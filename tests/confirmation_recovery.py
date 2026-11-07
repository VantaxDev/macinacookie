#!/usr/bin/env python3
"""Retain the actual dashboard dialog across an extension worker stop/popup wake.

No personal profile or website navigation. Controls use native WebDriver clicks;
only cookie/ledger setup is synthetic. Browser egress/GPU are disabled locally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import zipfile

import lifecycle as L
import worker_lifecycle as W

ROOT = Path(__file__).resolve().parents[1]
ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'
observations = []
W.observations = observations


def check(label, condition, detail=None):
    observations.append({'check': label, 'passed': bool(condition), 'detail': detail})
    if not condition:
        raise AssertionError((label, detail))
    print('PASS', label, flush=True)


def click(d, selector):
    # Explicit scrolling completes before the native click; CSS smooth scrolling
    # otherwise makes ChromeDriver aim outside the current viewport.
    d.run('document.querySelector(' + json.dumps(selector) + ').scrollIntoView({block: "center", behavior: "instant"}); return true;')
    element = d.command('/element', {'using': 'css selector', 'value': selector})[ELEMENT]
    d.command('/element/' + element + '/click', {})


def preview(d):
    assert L.wait(d, '!document.querySelector("#preview-button").disabled')
    click(d, '#preview-button')
    assert L.wait(d, '!document.querySelector("#preview-button").disabled && !document.querySelector("#preview-results").hidden && document.querySelectorAll("#cookie-rows tr").length===1')
    return d.run('return (await chrome.storage.session.get("macinacookiePreview")).macinacookiePreview;')


def dialog(d):
    click(d, '#delete-button')
    assert L.wait(d, 'document.querySelector("#confirm-dialog").open')


def run(d, profile, output):
    L.fixture(d)
    L.click(d, '#activate-observation', True)
    L.age_legacy(d)
    # Explicit revoke/regrant clears the worker cache without a setup restart;
    # age/ledger fixtures survive, automatic cleanup is still unauthorized.
    L.click(d, '#revoke-observation', False)
    L.click(d, '#activate-observation', True)
    check('eligible synthetic fixture with separately unauthorized automatic cleanup',
          L.data(d, 'GET_STATUS')['stats']['eligible'] == 1 and
          L.storage(d)[L.CONSENT]['autoAuthorized'] is False)
    first = preview(d)
    dialog(d)
    dashboard = d.call('GET', f'/session/{d.sid}/window')
    marker = d.run('window.confirmationFixtureMarker="retained-original-document"; return window.confirmationFixtureMarker;')
    check('confirmation open with keyboard-safe cancel focus before stop',
          d.run('return document.querySelector("#confirm-dialog").open && document.activeElement.id==="cancel-delete";'))
    old = W.stop(d, profile)
    popup = d.command('/window/new', {'type': 'tab'})['handle']
    d.command('/window', {'handle': popup})
    d.command('/url', {'url': d.url.replace('dashboard.html', 'popup.html')})
    W.woke(d, profile, old, 'separate popup tab wake')
    check('real popup ready after wake', L.wait(d, 'document.querySelector("#popup-stats").getAttribute("aria-busy")==="false" && document.querySelector("#popup-error").hidden'))
    d.command('/window', {'handle': dashboard})
    check('same original dashboard document and open dialog retained across wake',
          d.run('return window.confirmationFixtureMarker;') == marker and
          d.run('return document.querySelector("#confirm-dialog").open;'))
    click(d, '#confirm-delete')
    assert L.wait(d, '!document.querySelector("#confirm-dialog").open && !document.querySelector("#preview-button").disabled')
    state = d.run('return {feedback:document.querySelector("#feedback").textContent, role:document.querySelector("#feedback").getAttribute("role"), hidden:document.querySelector("#feedback").hidden, focus:document.activeElement.id, resultsHidden:document.querySelector("#preview-results").hidden, oldDeleteDisabled:document.querySelector("#delete-button").disabled};')
    check('obsolete confirmation rejects with actionable announced expiry error',
          'scaduto' in state['feedback'] and 'nuovo riepilogo' in state['feedback'] and
          state['role'] == 'alert' and not state['hidden'], state)
    check('recovery focus returns to enabled preview action with stale selection cleared',
          state['focus'] == 'preview-button' and state['resultsHidden'] and state['oldDeleteDisabled'], state)
    check('stale confirmation preserves synthetic cookie', L.cookie_names(d) == ['synthetic-aged'])
    L.capture(d, output, '01-stale-confirmation-recovery.png')
    fresh = preview(d)
    check('new UI preview is eligible and uses a different authorization token',
          fresh['total'] == 1 and fresh['token'] != first['token'])
    dialog(d)
    click(d, '#cancel-delete')
    check('cancel recovery preview leaves cookie and dialog state unchanged',
          not d.run('return document.querySelector("#confirm-dialog").open;') and
          L.cookie_names(d) == ['synthetic-aged'])
    dialog(d)
    L.capture(d, output, '02-fresh-confirmation-fixture.png')
    click(d, '#confirm-delete')
    assert L.wait(d, '!document.querySelector("#confirm-dialog").open && !document.querySelector("#preview-button").disabled')
    result = L.data(d, 'GET_STATUS')['lastRun']
    check('fresh confirmation performs exactly one synthetic deletion',
          result['mode'] == 'manual' and result['deleted'] == 1 and result['failed'] == 0 and
          L.cookie_names(d) == [], result)
    check('success is announced and keyboard focus remains on preview action',
          d.run('return !document.querySelector("#feedback").hidden && document.querySelector("#feedback").textContent.includes("Pulizia completata") && document.querySelector("#feedback").getAttribute("role")==="status" && document.activeElement.id==="preview-button";'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not __debug__:
        parser.error('Assertions must be enabled; do not use -O')
    args.output.mkdir(parents=True, exist_ok=False)
    digest = hashlib.sha256(args.package.read_bytes()).hexdigest()
    assert digest == args.sha256, 'Unexpected package hash'
    browser = shutil.which('chromium')
    if not browser:
        raise RuntimeError('Existing Chromium required; nothing will be installed')
    result = {'package_sha256': digest, 'harness_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'browser': subprocess.check_output([browser, '--version'], text=True).strip(),
              'scope': 'native retained-dialog controls; one synthetic profile/session; extension-only worker stop',
              'rendered_pixels_independently_reviewed': False}
    try:
        with tempfile.TemporaryDirectory(prefix='macinacookie-confirmation-') as tmp:
            tmp = Path(tmp)
            L.EXTENSION = tmp / 'extension'
            with zipfile.ZipFile(args.package) as z:
                assert len(z.namelist()) == len(L.FILES) and set(z.namelist()) == set(L.FILES)
                assert z.testzip() is None
                for name in L.FILES:
                    assert z.read(name) == (ROOT / 'extension' / name).read_bytes(), name
                z.extractall(L.EXTENSION)
            check('exact ZIP CRC/allowlist and 16/16 source bytes before extraction', True)
            # Ephemeral wrapper, NOT a system/browser configuration change. No
            # listener/server is started; an unused loopback proxy denies egress.
            binpath = tmp / 'bin'
            binpath.mkdir()
            wrapper = binpath / 'chromium'
            wrapper.write_text('#!/bin/sh\nexec ' + shlex.quote(browser) + ' --disable-gpu --disable-gpu-compositing --proxy-server=http://127.0.0.1:9 --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost" "$@"\n')
            wrapper.chmod(0o700)
            previous_path = os.environ.get('PATH', '')
            os.environ['PATH'] = str(binpath) + os.pathsep + previous_path
            try:
                profile = tmp / 'profile'
                d = L.open_browser(profile, '1.2.0')
                result['webdriver_session'] = d.sid
                try:
                    run(d, profile, args.output)
                finally:
                    d.close()
            finally:
                os.environ['PATH'] = previous_path
    finally:
        result['observations'] = observations
        result['passed'] = sum(item['passed'] for item in result['observations'])
        (args.output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(str(result['passed']) + ' retained-dialog recovery assertions passed', flush=True)


if __name__ == '__main__':
    main()

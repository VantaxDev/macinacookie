#!/usr/bin/env python3
"""Packaged Chromium restart/migration acceptance; disposable synthetic data only.

Driver transport is reused from chromium.py, without importing/running its suite.
All candidate runs load the verified extracted ZIP. Update controls use a synthetic
older manifest (same runtime); this is NOT CRX/Store update coverage.
"""
import base64, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
EXTENSION = pathlib.Path(os.environ.get('MACINACOOKIE_EXTENSION', ROOT/'extension')).resolve()
class Driver:
    def __init__(self, profile):
        self.log = self.proc = self.sid = None
        try:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            self.base = f'http://127.0.0.1:{port}'
            self.log = tempfile.TemporaryFile()
            self.proc = subprocess.Popen(['chromedriver', f'--port={port}', '--allowed-ips=127.0.0.1'], stdout=self.log, stderr=self.log)
            for _ in range(100):
                try:
                    self.call('GET', '/status')
                    break
                except Exception as error:
                    status_error = error
                    time.sleep(.1)
            else:
                raise status_error
            args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', f'--user-data-dir={profile}', f'--load-extension={EXTENSION}']
            if os.getuid() == 0: args.append('--no-sandbox')
            self.sid = self.call('POST', '/session', {'capabilities': {'alwaysMatch': {'goog:chromeOptions': {'binary': shutil.which('chromium'), 'args': args}}}})['sessionId']
        except BaseException:
            # Construction may fail before a caller receives this instance.
            try: self.close()
            except BaseException: pass  # Preserve the acquisition exception.
            raise
    def call(self, method, path, data=None):
        req=urllib.request.Request(self.base+path, data=json.dumps(data).encode() if data is not None else None, method=method, headers={'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=45) as r: v=json.load(r)['value']
        except urllib.error.HTTPError as e: raise RuntimeError(e.read().decode()) from e
        if isinstance(v,dict) and 'error' in v: raise RuntimeError(v)
        return v
    def command(self, path, data): return self.call('POST',f'/session/{self.sid}'+path,data)
    def js(self, code): return self.command('/execute/async', {'script': 'const done=arguments[arguments.length-1]; (async()=>{'+code+'})().then(v=>done({value:v}),e=>done({error:String(e)}));','args':[]})
    def run(self, code):
        v=self.js(code)
        assert 'error' not in v, v
        return v.get('value')
    def open(self):
        for _ in range(100):
            targets=self.command('/goog/cdp/execute', {'cmd':'Target.getTargets','params':{}})['targetInfos']
            workers=[t for t in targets if t['type']=='service_worker' and t['url'].endswith('/service-worker.js')]
            if workers: break
            time.sleep(.1)
        assert workers, targets
        self.url=workers[0]['url'].rsplit('/',1)[0]+'/dashboard.html'
        self.command('/url',{'url':self.url})
    def close(self):
        failure = None
        sid = getattr(self, 'sid', None)
        self.sid = None  # DELETE is attempted at most once, even on error.
        if sid is not None:
            try: self.call('DELETE', f'/session/{sid}')
            except BaseException as error: failure = error
        proc = getattr(self, 'proc', None)
        if proc is not None:
            try: proc.terminate()
            except ProcessLookupError: pass
            except BaseException as error: failure = failure or error
            try:
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()  # Only the Popen child acquired by this Driver.
                    proc.wait(timeout=5)
                self.proc = None
            except BaseException as error: failure = failure or error
        log = getattr(self, 'log', None)
        if log is not None:
            try:
                log.close()
                self.log = None
            except BaseException as error: failure = failure or error
        if failure is not None: raise failure

import argparse, hashlib, zipfile
sys.path.insert(0, str(ROOT / 'scripts'))
from build import FILES

CONSENT = 'macinacookieConsent'
STATE = 'macinacookieState'
ALARM = 'macinacookie-cleanup'
checks = []
observations = []
sessions = []

def check(label, condition, detail=None):
    observations.append({'check': label, 'passed': bool(condition), 'detail': detail})
    assert condition, (label, detail)
    checks.append(label)
    print('PASS', label, flush=True)

def msg(d, kind, **fields):
    return d.run('return await chrome.runtime.sendMessage('+json.dumps({'type': kind, **fields})+');')

def data(d, kind, **fields):
    result = msg(d, kind, **fields)
    assert result['ok'], result
    return result['data']

def storage(d):
    return d.run('return await chrome.storage.local.get(null);')

def wait(d, expression):
    return d.run('for(let i=0;i<100;i++){if('+expression+')return true; await new Promise(r=>setTimeout(r,50));} return false;')

def click(d, selector, active):
    assert wait(d, 'document.querySelector('+json.dumps(selector)+') && !document.querySelector('+json.dumps(selector)+').hidden && !document.querySelector('+json.dumps(selector)+').disabled')
    d.run('document.querySelector('+json.dumps(selector)+').click(); return true;')
    assert wait(d, '(await chrome.runtime.sendMessage({type:"GET_CONSENT"})).data.active === '+json.dumps(active))
    assert wait(d, 'document.body.classList.contains("observation-active") === '+json.dumps(active))

def cookie_names(d):
    return d.run('return (await chrome.cookies.getAll({domain:"lifecycle.example.test"})).map(c=>c.name).sort();')

def fixture(d):
    # Fixture API writes are test setup, not product observation/consent.
    d.run('return await chrome.cookies.set({url:"https://lifecycle.example.test/", name:"synthetic-aged", value:"fixture-only", secure:true, expirationDate:Date.now()/1000+864000});')

def age_legacy(d):
    data(d, 'GET_STATUS')
    return d.run('''
      const s=(await chrome.storage.local.get("macinacookieState")).macinacookieState;
      for(const r of Object.values(s.records))r.firstSeenAt=Date.now()-90*86400000;
      s.settings.maxAgeDays=1; s.settings.autoEnabled=true;
      s.nextRunAt=Date.now()-60000;
      await chrome.storage.local.set({macinacookieState:s});return s;
    ''')

def capture(d, output, name):
    d.command('/goog/cdp/execute', {'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1280,'height':800,'deviceScaleFactor':1,'mobile':False}})
    d.run('await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return true;')
    png=d.command('/goog/cdp/execute', {'cmd':'Page.captureScreenshot','params':{'format':'png','captureBeyondViewport':False}})
    (output/name).write_bytes(base64.b64decode(png['data']))
    d.command('/goog/cdp/execute', {'cmd':'Emulation.clearDeviceMetricsOverride','params':{}})

def open_browser(profile, expected_version):
    d=Driver(profile)
    try:
        d.open()
        version=d.run('return chrome.runtime.getManifest().version;')
        assert version == expected_version, version
        sessions.append({'session':d.sid,'version':version,'extension':d.url,'profile':str(profile)})
        return d
    except BaseException:
        try: d.close()
        except BaseException: pass  # Preserve the open/version error.
        raise

def inactive(d, label, expected_ledger):
    # Delay crosses the explicitly seeded due alarm. This is not a sleep-based
    # success oracle: persisted proof, rejected operations, ledger and cookie
    # identity are all checked independently after the timer boundary.
    d.run('await new Promise(r=>setTimeout(r,1600));return true;')
    status=data(d,'GET_CONSENT')
    ledger=storage(d).get(STATE)
    responses=[msg(d,'PREVIEW'),msg(d,'DELETE_PREVIEW',token='stale-fixture',ids=['fixture'])]
    check(label, not status['active'] and ledger==expected_ledger and
          cookie_names(d)==['synthetic-aged'] and all(not r['ok'] for r in responses),
          {'consent':status,'blockedResponses':responses,'ledgerPreserved':ledger==expected_ledger})
    check(label+' / UI', not d.run('return document.body.classList.contains("observation-active");') and
          d.run('return document.querySelector("#consent-details").open;'))


def lifecycle(profile, output, version):
    d=open_browser(profile,version)
    try:
        fixture(d)
        inactive(d,'new profile without proof stays inactive after cookie event',None)
    finally:d.close()
    d=open_browser(profile,version)
    try:
        inactive(d,'missing proof remains inactive after full restart',None)
        click(d,'#activate-observation',True)
        proof=storage(d)[CONSENT]
        check('explicit UI grant stores versioned proof without automatic authorization',proof=={'version':1,'accepted':True,'autoAuthorized':False})
        age_legacy(d)
    finally:d.close()
    d=open_browser(profile,version)
    try:
        status=data(d,'GET_STATUS')
        check('grant survives restart; legacy automatic setting cannot authorize deletion',status['consent']['active'] and status['stats']['eligible']==1 and not status['settings']['autoEnabled'] and cookie_names(d)==['synthetic-aged'],status)
        # Positive control: fixture genuinely eligible and preview accessible.
        preview=data(d,'PREVIEW')
        check('positive control produces eligible manual preview',preview['total']==1,preview)
        capture(d,output,'01-granted-after-restart.png')
        before=storage(d)[STATE]
        click(d,'#revoke-observation',False)
        check('UI revoke preserves ledger and cookie',storage(d)[STATE]==before and cookie_names(d)==['synthetic-aged'])
    finally:d.close()
    d=open_browser(profile,version)
    try:
        inactive(d,'revocation survives restart with ledger unchanged',before)
        check('previous preview cannot authorize deletion after restart',not msg(d,'DELETE_PREVIEW',token=preview['token'],ids=[r['id'] for r in preview['rows']])['ok'])
        capture(d,output,'02-revoked-after-restart.png')
    finally:d.close()


def update_control(profile, output, current_manifest, proof, label):
    # Real Chromium profile close/reopen and unpacked version transition; only
    # manifest.version differs in the synthetic predecessor. Target is restored
    # byte-for-byte BEFORE Chromium starts and verified again after all runs.
    manifest_file=EXTENSION/'manifest.json'
    predecessor=json.loads(current_manifest)
    predecessor['version']='1.1.999'
    manifest_file.write_text(json.dumps(predecessor,indent=2)+'\n')
    d=open_browser(profile,'1.1.999')
    try:
        fixture(d)
        click(d,'#activate-observation',True)
        ledger=age_legacy(d)
        if proof is None:
            d.run('await chrome.storage.local.remove("macinacookieConsent");return true;')
        else:
            d.run('await chrome.storage.local.set({macinacookieConsent:'+json.dumps(proof)+'});return true;')
        # Inactive profile intentionally retains a legacy due alarm.
        d.run('await chrome.alarms.create("macinacookie-cleanup",{when:Date.now()+1000}); return true;')
        identity=d.url
    finally:
        d.close()
        manifest_file.write_bytes(current_manifest)
    d=open_browser(profile,json.loads(current_manifest)['version'])
    try:
        check(label+' / stable extension identity',d.url==identity)
        check(label+' / proof preserved, not silently upgraded',storage(d).get(CONSENT)==proof)
        if proof and proof.get('version')==1 and proof.get('accepted'):
            s=data(d,'GET_STATUS')
            check(label+' / valid observation proof retained, legacy auto ignored',s['consent']['active'] and not s['settings']['autoEnabled'] and s['stats']['eligible']==1 and cookie_names(d)==['synthetic-aged'],s)
            check(label+' / manual positive control',data(d,'PREVIEW')['total']==1)
        else:
            inactive(d,label+' / no implicit migration grant or deletion',ledger)
            capture(d,output,'03-'+label+'.png')
            click(d,'#activate-observation',True)
            s=data(d,'GET_STATUS')
            check(label+' / new explicit grant works, automatic stays unauthorized',s['consent']['active'] and not s['settings']['autoEnabled'] and storage(d)[CONSENT]=={'version':1,'accepted':True,'autoAuthorized':False} and s['stats']['eligible']==1,s)
    finally:d.close()



def automatic_control(profile, output, version):
    d=open_browser(profile,version)
    try:
        fixture(d)
        click(d,'#activate-observation',True)
        assert wait(d,'!document.querySelector("#auto-enabled").disabled')
        # Separate actual dashboard action; observation grant alone is not enough.
        d.run('document.querySelector("#auto-enabled").click(); document.querySelector("#save-settings").click();return true;')
        assert wait(d,'(await chrome.storage.local.get("macinacookieConsent")).macinacookieConsent.autoAuthorized===true')
        check('positive auto control requires separate saved UI authorization',storage(d)[CONSENT]=={'version':1,'accepted':True,'autoAuthorized':True})
        age_legacy(d)
    finally:d.close()
    d=open_browser(profile,version)
    try:
        assert wait(d,'(await chrome.runtime.sendMessage({type:"GET_STATUS"})).data.lastRun?.mode==="auto"')
        s=data(d,'GET_STATUS')
        check('positive automatic deletion works across restart only with authorization',s['lastRun']['deleted']==1 and s['lastRun']['failed']==0 and cookie_names(d)==[],s)
        capture(d,output,'04-authorized-auto-positive-control.png')
        click(d,'#revoke-observation',False)
        fixture(d)
        inactive(d,'revoking automatic profile blocks a new synthetic cookie',storage(d)[STATE])
    finally:d.close()


def main():
    global EXTENSION
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=pathlib.Path)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    if not __debug__:
        parser.error('Run without -O: acceptance assertions must be enabled')
    # Never mix stale output with a fresh proof, or consume a user's profile.
    args.output.mkdir(parents=True,exist_ok=False)
    digest=hashlib.sha256(args.package.read_bytes()).hexdigest()
    assert digest==args.sha256,'Unexpected package hash'
    result={'sha256':digest,'scope':'Chromium unpacked restart and synthetic predecessor update; not Store/CRX',
            'harness_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            'manifest':json.loads((ROOT/'extension/manifest.json').read_text()),
            'file_sha256':{n:hashlib.sha256((ROOT/'extension'/n).read_bytes()).hexdigest() for n in FILES},
            'runtime_git':subprocess.check_output(['git','rev-parse','HEAD:extension'],cwd=ROOT,text=True).strip(),
            'browser':subprocess.check_output(['chromium','--version'],text=True).strip()}
    with tempfile.TemporaryDirectory(prefix='macinacookie-lifecycle-') as temp:
        temp=pathlib.Path(temp)
        EXTENSION=temp/'extension'
        with zipfile.ZipFile(args.package) as archive:
            assert len(archive.namelist())==len(FILES) and set(archive.namelist())==set(FILES),'allowlist/duplicates'
            assert archive.testzip() is None,'CRC'
            for name in FILES:
                assert archive.read(name)==(ROOT/'extension'/name).read_bytes(),name
            archive.extractall(EXTENSION)
        check('current ZIP SHA/CRC/allowlist and 14 source-identical files',True)
        manifest=(EXTENSION/'manifest.json').read_bytes()
        try:
            lifecycle(temp/'restart-profile',args.output,json.loads(manifest)['version'])
            for label,proof in [('update-valid',{'version':1,'accepted':True,'autoAuthorized':False}),
                                ('update-revoked',{'version':1,'accepted':False,'autoAuthorized':False}),
                                ('update-missing',None),
                                ('update-old-proof',{'version':0,'accepted':True,'autoAuthorized':True})]:
                update_control(temp/label,args.output,manifest,proof,label)
            automatic_control(temp/'automatic-profile',args.output,json.loads(manifest)['version'])
            check('target restored byte-identical after synthetic update controls',all((EXTENSION/n).read_bytes()==(ROOT/'extension'/n).read_bytes() for n in FILES))
        finally:
            result['sessions']=sessions
            result['observations']=observations
            result['passed']=len(checks)
            (args.output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(str(len(checks))+' packaged lifecycle assertions passed')

if __name__=='__main__':main()

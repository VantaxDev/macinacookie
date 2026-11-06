#!/usr/bin/env python3
"""Real Chromium integration in a disposable profile. No third-party Python deps."""
import base64, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
EXTENSION = pathlib.Path(os.environ.get('MACINACOOKIE_EXTENSION', ROOT/'extension')).resolve()
from lifecycle import Driver

checks=[]
def check(label, condition):
    assert condition, label
    checks.append(label); print('PASS', label, flush=True)

def message(d, obj):
    r=d.run('return await chrome.runtime.sendMessage('+json.dumps(obj)+');')
    assert r['ok'],r
    return r['data']

def screenshot(d, name):
    """Optional local store draft: actual UI, synthetic fixture, no personal profile."""
    destination = os.environ.get('MACINACOOKIE_SCREENSHOTS')
    if not destination:
        return
    output = pathlib.Path(destination)
    output.mkdir(parents=True, exist_ok=True)
    d.command('/goog/cdp/execute', {'cmd': 'Emulation.setDeviceMetricsOverride', 'params': {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False}})
    try:
        d.run('await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return true;')
        result = d.command('/goog/cdp/execute', {'cmd': 'Page.captureScreenshot', 'params': {'format': 'png', 'captureBeyondViewport': False}})
        (output / name).write_bytes(base64.b64decode(result['data']))
    finally:
        d.command('/goog/cdp/execute', {'cmd': 'Emulation.clearDeviceMetricsOverride', 'params': {}})

def activate_observation(d):
    return d.run('''for(let i=0;i<100;i++) {
      const b=document.querySelector("#activate-observation");
      if(b && !b.disabled && !b.hidden) {b.click();break;}
      await new Promise(r=>setTimeout(r,50));
    }
    for(let i=0;i<100;i++) {
      if(document.body.classList.contains("observation-active") && !document.querySelector("#preview-button").disabled)return true;
      await new Promise(r=>setTimeout(r,50));
    }return false;''')


def branding_smoke():
    """Focused UI/package regression; does not run the unchanged cleanup suite."""
    with tempfile.TemporaryDirectory(prefix='macinacookie-branding-') as profile:
        d = Driver(profile)
        try:
            d.open()
            inactive = message(d, {'type': 'GET_STATUS'})
            check('default inactive with visible disclosure and no stored ledger', not inactive['consent']['active'] and d.run('return !document.body.classList.contains("observation-active") && document.querySelector("#consent-details").open && !(await chrome.storage.local.get("macinacookieState")).macinacookieState;'))
            screenshot(d, '00-disclosure-fixture.png')
            check('explicit UI activation, automatic cleanup stays off', activate_observation(d) and not message(d, {'type': 'GET_STATUS'})['settings']['autoEnabled'])
            check('Chrome sidebar identity', d.run('return document.querySelector(".version-label").textContent;') == 'ESTENSIONE PER CHROME')
            check('desktop-only dashboard copy', d.run('return !/Android|ESTENSIONE PER FIREFOX/i.test(document.documentElement.textContent) && document.querySelector("#schedule-help").textContent.includes("Chrome");'))
            d.run('''for (const [name, domain] of [["old", "old.example.test"], ["protected", "keep.example.test"], ["recent", "recent.example.test"]]) {
              await chrome.cookies.set({url: "https://"+domain+"/", name, value: "synthetic-branding-"+name, secure: true, expirationDate: Date.now()/1000+864000});
            } return true;''')
            message(d, {'type': 'SAVE_SETTINGS', 'settings': {'maxAgeDays': 1, 'autoEnabled': False, 'intervalHours': 6, 'excludedDomains': ['keep.example.test']}})
            d.run('''const {macinacookieState:s}=await chrome.storage.local.get("macinacookieState");
              for (const [key, r] of Object.entries(s.records)) if (JSON.parse(key)[3]!=="recent") r.firstSeenAt=Date.now()-3*86400000;
              await chrome.storage.local.set({macinacookieState:s}); return true;''')
        finally:
            d.close()
        d = Driver(profile)
        try:
            d.open()
            status = message(d, {'type': 'GET_STATUS'})
            check('fixture counts and safe manual defaults', status['stats']['total']==3 and status['stats']['eligible']==1 and status['stats']['protected']==1 and not status['settings']['autoEnabled'])
            screenshot(d, '01-overview-fixture.png')
            check('manual preview renders from extracted package', d.run('document.querySelector("#preview-button").click(); for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll("#cookie-rows tr").length===1 && !document.querySelector("#preview-button").disabled)return true;} return false;'))
            check('confirmation and cancel remain usable', d.run('document.querySelector("#delete-button").click(); return document.querySelector("#confirm-dialog").open && document.querySelector("#confirm-warning").textContent.includes("disconnetterti");'))
            check('singular confirmation text and button', d.run('return document.querySelector("#confirm-description").textContent.startsWith("Stai per cancellare 1 cookie su 1 sito.") && document.querySelector("#confirm-delete").textContent === "Cancella 1 cookie";'))
            screenshot(d, '02-confirmation-fixture.png')
            d.run('document.querySelector("#cancel-delete").click(); return true;')
            check('cancel preserves all synthetic cookies', d.run('return (await chrome.cookies.getAll({partitionKey:{}})).length===3;'))
            message(d, {'type': 'SAVE_SETTINGS', 'settings': {'maxAgeDays': 1, 'autoEnabled': True, 'intervalHours': 6, 'excludedDomains': ['keep.example.test']}})
            d.command('/refresh', {})
            check('desktop automatic schedule copy', d.run('for(let i=0;i<100;i++){if(document.querySelector("#saved-rule-description").textContent.includes("Chrome deve essere aperto"))return true; await new Promise(r=>setTimeout(r,50));}return false;'))
            d.command('/url', {'url': d.url.replace('dashboard.html', 'popup.html')})
            check('popup renders desktop schedule without obsolete copy', d.run('for(let i=0;i<100;i++){if(document.querySelector("#popup-stats").getAttribute("aria-busy")==="false")return !/Android|Firefox/i.test(document.documentElement.textContent) && document.querySelector("#popup-next").textContent.includes("con Chrome aperto"); await new Promise(r=>setTimeout(r,50));}return false;'))
            d.command('/url', {'url': d.url})
            check('UI revocation returns to inactive disclosure without deleting ledger', d.run('for(let i=0;i<100;i++){if(!document.querySelector("#revoke-observation").hidden)break; await new Promise(r=>setTimeout(r,50));} document.querySelector("#revoke-observation").click(); for(let i=0;i<100;i++){const s=(await chrome.storage.local.get("macinacookieConsent")).macinacookieConsent;if(s?.accepted===false)return !document.body.classList.contains("observation-active") && !!(await chrome.storage.local.get("macinacookieState")).macinacookieState && (await chrome.cookies.getAll({partitionKey:{}})).length===3;await new Promise(r=>setTimeout(r,50));}return false;'))
            screenshot(d, '03-inactive-after-revocation.png')
        finally:
            d.close()
    print(f'{len(checks)} focused Chromium consent/UI checks passed')


if os.environ.get('MACINACOOKIE_CHECKS') in ('branding', 'consent'):
    branding_smoke()
    sys.exit(0)

with tempfile.TemporaryDirectory(prefix='macinacookie-chromium-') as profile:
    d=Driver(profile)
    try:
        d.open()
        assert activate_observation(d), 'explicit fixture opt-in'
        status=message(d,{'type':'GET_STATUS'})
        check('MV3 worker loads; scan available', status['scanAvailable'] and not status['warning'])
        check('safe defaults',status['settings']['maxAgeDays']==30 and not status['settings']['autoEnabled'])
        check('dashboard loads without warning', d.run('return document.querySelector("#status-warning").hidden;'))
        d.run('''for (const [name,domain,key] of [["old","old.example.test",null],["recent","recent.example.test",null],["protected","keep.example.test",null],["changed","change.example.test",null],["partition","old.example.test",{topLevelSite:"https://top.example.test",hasCrossSiteAncestor:true}]]) {
          await chrome.cookies.set({url:"https://"+domain+"/", name,value:"synthetic-secret-"+name,secure:true,sameSite:"no_restriction",expirationDate:Date.now()/1000+864000,...(key?{partitionKey:key}:{})});
        } return true;''')
        status=message(d,{'type':'GET_STATUS'})
        check('all five synthetic cookies including CHIPS enumerated',status['stats']['total']==5)
        check('new cookies never eligible',status['stats']['eligible']==0)
        message(d,{'type':'SAVE_SETTINGS','settings':{'maxAgeDays':1,'autoEnabled':False,'intervalHours':6,'excludedDomains':['keep.example.test']}})
        # Age only synthetic records in the disposable profile. Reload below clears
        # the worker cache; production code contains no clock or test hooks.
        d.run('''const {macinacookieState:s}=await chrome.storage.local.get("macinacookieState");
        for(const [key,r] of Object.entries(s.records)) if(JSON.parse(key)[3]!=="recent") r.firstSeenAt=Date.now()-3*86400000;
        await chrome.storage.local.set({macinacookieState:s}); return true;''')
    finally: d.close()
    d=Driver(profile)
    try:
        d.open()
        status=message(d,{'type':'GET_STATUS'})
        check('settings, age and exclusion survive full browser restart',status['settings']['intervalHours']==6 and status['stats']['eligible']==3 and status['stats']['protected']==1)
        check('UI creates preview table',d.run('document.querySelector("#preview-button").click(); for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(document.querySelectorAll("#cookie-rows tr").length===3 && !document.querySelector("#preview-button").disabled)return true;} return false;'))
        screenshot(d, '01-preview-fixture.png')
        p=d.run('return (await chrome.storage.session.get("macinacookiePreview")).macinacookiePreview;')
        check('UI search filters rows',d.run('const e=document.querySelector("#cookie-search");e.value="partition";e.dispatchEvent(new Event("input"));return document.querySelectorAll("#cookie-rows tr").length===1;'))
        check('UI search preserves selected rows',d.run('const e=document.querySelector("#cookie-search");e.value="";e.dispatchEvent(new Event("input"));return document.querySelectorAll("#cookie-rows input:checked").length===3;'))
        check('UI requires confirmation',d.run('document.querySelector("#delete-button").click();return document.querySelector("#confirm-dialog").open;'))
        screenshot(d, '02-confirmation-fixture.png')
        check('UI cancel deletes nothing',d.run('document.querySelector("#cancel-delete").click();return !document.querySelector("#confirm-dialog").open && (await chrome.cookies.getAll({partitionKey:{}})).length===5;'))
        check('preview includes normal and partitioned cookies',p['total']==3 and any(r['partitionSite'] for r in p['rows']))
        check('preview contains no raw cookie values','synthetic-secret' not in json.dumps(p))
        d.run('return await chrome.cookies.set({url:"https://change.example.test/",name:"changed",value:"changed-after-preview",secure:true,sameSite:"no_restriction",expirationDate:Date.now()/1000+864000});')
        check('UI confirmed deletion completes',d.run('document.querySelector("#delete-button").click();document.querySelector("#confirm-delete").click();for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));if(!document.querySelector("#feedback").hidden && document.querySelector("#feedback").textContent.includes("Pulizia completata"))return true;}return false;'))
        last=message(d,{'type':'GET_STATUS'})['lastRun']
        r={k:last[k] for k in ['deleted','skipped','failed']}
        check('only two unchanged selected cookies deleted',r=={'deleted':2,'skipped':1,'failed':0})
        names=d.run('return (await chrome.cookies.getAll({partitionKey:{}})).map(c=>c.name).sort();')
        check('protected, recent and changed cookies preserved',names==['changed','protected','recent'])
        r=d.run('return await chrome.runtime.sendMessage('+json.dumps({'type':'DELETE_PREVIEW','token':p['token'],'ids':[p['rows'][0]['id']]})+');')
        check('preview replay rejected',not r['ok'])
        ledger=d.run('return await chrome.storage.local.get(null);')
        check('persistent storage contains no raw cookie values','synthetic-secret' not in json.dumps(ledger) and 'changed-after-preview' not in json.dumps(ledger))
        d.command('/url',{'url':d.url.replace('dashboard.html','popup.html')})
        check('popup reads worker status',d.run('await new Promise(r=>setTimeout(r,300)); return document.querySelector("#popup-error").hidden && document.querySelector("#popup-total").textContent==="3";'))
        d.command('/url',{'url':d.url})
        d.command('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':360,'height':800,'deviceScaleFactor':1,'mobile':False}})
        check('dashboard fits narrow viewport',d.run('return document.documentElement.scrollWidth<=innerWidth;'))
        # The unchanged pending cookie will be removed by overdue automatic cleanup.
        # Authorize through the explicit control; legacy autoEnabled alone is not consent.
        automatic_settings = dict(message(d, {'type': 'GET_STATUS'})['settings'], autoEnabled=True)
        message(d, {'type': 'SAVE_SETTINGS', 'settings': automatic_settings})
        d.run('''const {macinacookieState:s}=await chrome.storage.local.get("macinacookieState");
        s.nextRunAt=Date.now()-10000;
        await chrome.storage.local.set({macinacookieState:s}); return true;''')
    finally: d.close()
    d=Driver(profile)
    try:
        d.open(); status=message(d,{'type':'GET_STATUS'})
        check('overdue automatic cleanup recovered after restart',status['lastRun']['mode']=='auto' and status['lastRun']['deleted']==1)
        check('automatic cleanup preserves exclusions and recent cookies',status['stats']['total']==2)
        check('next alarm restored in future',d.run('const a=await chrome.alarms.get("macinacookie-cleanup"); return a.scheduledTime>Date.now();'))
        check('permission set minimal',d.run('return JSON.stringify(chrome.runtime.getManifest().permissions)==="[\\"cookies\\",\\"storage\\",\\"alarms\\"]";'))
        # Ensure extension CSP rejects network access before any request is sent.
        check('CSP blocks outbound fetch',d.run('try {await fetch("https://example.com/"); return false;} catch {return true;}'))
    finally: d.close()
print(f'{len(checks)} real Chromium checks passed')

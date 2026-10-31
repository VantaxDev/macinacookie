#!/usr/bin/env python3
"""Real Chromium integration in a disposable profile. No third-party Python deps."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
EXTENSION = pathlib.Path(os.environ.get('MACINACOOKIE_EXTENSION', ROOT/'extension')).resolve()
class Driver:
    def __init__(self, profile):
        s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
        self.base = f'http://127.0.0.1:{port}'
        self.log = tempfile.TemporaryFile()
        self.proc = subprocess.Popen(['chromedriver', f'--port={port}', '--allowed-ips=127.0.0.1'], stdout=self.log, stderr=self.log)
        for _ in range(100):
            try: self.call('GET', '/status'); break
            except Exception: time.sleep(.1)
        args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', f'--user-data-dir={profile}', f'--load-extension={EXTENSION}']
        if os.getuid() == 0: args.append('--no-sandbox')
        self.sid = self.call('POST', '/session', {'capabilities': {'alwaysMatch': {'goog:chromeOptions': {'binary': shutil.which('chromium'), 'args': args}}}})['sessionId']
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
        try: self.call('DELETE',f'/session/{self.sid}')
        finally: self.proc.terminate(); self.proc.wait(timeout=10); self.log.close()

checks=[]
def check(label, condition):
    assert condition, label
    checks.append(label); print('PASS', label, flush=True)

def message(d, obj):
    r=d.run('return await chrome.runtime.sendMessage('+json.dumps(obj)+');')
    assert r['ok'],r
    return r['data']

with tempfile.TemporaryDirectory(prefix='macinacookie-chromium-') as profile:
    d=Driver(profile)
    try:
        d.open()
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
        p=d.run('return (await chrome.storage.session.get("macinacookiePreview")).macinacookiePreview;')
        check('UI search filters rows',d.run('const e=document.querySelector("#cookie-search");e.value="partition";e.dispatchEvent(new Event("input"));return document.querySelectorAll("#cookie-rows tr").length===1;'))
        check('UI search preserves selected rows',d.run('const e=document.querySelector("#cookie-search");e.value="";e.dispatchEvent(new Event("input"));return document.querySelectorAll("#cookie-rows input:checked").length===3;'))
        check('UI requires confirmation',d.run('document.querySelector("#delete-button").click();return document.querySelector("#confirm-dialog").open;'))
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
        d.run('''const {macinacookieState:s}=await chrome.storage.local.get("macinacookieState");
        s.settings.autoEnabled=true; s.nextRunAt=Date.now()-10000;
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

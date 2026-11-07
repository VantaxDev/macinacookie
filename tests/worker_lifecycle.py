#!/usr/bin/env python3
"""Real extension-only CDP stop/wake controls on an exact extracted ZIP."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tempfile, time, zipfile
import lifecycle as L
ROOT=pathlib.Path(__file__).resolve().parents[1]
NODE=pathlib.Path(os.environ.get('MACINACOOKIE_CDP_NODE', shutil.which('node') or 'node'))
observations=[]

def check(label,condition,detail=None):
    observations.append({'check':label,'passed':bool(condition),'detail':detail})
    assert condition,(label,detail)
    print('PASS',label,flush=True)

def targets(d):
    return [t for t in d.command('/goog/cdp/execute',{'cmd':'Target.getTargets','params':{}})['targetInfos'] if t['type']=='service_worker' and t['url']==d.url.replace('dashboard.html','service-worker.js')]

def cdp(d,profile,action):
    port, browser=pathlib.Path(profile,'DevToolsActivePort').read_text().splitlines()[:2]
    result=subprocess.run([str(NODE),str(ROOT/'tests/worker-cdp.cjs'),'ws://127.0.0.1:'+port+browser,d.url.replace('dashboard.html','service-worker.js'),action],capture_output=True,text=True,timeout=20)
    assert result.returncode==0,result.stderr
    return json.loads(result.stdout)

def stop(d,profile):
    before=targets(d)
    assert len(before)==1,before
    result=cdp(d,profile,'stop')
    check('CDP stopped only owned extension worker',result['after']['runningStatus']=='stopped' and not result['afterTargets'] and not targets(d),result)
    return before[0]['targetId'],result['before']['versionId'],result['context']['uniqueId']

def woke(d,profile,old,trigger,not_before=None):
    found=[]
    for _ in range(100):
        found=targets(d)
        if found:break
        time.sleep(.05)
    observed_at=time.time()*1000
    if not_before is not None:
        check(trigger+' target appeared only after scheduled alarm time',observed_at>=not_before,{'alarmWhen':not_before,'observedAt':observed_at})
    check(trigger+' worker target observed before diagnostic call',len(found)==1,found)
    identity=cdp(d,profile,'inspect')
    check(trigger+' has a new execution context, not the stopped instance',identity['context']['uniqueId']!=old[2],{'oldContext':old[2],'newContext':identity['context']['uniqueId'],'oldTarget':old[0],'newTargets':found})
    check(trigger+' retains installed versionId',identity['before']['versionId']==old[1],identity)


def alarm(d):
    return d.run('const when=Date.now()+3000; await chrome.alarms.create("macinacookie-cleanup",{when});return when;')

def create_event_cookie(d):
    # Direct extension-page cookie API is the controlled event source. No worker
    # request, popup navigation or status diagnostic occurs before observing wake.
    return d.run('return await chrome.cookies.set({url:"https://lifecycle.example.test/",name:"wake-fixture",value:"synthetic-event-"+Date.now(),secure:true,expirationDate:Date.now()/1000+864000});')

def inactive_evidence(d,before,label):
    response=L.msg(d,'PREVIEW')
    check(label+' stays inactive and rejects preview',not L.data(d,'GET_CONSENT')['active'] and not response['ok'],response)
    check(label+' preserves ledger and fixture cookies',L.storage(d)[L.STATE]==before and 'synthetic-aged' in L.cookie_names(d))

def age_due(d):
    L.data(d,'GET_STATUS')
    d.run("""
      const s=(await chrome.storage.local.get('macinacookieState')).macinacookieState;
      for(const [key,r] of Object.entries(s.records))if(JSON.parse(key)[3]==='synthetic-aged')r.firstSeenAt=Date.now()-90*86400000;
      s.settings.maxAgeDays=1;s.settings.autoEnabled=true;s.nextRunAt=Date.now()-60000;
      await chrome.storage.local.set({macinacookieState:s});return true;
    """)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=pathlib.Path)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    parser.add_argument('--preview-only',action='store_true',help='Replay only the reproduced preview defect')
    args=parser.parse_args()
    if not __debug__:parser.error('Assertions must be enabled; do not use -O')
    args.output.mkdir(parents=True,exist_ok=False)
    digest=hashlib.sha256(args.package.read_bytes()).hexdigest()
    assert digest==args.sha256
    result={'package_sha256':digest,'harness_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'cdp_helper_sha256':hashlib.sha256((ROOT/'tests/worker-cdp.cjs').read_bytes()).hexdigest(),'cdp_node':subprocess.check_output([str(NODE),'--version'],text=True).strip(),'browser':subprocess.check_output(['chromium','--version'],text=True).strip()}
    try:
        with tempfile.TemporaryDirectory(prefix='macinacookie-worker-') as tmp:
            tmp=pathlib.Path(tmp); L.EXTENSION=tmp/'extension'
            with zipfile.ZipFile(args.package) as z:
                assert len(z.namelist())==len(L.FILES) and set(z.namelist())==set(L.FILES)
                assert z.testzip() is None
                for name in L.FILES:assert z.read(name)==(ROOT/'extension'/name).read_bytes(),name
                z.extractall(L.EXTENSION)
            profile=tmp/'profile';d=L.open_browser(profile,'1.2.0')
            try:
                result['webdriver_session']=d.sid
                result['installed_manifest']=d.run('return chrome.runtime.getManifest();')
                L.fixture(d);L.click(d,'#activate-observation',True)
                L.age_legacy(d)
                # Reload worker cache without restarting browser. This first stop
                # is setup; subsequent stop is the actual preview boundary.
                old=stop(d,profile)
                d.command('/url',{'url':d.url.replace('dashboard.html','popup.html')})
                woke(d,profile,old,'popup setup wake')
                d.command('/url',{'url':d.url})
                preview=L.data(d,'PREVIEW')
                check('positive eligible preview before stop',preview['total']==1)
                old=stop(d,profile)
                d.command('/url',{'url':d.url.replace('dashboard.html','popup.html')})
                woke(d,profile,old,'popup preview wake')
                d.command('/url',{'url':d.url})
                response=L.msg(d,'DELETE_PREVIEW',token=preview['token'],ids=[r['id'] for r in preview['rows']])
                check('pre-termination preview is rejected without deleting cookie',not response['ok'] and L.cookie_names(d)==['synthetic-aged'],response)
                check('new preview works after worker restart',L.data(d,'PREVIEW')['total']==1)
                if not args.preview_only:
                    # Scenario 2: a real scheduled alarm wakes a revoked worker.
                    L.click(d,'#revoke-observation',False)
                    before=L.storage(d)[L.STATE]
                    when=alarm(d);old=stop(d,profile)
                    woke(d,profile,old,'revoked alarm wake',not_before=when)
                    inactive_evidence(d,before,'revoked alarm wake')
                    # Scenario 3: cookie onChanged wakes it, still revoked.
                    old=stop(d,profile)
                    create_event_cookie(d)
                    woke(d,profile,old,'revoked cookie event wake')
                    inactive_evidence(d,before,'revoked cookie event wake')
                    # Scenario 4: observing is NOT automatic cleanup authorization.
                    L.click(d,'#activate-observation',True)
                    age_due(d)
                    check('observation regrant has no automatic authorization',L.storage(d)[L.CONSENT]['autoAuthorized'] is False)
                    old=stop(d,profile)
                    create_event_cookie(d)
                    woke(d,profile,old,'observation-only cookie event wake')
                    status=L.data(d,'GET_STATUS')
                    check('event wake cannot inherit legacy automatic deletion',status['stats']['eligible']==1 and not status['settings']['autoEnabled'] and L.cookie_names(d)==['synthetic-aged','wake-fixture'],status)
                    # Scenario 5: separately enabled cleanup, real alarm positive.
                    d.command('/refresh',{})
                    assert L.wait(d,'!document.querySelector("#auto-enabled").disabled')
                    d.run('document.querySelector("#auto-enabled").click();document.querySelector("#save-settings").click();return true;')
                    assert L.wait(d,'(await chrome.storage.local.get("macinacookieConsent")).macinacookieConsent.autoAuthorized===true')
                    age_due(d)
                    when=alarm(d);old=stop(d,profile)
                    woke(d,profile,old,'authorized automatic alarm wake',not_before=when)
                    assert L.wait(d,'(await chrome.runtime.sendMessage({type:"GET_STATUS"})).data.lastRun?.mode==="auto"')
                    status=L.data(d,'GET_STATUS')
                    check('authorized alarm deletes only the eligible synthetic cookie',status['lastRun']['deleted']==1 and status['lastRun']['failed']==0 and L.cookie_names(d)==['wake-fixture'],status)
                    check('all stop/wake scenarios used one unchanged browser session',d.sid==result['webdriver_session'] and d.run('return chrome.runtime.getManifest().version;')=='1.2.0')

            finally:d.close()
    finally:
        result['observations']=observations
        result['passed']=sum(o['passed'] for o in observations)
        result['scope']='preview-only' if args.preview_only else 'five scenarios, six extension-only stops, one Chromium session'
        print(str(result['passed'])+' worker lifecycle assertions passed',flush=True)
        (args.output/'results.json').write_text(json.dumps(result,indent=2)+'\n')

if __name__=='__main__':main()

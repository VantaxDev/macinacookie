// Owner copy adapted from read-only independent QA probes 4/5. Reviewer files unchanged.
'use strict';
// Independent harness; require only the exact ZIP's extracted code, not owner tests.
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),os=require('node:os');
const EXT=path.resolve(process.env.MACINACOOKIE_EXTENSION||path.join(__dirname,'../extension'));
const OUT=process.env.MACINACOOKIE_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'macinacookie-owner-qa-'));
fs.mkdirSync(OUT,{recursive:true});
const {createApp}=require(path.join(EXT,'background.js'));
const G='macinacookieConsent',S='macinacookieState',P='macinacookiePreview';
const proof=(auto=false)=>({version:1,accepted:true,autoAuthorized:auto});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const turn=()=>new Promise(r=>setImmediate(r));
async function flush(n=12){while(n--)await turn()}
const event=()=>({listeners:[],addListener(f){this.listeners.push(f)},emit(...a){for(const f of this.listeners)f(...a)}});
const copy=x=>structuredClone(x);
function fixture(initial={},hooks={}){
 const local=copy(initial),session={},calls=[];
 const cookie={storeId:'0',domain:'synthetic.test',path:'/',name:'auth',value:'SYNTHETIC',secure:true,httpOnly:true,session:false,hostOnly:true,sameSite:'lax',expirationDate:9999999999};
 const changed=event();
 const area=(data,label)=>({
  async get(key){calls.push(label+'.get:'+key);const snapshot=copy(data[key]);if(hooks.get)await hooks.get(key);return {[key]:snapshot}},
  async set(values){calls.push(label+'.set:'+Object.keys(values));if(hooks.set)await hooks.set(values);const changes={};for(const [k,v]of Object.entries(values)){changes[k]={oldValue:copy(data[k]),newValue:copy(v)};data[k]=copy(v)}if(hooks.events)changed.emit(changes,label)},
  async remove(key){calls.push(label+'.remove:'+key);if(hooks.remove)await hooks.remove(key);delete data[key]}
 });
 const api={storage:{local:area(local,'local'),session:area(session,'session'),onChanged:changed},runtime:{id:'synthetic',getURL:p=>'chrome-extension://synthetic/'+p,getPlatformInfo:async()=>({os:'linux'}),onMessage:event(),onInstalled:event(),onStartup:event()},permissions:{contains:async()=>true,onAdded:event(),onRemoved:event()},alarms:{clear:async()=>{calls.push('alarms.clear')},create:async()=>{calls.push('alarms.create')},onAlarm:event()},cookies:{getAll:async()=>{calls.push('cookies.getAll');if(hooks.scan)await hooks.scan();return [copy(cookie)]},get:async()=>{calls.push('cookies.get');return copy(cookie)},remove:async d=>{calls.push('cookies.remove');return d},onChanged:event()}};
 const crypto={subtle:{digest:async(...a)=>{calls.push('hash');return webcrypto.subtle.digest(...a)}},randomUUID:()=>webcrypto.randomUUID()};
 const app=createApp(api,{crypto,now:()=>1700000000000});app.ready.catch(()=>{});
 const sender={id:'synthetic',url:api.runtime.getURL('dashboard.html')};
 const req=(type,fields={},s=sender)=>app.request({type,...fields},s);
 return {local,session,calls,api,app,req,cookie,sender};
}
const sensitive=calls=>calls.filter(x=>x.includes(S)||x.startsWith('cookies.')||x==='hash'||x==='session.get:'+P||x==='alarms.create');
const results=[];
const filter=process.env.PROBE_FILTER;
async function probe(name,fn){if(filter&&!name.startsWith(filter))return;try{const details=await fn();results.push({name,result:'PASS',details});console.log('PASS',name,JSON.stringify(details))}catch(e){results.push({name,result:'NEEDS_FIX',error:e.stack});console.log('NEEDS_FIX',name,e.stack)}}
function fakeUI(f){
 const nodes=new Map();
 function el(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,value:'',checked:false,open:false,textContent:'',className:'',attrs:{},listeners:{},classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this.attrs[k]=v},append(){},replaceChildren(){},querySelectorAll(){return []},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)},close(){this.open=false}});return nodes.get(id)}
 const html=fs.readFileSync(path.join(EXT,'dashboard.html'),'utf8');for(const m of html.matchAll(/id="([^"]+)"/g))el(m[1]);
 const doc={getElementById:el,body:el('body'),createElement:()=>el('generated-'+Math.random()),createTextNode:t=>({textContent:t}),createDocumentFragment:()=>el('fragment'),addEventListener(){},hidden:false};
 const context={document:doc,chrome:{runtime:{sendMessage:msg=>f.app.request(msg,f.sender)},storage:{onChanged:f.api.storage.onChanged},permissions:{request:async()=>true}},console,setInterval:()=>0,clearInterval:()=>{},Intl,Date,Set,Map,Number,String,Boolean,Error};
 vm.runInNewContext(fs.readFileSync(path.join(EXT,'dashboard.js'),'utf8'),context,{filename:'zip/dashboard.js'});
 const click=id=>{const e=el(id);assert(!e.disabled&&!e.hidden,id+' should be actionable');return e.listeners.click[0]({preventDefault(){}})};
 return {el,click};
}
(async()=>{
 await probe('4 failed revoke persistence error survives a late cancelled dashboard response',async()=>{
  let pause=false,fail=false;const entered=defer(),block=defer();const f=fixture({[G]:proof()},{scan:async()=>{if(pause){entered.resolve();await block.promise}},set:async v=>{if(fail&&v[G]&&!v[G].accepted)throw Error('synthetic storage failure')}});await f.app.ready;
  const ui=fakeUI(f);await flush();pause=true;const pending=ui.click('preview-button');await entered.promise;fail=true;
  await ui.click('revoke-observation');const errorInitially=ui.el('feedback').textContent;
  assert.match(errorInitially,/prima di riavviare Chrome/);assert.equal((await f.req('GET_CONSENT')).data.active,false);assert.equal(f.local[G].accepted,true);
  const before=f.calls.length;const retainedLedger=JSON.stringify(f.local[S]);pause=false;block.resolve();await pending;await flush();const errorFinally=ui.el('feedback').textContent;assert.equal(JSON.stringify(f.local[S]),retainedLedger);
  const restarted=fixture(f.local);await restarted.app.ready;const activeAfterRestart=(await restarted.req('GET_CONSENT')).data.active;assert(activeAfterRestart);
  const observations={activeAfterRestart,ledgerPreserved:true,errorInitially,errorFinally,consentState:ui.el('consent-state').textContent,statusWarning:ui.el('status-warning').textContent,persistedAccepted:f.local[G].accepted,postRevocationSensitiveCalls:sensitive(f.calls.slice(before))};
  fs.writeFileSync(path.join(OUT,'probe4-observations.json'),JSON.stringify(observations,null,2));assert.match(errorFinally,/prima di riavviare Chrome/,'late response must not replace explicit persistence failure with generic cancellation');
  assert.equal(ui.el('feedback').hidden,false);assert.match(ui.el('consent-state').textContent,/prima di riavviare Chrome/);
  assert.match(ui.el('decline-observation').textContent,/Riprova/);
  await ui.click('decline-observation');await flush();assert.match(ui.el('feedback').textContent,/prima di riavviare Chrome/);
  fail=false;await ui.click('decline-observation');await flush();
  assert.equal(f.local[G].accepted,false);assert.equal((await f.req('GET_CONSENT')).data.active,false);
  assert(!/prima di riavviare Chrome/.test(ui.el('feedback').textContent));
  assert.equal(ui.el('decline-observation').textContent,'Rimani inattivo');
  return {...observations,retrySaved:true,feedbackAfterRetry:ui.el('feedback').textContent};
 });
 await probe('5 storage revocation during pending grant is authoritative even while memory inactive',async()=>{
  const entered=defer(),block=defer();let hold=false;const f=fixture({}, {remove:async k=>{if(hold&&k===P){entered.resolve();await block.promise}}});await f.app.ready;
  hold=true;const grant=f.req('GRANT_CONSENT',{version:1});await entered.promise;
  // Revoke persisted before grant has even dispatched its accepted=true write.
  f.local[G]={version:1,accepted:false,autoAuthorized:false};
  f.api.storage.onChanged.emit({[G]:{newValue:copy(f.local[G])}},'local');block.resolve();const response=await grant;await f.app.settled();
  const observations={boundary:'pending preview cleanup, before grant storage write',persisted:f.local[G],response,consent:(await f.req('GET_CONSENT')).data,calls:f.calls.slice()};fs.writeFileSync(path.join(OUT,'probe5-observations.json'),JSON.stringify(observations,null,2));
  assert.equal(response.ok,false,'later storage revocation must invalidate pending grant');assert.equal(observations.consent.active,false);
  assert.equal(f.local[G].accepted,false);assert.deepEqual(sensitive(f.calls),[]);
  assert(!f.calls.includes('local.set:'+G),'obsolete grant must never dispatch accepted=true');
  hold=false;assert((await f.req('GRANT_CONSENT',{version:1})).ok);await f.app.settled();
  assert.equal(f.local[G].autoAuthorized,false);assert((await f.req('GET_CONSENT')).data.active);
  return {...observations,explicitRegrant:true};
 });


 await probe('6 own storage events do not cancel normal grant/refusal/regrant or grant auto authority',async()=>{
  const f=fixture({}, {events:true});await f.app.ready;
  assert((await f.req('REVOKE_CONSENT')).ok);assert.equal(f.local[G].accepted,false);
  assert((await f.req('GRANT_CONSENT',{version:1})).ok);await f.app.settled();
  assert.equal(f.local[G].autoAuthorized,false);
  const status=(await f.req('GET_STATUS')).data;
  assert((await f.req('SAVE_SETTINGS',{settings:{...status.settings,autoEnabled:true}})).ok);
  assert.equal(f.local[G].autoAuthorized,true);
  assert((await f.req('REVOKE_CONSENT')).ok);
  assert((await f.req('GRANT_CONSENT',{version:1})).ok);await f.app.settled();
  assert.equal(f.local[G].autoAuthorized,false);
  assert.equal((await f.req('GET_STATUS')).data.settings.autoEnabled,false);
  assert.equal((await f.req('GRANT_CONSENT',{version:1},{...f.sender,url:f.api.runtime.getURL('popup.html')})).ok,false);
  return {ownEventsEnabled:true,normalGrantRefusalRegrant:true,autoRequiresSeparateChoice:true,popupGrantRejected:true};
 });
 await probe('7 storage revocation invalidates grant at proof-load and alarm-cleanup boundaries',async()=>{
  for(const boundary of ['proof-load','alarm-cleanup']){
   const entered=defer(),block=defer();
   const f=fixture({}, {get:async key=>{if(boundary==='proof-load'&&key===G){entered.resolve();await block.promise}}});
   if(boundary==='alarm-cleanup'){
    await f.app.ready;
    f.api.alarms.clear=async()=>{f.calls.push('alarms.clear');entered.resolve();await block.promise};
   }
   const grant=f.req('GRANT_CONSENT',{version:1});await entered.promise;
   f.local[G]={version:1,accepted:false,autoAuthorized:false};
   f.api.storage.onChanged.emit({[G]:{newValue:copy(f.local[G])}},'local');
   block.resolve();assert.equal((await grant).ok,false,boundary);await f.app.settled();
   assert.deepEqual(sensitive(f.calls),[],boundary);assert.equal(f.local[G].accepted,false);
   assert(!f.calls.includes('local.set:'+G),boundary);
  }
  return {boundaries:['proof-load','alarm-cleanup'],acceptedWriteDispatches:0,sensitiveDispatches:0};
 });
 await probe('8 failed-revocation warning may be resolved only by a new successful explicit activation',async()=>{
  let fail=false;const f=fixture({[G]:proof()},{set:async value=>{if(fail&&value[G]&&!value[G].accepted)throw Error('synthetic failure')}});await f.app.ready;
  const ui=fakeUI(f);await flush();fail=true;await ui.click('revoke-observation');
  assert.match(ui.el('feedback').textContent,/prima di riavviare Chrome/);
  await ui.click('activate-observation');await flush();
  assert((await f.req('GET_CONSENT')).data.active);assert.equal(f.local[G].autoAuthorized,false);
  assert.match(ui.el('feedback').textContent,/Osservazione attivata/);
  assert(!/prima di riavviare Chrome/.test(ui.el('feedback').textContent));
  return {explicitSuccessfulActivation:true,warningResolved:true,automaticNotAuthorized:true};
 });

 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2)+'\n');
 console.log('SUMMARY',JSON.stringify(results.map(({name,result})=>({name,result}))));
 process.exitCode=results.some(x=>x.result!=='PASS')?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});

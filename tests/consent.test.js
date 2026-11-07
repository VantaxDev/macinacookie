'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {createApp}=require('../extension/background');
const GATE='macinacookieConsent';
const STATE='macinacookieState';
const clone=x=>structuredClone(x);
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},emit(...values){for(const fn of this.listeners)fn(...values)}});
const valid=(autoAuthorized=false)=>({version:1,accepted:true,autoAuthorized});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(initial={},hooks={}){
 const local=clone(initial),session={},calls=[];
 const cookie={storeId:'0',domain:'fixture.test',path:'/',name:'login',value:'SYNTHETIC-ONLY',secure:true,httpOnly:true,session:false,hostOnly:true,sameSite:'lax',expirationDate:9999999999};
 const area=(data,label)=>({get:async key=>{calls.push(label+'.get:'+key);if(hooks.read)await hooks.read(key);return {[key]:clone(data[key])};},set:async value=>{calls.push(label+'.set:'+Object.keys(value));if(hooks.write)await hooks.write(value);Object.assign(data,clone(value));},remove:async key=>{calls.push(label+'.remove:'+key);if(hooks.sessionRemove)await hooks.sessionRemove();delete data[key];}});
 const api={storage:{onChanged:event(),local:area(local,'local'),session:area(session,'session')},runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,getPlatformInfo:async()=>({os:'linux'}),onStartup:event(),onInstalled:event(),onMessage:event()},permissions:{contains:async()=>true,onAdded:event(),onRemoved:event()},alarms:{clear:async()=>{calls.push('alarm.clear')},create:async()=>{calls.push('alarm.create')},onAlarm:event()},cookies:{getAll:async()=>{calls.push('cookies.getAll');if(hooks.scan)await hooks.scan();return [clone(cookie)];},get:async()=>{calls.push('cookies.get');if(hooks.get)await hooks.get();return clone(cookie);},remove:async details=>{calls.push('cookies.remove');if(hooks.remove)await hooks.remove();return details;},onChanged:event()}};
 const crypto={subtle:{digest:async(...args)=>{calls.push('hash');if(hooks.hash)await hooks.hash();return webcrypto.subtle.digest(...args);}},randomUUID:()=>webcrypto.randomUUID()};
 const app=createApp(api,{crypto,now:()=>1700000000000});
 const sender={id:'fixture',url:api.runtime.getURL('dashboard.html')};
 const request=(type,extra={})=>app.request({type,...extra},sender);
 return {local,session,calls,api,app,request,cookie,sender};
}
function assertNoSensitive(f){assert(!f.calls.some(x=>x.includes(STATE)||x.startsWith('cookies.')||x==='hash'||x.startsWith('session.get')||x==='alarm.create'),f.calls.join('\n'));}

test('consent: new and existing profiles stay inactive without proof',async()=>{
 for(const initial of [{},{[STATE]:{sentinel:'DO NOT READ',settings:{autoEnabled:true}}}]){
  const f=fixture(initial);await f.app.ready;
  f.api.runtime.onInstalled.emit();f.api.runtime.onStartup.emit();f.api.alarms.onAlarm.emit(new Proxy({},{get(){throw Error('timer payload before opt-in')}}));
  f.api.cookies.onChanged.emit(new Proxy({},{get(){throw Error('payload accessed before opt-in')}}));
  await f.app.settled();
  assert.equal((await f.request('GET_STATUS')).data.consent.active,false);
  for(const type of ['PREVIEW','SAVE_SETTINGS','DELETE_PREVIEW'])assert.equal((await f.request(type)).ok,false);
  assertNoSensitive(f);assert.deepEqual(f.local,initial);
 }
});

test('consent: malformed and old-version proofs fail closed',async()=>{
 for(const proof of [null,false,{}, {version:0,accepted:true,autoAuthorized:true},{version:1,accepted:'yes',autoAuthorized:false},{version:1,accepted:true},{version:1,accepted:false,autoAuthorized:true}]){
  const f=fixture({[GATE]:proof});await f.app.ready;assertNoSensitive(f);
 }
});

test('consent: valid proof survives worker restart; unknown fields do not',async()=>{
 const f=fixture({[GATE]:valid()});await f.app.ready;assert(f.calls.includes('cookies.getAll'));
 const restarted=fixture(f.local);await restarted.app.ready;assert(restarted.calls.includes('cookies.getAll'));
 const malformed=fixture({[GATE]:{...valid(),extra:true}});await malformed.app.ready;assertNoSensitive(malformed);
});

test('consent: async proof loading ignores events before touching payload',async()=>{
 const block=deferred();const f=fixture({[GATE]:valid()},{read:async key=>{if(key===GATE)await block.promise;}});
 f.api.cookies.onChanged.emit(new Proxy({},{get(){throw Error('early payload')}}));
 f.api.alarms.onAlarm.emit({name:'macinacookie-cleanup'});
 assertNoSensitive(f);block.resolve();await f.app.ready;
});

test('consent: explicit activation only; failure or wrong version cannot activate',async()=>{
 const f=fixture();await f.app.ready;
 assert.equal((await f.request('GRANT_CONSENT',{version:0})).ok,false);assertNoSensitive(f);
 assert.equal((await f.request('GRANT_CONSENT',{version:1})).ok,true);await f.app.settled();
 assert.deepEqual(f.local[GATE],valid());assert(f.calls.includes('cookies.getAll'));
 const bad=fixture({}, {write:async()=>{throw Error('disk')}});await bad.app.ready;
 assert.equal((await bad.request('GRANT_CONSENT',{version:1})).ok,false);assertNoSensitive(bad);
});

test('consent: rejection persists inactivity and preserves legacy ledger',async()=>{
 const initial={[STATE]:{sentinel:'KEEP'}};const f=fixture(initial);await f.app.ready;
 assert((await f.request('REVOKE_CONSENT')).ok);assert.deepEqual(f.local[STATE],initial[STATE]);
 assert.equal(f.local[GATE].accepted,false);assertNoSensitive(f);
 const restart=fixture(f.local);await restart.app.ready;assertNoSensitive(restart);
});

test('consent: revocation discards in-flight scan and invalidates queued work',async()=>{
 const block=deferred(),entered=deferred();let pause=false;
 const f=fixture({[GATE]:valid()},{scan:async()=>{if(pause){entered.resolve();await block.promise;}}});await f.app.ready;
 const before=clone(f.local[STATE]);pause=true;f.calls.length=0;
 const pending=f.request('PREVIEW');await entered.promise;
 const revoke=f.request('REVOKE_CONSENT');
 f.api.cookies.onChanged.emit(new Proxy({},{get(){throw Error('revoked payload')}}));
 const queued=f.request('PREVIEW');block.resolve();
 assert.equal((await pending).ok,false);assert.equal((await queued).ok,false);assert((await revoke).ok);
 assert.deepEqual(f.local[STATE],before);assert(!f.calls.includes('hash'));assert(!f.calls.includes('cookies.remove'));
 assert(!f.calls.some(x=>x==='local.set:'+STATE||x.startsWith('session.set')));
});

test('consent: gate read failure and revocation write failure stay inactive',async()=>{
 const unreadable=fixture({}, {read:async()=>{throw Error('disk')}});await unreadable.app.ready;assertNoSensitive(unreadable);
 let fail=false;const f=fixture({[GATE]:valid()},{write:async value=>{if(fail&&value[GATE])throw Error('disk')}});await f.app.ready;
 fail=true;assert.equal((await f.request('REVOKE_CONSENT')).ok,false);
 assert.equal((await f.request('GET_STATUS')).data.consent.active,false);
 const before=f.calls.length;assert.equal((await f.request('PREVIEW')).ok,false);assert.equal(f.calls.length,before);
});
module.exports={fixture,valid,GATE,STATE,deferred};

async function agedFixture(hooks={}) {
 const original=fixture({[GATE]:valid()});await original.app.ready;
 const initial=clone(original.local);
 Object.values(initial[STATE].records)[0].firstSeenAt-=31*86400000;
 initial[STATE].settings.excludedDomains=['protected.test'];
 const f=fixture(initial,hooks);await f.app.ready;return f;
}
async function makePreview(f){const p=await f.request('PREVIEW');assert(p.ok,p.error);return p.data;}

test('consent: activation preserves ages/exclusions and does not authorize legacy auto',async()=>{
 const seed=await agedFixture();const initial=clone(seed.local);
 delete initial[GATE];initial[STATE].settings.autoEnabled=true;initial[STATE].nextRunAt=1;
 const firstSeen=Object.values(initial[STATE].records)[0].firstSeenAt;
 const f=fixture(initial);await f.app.ready;assertNoSensitive(f);
 assert((await f.request('GRANT_CONSENT',{version:1})).ok);await f.app.settled();
 assert.equal(Object.values(f.local[STATE].records)[0].firstSeenAt,firstSeen);
 assert.deepEqual(f.local[STATE].settings.excludedDomains,['protected.test']);
 assert.equal(f.local[GATE].autoAuthorized,false);
 assert(!f.calls.includes('cookies.remove'));assert(!f.calls.includes('alarm.create'));
 const status=(await f.request('GET_STATUS')).data;assert.equal(status.settings.autoEnabled,false);
 assert((await f.request('SAVE_SETTINGS',{settings:{...status.settings,autoEnabled:true}})).ok);
 assert.equal(f.local[GATE].autoAuthorized,true);assert(f.calls.includes('alarm.create'));
});

test('consent: revoke during final cookie read prevents deletion and later writes',async()=>{
 const block=deferred(),entered=deferred();let pause=false;
 const f=await agedFixture({get:async()=>{if(pause){entered.resolve();await block.promise;}}});
 const p=await makePreview(f);pause=true;
 const pending=f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)});await entered.promise;
 const revoke=f.request('REVOKE_CONSENT');const after=f.calls.length;block.resolve();
 assert.equal((await pending).ok,false);assert((await revoke).ok);
 assert(!f.calls.includes('cookies.remove'));
 assert(!f.calls.slice(after).some(x=>x==='hash'||x==='local.set:'+STATE));
 assert.equal(f.session.macinacookiePreview,undefined);
 assert((await f.request('GRANT_CONSENT',{version:1})).ok);await f.app.settled();
 assert.equal((await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)})).ok,false);
});

test('consent: revoke during hash ignores result and does not checkpoint',async()=>{
 const block=deferred(),entered=deferred();let pause=false;
 const f=fixture({[GATE]:valid()},{hash:async()=>{if(pause){entered.resolve();await block.promise;}}});await f.app.ready;
 pause=true;f.calls.length=0;const pending=f.request('PREVIEW');await entered.promise;
 const revoke=f.request('REVOKE_CONSENT');const after=f.calls.length;block.resolve();
 assert.equal((await pending).ok,false);assert((await revoke).ok);
 assert(!f.calls.slice(after).some(x=>x==='local.set:'+STATE||x==='cookies.remove'||x.startsWith('session.set')));
});

test('consent: dispatched removal is not cancellable but cannot start another effect',async()=>{
 const block=deferred(),entered=deferred();let pause=false;
 const f=await agedFixture({remove:async()=>{if(pause){entered.resolve();await block.promise;}}});
 const p=await makePreview(f);pause=true;
 const pending=f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)});await entered.promise;
 assert.equal(f.calls.filter(x=>x==='cookies.remove').length,1);
 const revoke=f.request('REVOKE_CONSENT');const after=f.calls.length;block.resolve();
 assert.equal((await pending).ok,false);assert((await revoke).ok);
 assert(!f.calls.slice(after).some(x=>x==='cookies.remove'||x==='local.set:'+STATE));
});

test('consent: malformed storage event revokes; storage events cannot grant',async()=>{
 const f=fixture({[GATE]:valid()});await f.app.ready;
 f.api.storage.onChanged.emit({[GATE]:{newValue:{version:9,accepted:true}}},'local');
 assert.equal((await f.request('GET_STATUS')).data.consent.active,false);
 f.api.storage.onChanged.emit({[GATE]:{newValue:valid()}},'local');
 assert.equal((await f.request('GET_STATUS')).data.consent.active,false);
 f.api.cookies.onChanged.emit(new Proxy({},{get(){throw Error('payload')}}));
});

test('consent: revoked while loading proof cannot resurrect persisted acceptance',async()=>{
 const block=deferred();const f=fixture({[GATE]:valid()},{read:async key=>{if(key===GATE)await block.promise;}});
 const revoke=f.request('REVOKE_CONSENT');block.resolve();await f.app.ready;assert((await revoke).ok);
 assertNoSensitive(f);assert.equal(f.local[GATE].accepted,false);
});

test('consent: revocation wins over a pending activation write',async()=>{
 const block=deferred(),entered=deferred();
 const f=fixture({}, {write:async value=>{if(value[GATE]?.accepted){entered.resolve();await block.promise;}}});await f.app.ready;
 const grant=f.request('GRANT_CONSENT',{version:1});await entered.promise;
 const revoke=f.request('REVOKE_CONSENT');block.resolve();
 assert.equal((await grant).ok,false);assert((await revoke).ok);
 assert.equal(f.local[GATE].accepted,false);assertNoSensitive(f);
});

test('consent: revoke during ledger read discards data before hashing',async()=>{
 const block=deferred(),entered=deferred();
 const f=fixture({[GATE]:valid(),[STATE]:{sentinel:'PRESERVE'}}, {read:async key=>{if(key===STATE){entered.resolve();await block.promise;}}});
 const ready=f.app.ready.catch(error=>error);await entered.promise;
 const revoke=f.request('REVOKE_CONSENT');block.resolve();await ready;assert((await revoke).ok);
 assert(!f.calls.includes('hash'));assert(!f.calls.includes('cookies.getAll'));
 assert.deepEqual(f.local[STATE],{sentinel:'PRESERVE'});
});

test('consent: failed preview cleanup cannot reactivate old authorization',async()=>{
 const f=fixture({}, {sessionRemove:async()=>{throw Error('session unavailable')}});await f.app.ready;
 assert.equal((await f.request('GRANT_CONSENT',{version:1})).ok,false);
 assert.equal((await f.request('GET_STATUS')).data.consent.active,false);assertNoSensitive(f);
});


test('consent: minimal control status stays responsive during a blocked scan',async()=>{
 const block=deferred(),entered=deferred();let pause=false;
 const f=fixture({[GATE]:valid()},{scan:async()=>{if(pause){entered.resolve();await block.promise;}}});await f.app.ready;
 pause=true;const pending=f.request('PREVIEW');await entered.promise;
 try {
  const status=await Promise.race([f.request('GET_CONSENT'),new Promise(resolve=>setImmediate(()=>resolve(null)))]);
  assert(status?.ok);assert.deepEqual(Object.keys(status.data).sort(),['active','version','warning']);assert(status.data.active);
 } finally {block.resolve();await pending;}
});

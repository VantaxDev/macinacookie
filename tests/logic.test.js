"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const Core=require('../extension/core');
const {createApp,STATE_KEY,PREVIEW_KEY}=require('../extension/background');
const clone=x=>structuredClone(x);
const cookie=(name='old',extra={})=>({storeId:'0',domain:'sample.test',path:'/',name,value:'synthetic-only',hostOnly:true,secure:true,httpOnly:false,session:false,sameSite:'lax',expirationDate:9999999999,...extra});
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},emit(v){for(const fn of this.listeners)fn(v)}});
async function fixture(cookies=[cookie()]) {
 let clock=1700000000000, permitted=true, failScan=false, failWrite=false, onGet=null, onRemove=null;
 const local={macinacookieConsent:{version:1,accepted:true,autoAuthorized:false}},session={},removed=[],audit=[];
 const area=data=>({get:async key=>clone(key?{[key]:data[key]}:data),set:async v=>{if(data===local&&failWrite)throw Error('disk');Object.assign(data,clone(v));},remove:async k=>{delete data[k]}});
 const api={storage:{local:area(local),session:area(session)},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getPlatformInfo:async()=>({os:'linux'}),onMessage:event(),onStartup:event(),onInstalled:event()},permissions:{contains:async()=>permitted,onAdded:event(),onRemoved:event()},alarms:{clear:async()=>true,create:async()=>{},onAlarm:event()},cookies:{onChanged:event(),getAll:async details=>{audit.push('cookies.getAll');assert.deepEqual(details,{partitionKey:{}});if(failScan)throw Error('scan');return clone(cookies)},get:async details=>{assert(!('firstPartyDomain' in details));const c=cookies.find(c=>c.name===details.name&&JSON.stringify(c.partitionKey)===JSON.stringify(details.partitionKey));const result=c&&clone(c);if(onGet)onGet();return result},remove:async details=>{removed.push(details.name);const i=cookies.findIndex(c=>c.name===details.name);if(i<0)return null;const [c]=cookies.splice(i,1);api.cookies.onChanged.emit({removed:true,cause:'explicit',cookie:c});if(onRemove)onRemove();return clone(details)}}};
 const app=createApp(api,{now:()=>clock,crypto:webcrypto});await app.ready;
 const sender={id:'test',url:api.runtime.getURL('dashboard.html')};
 return {api,app,local,session,removed,cookies,sender,audit,
  request:async(type,fields={})=>app.request({type,...fields},sender),
  advance:n=>{clock+=n},permission:v=>{permitted=v},failScan:v=>{failScan=v},failWrite:v=>{failWrite=v},onGet:fn=>{onGet=fn},onRemove:fn=>{onRemove=fn}};
}
const settings=extra=>({...Core.DEFAULT_SETTINGS,...extra});
async function oldFixture(cookies){const f=await fixture(cookies);f.advance(31*Core.DAY_MS);return f;}
async function preview(f){const r=await f.request('PREVIEW');assert(r.ok,r.error);return r.data;}

test('threshold bounds and invalid settings rejected',()=>{
 for(const maxAgeDays of [0,121,1.1,'30'])assert.throws(()=>Core.normalizeSettings(settings({maxAgeDays})));
 for(const maxAgeDays of [1,120])assert.equal(Core.normalizeSettings(settings({maxAgeDays})).maxAgeDays,maxAgeDays);
 for(const intervalHours of [0,2881])assert.throws(()=>Core.normalizeSettings(settings({intervalHours})));
});
test('domain normalization, deduplication and subdomain protection',()=>{
 assert.deepEqual(Core.normalizeSettings(settings({excludedDomains:['.EXAMPLE.com.','example.com']})).excludedDomains,['example.com']);
 assert(Core.isExcluded('sub.example.com',['example.com']));assert(!Core.isExcluded('notexample.com',['example.com']));
 for(const d of ['https://example.com','a/b','*.example.com','example.com?x'])assert.throws(()=>Core.normalizeDomain(d));
});
test('partition identity separates both ancestor bits and regular cookies',()=>{
 const c=cookie(),a=cookie('old',{partitionKey:{topLevelSite:'https://top.test',hasCrossSiteAncestor:true}}),b=cookie('old',{partitionKey:{topLevelSite:'https://top.test',hasCrossSiteAncestor:false}});
 assert.equal(new Set([c,a,b].map(Core.cookieIdentity)).size,3);
});
test('unsafe and unrepresentable removal selectors rejected',()=>{
 for(const path of ['/../x','/a?b','/a#b','/a b','/a\\b'])assert.equal(Core.removalDetails(cookie('x',{path})),null);
 assert.equal(Core.removalDetails(cookie('x',{firstPartyDomain:'firefox.test'})),null);
 assert.equal(Core.removalDetails(cookie('x',{partitionKey:{topLevelSite:'https://top.test',unknown:1}})),null);
 assert(!('firstPartyDomain' in Core.removalDetails(cookie())));
});
test('first observed age, not expiration, determines eligibility',()=>{
 const c=cookie();const s=settings();const now=60*Core.DAY_MS;
 assert(!Core.eligibility({firstSeenAt:now},c,s,now));assert(!Core.eligibility({firstSeenAt:now+1},c,s,now));
 assert(Core.eligibility({firstSeenAt:now-30*Core.DAY_MS},c,s,now));
});
test('unexpected removal response fails identity validation',()=>{
 const c=cookie(),d=Core.removalDetails(c);
 assert(Core.removalResultMatches(d,c,d));assert(!Core.removalResultMatches({...d,storeId:'1'},c,d));
 assert(!Core.removalResultMatches({...d,partitionKey:{topLevelSite:'https://other.test'}},c,d));
});
test('unauthorized pages and incognito senders cannot request deletion',async()=>{
 const f=await fixture();
 for(const sender of [{...f.sender,id:'other'},{...f.sender,url:'https://example.test'},{...f.sender,tab:{incognito:true}}])assert.equal((await f.app.request({type:'PREVIEW'},sender)).ok,false);
 assert.equal(f.removed.length,0);
});
test('missing host permissions stop scans and deletion',async()=>{
 const f=await oldFixture();const p=await preview(f);f.permission(false);
 assert.equal((await f.request('PREVIEW')).ok,false);
 assert.equal((await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)})).ok,false);assert.equal(f.removed.length,0);
});
test('incomplete scan preserves durable ledger and prevents deletion',async()=>{
 const f=await oldFixture();const p=await preview(f);const before=clone(f.local);f.failScan(true);
 assert.equal((await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)})).ok,false);
 assert.deepEqual(f.local,before);assert.equal(f.removed.length,0);
});
test('expired preview and foreign row IDs cannot delete',async()=>{
 const f=await oldFixture();const p=await preview(f);
 assert.equal((await f.request('DELETE_PREVIEW',{token:p.token,ids:['foreign']})).ok,false);
 f.advance(10*60*1000);
 assert.equal((await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)})).ok,false);assert.equal(f.removed.length,0);
});
test('settings change invalidates outstanding preview',async()=>{
 const f=await oldFixture();const p=await preview(f);
 assert((await f.request('SAVE_SETTINGS',{settings:settings({excludedDomains:['sample.test']})})).ok);
 assert.equal((await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)})).ok,false);assert.equal(f.removed.length,0);
});
test('private/unknown stores excluded from ledger and preview',async()=>{
 const f=await oldFixture([cookie(),cookie('private',{storeId:'1'})]);const p=await preview(f);
 assert.equal(p.total,1);assert.equal(Object.keys(f.local[STATE_KEY].records).length,1);
});
test('changed value after preview is skipped',async()=>{
 const f=await oldFixture();const p=await preview(f);f.cookies[0].value='changed';
 const r=await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)});
 assert.deepEqual(r.data,{deleted:0,skipped:1,failed:0});assert.equal(f.removed.length,0);
});
test('removal/recreation during last read is detected even with identical values',async()=>{
 const f=await oldFixture();const p=await preview(f);
 f.onGet(()=>{const c=clone(f.cookies[0]);f.api.cookies.onChanged.emit({removed:true,cause:'explicit',cookie:c});f.api.cookies.onChanged.emit({removed:false,cause:'explicit',cookie:c});});
 const r=await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)});
 assert.deepEqual(r.data,{deleted:0,skipped:1,failed:0});assert.equal(f.removed.length,0);await f.app.settled();
});
test('failed durable checkpoint stops batch after first deletion',async()=>{
 const f=await oldFixture([cookie('a'),cookie('b')]);const p=await preview(f);f.onRemove(()=>f.failWrite(true));
 const r=await f.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)});
 assert.equal(r.ok,false);assert.deepEqual(f.removed,['a']);assert.match(r.error,/Cookie già cancellati: 1/);await f.app.settled();
});
test('callback bridge keeps response channel open and responds asynchronously',async()=>{
 const f=await fixture();let resolve;const response=new Promise(r=>{resolve=r});
 assert.equal(f.api.runtime.onMessage.listeners[0]({type:'GET_STATUS'},f.sender,resolve),true);
 assert((await response).ok);
});
test('corrupt durable state fails closed without deleting',async()=>{
 const f=await fixture();f.local[STATE_KEY].version=99;
 const app=createApp(f.api,{crypto:webcrypto});await assert.rejects(app.ready);assert.equal(f.removed.length,0);
});
test('falsy stored states fail closed and preserve storage',async()=>{
 for(const corrupt of [null,false,0,'']) {
  const f=await fixture();
  f.local[STATE_KEY]=corrupt;
  const before=clone(f.local);
  const app=createApp(f.api,{crypto:webcrypto});
  await assert.rejects(app.ready,/dati di Macinacookie non sono leggibili/);
  const response=await app.request({type:'PREVIEW'},f.sender);
  assert.equal(response.ok,false);
  assert.deepEqual(f.local,before);
  assert.deepEqual(f.removed,[]);
 }
});
test('persisted fingerprint arrays fail closed without rewriting the ledger',async()=>{
 const f=await oldFixture();
 const record=Object.values(f.local[STATE_KEY].records)[0];
 record.fingerprint=[record.fingerprint]; // RegExp.test must not coerce storage types.
 const before=clone(f.local);
 const app=createApp(f.api,{now:()=>1700000000000+31*Core.DAY_MS,crypto:webcrypto});
 await assert.rejects(app.ready,/dati di Macinacookie non sono leggibili/);
 assert.equal((await app.request({type:'PREVIEW'},f.sender)).ok,false);
 assert.deepEqual(f.local,before);
 assert.deepEqual(f.removed,[]);
 assert.equal(f.session[PREVIEW_KEY],undefined);
});
test('preview persists in session only, with no raw cookie value in either storage area',async()=>{
 const f=await oldFixture();await preview(f);assert(f.session[PREVIEW_KEY]);
 assert(!JSON.stringify(f.local).includes('synthetic-only'));assert(!JSON.stringify(f.session).includes('synthetic-only'));
});

test('persisted record IDs must match their cookie identity before any side effects',async()=>{
 for(const corrupt of ['duplicate','mismatch']) {
  const f=await oldFixture([cookie('a'),cookie('b')]);
  const records=Object.values(f.local[STATE_KEY].records);
  records[1].id=corrupt==='duplicate'?records[0].id:'0'.repeat(64);
  const before=clone(f.local);
  // Restart with aged records, as on a browser wake; no production cookies.
  const app=createApp(f.api,{now:()=>1700000000000+31*Core.DAY_MS,crypto:webcrypto});
  await assert.rejects(app.ready,/dati di Macinacookie non sono leggibili/);
  const response=await app.request({type:'PREVIEW'},f.sender);
  assert.equal(response.ok,false);
  assert.deepEqual(f.local,before);
  assert.deepEqual(f.removed,[]);
  assert.equal(f.session[PREVIEW_KEY],undefined);
 }
});

// A valid persisted opt-in may resume observation; no inference from permissions.
test('authorized persisted consent resumes observation without reopening UI',async()=>{
 const f=await fixture([cookie('synthetic-login')]);
 assert.deepEqual(f.audit,['cookies.getAll']);
 const expected=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(Core.fingerprintInput(f.cookies[0])))).toString('hex');
 assert.equal(Object.values(f.local[STATE_KEY].records)[0].fingerprint,expected);
 f.api.runtime.onInstalled.emit({reason:'install'});
 await f.app.settled();
 assert.equal(f.audit.length,2);
 f.api.runtime.onStartup.emit();
 await f.app.settled();
 assert.equal(f.audit.length,3);
 let writes=0;
 const save=f.api.storage.local.set;
 f.api.storage.local.set=async value=>{writes++;return save(value)};
 f.api.cookies.onChanged.emit({removed:false,cause:'explicit',cookie:cookie('synthetic-login',{value:'synthetic-changed-login'})});
 await f.app.settled();
 assert.equal(writes,1);
 assert.notEqual(Object.values(f.local[STATE_KEY].records)[0].fingerprint,expected);
 assert.equal(f.removed.length,0);
 assert.equal(Object.keys(f.local[STATE_KEY].records).length,1);
});

test('negative tracking epoch fails closed before scans or storage writes',async()=>{
 const f=await oldFixture();
 f.local[STATE_KEY].trackingSince=-1;
 const before=clone(f.local), scans=f.audit.length;
 const app=createApp(f.api,{now:()=>1700000000000+31*Core.DAY_MS,crypto:webcrypto});
 await assert.rejects(app.ready,/dati di Macinacookie non sono leggibili/);
 assert.equal((await app.request({type:'PREVIEW'},f.sender)).ok,false);
 assert.deepEqual(f.local,before);
 assert.equal(f.audit.length,scans);
 assert.deepEqual(f.removed,[]);
 assert.equal(f.session[PREVIEW_KEY],undefined);
});

test('zero tracking epoch remains valid on restart',async()=>{
 const f=await fixture();
 f.local[STATE_KEY].trackingSince=0;
 const app=createApp(f.api,{now:()=>1700000000000,crypto:webcrypto});
 await app.ready;
 assert.equal((await app.request({type:'GET_STATUS'},f.sender)).ok,true);
 assert.equal(f.local[STATE_KEY].trackingSince,0);
 assert.deepEqual(f.removed,[]);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {createApp}=require(require('node:path').join(process.env.MACINACOOKIE_EXTENSION || require('node:path').join(__dirname,'../extension'),'background.js'));
const GATE='macinacookieConsent';
const STATE='macinacookieState';
const clone=x=>structuredClone(x);
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},emit(...values){for(const fn of this.listeners)fn(...values)}});
const valid=(autoAuthorized=false)=>({version:1,accepted:true,autoAuthorized});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(initial={},hooks={},initialSession={}){
 const local=clone(initial),session=clone(initialSession),calls=[];
 const cookie={storeId:'0',domain:'fixture.test',path:'/',name:'login',value:'SYNTHETIC-ONLY',secure:true,httpOnly:true,session:false,hostOnly:true,sameSite:'lax',expirationDate:9999999999};
 const area=(data,label)=>({get:async key=>{calls.push(label+'.get:'+key);if(hooks.read)await hooks.read(key);return {[key]:clone(data[key])};},set:async value=>{calls.push(label+'.set:'+Object.keys(value));if(hooks.write)await hooks.write(value);Object.assign(data,clone(value));},remove:async key=>{calls.push(label+'.remove:'+key);if(hooks.sessionRemove)await hooks.sessionRemove();delete data[key];}});
 const api={storage:{onChanged:event(),local:area(local,'local'),session:area(session,'session')},runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,getPlatformInfo:async()=>({os:'linux'}),onStartup:event(),onInstalled:event(),onMessage:event()},permissions:{contains:async()=>true,onAdded:event(),onRemoved:event()},alarms:{clear:async()=>{calls.push('alarm.clear')},create:async()=>{calls.push('alarm.create')},onAlarm:event()},cookies:{getAll:async()=>{calls.push('cookies.getAll');if(hooks.scan)await hooks.scan();return [clone(cookie)];},get:async()=>{calls.push('cookies.get');if(hooks.get)await hooks.get();return clone(cookie);},remove:async details=>{calls.push('cookies.remove');if(hooks.remove)await hooks.remove();return details;},onChanged:event()}};
 const crypto={subtle:{digest:async(...args)=>{calls.push('hash');if(hooks.hash)await hooks.hash();return webcrypto.subtle.digest(...args);}},randomUUID:()=>webcrypto.randomUUID()};
 const app=createApp(api,{crypto,now:()=>1700000000000});
 const sender={id:'fixture',url:api.runtime.getURL('dashboard.html')};
 const request=(type,extra={})=>app.request({type,...extra},sender);
 return {local,session,calls,api,app,request,cookie,sender};
}

async function aged(){
 const f=fixture({[GATE]:valid()});await f.app.ready;
 const initial=clone(f.local);Object.values(initial[STATE].records)[0].firstSeenAt-=31*86400000;
 const ready=fixture(initial);await ready.app.ready;return ready;
}
test('worker preview: session token cannot authorize a new worker instance',async()=>{
 const f=await aged();const p=(await f.request('PREVIEW')).data;assert.equal(p.total,1);
 const next=fixture(f.local,{},f.session);await next.app.ready;
 const before=clone(next.local[STATE]);next.calls.length=0;
 assert.equal((await next.request('DELETE_PREVIEW',{token:p.token,ids:p.rows.map(r=>r.id)})).ok,false);
 assert.deepEqual(next.local[STATE],before);assert(!next.calls.includes('cookies.remove'));
 const fresh=(await next.request('PREVIEW')).data;assert.equal(fresh.total,1);assert.notEqual(fresh.token,p.token);
 const result=await next.request('DELETE_PREVIEW',{token:fresh.token,ids:fresh.rows.map(r=>r.id)});
 assert(result.ok,result.error);assert.equal(result.data.deleted,1);
 assert.equal((await next.request('DELETE_PREVIEW',{token:fresh.token,ids:fresh.rows.map(r=>r.id)})).ok,false);
});
test('worker preview: cleanup failure still invalidates local authorization',async()=>{
 const f=await aged();
 let fail=false;const same=fixture(f.local,{sessionRemove:async()=>{if(fail)throw Error('synthetic cleanup failure')}});await same.app.ready;
 const own=(await same.request('PREVIEW')).data;fail=true;
 assert.equal((await same.request('SAVE_SETTINGS',{settings:{...same.local[STATE].settings,maxAgeDays:30}})).ok,false);
 same.calls.length=0;
 assert.equal((await same.request('DELETE_PREVIEW',{token:own.token,ids:own.rows.map(r=>r.id)})).ok,false);
 assert(!same.calls.includes('cookies.remove'));
 assert(!same.calls.some(x=>x.startsWith('session.get')||x==='cookies.getAll'),same.calls.join('\n'));
});

"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const path=require('node:path');
const EXT=path.resolve(process.env.MACINACOOKIE_EXTENSION||path.join(__dirname,'../extension'));
const Core=require(path.join(EXT,'core'));
const {createApp,STATE_KEY,PREVIEW_KEY}=require(path.join(EXT,'background'));
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


test('preview carries cross-site ancestor discriminator without cookie values',async()=>{
 const cookies=[true,false,undefined].map(flag=>cookie('same',{partitionKey:{topLevelSite:'https://top.test',...(flag===undefined?{}:{hasCrossSiteAncestor:flag})}}));
 cookies.push(cookie('same'));
 const f=await oldFixture(cookies);const p=await preview(f);
 assert.equal(p.rows.length,4);assert.equal(new Set(p.rows.map(r=>r.id)).size,4);
 assert.deepEqual(p.rows.map(r=>r.partitionCrossSiteAncestor),[true,false,null,null]);
 assert(p.rows.slice(0,3).every(r=>r.partitionSite==='https://top.test'));
 assert.equal(p.rows[3].partitionSite,'');
 assert(p.rows.every(r=>!('value' in r)&&!('fingerprint' in r)));
 assert.equal(f.removed.length,0);
});
const vm=require('node:vm'),fs=require('node:fs');
const tick=()=>new Promise(r=>setImmediate(r));
test('dashboard visually and accessibly distinguishes CHIPS ancestor variants',async()=>{
 const nodes=new Map();let generated=0;
 const make=()=>({hidden:false,disabled:false,value:'',checked:false,open:false,textContent:'',children:[],attrs:{},listeners:{},
  classList:{toggle(){},remove(){}},setAttribute(k,v){this.attrs[k]=v;},
  addEventListener(k,f){this.listeners[k]=f;},append(...v){this.children.push(...v);},
  replaceChildren(...v){this.children=[...v];},querySelectorAll(){return [];},close(){this.open=false;}});
 const el=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
 const settings={maxAgeDays:30,intervalHours:24,autoEnabled:false,excludedDomains:[]};
 const status={consent:{active:true},settings,stats:null,hasPermissions:true,scanAvailable:true};
 const rows=[true,false,null].map((flag,i)=>({id:String(i),domain:'sample.test',name:'same',path:'/',storeId:'0',partitionSite:'https://top.test',partitionCrossSiteAncestor:flag,firstSeenAt:1700000000000,ageDays:31,session:false,secure:true}));
 const messages=[];
 vm.runInNewContext(fs.readFileSync(path.join(EXT,'dashboard.js'),'utf8'),{
  Intl,Date,setInterval(){},document:{body:el('body'),hidden:false,addEventListener(){},getElementById:el,
   createElement:()=>{const n=make();nodes.set('generated'+generated++,n);return n;},createTextNode:text=>({textContent:text}),createDocumentFragment:make},
  chrome:{storage:{onChanged:{addListener(){}}},runtime:{sendMessage:async m=>{
   messages.push(m.type);return {ok:true,data:m.type==='GET_CONSENT'?{active:true}:m.type==='PREVIEW'?{rows,token:'synthetic',expiresAt:Date.now()+60000,maxAgeDays:30}:status};}}}
 });
 await tick();await tick();
 await el('preview-button').listeners.click();
 const boxes=[...nodes.values()].filter(n=>n.type==='checkbox');
 assert.equal(boxes.length,3);
 const labels=boxes.map(n=>n.attrs['aria-label']);
 assert.equal(new Set(labels).size,3,'selection names must distinguish ancestor contexts');
 assert(labels.every(x=>x.includes('https://top.test')));
 const contexts=[...nodes.values()].filter(n=>n.className==='context-text').map(n=>n.textContent);
 assert.equal(new Set(contexts).size,3,'visible context must distinguish ancestor contexts');
 assert(contexts.some(x=>x.includes('con antenato cross-site')));
 assert(contexts.some(x=>x.includes('senza antenato cross-site')));
 assert(contexts.some(x=>x.includes('non disponibile')));
 assert(!messages.some(x=>x.includes('DELETE')));
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const proof={accepted:true,version:1,autoAuthorized:true};
const active=(total=42)=>({ok:true,data:{consent:{active:true},stats:{total,eligible:7},
 hasPermissions:true,scanAvailable:true,settings:{autoEnabled:true,maxAgeDays:30},
 nextRunAt:Date.now()+60000,warning:'previous scan warning'}});
function popup(){
 const elements=new Map(),pending=[],calls=[];let changed;
 const make=()=>{
  const classes=new Set();
  return {hidden:true,textContent:'',attrs:{},listeners:{},
   classList:{remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},
   setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.listeners[k]=f;},
   replaceChildren(){this.textContent='';},append(...nodes){this.textContent+=nodes.map(n=>typeof n==='string'?n:n.textContent).join('');}};
 };
 const el=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
 vm.runInNewContext(fs.readFileSync(path.join(process.env.MACINACOOKIE_EXTENSION||path.join(__dirname,'../extension'),'popup.js'),'utf8'),{
  Intl,document:{getElementById:el,createElement:make,createTextNode:x=>x},window:{close(){}},
  chrome:{runtime:{sendMessage:msg=>{calls.push(msg.type);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}},
   storage:{onChanged:{addListener:f=>{changed=f;}}}}});
 return {el,pending,calls,refresh:()=>changed({macinacookieConsent:{newValue:proof}},'local')};
}
for(const failure of ['reject','error response'])test(`current ${failure} clears stale active summary and retry recovers`,async()=>{
 const p=popup();p.pending[0].resolve(active());await tick();
 assert.equal(p.el('popup-total').textContent,'42');
 assert(p.el('popup-mode').classList.contains('is-active'));
 assert.equal(p.el('popup-warning').hidden,false);
 p.el('popup-open-error').textContent='independent navigation failure';p.el('popup-open-error').hidden=false;
 p.refresh();
 if(failure==='reject')p.pending[1].reject(Error('current read failed'));
 else p.pending[1].resolve({ok:false,error:'current read failed'});
 await tick();
 assert.equal(p.el('popup-mode').textContent,'Lettura non disponibile');
 assert.equal(p.el('popup-total').textContent,'—');
 assert.equal(p.el('popup-eligible').textContent,'—');
 assert.equal(p.el('popup-mode').classList.contains('is-active'),false);
 assert.equal(p.el('popup-warning').hidden,true);
 assert.equal(p.el('popup-warning').textContent,'');
 assert.equal(p.el('popup-error').hidden,false);
 assert.equal(p.el('popup-retry').hidden,false);
 assert.equal(p.el('popup-stats').attrs['aria-busy'],'false');
 assert.equal(p.el('popup-open-error').hidden,false);
 assert.equal(p.el('popup-open-error').textContent,'independent navigation failure');
 p.el('popup-retry').listeners.click();
 p.pending[2].resolve(active(19));await tick();
 assert.equal(p.el('popup-total').textContent,'19');
 assert.equal(p.el('popup-mode').textContent,'Pulizia automatica attiva');
 assert(p.el('popup-mode').classList.contains('is-active'));
 assert.equal(p.el('popup-warning').hidden,false);
 assert.equal(p.el('popup-error').hidden,true);
 assert.equal(p.el('popup-retry').hidden,true);
 assert.deepEqual(p.calls,['GET_STATUS','GET_STATUS','GET_STATUS']);
});

test('obsolete rejected refresh cannot erase a newer active summary',async()=>{
 const p=popup();p.pending[0].resolve(active());await tick();
 p.refresh();p.refresh();p.pending[2].resolve(active(19));await tick();
 p.pending[1].reject(Error('obsolete failure'));await tick();
 assert.equal(p.el('popup-total').textContent,'19');
 assert.equal(p.el('popup-mode').textContent,'Pulizia automatica attiva');
 assert(p.el('popup-mode').classList.contains('is-active'));
 assert.equal(p.el('popup-warning').hidden,false);
 assert.equal(p.el('popup-error').hidden,true);
 assert.equal(p.el('popup-stats').attrs['aria-busy'],'false');
});

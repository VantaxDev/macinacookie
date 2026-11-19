'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function popup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {hidden:false, textContent:'', attrs:{}, listeners:{},
      classList:{remove(){}, toggle(){}}, setAttribute(k,v){this.attrs[k]=v;},
      addEventListener(k,v){this.listeners[k]=v;}, replaceChildren(){}, append(){}});
    return elements.get(id);
  };
  const pending = [];
  let changed;
  vm.runInNewContext(fs.readFileSync(path.join(process.env.MACINACOOKIE_EXTENSION || path.join(__dirname,'../extension'),'popup.js'),'utf8'), {
    Intl, document:{getElementById:element,createElement:()=>element('dot'),createTextNode:x=>x},
    chrome:{runtime:{sendMessage:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},
      storage:{onChanged:{addListener:f=>{changed=f;}}}}, window:{close(){}}
  });
  return {element,pending,change:(proof,area='local')=>changed({macinacookieConsent:{newValue:proof}},area)};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
const inactive = {ok:true,data:{consent:{active:false}}};

for (const outcome of ['reject','error response','success']) test(`obsolete ${outcome} cannot overwrite newer inactive status`,async()=>{
  const p=popup(); p.change();
  p.pending[1].resolve(inactive); await tick();
  const before = p.element('popup-mode').textContent;
  if(outcome==='reject') p.pending[0].reject(Error('old worker disconnected'));
  else p.pending[0].resolve(outcome==='success'?inactive:{ok:false,error:'old failure'});
  await tick();
  assert.equal(p.element('popup-mode').textContent,before);
  assert.equal(p.element('popup-error').hidden,true);
  assert.equal(p.element('popup-retry').hidden,true);
});
test('obsolete completion does not clear busy state of current request',async()=>{
  const p=popup(); p.change();
  p.pending[0].resolve(inactive); await tick();
  assert.equal(p.element('popup-stats').attrs['aria-busy'],'true');
  p.pending[1].resolve(inactive); await tick();
  assert.equal(p.element('popup-stats').attrs['aria-busy'],'false');
});
test('current failure remains visible and retry can recover',async()=>{
  const p=popup(); p.pending[0].reject(Error('current failure')); await tick();
  assert.equal(p.element('popup-error').hidden,false);
  assert.equal(p.element('popup-retry').hidden,false);
  assert.equal(p.element('popup-error').textContent,'current failure');
  p.element('popup-retry').listeners.click();
  p.pending[1].resolve(inactive); await tick();
  assert.equal(p.element('popup-error').hidden,true);
  assert.equal(p.element('popup-mode').textContent,'Osservazione inattiva');
});

const active = {ok:true,data:{consent:{active:true},stats:{total:42,eligible:7},
  hasPermissions:true,scanAvailable:true,settings:{autoEnabled:true,maxAgeDays:30},
  nextRunAt:Date.now()+60000,warning:'old scan warning'}};
for (const proof of [{accepted:false}, undefined, {accepted:true,version:2,autoAuthorized:false},
  {accepted:true,version:1}, {accepted:true,version:1,autoAuthorized:false,extra:true}]) {
  test(`external invalid consent clears visible data synchronously: ${JSON.stringify(proof)}`,async()=>{
    const p=popup();p.pending[0].resolve(active);await tick();
    assert.equal(p.element('popup-total').textContent,'42');
    p.change(proof);
    assert.equal(p.element('popup-total').textContent,'—');
    assert.equal(p.element('popup-eligible').textContent,'—');
    assert.equal(p.element('popup-mode').textContent,'Osservazione inattiva');
    assert.equal(p.element('popup-warning').hidden,true);
    assert.doesNotMatch(p.element('popup-next').textContent,/Prossima pulizia/);
    // A failed refresh must not bring back the previous cookie statistics.
    p.pending[1].reject(Error('worker unavailable'));await tick();
    assert.equal(p.element('popup-total').textContent,'—');
    assert.equal(p.element('popup-eligible').textContent,'—');
  });
}
test('valid consent updates and nonlocal changes do not clear current statistics',async()=>{
  const p=popup();p.pending[0].resolve(active);await tick();
  p.change({accepted:false},'session');
  assert.equal(p.pending.length,1);
  assert.equal(p.element('popup-total').textContent,'42');
  p.change({accepted:true,version:1,autoAuthorized:false});
  assert.equal(p.element('popup-total').textContent,'42');
  p.pending[1].resolve(inactive);await tick();
  assert.equal(p.element('popup-total').textContent,'—');
});
test('revocation during initial load clears view and stale active success stays ignored',async()=>{
  const p=popup();p.change(null);
  assert.equal(p.element('popup-mode').textContent,'Osservazione inattiva');
  p.pending[0].resolve(active);await tick();
  assert.equal(p.element('popup-total').textContent,'—');
  assert.equal(p.element('popup-stats').attrs['aria-busy'],'true');
  p.pending[1].resolve(inactive);await tick();
  assert.equal(p.element('popup-stats').attrs['aria-busy'],'false');
});

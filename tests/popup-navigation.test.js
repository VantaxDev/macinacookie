'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const turn = () => new Promise(resolve=>setImmediate(resolve));
const inactive = {ok:true,data:{consent:{active:false}}};
function popup(openOptionsPage,createTab) {
  const elements=new Map(), pending=[], calls=[];
  let changed,closed=0;
  const el=id=>{
    if(!elements.has(id))elements.set(id,{hidden:id.includes('error'),textContent:'',disabled:false,listeners:{},
      classList:{remove(){},toggle(){}},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;}});
    return elements.get(id);
  };
  vm.runInNewContext(fs.readFileSync(path.join(process.env.MACINACOOKIE_EXTENSION||path.join(__dirname,'../extension'),'popup.js'),'utf8'),{
    Intl,document:{getElementById:el},window:{close(){closed++;}},
    chrome:{runtime:{sendMessage:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
      openOptionsPage:()=>{calls.push('options');return openOptionsPage();},getURL:p=>'chrome-extension://synthetic/'+p},
      tabs:{create:args=>{calls.push(args);return createTab(args);}},
      storage:{onChanged:{addListener:f=>{changed=f;}}}}
  });
  return {el,pending,calls,closed:()=>closed,click:()=>el('open-dashboard').listeners.click(),
    change:()=>changed({macinacookieConsent:{newValue:{accepted:false}}},'local'),
    visibleError:message=>['popup-error','popup-open-error'].some(id=>!el(id).hidden&&el(id).textContent===message)};
}
test('primary dashboard open closes popup without creating fallback tab',async()=>{
  const p=popup(async()=>{},async()=>{throw Error('unexpected fallback');});
  await p.click();assert.deepEqual(p.calls,['options']);assert.equal(p.closed(),1);
  p.pending[0].resolve(inactive);await turn();
});
test('primary failure uses existing extension URL fallback exactly once',async()=>{
  const p=popup(async()=>{throw Error('options unavailable');},async()=>{});
  await p.click();assert.deepEqual(JSON.parse(JSON.stringify(p.calls)),['options',{url:'chrome-extension://synthetic/dashboard.html'}]);
  assert.equal(p.closed(),1);assert.equal(p.el('open-dashboard').disabled,false);
  p.pending[0].resolve(inactive);await turn();
});
test('total opening failure survives status refresh and retry preserves independent read error',async()=>{
  let fail=true;
  const p=popup(async()=>{if(fail)throw Error('options unavailable');},async()=>{throw Error('cannot open dashboard');});
  p.pending[0].resolve(inactive);await turn();
  await p.click();assert.equal(p.closed(),0);assert.equal(p.el('open-dashboard').disabled,false);
  assert(p.visibleError('cannot open dashboard'));
  p.change();
  assert(p.visibleError('cannot open dashboard'),'a consent/status refresh must not erase the navigation failure');
  p.pending[1].reject(Error('cannot read status'));await turn();
  assert(p.visibleError('cannot open dashboard'));
  assert(p.visibleError('cannot read status'));
  fail=false;await p.click();assert.equal(p.closed(),1);
  assert(!p.visibleError('cannot open dashboard'));
  assert(p.visibleError('cannot read status'),'opening retry must not clear an unrelated status failure');
});
test('repeated clicks while primary request is pending do not duplicate navigation',async()=>{
  let resolve;
  const p=popup(()=>new Promise(r=>{resolve=r;}),async()=>{});
  const first=p.click();await p.click();assert.deepEqual(p.calls,['options']);
  assert.equal(p.el('open-dashboard').disabled,true);resolve();await first;
  assert.equal(p.closed(),1);assert.equal(p.el('open-dashboard').disabled,false);
  p.pending[0].resolve(inactive);await turn();
});

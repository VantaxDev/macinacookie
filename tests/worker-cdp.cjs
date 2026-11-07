// Local CDP observer/controller. Requires an already installed Node with WebSocket.
'use strict';
const [endpoint, scriptURL, action = 'inspect'] = process.argv.slice(2);
if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//.test(endpoint)) throw Error('Only owned loopback browser CDP accepted');
if (!/^chrome-extension:\/\/[a-p]{32}\/service-worker\.js$/.test(scriptURL)) throw Error('Exact extension worker required');
if (typeof WebSocket !== 'function') throw Error('CDP helper needs a Node runtime with built-in WebSocket; set MACINACOOKIE_CDP_NODE to an existing supported Node binary.');
const ws = new WebSocket(endpoint);
const pending = new Map(), versions = new Map(), events = [];
let sequence = 0;
const contexts = [];
ws.addEventListener('message', event => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    const {resolve, reject} = pending.get(m.id); pending.delete(m.id);
    if (m.error) reject(Error(JSON.stringify(m.error))); else resolve(m.result);
  } else if (m.method === 'Runtime.executionContextCreated') {contexts.push(m.params.context);
  } else if (m.method === 'ServiceWorker.workerVersionUpdated') {
    for (const v of m.params.versions) if (v.scriptURL === scriptURL) {versions.set(v.versionId,v); events.push(v);}
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve,reject) => {
    const id = ++sequence; pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
}
const delay = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  const targets=(await send('Target.getTargets')).targetInfos;
  const page=targets.find(t=>t.type==='page' && t.url.startsWith(scriptURL.replace('service-worker.js','')));
  if (!page) throw Error('Owned extension page missing');
  const {sessionId}=await send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
  await send('ServiceWorker.enable',{},sessionId);
  for(let i=0;i<100 && ![...versions.values()].some(v=>v.runningStatus==='running');i++)await delay(50);
  const before=[...versions.values()].find(v=>v.runningStatus==='running');
  if(!before) throw Error('No running version observed; cannot claim worker stop');
  const running=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker' && t.url===scriptURL);
  if(!running)throw Error('Worker target disappeared before context observation');
  const attached=await send('Target.attachToTarget',{targetId:running.targetId,flatten:true});
  await send('Runtime.enable',{},attached.sessionId);
  const manifest=await send('Runtime.evaluate',{expression:'({url:location.href,version:chrome.runtime.getManifest().version})',returnByValue:true},attached.sessionId);
  const context=contexts.find(c=>c.uniqueId);
  if(!context)throw Error('Worker execution context uniqueId unavailable');
  await send('Target.detachFromTarget',{sessionId:attached.sessionId});
  if(action==='stop') {
    await send('ServiceWorker.stopWorker',{versionId:before.versionId},sessionId);
    for(let i=0;i<100 && versions.get(before.versionId).runningStatus!=='stopped';i++)await delay(50);
    if(versions.get(before.versionId).runningStatus!=='stopped')throw Error('Stopped status not observed');
  } else if(action!=='inspect')throw Error('Invalid action');
  const afterTargets=(await send('Target.getTargets')).targetInfos.filter(t=>t.type==='service_worker' && t.url===scriptURL);
  console.log(JSON.stringify({action,context,manifest:manifest.result.value,before,after:versions.get(before.versionId),afterTargets,events}));
  await send('Target.detachFromTarget',{sessionId});
  ws.close();
})().catch(e=>{console.error(e.stack);ws.close();process.exitCode=1;});
setTimeout(()=>{console.error('CDP observer deadline');process.exit(2);},15000).unref();

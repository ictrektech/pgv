import {test} from 'node:test';import assert from 'node:assert/strict';
import {schedulerModels,runtimeConfig,managedConfig} from './scheduler.mjs';
test('catalog filters non-language models and preserves qualified IDs/protocols',()=>{
 const models=schedulerModels({models:[{qualified:'cloud/chat',endpoints:['/v1/chat/completions']},{qualified:'cloud/responses',endpoints:['responses']},{qualified:'cloud/claude',endpoints:['messages']},{qualified:'private/embed',endpoints:['embeddings']},{qualified:'vision/image',capabilities:['image_generation']}]});
 assert.deepEqual(models.map(m=>m.id),['cloud/chat','cloud/claude','cloud/responses']);assert.equal(models[1].style,'anthropic-messages');
});
test('runtime supplies only ephemeral credentials to the fixed loopback bridge',async()=>{
 const config=managedConfig([{id:'private/model',name:'Model'}]);
 const runtime=await runtimeConfig({...config,customHeaders:{Authorization:'untrusted'},proxyEnabled:true},{token:'vos-token'},'ephemeral',async()=>[{id:'private/model',style:'responses'}]);
 assert.equal(runtime.endpoint,'http://127.0.0.1:8093/v1');assert.equal(runtime.apiKey,'ephemeral');assert.equal(runtime.apiStyle,'responses');assert.deepEqual(runtime.customHeaders,{});assert.equal(runtime.proxyEnabled,false);assert.equal(config.apiKey,'');assert.ok(!JSON.stringify(runtime).includes('vos-token'));
 await assert.rejects(runtimeConfig({...config,model:'hidden/model'},{token:'token'},'key',async()=>[]));
});
test('inference bridge forwards verified VOS identity and never the ephemeral key',async()=>{
 const http=await import('node:http'),{createSchedulerBridge}=await import('./scheduler.mjs');
 let received;
 const scheduler=http.createServer((req,res)=>{received=req.headers.authorization;res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'test-completion'}));});
 await new Promise(r=>scheduler.listen(0,'127.0.0.1',r));
 const bridge=createSchedulerBridge({sessions:new Map([['ephemeral',{token:'vos-token',expires:Date.now()+10000,sockets:new Set()}]]),verify:async token=>assert.equal(token,'vos-token'),baseUrl:`http://127.0.0.1:${scheduler.address().port}`});
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${bridge.address().port}`;
 try{
  assert.equal((await fetch(url+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer invalid'},body:'{}'})).status,401);
  const response=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer ephemeral'},body:'{}'});
  assert.equal(response.status,200);assert.equal(received,'Bearer vos-token');
  assert.equal((await fetch(url+'/api/v1/upstreams',{headers:{authorization:'Bearer ephemeral'}})).status,404);
 }finally{await Promise.all([new Promise(r=>bridge.close(r)),new Promise(r=>scheduler.close(r))]);}
});

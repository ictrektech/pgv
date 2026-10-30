import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameOrigin,verifyAdministrator,seedConnections} from './gateway.mjs';
test('PGV installation has no V-Scheduler dependency',async()=>{
 const {readFile}=await import('node:fs/promises');
 const manifest=await readFile(new URL('../../ictrek.app/src/manifest.yml',import.meta.url),'utf8');
 assert.doesNotMatch(manifest,/com\.ictrek\.v-scheduler/);
});
test('mutations require same origin, ordinary reads may omit Origin',()=>{
 assert.equal(sameOrigin({method:'GET',headers:{host:'vos'}}),true);
 assert.equal(sameOrigin({method:'POST',headers:{host:'vos'}}),false);
 assert.equal(sameOrigin({method:'POST',headers:{host:'vos',origin:'https://evil'}}),false);
 assert.equal(sameOrigin({method:'POST',headers:{host:'vos',origin:'https://vos'}}),true);
});
test('only server-verified VOS administrators may enter',async()=>{
 const user=claims=>async()=>({ok:true,json:async()=>({code:0,data:claims})});
 assert.equal(await verifyAdministrator('token','url',user({sub:'1',preferred_username:'admin'})),'1');
 await assert.rejects(verifyAdministrator('token','url',user({sub:'2',preferred_username:'ordinary'})));
 await assert.rejects(verifyAdministrator('token','url',async()=>({ok:false})));
});
test('managed connections are idempotent and preserve unrelated records',async()=>{
 const calls=[];
 const api=async(path,payload)=>{calls.push([path,payload]);if(path==='connection/list')return [{id:'kept-id',name:'PGV PostgreSQL'},{id:'custom',name:'Custom'}];return null;};
 await seedConnections({PGPASSWORD:'unit-pg',PGV_REDIS_PASSWORD:'unit-redis'},api);
 const saved=calls.find(([p])=>p==='connection/save')[1];
 assert.deepEqual(saved.configs.map(c=>c.id),['kept-id','pgv-redis']);
 assert.deepEqual(saved.removedIds,[]);
 assert.equal(saved.configs[0].db_type,'postgres');assert.equal(saved.configs[0].driver_profile,'postgres');
 assert.equal(saved.configs[1].host,'pgv-redis');
 assert.equal(calls.filter(([p])=>p==='connection/connect').length,2);
});

test('sandbox asset tickets authorize only static plugin assets and expire with logout',async()=>{
 const http=await import('node:http');
 const {createGateway,BASE}=await import('./gateway.mjs');
 const upstream=http.createServer((req,res)=>{
  if(req.url===`${BASE}/api/ai/configs`){res.setHeader('content-type','application/json');return res.end(JSON.stringify([{id:'manual-provider',endpoint:'https://example.invalid/v1',apiKey:'fixture-key',model:'manual-model'}]));}
  if(!req.url.startsWith(`${BASE}/api/plugins/signed.example/ui/`)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':'text/javascript'});res.end('export const signed = true;');
 });
 const info=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({sub:'admin-id',preferred_username:'admin'}));});
 await new Promise(r=>upstream.listen(8082,'127.0.0.1',r));await new Promise(r=>info.listen(0,'127.0.0.1',r));
 const gateway=createGateway({userinfoUrl:`http://127.0.0.1:${info.address().port}/userinfo`});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${gateway.address().port}`;
 try{
  const login=await fetch(origin+BASE+'/api/vos/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({access_token:'validation'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],{assets}=await login.json();
  const configs=await (await fetch(origin+BASE+'/api/ai/configs',{headers:{cookie}})).json();
  assert.deepEqual(configs[0],{id:'manual-provider',endpoint:'https://example.invalid/v1',apiKey:'fixture-key',model:'manual-model'});
  assert.equal(configs[1].endpoint,'vos://v-scheduler');
  assert.deepEqual(configs[1].models,[]);
  const assetUrl=origin+BASE+`/plugin-assets/${assets}/signed.example/main.js`;
  const refreshes=await Promise.all([1,2].map(i=>fetch(origin+BASE+'/api/vos/login',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({access_token:`validation-refresh-${i}`})})));
  for(const refresh of refreshes){
   assert.equal(refresh.status,200);
   assert.equal(refresh.headers.get('set-cookie').split(';')[0],cookie);
   assert.equal((await refresh.json()).assets,assets);
  }
  assert.equal((await fetch(origin+BASE+'/api/auth/check',{headers:{cookie}})).status,200);
  const asset=await fetch(assetUrl,{headers:{origin:'null'}});assert.equal(asset.status,200);assert.equal(asset.headers.get('access-control-allow-origin'),'*');
  assert.equal((await fetch(origin+BASE+'/api/connection/list',{headers:{origin:'null',cookie}})).status,403);
  assert.equal((await fetch(origin+BASE+'/api/connection/list',{headers:{cookie:`pgv_vos_session=${assets}`}})).status,401);
  assert.equal((await fetch(origin+BASE+'/api/auth/logout',{method:'POST',headers:{origin,cookie}})).status,204);
  assert.equal((await fetch(assetUrl,{headers:{origin:'null'}})).status,401);
 }finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>upstream.close(r)),new Promise(r=>info.close(r))]);}
});

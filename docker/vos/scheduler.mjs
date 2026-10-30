/** Optional V-Scheduler discovery/inference; never persists VOS credentials in DBX. */
import http from 'node:http';
export const SCHEDULER_ENDPOINT='vos://v-scheduler';
const BASE=process.env.PGV_SCHEDULER_URL||'http://v-scheduler:8080';
const LOCAL='http://127.0.0.1:8093/v1';
const normalize=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export function schedulerModels(payload){
 if(!Array.isArray(payload?.models))throw Error('Invalid V-Scheduler model catalog');
 const models=new Map();
 for(const row of payload.models){
  const id=row.qualified;
  if(typeof id!=='string'||!id.trim())continue;
  const endpoints=(row.endpoints||[]).map(normalize),caps=(row.capabilities||[]).map(normalize);
  let style;
  if(endpoints.length){
   if(endpoints.some(v=>v.endsWith('chatcompletions')))style='completions';
   else if(endpoints.some(v=>v.endsWith('responses')))style='responses';
   else if(endpoints.some(v=>v.endsWith('messages')))style='anthropic-messages';
  }else if(caps.some(v=>['chat','chatcompletions','textgeneration','llm','completion'].includes(v)))style='completions';
  else if(!caps.length&&row.kind!=='embedding')style='completions';
  if(style&&!models.has(id))models.set(id,{id,name:row.display_name||row.name||id,style});
 }
 return [...models.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export async function discoverScheduler(token,fetcher=fetch){
 const response=await fetcher(`${BASE}/api/v1/models`,{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(`V-Scheduler models unavailable (${response.status})`);
 return schedulerModels(await response.json());
}
export function managedConfig(models){
 return {id:'pgv-v-scheduler',name:'V-Scheduler',provider:'openai-compatible',endpoint:SCHEDULER_ENDPOINT,apiKey:'',authMethod:'bearer',apiStyle:'completions',model:models[0]?.id||'',models:models.map(m=>({name:m.id,label:m.name})),isDefault:false};
}
export async function runtimeConfig(config,identity,sessionId,discover=discoverScheduler){
 if(config?.endpoint!==SCHEDULER_ENDPOINT)return config;
 const models=await discover(identity.token),model=models.find(m=>m.id===config.model);
 if(!model)throw Error('Model is unavailable to this VOS account; refresh V-Scheduler models');
 return {...config,provider:model.style==='anthropic-messages'?'anthropic-compatible':'openai-compatible',endpoint:LOCAL,apiKey:sessionId,authMethod:'bearer',apiStyle:model.style,customHeaders:{},proxyEnabled:false,proxyUrl:'',skipTlsVerify:false};
}
export function createSchedulerBridge({sessions,verify,baseUrl=BASE}){
 return http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.socket.remoteAddress!=='127.0.0.1'||!['/v1/chat/completions','/v1/responses','/v1/messages','/v1/models'].includes(path)){res.writeHead(404);return res.end();}
  const key=req.headers.authorization?.replace(/^Bearer /i,'')||req.headers['x-api-key'];
  const identity=sessions.get(key);
  try{if(!identity||identity.expires<Date.now())throw Error('Session required');await verify(identity.token);}catch{res.writeHead(401);return res.end();}
  const target=new URL(path,baseUrl);
  const proxy=http.request(target,{method:req.method,headers:{'content-type':'application/json',authorization:`Bearer ${identity.token}`,...(req.headers['anthropic-version']?{'anthropic-version':req.headers['anthropic-version']}:{})}},upstream=>{
   res.writeHead(upstream.statusCode,{'content-type':upstream.headers['content-type']||'application/json','cache-control':'no-store'});upstream.pipe(res);
  });
  identity.sockets.add(proxy);
  res.on('close',()=>identity.sockets.delete(proxy));
  proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  req.on('aborted',()=>proxy.destroy());res.on('close',()=>proxy.destroy());req.pipe(proxy);
 });
}

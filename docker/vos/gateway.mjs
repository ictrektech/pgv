import {SCHEDULER_ENDPOINT,discoverScheduler,managedConfig,runtimeConfig,createSchedulerBridge} from './scheduler.mjs';
/** VOS authenticates administrators; DBX is reachable only on container loopback. */
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const BASE = '/app/com.ictrek.pgv';
const INTERNAL = 'http://127.0.0.1:8082';
const HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
export function sameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return ['GET','HEAD'].includes(request.method);
    try {const u = new URL(origin); return ['http:','https:'].includes(u.protocol) && u.host === request.headers.host;} catch {return false;}
}
export async function verifyAdministrator(token, userinfoUrl, fetcher = fetch) {
    if (typeof token !== 'string' || !token || token.length > 16384) throw Error('Invalid session');
    const response = await fetcher(userinfoUrl, {headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Invalid session');
    const payload = await response.json();
    if (payload.code !== undefined && payload.code !== 0) throw Error('Invalid session');
    const c = payload.data || payload;
    if (!c.sub || (c.preferred_username || c.username) !== 'admin') throw Error('Administrator required');
    return c.sub;
}
function reply(res, code, body='') {res.writeHead(code, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end(body);}
async function jsonBody(req,limit=32768) {
    const chunks=[];let size=0;
    for await (const chunk of req) {size+=chunk.length;if(size>limit)throw Error('Request too large');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString());
}
export async function backendApi(path, payload, fetcher=fetch) {
    const r=await fetcher(`${INTERNAL}${BASE}/api/${path}`,{method:payload===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw Error(`DBX ${path} failed (${r.status})`);
    return r.json();
}
export async function seedConnections(env=process.env, api=backendApi) {
    // Only DBX's own metadata is migrated. Existing PostgreSQL/Redis data is untouched.
    await api('migration/start',{});
    const saved=await api('connection/list');
    const specs=[{id:'pgv-postgres',name:'PGV PostgreSQL',db_type:'postgres',host:env.PGHOST||'pgv',port:Number(env.PGPORT||5432),username:env.PGUSER||'postgres',password:env.PGPASSWORD,database:env.PGDATABASE||'postgres'},
        {id:'pgv-redis',name:'PGV Redis',db_type:'redis',host:env.PGV_REDIS_HOST||'pgv-redis',port:6379,username:'',password:env.PGV_REDIS_PASSWORD,database:'0'}];
    const configs=specs.map(spec=>{
        if(!spec.password)throw Error('PGV connection credentials required');
        const old=saved.find(c=>c.id===spec.id||c.name===spec.name);
        return {...old,...spec,id:old?.id||spec.id,driver_profile:spec.db_type,save_password:true,is_production:true,color:'#60a5fa'};
    });
    await api('connection/save',{configs,removedIds:[]});
    for(const config of configs)await api('connection/connect',{config});
}
export function createGateway({userinfoUrl,webRoot='/app/static',schedulerBridge=false}) {
    const sessions=new Map();
    const assetSessions=new Map();
    let bridge;
    if(schedulerBridge){
      bridge=createSchedulerBridge({sessions,verify:token=>verifyAdministrator(token,userinfoUrl)});
      bridge.listen(8093,'127.0.0.1');
    }
    const cookieId=req=>(req.headers.cookie||'').split(';').map(c=>c.trim().split('=')).find(([k])=>k==='pgv_vos_session')?.[1];
    const invalidate=id=>{const s=sessions.get(id);if(s){for(const socket of s.sockets)socket.destroy();assetSessions.delete(s.assets);}sessions.delete(id);};
    const authorized=async req=>{
        const id=cookieId(req),s=sessions.get(id);
        if(!s||s.expires<Date.now()){invalidate(id);throw Error('Session required');}
        try{await verifyAdministrator(s.token,userinfoUrl);}catch{invalidate(id);throw Error('Session expired');}
        return s;
    };
    const headers=req=>Object.fromEntries(Object.entries(req.headers).filter(([k])=>!HOP.has(k)&&!k.startsWith('x-forwarded-')&&!['host','origin','cookie','authorization'].includes(k)));
    const server=http.createServer(async(req,res)=>{
        try{
            const pathname=new URL(req.url,'http://localhost').pathname;
            if(pathname==='/healthz')return reply(res,200,'OK');
            if(pathname==='/'){res.writeHead(307,{location:`${BASE}/`});return res.end();}
            if(!pathname.startsWith(`${BASE}/`))return reply(res,404);
            if(pathname.startsWith(`${BASE}/plugin-assets/`)){
                if(!['GET','HEAD'].includes(req.method))return reply(res,405);
                const [ticket,plugin,...parts]=pathname.slice(`${BASE}/plugin-assets/`.length).split('/');
                const id=assetSessions.get(ticket),identity=sessions.get(id);
                if(!identity||identity.expires<Date.now()||!plugin||!(/^[a-zA-Z0-9._-]+$/).test(plugin))return reply(res,401);
                try{await verifyAdministrator(identity.token,userinfoUrl);}catch{invalidate(id);return reply(res,401);}
                let pieces;
                try{pieces=parts.map(decodeURIComponent);if(pieces.some(p=>['.','..'].includes(p)||/[\\/\0]/.test(p)))return reply(res,404);}catch{return reply(res,404);}
                const target=`${INTERNAL}${BASE}/api/plugins/${plugin}/ui/${pieces.map(encodeURIComponent).join('/')}`;
                const proxy=http.request(target,{method:req.method},upstream=>{
                    res.writeHead(upstream.statusCode,{...Object.fromEntries(Object.entries(upstream.headers).filter(([k])=>!HOP.has(k)&&k!=='set-cookie')),'access-control-allow-origin':'*','cache-control':'no-store'});upstream.pipe(res);
                });proxy.on('error',()=>{if(!res.headersSent)reply(res,502);else res.destroy();});proxy.end();return;
            }
            if(!sameOrigin(req))return reply(res,403);
            const path=pathname.slice(BASE.length);
            if(path==='/api/vos/login'){
                if(req.method!=='POST')return reply(res,405);
                try{
                    const {access_token:token}=await jsonBody(req);
                    const subject=await verifyAdministrator(token,userinfoUrl);
                    for(const [id,s] of sessions)if(s.expires<Date.now())invalidate(id);
                    // VOS may mount the same keep-alive page more than once. Refresh
                    // the verified identity in place so parallel frames cannot revoke
                    // each other's in-flight requests or sandbox asset tickets.
                    let id=cookieId(req),session=sessions.get(id);
                    if(!session||session.subject!==subject){
                        invalidate(id);
                        if(sessions.size>=500)throw Error('Session limit');
                        id=randomBytes(32).toString('hex');
                        session={subject,assets:randomBytes(32).toString('hex'),sockets:new Set()};
                        sessions.set(id,session);
                    }
                    session.token=token;session.expires=Date.now()+43200000;
                    const {assets}=session;
                    assetSessions.set(assets,id);
                    res.setHeader('set-cookie',`pgv_vos_session=${id}; Path=${BASE}/; HttpOnly; SameSite=Strict; Max-Age=43200${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);
                    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({assets}));
                }catch{return reply(res,403,'VOS administrator required');}
            }
            if(path.startsWith('/api/')){
                let identity;try{identity=await authorized(req);}catch{return reply(res,401);}
                if(path.startsWith('/api/auth/')){
                    if(path==='/api/auth/check'){
                        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
                        return res.end(JSON.stringify({authenticated:true,required:true,setup_required:false}));
                    }
                    if(path==='/api/auth/logout') {invalidate(cookieId(req));return reply(res,204);}
                    return reply(res,403);
                }
                if(path==='/api/ai/configs'&&req.method==='GET'){
                    const configs=await backendApi('ai/configs');
                    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
                    // Discovery belongs to the model picker. Manual providers must
                    // remain available without waiting for an optional Scheduler.
                    return res.end(JSON.stringify([...configs.filter(c=>c.id!=='pgv-v-scheduler'),managedConfig([])]));
                }
                let rewritten;
                const aiPaths=['/api/ai/complete','/api/ai/stream','/api/ai/agent-stream','/api/ai/models','/api/ai/model-effort','/api/ai/test-connection'];
                if(req.method==='POST'&&aiPaths.includes(path)){
                    const payload=await jsonBody(req,32*1024*1024);
                    const config=payload.request?.config||payload.config;
                    if(config?.endpoint===SCHEDULER_ENDPOINT){
                        try{
                            if(path==='/api/ai/models'){
                                const models=await discoverScheduler(identity.token);
                                res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
                                return res.end(JSON.stringify(models.map(m=>({id:m.id,displayName:m.name}))));
                            }
                            const runtime=await runtimeConfig(config,identity,cookieId(req));
                            if(payload.request)payload.request.config=runtime;else payload.config=runtime;
                        }catch(error){return reply(res,503,`V-Scheduler: ${error.message}`);}
                    }
                    rewritten=JSON.stringify(payload);
                }
                const proxy=http.request(`${INTERNAL}${req.url}`,{method:req.method,headers:{...headers(req),...(rewritten?{'content-length':Buffer.byteLength(rewritten)}:{})}},upstream=>{
                    res.writeHead(upstream.statusCode,Object.fromEntries(Object.entries(upstream.headers).filter(([k])=>!HOP.has(k)&&k!=='set-cookie')));
                    upstream.pipe(res);
                });
                proxy.on('error',()=>{if(!res.headersSent)reply(res,502);else res.destroy();});
                req.on('aborted',()=>proxy.destroy());res.on('close',()=>proxy.destroy());if(rewritten)proxy.end(rewritten);else req.pipe(proxy);return;
            }
            if(!['GET','HEAD'].includes(req.method))return reply(res,405);
            const root=resolve(webRoot);let file=resolve(root,`.${decodeURIComponent(path)}`);
            if(!file.startsWith(`${root}/`)&&file!==root)return reply(res,404);
            try{if(!(await stat(file)).isFile())file=resolve(root,'index.html');}catch{file=resolve(root,'index.html');}
            const body=await readFile(file);
            const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
            res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','content-security-policy':"base-uri 'self'; object-src 'none'; frame-ancestors 'self'",'x-content-type-options':'nosniff','cache-control':'no-cache'});
            res.end(req.method==='HEAD'?undefined:body);
        }catch{if(!res.headersSent)reply(res,500);else res.destroy();}
    });
    server.on('upgrade',async(req,socket,head)=>{
        if(!req.url?.startsWith(`${BASE}/api/`)||!sameOrigin(req))return socket.destroy();
        let s;try{s=await authorized(req);}catch{return socket.destroy();}
        s.sockets.add(socket);socket.on('close',()=>s.sockets.delete(socket));
        const proxy=http.request(`${INTERNAL}${req.url}`,{headers:{...headers(req),connection:'Upgrade',upgrade:'websocket'}});
        proxy.on('upgrade',(r,upstream,upstreamHead)=>{
            socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers).filter(([k])=>k!=='set-cookie').map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
            if(head.length)upstream.write(head);if(upstreamHead.length)socket.write(upstreamHead);
            socket.pipe(upstream);upstream.pipe(socket);
            socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
            socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
        });
        proxy.on('error',()=>socket.destroy());proxy.on('response',r=>{r.resume();socket.destroy();});proxy.end();
    });
    server.on('close',()=>bridge?.close());
    return server;
}
async function main(){
    const backendEnv={...process.env};
    delete backendEnv.PGPASSWORD; delete backendEnv.PGV_REDIS_PASSWORD; delete backendEnv.VOS_USERINFO_URL;
    const child=spawn('/usr/local/bin/dbx-web',[],{stdio:'inherit',env:backendEnv});
    child.on('exit',code=>process.exit(code||0));
    process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGINT'));
    for(let attempt=0;;attempt++){
        try{const r=await fetch(`${INTERNAL}${BASE}/api/auth/check`);if(r.ok)break;}catch{}
        if(attempt>=120){child.kill('SIGTERM');throw Error('DBX backend not ready');}
        await new Promise(r=>setTimeout(r,500));
    }
    await seedConnections();
    createGateway({userinfoUrl:process.env.VOS_USERINFO_URL,schedulerBridge:true}).listen(8081,'0.0.0.0',()=>console.log('PGV DBX viewer ready'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exit(1);});

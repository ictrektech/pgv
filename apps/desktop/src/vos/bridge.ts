import { apiUrl } from '@/lib/common/webPath';
export let pluginAssetRoot = "";
export const isVos = import.meta.env.BASE_URL === '/app/com.ictrek.pgv/';
type State = {locale?: string; theme?: string};
type OAuth = {authorize: (p: Record<string,string>)=>Promise<{code:string;state:string}>;token:(p:Record<string,string>)=>Promise<{access_token:string}>};
type Bridge = {api?:{v1000?:{oauth2?:OAuth}};getState?:()=>Promise<State>;broadcast?:{on:(event:string,handler:(state:State)=>void)=>()=>void}};
export async function vosBridge(): Promise<Bridge> {
  for(let i=0;i<100;i++){
    const bridge=(window as Window & {vos_platform?:Bridge}).vos_platform;
    if(bridge)return bridge;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('请从 VOS 侧栏打开 PGV / Open PGV from VOS');
}
export async function authenticateVosViewer() {
  if(!isVos)return;
  const bridge=await vosBridge(),oauth=bridge.api?.v1000?.oauth2;
  if(!oauth)throw new Error('VOS OAuth bridge unavailable');
  const encode=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
  const verifier=random(),state=random();
  const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const result=await oauth.authorize({client_id:'com.ictrek.pgv',response_type:'code',scope:'openid profile email',state,nonce:random(),code_challenge:challenge,code_challenge_method:'S256'});
  if(result.state!==state)throw new Error('VOS OAuth state mismatch');
  const tokens=await oauth.token({grant_type:'authorization_code',code:result.code,code_verifier:verifier,client_id:'com.ictrek.pgv'});
  const response=await fetch(apiUrl('/api/vos/login'),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({access_token:tokens.access_token})});
  if(!response.ok)throw new Error('PGV 需要 VOS 管理员权限 / VOS administrator required');
  const session = await response.json();
  pluginAssetRoot = `${location.origin}/app/com.ictrek.pgv/plugin-assets/${session.assets}/`;
}
export async function syncVosState(apply:(state:State)=>void|Promise<void>) {
  if(!isVos)return;
  const bridge=await vosBridge();let revision=0;
  const offs=['locale-change','theme-change'].map(event=>bridge.broadcast?.on(event,state=>{revision++;void apply(state);}));
  const before=revision;
  const state=await bridge.getState?.();
  if(state&&before===revision)await apply(state);
  window.addEventListener('pagehide',()=>offs.forEach(off=>off?.()),{once:true});
}
export async function syncVosAppearance(){
  if(!isVos)return;
  const [{setLocale},{useTheme}]=await Promise.all([import('@/i18n'),import('@/composables/useTheme')]);
  await syncVosState(async state=>{
    if(state.locale)await setLocale(state.locale.toLowerCase().startsWith('zh')?'zh-CN':'en');
    if(state.theme)useTheme().setThemeMode(state.theme==='dark'?'dark':'light');
  });
}

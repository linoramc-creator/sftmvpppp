import {normalizeAccessCode,normalizeLegacyAccessCode,generateAccessCode} from './access-code-format.ts';
import {AccessCodeError,accessSessionId,requireCodeSession} from './access-code-session.ts';
import {normalizeProfileName} from './profile-name.ts';
type User={id:string;email:string;email_confirmed_at:string};
type Tokens={access_token:string;refresh_token:string};
export type AccessDependencies={url:string;serviceKey:string;anonKey:string;pepper:string;fetcher?:typeof fetch};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const normalizeEmail=(value:unknown)=>typeof value==='string'&&value.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())?value.trim().toLowerCase():null;
const SITE='https://sftmvpppp.vercel.app',origins=new Set([SITE,'http://localhost:5173','http://127.0.0.1:4173']);
export function accessHandler(deps:AccessDependencies){
 const fetcher=deps.fetcher??fetch;
 async function http(path:string,body:unknown,admin=false,token?:string,method='POST'){
  const r=await fetcher(deps.url+path,{method,headers:{apikey:admin?deps.serviceKey:deps.anonKey,Authorization:'Bearer '+(token??(admin?deps.serviceKey:deps.anonKey)),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});
  if(!r.ok){
   // GoTrue may delete the caller's session when its password is retired.
   // Only this precise logout response permits retrying with a fresh session.
   const detail=path==='/auth/v1/logout?scope=global'&&r.status===403?await r.json().catch(()=>({})):{};
   const expiredLogout=(detail.error_code??detail.code)==='session_not_found';
   throw new AccessCodeError(r.status===429?429:r.status===400||r.status===401||expiredLogout?401:503,r.status===429?'Demasiados intentos. Espera unos minutos.':'No se ha podido verificar el acceso.');
  }
  const value=await r.text();return value?JSON.parse(value):null;
 }
 const rpc=(name:string,body:Record<string,unknown>)=>http('/rest/v1/rpc/'+name,body,true);
 const store=(operation:string,uid:string|null=null,payload:Record<string,unknown>={})=>rpc('beta_access_store',{operation,uid,payload});
 async function digest(value:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(deps.pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function validUser(value:unknown):Promise<User>{const u=value as User;if(!uuid(u?.id)||typeof u.email!=='string'||!u.email_confirmed_at||await rpc('beta_active_user',{uid:u.id})!==true)throw new AccessCodeError(403,'No se ha podido verificar el acceso a esta cuenta.');return u;}
 const userFrom=async(token:string)=>{if(!token||token.length>4096)throw new AccessCodeError(401,'Inicia la activación de tu código.');return validUser(await http('/auth/v1/user',null,false,token,'GET'));};
 const logoutAuth=async(token:string,scope='local')=>{await http('/auth/v1/logout?scope='+scope,{},true,token);};
 async function mint(uid:string):Promise<Tokens>{
  // generate_link can create a user: verify an existing identity before AND after.
  const user=await validUser(await http('/auth/v1/admin/users/'+uid,null,true,undefined,'GET'));
  const link=await http('/auth/v1/admin/generate_link',{type:'magiclink',email:user.email},true);
  if((link.user?.id??link.id)!==uid)throw new AccessCodeError(503,'No se ha podido verificar la identidad.');
  const hash=link.hashed_token??link.properties?.hashed_token;if(typeof hash!=='string')throw new AccessCodeError(503,'No se ha podido preparar la sesión.');
  const session=await http('/auth/v1/verify',{type:'magiclink',token_hash:hash});
  if(session?.user?.id!==uid||typeof session.access_token!=='string'||typeof session.refresh_token!=='string'||!accessSessionId('Bearer '+session.access_token,uid)){
   if(typeof session?.access_token==='string')await logoutAuth(session.access_token).catch(()=>{});
   throw new AccessCodeError(503,'No se ha podido verificar la identidad.');
  }
  return {access_token:session.access_token,refresh_token:session.refresh_token};
 }
 async function finishPending(uid:string,hash:string,version:number,token?:string){
  // Retire the old password and every old refresh session. Never return the random password.
  const bearer=token??(await mint(uid)).access_token;
  try{
   await http('/auth/v1/admin/users/'+uid,{password:generateAccessCode()},true,undefined,'PUT');
   try{await logoutAuth(bearer,'global');}catch(error){
    if(!(error instanceof AccessCodeError)||error.status!==401)throw error;
    // Password changes may already invalidate the old bearer. Obtain a fresh
    // server-only session to ensure all remaining refresh sessions are retired.
    const temporary=await mint(uid);try{await logoutAuth(temporary.access_token,'global');}catch(cause){await logoutAuth(temporary.access_token).catch(()=>{});throw cause;}
   }
   await store('activate',uid,{digest:hash,version});
  }catch(error){if(!token)await logoutAuth(bearer).catch(()=>{});throw error;}
 }
 async function enter(uid:string,hash:string,version:number){
  const tokens=await mint(uid),sessionId=accessSessionId('Bearer '+tokens.access_token,uid)!;
  try{await store('grant',uid,{digest:hash,version,sessionId});}catch(error){await logoutAuth(tokens.access_token).catch(()=>{});throw error;}
  return tokens;
 }
 return async(req:Request):Promise<Response>=>{
  const origin=req.headers.get('origin'),headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin&&origins.has(origin)?origin:SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  try{
   if(origin&&!origins.has(origin))throw new AccessCodeError(403,'Origen no permitido.');
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(req.method!=='POST')throw new AccessCodeError(405,'Método no permitido.');
   if(!deps.pepper||deps.pepper.length<32)throw new AccessCodeError(503,'El acceso está temporalmente no disponible.');
   if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AccessCodeError(415,'Formato inválido.');
   const reader=req.body?.getReader();if(!reader)throw new AccessCodeError(400,'Petición vacía.');let size=0,text='';const decoder=new TextDecoder();
   for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>4096){await reader.cancel();throw new AccessCodeError(413,'Petición demasiado grande.');}text+=decoder.decode(p.value,{stream:true});}text+=decoder.decode();
   let body:Record<string,unknown>;try{body=JSON.parse(text);}catch{throw new AccessCodeError(400,'Petición inválida.');}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','code','email','password','name'].includes(k)))throw new AccessCodeError(400,'Petición inválida.');
   const action=body.action;if(!['login','legacy','register','bootstrap','activate','rotate','status','logout'].includes(String(action)))throw new AccessCodeError(400,'Operación inválida.');
   const code=normalizeAccessCode(body.code),email=normalizeEmail(body.email);
   const ip=(req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()??req.headers.get('cf-connecting-ip')??'unknown').slice(0,160);
   // Global + credential buckets remain effective even if forwarded IP headers are spoofed.
   // A changing guess or IP must never reset the five-digit account limit.
   const rateCredential=action==='login'||action==='bootstrap'?email??String(body.email??'none').trim().toLowerCase():action==='legacy'?normalizeLegacyAccessCode(body.code)??'invalid':email??req.headers.get('authorization')??'none';
   if(await rpc('beta_access_attempt',{kind:action,ip_hash:await digest('ip:'+ip),code_hash:await digest('rate:'+rateCredential)})!==true)throw new AccessCodeError(429,'Demasiados intentos. Espera unos minutos.');
   if(action==='login'){
    if(!code||!email)throw new AccessCodeError(401,'Código incorrecto o acceso no disponible.');
    const hash=await digest('pin:'+email+':'+code),found=await store('find',null,{digest:hash});if(!found||found.credentialKind!=='pin')throw new AccessCodeError(401,'Código incorrecto o acceso no disponible.');
    if(found.state==='pending')await finishPending(found.userId,hash,found.version);
    const tokens=await enter(found.userId,hash,found.version);
    await rpc('beta_access_login_success',{uid:found.userId,sid:accessSessionId('Bearer '+tokens.access_token,found.userId),account_hash:await digest('rate:'+email)}).catch(()=>{});
    return json(tokens);
   }
   if(action==='legacy'){
    const previous=normalizeLegacyAccessCode(body.code);if(!previous)throw new AccessCodeError(401,'Código incorrecto o acceso no disponible.');
    const hash=await digest('code:'+previous),found=await store('find',null,{digest:hash});
    if(!found||found.credentialKind!=='legacy')throw new AccessCodeError(401,'Código incorrecto o acceso no disponible.');
    const tokens=await mint(found.userId),sessionId=accessSessionId('Bearer '+tokens.access_token,found.userId)!;
    try{await store('legacyBootstrap',found.userId,{digest:hash,version:found.version,sessionId});}catch(error){await logoutAuth(tokens.access_token).catch(()=>{});throw error;}
    return json({bootstrapToken:tokens.access_token});
   }
   if(action==='register'||action==='bootstrap'){
    if(!email)throw new AccessCodeError(400,'Introduce un e-mail válido.');
    if(action==='bootstrap'){
     if(typeof body.password!=='string'||body.password.length<1||body.password.length>128)throw new AccessCodeError(400,'Introduce tu contraseña actual.');
     const session=await http('/auth/v1/token?grant_type=password',{email,password:body.password});
     try{const user=await validUser(session?.user),state=await store('status',user.id);if(state.hasCode)throw new AccessCodeError(409,'Esta cuenta ya tiene un código. Entra con tu código personal.');return json({bootstrapToken:session.access_token});}
     catch(error){if(session?.access_token)await logoutAuth(session.access_token).catch(()=>{});throw error;}
    }
    const name=normalizeProfileName(body.name);if(!code||!name)throw new AccessCodeError(400,'Indica tu nombre y elige un código de cinco dígitos.');
    const hash=await digest('pin:'+email+':'+code);
    let user:User;try{user=await validUser(await http('/auth/v1/admin/users',{email,password:generateAccessCode(),email_confirm:true,user_metadata:{display_name:name}},true));}catch{throw new AccessCodeError(400,'No se pudo crear la cuenta. Si ya tienes una, activa su código.');}
    let prepared=false;
    try{const row=await store('prepare',user.id,{digest:hash,credentialKind:'pin'});prepared=true;await store('activate',user.id,{digest:hash,version:row.version});return json(await enter(user.id,hash,row.version));}
    catch(error){if(!prepared)await http('/auth/v1/admin/users/'+user.id,{},true,undefined,'DELETE').catch(()=>{});throw error;}
   }
   const token=(req.headers.get('authorization')??'').replace(/^Bearer\s+/i,''),user=await userFrom(token);
   if(action==='status')return json(await store('status',user.id,{sessionId:accessSessionId('Bearer '+token,user.id)}));
   if(action==='logout'){await store('logout',user.id,{sessionId:accessSessionId('Bearer '+token,user.id)});await logoutAuth(token).catch(()=>{});return json({ok:true});}
   if(!code)throw new AccessCodeError(400,'Elige un código numérico de cinco dígitos.');
   const hash=await digest('pin:'+user.email.trim().toLowerCase()+':'+code),sid=accessSessionId('Bearer '+token,user.id);
   const state=await store('status',user.id,{sessionId:sid});
   if(action==='activate'&&state.hasCode&&!state.pending)throw new AccessCodeError(409,'Esta cuenta ya tiene un código.');
   const sessionId=action==='rotate'?state.credentialKind==='legacy'&&state.canMigrate===true?sid:await requireCodeSession('Bearer '+token,user.id,rpc):undefined;
   const row=await store('prepare',user.id,{digest:hash,credentialKind:'pin',...(sessionId?{sessionId}:{})});
   await finishPending(user.id,hash,row.version,token);
   return json(await enter(user.id,hash,row.version));
  }catch(error){return json({error:error instanceof AccessCodeError?error.message:'No se ha podido completar el acceso. Vuelve a intentarlo.'},error instanceof AccessCodeError?error.status:503);}
 };
}

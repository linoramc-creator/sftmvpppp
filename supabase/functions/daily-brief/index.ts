import {buildBrief,briefWindow,zoneDate,type BriefEnv} from './data.ts';
import {renderBrief} from './render.ts';
import {mailReady,sendBrief} from './email.ts';
import {deliveryTime,briefId,editionDate} from './preferences.ts';
declare const EdgeRuntime:{waitUntil(promise:Promise<unknown>):void};
const env=(key:string)=>Deno.env.get(key)??'';
const SITE='https://sftmvpppp.vercel.app',ORIGINS=new Set([SITE,'http://localhost:5173','http://127.0.0.1:4173']);
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','X-Content-Type-Options':'nosniff'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
class BriefError extends Error{constructor(public status:number,message:string){super(message);}}
async function service(path:string,init:RequestInit={}){
 const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`,{...init,headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(10000)});
 if(!r.ok){const error=await r.json().catch(()=>null);if(error?.message==='BRIEF_BUSY')throw new BriefError(409,'Ya hay una prueba en preparación. Espera a que termine.');if(error?.message==='BRIEF_TEST_LIMIT')throw new BriefError(429,'Has alcanzado las cinco pruebas de hoy. Las ediciones diarias siguen programadas.');throw new Error('DATABASE_UNAVAILABLE');}
 const text=await r.text();return text?JSON.parse(text):null;
}
const rpc=(name:string,body:unknown)=>service('rpc/'+name,{method:'POST',body:JSON.stringify(body)});
async function sameSecret(value:string,expected:string){if(!expected||!value)return false;const [a,b]=await Promise.all([value,expected].map(s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));return new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]);}
async function read(uid:string,filter=''){const rows=await service(`beta_daily_briefs?user_id=eq.${uid}${filter}&select=*&order=created_at.desc&limit=1`);return rows[0]??null;}
async function settings(uid:string){const [s]=await service(`beta_brief_settings?user_id=eq.${uid}&select=enabled,email_enabled,delivery_time&limit=1`);return {enabled:!!s?.enabled,time:s?.delivery_time?.slice(0,5)??'07:00',timezone:'Europe/Madrid',mailReady:mailReady()};}
function output(row:any){return {id:row?.id??null,date:row?.edition??zoneDate(Date.now()),kind:row?.kind??'daily',createdAt:row?.created_at??null,status:row?.status??'missing',payload:row?.payload??null,html:row?.payload?renderBrief(row.payload):null,mailStatus:row?.mail_status??'pending',mailReady:mailReady(),sentAt:row?.sent_at??null};}
async function build(uid:string,id:string,preview:boolean,date:string,time:string){
 try{
  const [saved]=await service(`beta_watchlists?user_id=eq.${uid}&select=symbols&limit=1`);
  const keys:BriefEnv={MASSIVE_API_KEY:env('MASSIVE_API_KEY'),FRED_KEY:env('Fred'),FINNHUB_KEY:env('Finhub'),TAVILY_KEY:env('Tavily'),GEMINI_API_KEY:env('Gemini')};
  const payload=await buildBrief(saved?.symbols??[],keys,preview,Date.now(),time,date);
  await service(`beta_daily_briefs?id=eq.${id}&user_id=eq.${uid}`,{method:'PATCH',body:JSON.stringify({status:'ready',payload,html:renderBrief(payload),mail_status:mailReady()?'pending':'unavailable',updated_at:new Date().toISOString()})});
 }catch{
  await service(`beta_daily_briefs?id=eq.${id}&user_id=eq.${uid}`,{method:'PATCH',body:JSON.stringify({status:'failed',updated_at:new Date().toISOString()})});
 }
}
async function generateDaily(uid:string,date:string){const preferences=await settings(uid);if(!preferences.enabled)return;const id=await rpc('beta_claim_brief',{uid,edition_date:date});if(id)await build(uid,id,false,date,preferences.time);}
async function trial(uid:string,requestId:string,wait=false){
 const id=await rpc('beta_claim_brief_test',{uid,request:requestId});
 if(id){const preferences=await settings(uid),job=build(uid,id,true,zoneDate(Date.now()),preferences.time);if(wait)await job;else EdgeRuntime.waitUntil(job);}
 return read(uid,`&request_id=eq.${requestId}`);
}
async function deliver(uid:string,filter:string){
 const row=await read(uid,filter);if(!row||row.status!=='ready'||['sent','sending','uncertain','disabled'].includes(row.mail_status))return row;
 if(!mailReady()){await service(`beta_daily_briefs?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({mail_status:'unavailable'})});return read(uid,`&id=eq.${row.id}`);}
 const [preferences]=await service(`beta_brief_settings?user_id=eq.${uid}&select=email_enabled&limit=1`);if(!preferences?.email_enabled&&row.kind==='daily')return row;
 const claimed=await service(`beta_daily_briefs?id=eq.${row.id}&user_id=eq.${uid}&mail_status=in.(pending,unavailable,failed)`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({mail_status:'sending',updated_at:new Date().toISOString()})});if(!claimed?.length)return read(uid,`&id=eq.${row.id}`);
 try{
  const [profile]=await service(`beta_profiles?id=eq.${uid}&revoked=eq.false&select=email&limit=1`);if(!profile||!await rpc('beta_is_admin',{uid}))throw new Error('MAIL_RECIPIENT_INVALID');
  const mailId=await sendBrief(profile.email,row.id,row.payload);
  await service(`beta_daily_briefs?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({mail_status:'sent',mail_id:mailId,sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
 }catch(error){const known=error instanceof Error&&['MAIL_PROVIDER_REJECTED','MAIL_RECIPIENT_INVALID','MAIL_TLS_REQUIRED'].includes(error.message);await service(`beta_daily_briefs?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({mail_status:known?'failed':'uncertain',updated_at:new Date().toISOString()})});}
 return read(uid,`&id=eq.${row.id}`);
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&!ORIGINS.has(origin))return json({error:'Origen no permitido.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return json({error:'Método no permitido.'},405);
 try{
  if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Formato inválido.'},415);
  const trusted=await sameSecret(req.headers.get('x-brief-job')??'',env('BRIEF_CRON_SECRET'));
  let uid='';
  if(!trusted){const auth=req.headers.get('authorization')??'';if(!/^Bearer \S{20,4096}$/.test(auth))return json({error:'Inicia sesión.'},401);const r=await fetch(env('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:auth},signal:AbortSignal.timeout(8000)});if(!r.ok)return json({error:'Sesión no válida.'},401);uid=(await r.json()).id;if(!await rpc('beta_is_admin',{uid}))return json({error:'El brief está reservado a tu cuenta de administrador.'},403);}
  const reader=req.body?.getReader(),decoder=new TextDecoder();let body='',bytes=0;if(reader){for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4096){await reader.cancel();return json({error:'Petición demasiado grande.'},413);}body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();}
  let input:any;try{input=JSON.parse(body);}catch{return json({error:'JSON inválido.'},400);}if(!input||Array.isArray(input)||typeof input!=='object')return json({error:'Petición inválida.'},400);
  if(trusted){if(!briefId(input.userId)||!await rpc('beta_is_admin',{uid:input.userId}))return json({error:'Destinatario inválido.'},403);uid=input.userId;}
  const operation=input.operation??'read';
  if(operation==='settings')return json(await settings(uid));
  if(operation==='saveSettings'){
   const time=deliveryTime(input.time);if(!time)return json({error:'Introduce una hora válida (HH:MM).'},400);
   await service(`beta_brief_settings?user_id=eq.${uid}`,{method:'PATCH',body:JSON.stringify({delivery_time:time})});return json(await settings(uid));
  }
  if(operation==='list')return json(await service(`beta_daily_briefs?user_id=eq.${uid}&select=id,edition,kind,status,mail_status,created_at&order=created_at.desc&limit=30`));
  if(operation==='read'){
   if(input.id!==undefined&&!briefId(input.id))return json({error:'Edición inválida.'},400);
   if(input.date!==undefined&&!editionDate(input.date))return json({error:'Fecha inválida.'},400);
   return json(output(await read(uid,input.id?`&id=eq.${input.id}`:input.date?`&edition=eq.${input.date}&kind=eq.daily`:'')));
  }
  if(operation==='test'){
   if(!briefId(input.requestId))return json({error:'Identificador de prueba inválido.'},400);
   const row=await trial(uid,input.requestId,trusted&&input.wait===true);return json(output(row),row?.status==='building'?202:200);
  }
  if(operation==='send'){
   if(!briefId(input.id))return json({error:'Edición inválida.'},400);
   if(!mailReady())return json({error:'El remitente del servidor todavía no está conectado. La prueba queda guardada aquí.'},409);
   return json(output(await deliver(uid,`&id=eq.${input.id}`)));
  }
  if(trusted&&['generate','deliver'].includes(operation)&&editionDate(input.date)){
   const job=operation==='generate'?generateDaily(uid,input.date):deliver(uid,`&edition=eq.${input.date}&kind=eq.daily`);EdgeRuntime.waitUntil(job.catch(()=>console.error('Daily brief job failed')));return json({accepted:true},202);
  }
  return json({error:'Operación inválida.'},400);
 }catch(error){return error instanceof BriefError?json({error:error.message},error.status):json({error:'No se ha podido completar el brief. Inténtalo de nuevo.'},503);}
});

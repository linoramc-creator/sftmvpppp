import {buildBrief,briefWindow,type BriefEnv} from './data.ts';
import {renderBrief} from './render.ts';
import {mailReady,sendBrief} from './email.ts';
declare const EdgeRuntime:{waitUntil(promise:Promise<unknown>):void};
const env=(key:string)=>Deno.env.get(key)??'';
const SITE='https://sftmvpppp.vercel.app',ORIGINS=new Set([SITE,'http://localhost:5173','http://127.0.0.1:4173']);
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','X-Content-Type-Options':'nosniff'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function service(path:string,init:RequestInit={}){const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`,{...init,headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('DATABASE_UNAVAILABLE');const text=await r.text();return text?JSON.parse(text):null;}
const rpc=(name:string,body:any)=>service('rpc/'+name,{method:'POST',body:JSON.stringify(body)});
async function sameSecret(value:string,expected:string){if(!expected||!value)return false;const [a,b]=await Promise.all([value,expected].map(s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));return new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]);}
async function read(uid:string,date=briefWindow().date){const rows=await service(`beta_daily_briefs?user_id=eq.${uid}&edition=eq.${date}&select=*&limit=1`);return rows[0]??null;}
function output(row:any){return {id:row?.id??null,date:row?.edition??briefWindow().date,status:row?.status??'missing',payload:row?.payload??null,html:row?.html??null,mailStatus:row?.mail_status??'pending',mailReady:mailReady(),sentAt:row?.sent_at??null};}
async function generate(uid:string,preview=false){
 const date=briefWindow().date,id=await rpc('beta_claim_brief',{uid,edition_date:date});if(!id)return read(uid,date);
 try{
  const saved=await service(`beta_watchlists?user_id=eq.${uid}&select=symbols&limit=1`),symbols=saved[0]?.symbols??[];
  const keys:BriefEnv={MASSIVE_API_KEY:env('MASSIVE_API_KEY'),FRED_KEY:env('Fred'),FINNHUB_KEY:env('Finhub'),TAVILY_KEY:env('Tavily'),GEMINI_API_KEY:env('Gemini')};
  const payload=await buildBrief(symbols,keys,preview),html=renderBrief(payload);
  await service(`beta_daily_briefs?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({status:'ready',payload,html,mail_status:mailReady()?'pending':'unavailable',updated_at:new Date().toISOString()})});return read(uid,date);
 }catch{await service(`beta_daily_briefs?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({status:'failed',updated_at:new Date().toISOString()})});throw new Error('BRIEF_GENERATION_FAILED');}
}
async function deliver(uid:string){
 const row=await read(uid);if(!row||row.status!=='ready')return row;
 if(['sent','sending','uncertain','disabled'].includes(row.mail_status))return row;
 if(!mailReady()){await service(`beta_daily_briefs?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({mail_status:'unavailable'})});return read(uid);}
 const settings=await service(`beta_brief_settings?user_id=eq.${uid}&select=email_enabled&limit=1`);if(!settings[0]?.email_enabled)return row;
 const claimed=await service(`beta_daily_briefs?id=eq.${row.id}&mail_status=in.(pending,unavailable,failed)`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({mail_status:'sending',updated_at:new Date().toISOString()})});if(!claimed?.length)return read(uid);
 try{const profiles=await service(`beta_profiles?id=eq.${uid}&revoked=eq.false&select=email&limit=1`);if(!profiles[0]||!await rpc('beta_is_admin',{uid}))throw new Error('MAIL_RECIPIENT_INVALID');const mailId=await sendBrief(profiles[0].email,row.id,row.payload);await service(`beta_daily_briefs?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({mail_status:'sent',mail_id:mailId,sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})});}
 catch(error){const known=error instanceof Error&&['MAIL_PROVIDER_REJECTED','MAIL_RECIPIENT_INVALID','MAIL_TLS_REQUIRED'].includes(error.message);await service(`beta_daily_briefs?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({mail_status:known?'failed':'uncertain',updated_at:new Date().toISOString()})});}
 return read(uid);
}
async function scheduled(operation:string){const users=await service('beta_brief_settings?enabled=eq.true&select=user_id');for(const {user_id:uid} of users){if(!await rpc('beta_is_admin',{uid}))continue;try{if(operation==='generate')await generate(uid);else await deliver(uid);}catch{console.error('Daily brief job failed');}}}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&!ORIGINS.has(origin))return json({error:'Origen no permitido.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'Método no permitido.'},405);
 try{
  if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'Formato inválido.'},415);
  const trusted=await sameSecret(req.headers.get('x-brief-job')??'',env('BRIEF_CRON_SECRET'));
  let uid='';if(!trusted){const auth=req.headers.get('authorization')??'';if(!/^Bearer \S{20,4096}$/.test(auth))return json({error:'Inicia sesión.'},401);const r=await fetch(env('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:auth},signal:AbortSignal.timeout(8000)});if(!r.ok)return json({error:'Sesión no válida.'},401);uid=(await r.json()).id;if(!await rpc('beta_is_admin',{uid}))return json({error:'El brief está en prueba con la cuenta de administrador.'},403);}
  const reader=req.body?.getReader();let body='',bytes=0;if(reader){for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4096){await reader.cancel();return json({error:'Petición demasiado grande.'},413);}body+=new TextDecoder().decode(part.value);}}
  let input:any;try{input=JSON.parse(body);}catch{return json({error:'JSON inválido.'},400);}if(!input||Array.isArray(input)||typeof input!=='object')return json({error:'Petición inválida.'},400);
  const operation=input.operation??'read';
  if(trusted){if(!['generate','deliver','test'].includes(operation))return json({error:'Operación inválida.'},400);if(operation==='test'){if(typeof input.userId!=='string'||!await rpc('beta_is_admin',{uid:input.userId}))return json({error:'Destinatario inválido.'},403);await generate(input.userId,true);return json(output(await deliver(input.userId)));}EdgeRuntime.waitUntil(scheduled(operation));return json({accepted:true},202);}
  if(operation==='list')return json(await service(`beta_daily_briefs?user_id=eq.${uid}&select=id,edition,status,mail_status&order=edition.desc&limit=30`));
  if(operation==='read'){const date=typeof input.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)?input.date:undefined;return json(output(await read(uid,date)));}
  if(['generate','test'].includes(operation)){await generate(uid,true);return json(output(operation==='test'?await deliver(uid):await read(uid)));}
  return json({error:'Operación inválida.'},400);
 }catch{return json({error:'No se ha podido completar el brief. Inténtalo de nuevo.'},503);}
});

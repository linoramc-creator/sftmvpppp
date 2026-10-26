import {checkResearchItem} from '../analyze-ticker/research-library.ts';
import {runResearchMonitor,validResearchJob} from './worker.ts';
import {researchMailReady} from './email.ts';
const env=(key:string)=>Deno.env.get(key)??'';
async function service(path:string,init:RequestInit={}){const key=env('SUPABASE_SERVICE_ROLE_KEY'),r=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...init.headers},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok){await r.body?.cancel();throw Error('RESEARCH_STORAGE_UNAVAILABLE');}const value=await r.text();return value?JSON.parse(value):null;}
const rpc=(name:string,body:Record<string,any>)=>service('rpc/'+name,{method:'POST',body:JSON.stringify(body)});
Deno.serve(async request=>{
 const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
 if(!await validResearchJob(request,env('BRIEF_CRON_SECRET')))return new Response(JSON.stringify({error:'No autorizado.'}),{status:403,headers});
 try{if(Number(request.headers.get('content-length')??0)>512)return new Response('{}',{status:413,headers});const reader=request.body?.getReader();let size=0,raw='';if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return new Response('{}',{status:413,headers});}raw+=new TextDecoder().decode(value);}const body=JSON.parse(raw||'{}');if(body.operation==='status')return new Response(JSON.stringify({ready:true,mailReady:researchMailReady(env),checks:'structured-only',schedule:'15 minutes',batch:5,dailyCap:300}),{headers});if(body.operation&&body.operation!=='run')return new Response('{}',{status:400,headers});
  const task=runResearchMonitor({env,service,rpc,check:(uid,id)=>checkResearchItem(uid,id,{env,service,rpc})}).then(result=>console.log(JSON.stringify({job:'research-monitor',...result}))).catch(()=>console.error('research-monitor failed'));
  if(typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(task);else await task;
  return new Response(JSON.stringify({accepted:true}),{status:202,headers});
 }catch{return new Response(JSON.stringify({error:'No se pudo ejecutar la revisión.'}),{status:503,headers});}
});

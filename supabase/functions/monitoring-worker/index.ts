import {runMonitoringWorker,validMonitoringJob} from '../analyze-ticker/monitoring-worker.ts';
import {collectMonitorSnapshot,interpretMonitorNews} from '../analyze-ticker/monitoring-data.ts';
const env=(key:string)=>Deno.env.get(key)??'';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const providerEnv={MASSIVE_API_KEY:env('MASSIVE_API_KEY'),FMP_KEY:env('FMP')||env('FMP_API_KEY')||env('FMP_KEY'),FINNHUB_KEY:env('FINNHUB_API_KEY')||env('Finhub')||env('FINNHUB_KEY')};
async function store(operation:string,payload:Record<string,unknown>={}){
 const key=env('SUPABASE_SERVICE_ROLE_KEY'),r=await fetch(env('SUPABASE_URL')+'/rest/v1/rpc/beta_monitor_store',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({operation,uid:null,payload})});
 if(!r.ok){await r.body?.cancel();throw new Error('MONITOR_STORE_UNAVAILABLE');}return r.json();
}
Deno.serve(async request=>{
 if(!await validMonitoringJob(request,env('BRIEF_CRON_SECRET')))return Response.json({error:'No autorizado.'},{status:403,headers});
 try{
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return Response.json({error:'Petición demasiado grande.'},{status:413,headers});}chunks.push(value);}
  const raw=new Uint8Array(size);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length;}const body=JSON.parse(new TextDecoder().decode(raw)||'{}');
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='operation')||!['run','status'].includes(body.operation??'run'))return Response.json({error:'Petición inválida.'},{status:400,headers});
  if(body.operation==='status')return Response.json({ready:true,delivery:'in-app',scheduleMinutes:5,assetIntervalMinutes:15,fundamentalsHours:24,...await store('status')},{headers});
  const task=runMonitoringWorker({store,collect:(symbol,previous)=>collectMonitorSnapshot(symbol,previous,providerEnv),interpret:async news=>{const key=env('GEMINI_API_KEY')||env('Gemini')||env('GOOGLE_API_KEY');if(!key||!(await store('analysis_budget')).allowed)return [];return interpretMonitorNews(news,key);}}).then(result=>console.log(JSON.stringify({job:'monitoring',...result}))).catch(()=>console.error('Monitoring worker unavailable'));
  if(typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(task);else await task;
  return Response.json({accepted:true},{status:202,headers});
 }catch{return Response.json({error:'No se pudo completar el seguimiento.'},{status:503,headers});}
});

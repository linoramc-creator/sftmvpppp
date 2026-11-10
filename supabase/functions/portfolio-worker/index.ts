import {runPortfolioWorker} from '../analyze-ticker/portfolio-lab.ts';
import {validResearchJob} from '../research-monitor/worker.ts';
const env=(key:string)=>Deno.env.get(key)??'';
Deno.serve(async request=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(request.headers.has('origin')||!await validResearchJob(request,env('BRIEF_CRON_SECRET')))return Response.json({error:'No autorizado.'},{status:403,headers});
 try{
  const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return Response.json({error:'Petición demasiado grande.'},{status:413,headers});}chunks.push(value);}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}const body=JSON.parse(new TextDecoder().decode(raw)||'{}');
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='operation')||!['run','status'].includes(body.operation??'run'))return Response.json({error:'Petición inválida.'},{status:400,headers});
  if(body.operation==='status')return Response.json({ready:true,private:true,execution:'completed-minute-candles',pollSeconds:60,positionsPollSeconds:300,realTrading:false},{headers});
  const task=runPortfolioWorker().then(result=>console.log(JSON.stringify({job:'portfolio-lab',...result}))).catch(()=>console.error('portfolio-lab worker unavailable'));
  if(typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(task);else await task;
  return Response.json({accepted:true},{status:202,headers});
 }catch{return Response.json({error:'No se pudo actualizar el laboratorio.'},{status:503,headers});}
});

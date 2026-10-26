import {researchMailReady,sendResearchMail,ResearchMailError} from './email.ts';
import type {ResearchDiff,ResearchReview} from '../analyze-ticker/research-types.ts';
type Row=Record<string,any>;
export type MonitorDependencies={env:(key:string)=>string;rpc:(name:string,body:Row)=>Promise<any>;service:(path:string,init?:RequestInit)=>Promise<any>;check:(uid:string,id:string)=>Promise<ResearchReview>;send?:typeof sendResearchMail};
/** Separate from HTTP authorization for deterministic delivery/lease tests. No
 * model runs here; only users who opted into monitoring enter the due queue. */
export async function runResearchMonitor(deps:MonitorDependencies){
 const stats={checked:0,checkFailed:0,sent:0,uncertain:0,disabled:0,failed:0},jobs:Row[]=await deps.rpc('beta_research_claim_due',{batch_size:5});
 for(let i=0;i<jobs.length;i+=2)await Promise.all(jobs.slice(i,i+2).map(async job=>{let ok=false;try{await deps.check(job.user_id,job.item_id);stats.checked++;ok=true;}catch{stats.checkFailed++;}finally{await deps.rpc('beta_research_complete_monitor',{uid:job.user_id,item_id:job.item_id,claim_token:job.claim_token,next_at:ok?null:new Date(Date.now()+3*3600000).toISOString()});}}));
 if(!researchMailReady(deps.env))return stats;
 const notices:Row[]=await deps.rpc('beta_research_claim_notifications',{batch_size:5});
 for(const notice of notices){let status:'sent'|'failed'|'uncertain'|'disabled'='disabled';try{
   // Revalidate opt-in and active status after claiming, before every delivery.
   const [items,profiles,reviews,active]=await Promise.all([deps.service(`beta_research_items?id=eq.${notice.item_id}&user_id=eq.${notice.user_id}&select=title,monitor_enabled,email_enabled,deleted_at,status&limit=1`),deps.service(`beta_profiles?id=eq.${notice.user_id}&select=email,revoked&limit=1`),deps.service(`beta_research_reviews?id=eq.${notice.review_id}&user_id=eq.${notice.user_id}&select=diff&limit=1`),deps.rpc('beta_active_user',{uid:notice.user_id})]);
   const item=items?.[0],profile=profiles?.[0],diff:ResearchDiff=notice.diff??reviews?.[0]?.diff;
   if(active===true&&item?.monitor_enabled&&item?.email_enabled&&!item.deleted_at&&item.status==='active'&&profile&&!profile.revoked&&profile.email===notice.email&&diff?.material){await (deps.send??sendResearchMail)(profile.email,notice.id,item.title,diff,deps.env);status='sent';stats.sent++;}else stats.disabled++;
  }catch(error){status=error instanceof ResearchMailError&&error.uncertain?'uncertain':'failed';stats[status]++;}
  await deps.rpc('beta_research_finish_notification',{notice_id:notice.id,claim_token:notice.claim_token,result_status:status});
 }
 return stats;
}
export async function validResearchJob(request:Request,secret:string){
 if(request.method!=='POST'||!secret||secret.length<32)return false;const input=request.headers.get('x-research-job')??'';if(input.length!==secret.length)return false;const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)),crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))]);const aa=new Uint8Array(a),bb=new Uint8Array(b);let delta=0;for(let i=0;i<aa.length;i++)delta|=aa[i]^bb[i];return delta===0;
}

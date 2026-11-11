import {canonicalMonitoringUrl,detectMonitoringChanges,evaluateMonitoringAlert,monitoringKey,monitoringNewsKey,monitoringTitleKey,monitoringSourceUrl} from './monitoring-engine.ts';
import type {MonitorClaim,MonitorNews,MonitorSnapshot} from './monitoring-types.ts';

export type MonitoringWorkerDependencies={
 store:(operation:'claim_assets'|'commit_asset'|'fail_asset',payload:Record<string,unknown>)=>Promise<any>;
 collect:(symbol:string,previous:MonitorSnapshot|null)=>Promise<MonitorSnapshot>;
 interpret?:(news:MonitorNews[])=>Promise<MonitorNews[]>;
 now?:()=>number;
 batchSize?:number;
 interpretTimeoutMs?:number;
};
type Analysis={summary:string;analysisKey:string};
const boundedText=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max):'';
function aliases(news:MonitorNews){const url=canonicalMonitoringUrl(news.url),title=monitoringTitleKey(news.title);return [...(url?['url:'+url]:[]),...(title?['title:'+title]:[])];}
function attempted(news:MonitorNews):Analysis{return {summary:boundedText(news.excerpt,800),analysisKey:'news-v1:'+monitoringKey(monitoringNewsKey(news))+':attempted'};}
function existing(news:MonitorNews):Analysis|null{const summary=boundedText(news.summary,1200),analysisKey=boundedText(news.analysisKey,200);return analysisKey||summary?{summary:summary||boundedText(news.excerpt,800),analysisKey:analysisKey||'news-v1:'+monitoringKey(monitoringNewsKey(news))+':cached'}:null;}
async function deadline<T>(task:Promise<T>,milliseconds:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Monitoring deadline')),milliseconds);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
function snapshotValid(snapshot:MonitorSnapshot,symbol:string,now:number){return !!snapshot&&snapshot.schema===1&&snapshot.symbol===symbol&&typeof snapshot.collectedAt==='string'&&Number.isFinite(Date.parse(snapshot.collectedAt))&&Date.parse(snapshot.collectedAt)<=now&&!!snapshot.metrics&&typeof snapshot.metrics==='object'&&Array.isArray(snapshot.news)&&Array.isArray(snapshot.calendar)&&Array.isArray(snapshot.coverage)&&(Object.values(snapshot.metrics).some(metric=>typeof metric?.value==='number'&&Number.isFinite(metric.value))||snapshot.news.length>0||snapshot.calendar.length>0||!!snapshot.holdings?.items.length);}

/** The lease is global per asset. Numeric observations survive every model
 * failure; attempted analysis keys also survive, preventing paid retry loops.
 * No email, push or user delivery occurs in this worker. */
export async function runMonitoringWorker(deps:MonitoringWorkerDependencies){
 const now=deps.now??Date.now,batch=Math.min(8,Math.max(1,Math.floor(deps.batchSize??4))),stats={claimed:0,collected:0,committed:0,failed:0,skipped:0,interpretations:0,interpretFailed:0};
 const response=await deps.store('claim_assets',{limit:batch}),claims:MonitorClaim[]=Array.isArray(response)?response.slice(0,8):[],seen=new Set<string>(),jobs=claims.filter(claim=>{if(!claim||typeof claim.symbol!=='string'||typeof claim.token!=='string'||!Array.isArray(claim.alerts)||seen.has(claim.symbol)){stats.skipped++;return false;}seen.add(claim.symbol);return true;});stats.claimed=jobs.length;
 const analysis=new Map<string,Promise<Analysis>>();
 for(const claim of jobs)for(const news of claim.previous?.news??[]){const value=existing(news);if(value)for(const alias of aliases(news))if(!analysis.has(alias))analysis.set(alias,Promise.resolve(value));}
 async function summarize(snapshot:MonitorSnapshot){
  const at=now(),seen=new Set<string>(),rows=snapshot.news.filter(news=>{const keys=aliases(news);if(!canonicalMonitoringUrl(news.url)||keys.some(key=>seen.has(key)))return false;for(const key of keys)seen.add(key);return true;}).map(news=>({...news,url:monitoringSourceUrl(news.url)})),pending:MonitorNews[]=[],waiting:{news:MonitorNews;task:Promise<Analysis>}[]=[];
  for(const news of rows){const keys=aliases(news),cached=keys.map(key=>analysis.get(key)).find(Boolean),saved=existing(news);if(saved){for(const key of keys)analysis.set(key,Promise.resolve(saved));waiting.push({news,task:Promise.resolve(saved)});continue;}if(cached){waiting.push({news,task:cached});continue;}
   const published=Date.parse(news.date);if(!keys.length||!Number.isFinite(published)||published>at||at-published>7*86400000)continue;
   if(pending.length<6)pending.push(news);else{const value=attempted(news);for(const key of keys)analysis.set(key,Promise.resolve(value));waiting.push({news,task:Promise.resolve(value)});}
  }
  if(pending.length){
   const call=(async()=>{let values:MonitorNews[]=[];if(deps.interpret){stats.interpretations++;try{const returned=await deadline(Promise.resolve().then(()=>deps.interpret!(pending.map(news=>({...news})))),Math.max(1,Math.min(9000,deps.interpretTimeoutMs??9000)));if(Array.isArray(returned))values=returned;else stats.interpretFailed++;}catch{stats.interpretFailed++;}}
    return new Map(pending.map(news=>{const returned=values.find(value=>value?.id===news.id),summary=boundedText(returned?.summary,1200),value=summary?{summary,analysisKey:boundedText(returned?.analysisKey,200)||'news-v1:'+monitoringKey(monitoringNewsKey(news))+':complete'}:attempted(news);return [monitoringNewsKey(news),value];}));
   })();
   for(const news of pending){const task=call.then(values=>values.get(monitoringNewsKey(news))??attempted(news));for(const key of aliases(news))analysis.set(key,task);waiting.push({news,task});}
  }
  await Promise.all(waiting.map(async({news,task})=>{const value=await task;news.summary=value.summary;news.analysisKey=value.analysisKey;}));return {...snapshot,metrics:Object.fromEntries(Object.entries(snapshot.metrics).map(([field,metric])=>[field,metric?{...metric,url:monitoringSourceUrl(metric.url)}:metric])),calendar:snapshot.calendar.map(event=>({...event,url:monitoringSourceUrl(event.url)})),holdings:snapshot.holdings?{...snapshot.holdings,url:monitoringSourceUrl(snapshot.holdings.url)}:null,news:rows};
 }
 let cursor=0;await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{while(cursor<jobs.length){const claim=jobs[cursor++];try{
   const raw=await deadline(Promise.resolve().then(()=>deps.collect(claim.symbol,claim.previous?structuredClone(claim.previous):null)),40000);if(!snapshotValid(raw,claim.symbol,now()))throw new Error('Invalid monitoring snapshot');stats.collected++;
   const snapshot=await summarize(raw),checkedAt=now(),changes=detectMonitoringChanges(claim.previous,snapshot,checkedAt),evaluations=claim.alerts.map(alert=>({id:alert.id,revision:alert.revision,evaluation:evaluateMonitoringAlert(alert,snapshot,checkedAt)}));
   const committed=await deps.store('commit_asset',{symbol:claim.symbol,token:claim.token,snapshot,changes,evaluations});if(committed?.committed===false)throw new Error('Monitoring lease lost');stats.committed++;
  }catch{stats.failed++;try{await deps.store('fail_asset',{symbol:claim.symbol,token:claim.token});}catch{/* A lost lease must not be reacquired or overwrite another worker. */}}
 }}));return stats;
}

export async function validMonitoringJob(request:Request,secret:string){
 if(request.method!=='POST'||request.headers.has('origin')||!secret||secret.length<32)return false;const supplied=request.headers.get('x-monitor-job')??'';if(supplied.length!==secret.length)return false;
 const [left,right]=await Promise.all([crypto.subtle.digest('SHA-256',new TextEncoder().encode(supplied)),crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))]);const a=new Uint8Array(left),b=new Uint8Array(right);let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;
}

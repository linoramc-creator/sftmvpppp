import {marketJson} from './eodhd-market-fetch.ts';

export const OIL_REFRESH_MS=300000;
export const isOilFuture=(symbol:string)=>symbol==='CL=F'||symbol==='BZ=F';
const cache=new Map<string,{at:number;raw:any}>(),pending=new Map<string,Promise<any>>();
/** A recent traded continuous future is a different instrument from EIA spot.
 * Do not label a continuous symbol as a specific expiry unless disclosed. */
export function oilFutureMetadata(symbol:string,raw:any,now=Date.now()):boolean{
 const meta=raw?.chart?.result?.[0]?.meta;
 if(!isOilFuture(symbol)||meta?.symbol!==symbol||meta.instrumentType!=='FUTURE'||meta.currency!=='USD'||typeof meta.regularMarketPrice!=='number'||!Number.isFinite(meta.regularMarketPrice)||meta.regularMarketPrice<=0)return false;
 const at=Number(meta.regularMarketTime)*1000,age=now-at;
 if(!Number.isFinite(at)||age < -60000||age>96*3600000)return false;
 const period=meta.currentTradingPeriod?.regular,active=typeof period?.start==='number'&&typeof period?.end==='number'&&now>=period.start*1000&&now<period.end*1000;
 // Last close may legitimately precede a weekend. An active session must not
 // silently display a days-old observation as a live future.
 return !active||age<=2*3600000;
}
export function oilContractLabel(symbol:string,raw:any):string{
 const meta=raw?.chart?.result?.[0]?.meta??{},name=String(meta.shortName??meta.longName??'').replace(/[<>\p{Cc}\p{Cf}]/gu,'').slice(0,80);
 const expiry=/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4}\b/i.exec(name)?.[0];
 return `${symbol} · ${meta.exchangeName==='NYM'?'NYMEX':'Referencia continua'} · ${expiry??'vencimiento no informado'}`;
}
export async function oilFutureRaw(symbol:string,deps:{now?:number;read?:(symbol:string,accept:(raw:any)=>boolean)=>Promise<any>}={}):Promise<any>{
 if(!isOilFuture(symbol))return null;
 const now=deps.now??Date.now(),cacheable=!deps.read&&deps.now===undefined,hit=cache.get(symbol);
 if(cacheable&&hit&&hit.raw===null&&now-hit.at<60000)return null;
 if(cacheable&&hit&&now-hit.at<OIL_REFRESH_MS&&oilFutureMetadata(symbol,hit.raw,now))return hit.raw;
 if(cacheable&&pending.has(symbol))return pending.get(symbol)!;
 const operation=(async()=>{
  const accept=(raw:any)=>oilFutureMetadata(symbol,raw,now)&&now-raw.chart.result[0].meta.regularMarketTime*1000<=30*60000;
  const raw=await(deps.read??((value,check)=>marketJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(value)}?range=5d&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:8000,acceptPrimary:check})))(symbol,accept);
  const result=oilFutureMetadata(symbol,raw,now)?raw:null;
  if(cacheable)cache.set(symbol,{at:Date.now(),raw:result});
  return result;
 })().catch(()=>null).finally(()=>{if(cacheable)pending.delete(symbol);});
 if(cacheable)pending.set(symbol,operation);return operation;
}

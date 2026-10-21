import {cached} from './panels.ts';
import {instrumentInfo,type InstrumentInfo} from './asset-instrument.ts';
import {regularSessionEnd} from './market-session.ts';
import {marketJson} from './eodhd-market-fetch.ts';
export type RiskBar={date:string;open:number;high:number;low:number;close:number;adjusted:number;volume:number|null};
export type RiskPoint={date:string;vol20:number|null;vol60:number|null;drawdown:number;volumeRatio:number|null;atr:number|null;atrPercent:number|null;belowPeak:number};
export type RiskData={currency:string;history:RiskPoint[];percentiles:Record<string,{value:number|null;samples:number}>;asOf:string|null;instrument?:InstrumentInfo;annualizationDays?:number};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function volatility(values:number[],annualizationDays:number){const mean=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1))*Math.sqrt(annualizationDays)*100;}
export function riskHistory(bars:RiskBar[],currency:string,annualizationDays=252):RiskData{
 const history:RiskPoint[]=[],returns:number[]=[];let atr:number|null=null;const trs:number[]=[];
 bars.forEach((b,i)=>{
  if(i>0)returns.push(Math.log(b.adjusted/bars[i-1].adjusted));
  const tr=i>0?Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)):b.high-b.low;
  trs.push(tr);if(i===13)atr=trs.reduce((a,v)=>a+v,0)/14;else if(i>13)atr=(atr!*13+tr)/14;
  const recent=bars.slice(Math.max(0,i-251),i+1);let peak=recent[0].close,peakAt=0;recent.forEach((r,j)=>{if(r.close>=peak){peak=r.close;peakAt=j;}});
  const volumes=bars.slice(Math.max(0,i-20),i).map(r=>r.volume),average=volumes.length===20&&volumes.every(v=>v!==null)?volumes.reduce<number>((a,v)=>a+v!,0)/20:null;
  history.push({date:b.date,vol20:returns.length>=20?volatility(returns.slice(-20),annualizationDays):null,vol60:returns.length>=60?volatility(returns.slice(-60),annualizationDays):null,drawdown:(b.close/peak-1)*100,belowPeak:recent.length-1-peakAt,volumeRatio:average&&b.volume!==null?b.volume/average:null,atr,atrPercent:atr!==null?atr/b.close*100:null});
 });
 const last=history.at(-1),percentiles:RiskData['percentiles']={};
 for(const key of ['vol20','vol60','drawdown','volumeRatio','atrPercent'] as const){const previous=history.slice(-253,-1).map(p=>p[key]).filter((v):v is number=>v!==null);const value=last?.[key];const signed=(v:number)=>key==='drawdown'?-v:v;
  percentiles[key]={samples:previous.length,value:value==null||previous.length<60?null:previous.reduce((n,v)=>n+(signed(v)<signed(value)?1:signed(v)===signed(value)?0.5:0),0)/previous.length*100};
 }
 return {currency,history:history.slice(-252),percentiles,asOf:last?.date??null,annualizationDays};
}
export function chartRiskData(c:any,symbol:string,now=Date.now()):RiskData{
 const q=c?.indicators?.quote?.[0],info=instrumentInfo(c?.meta??{},symbol),adj=c?.indicators?.adjclose?.[0]?.adjclose;
 const annualizationDays=info.kind==='crypto'?365:252;
 if(!q||(!adj&&!['index','future','forex','crypto'].includes(info.kind)))return {...riskHistory([],c?.meta?.currency??'',annualizationDays),instrument:info};
 const zone=c.meta?.exchangeTimezoneName??'UTC',day=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(t),today=day(now),rows=new Map<string,RiskBar>();
 const end=regularSessionEnd(c.meta,symbol),closedToday=finite(end)&&end*1000<=now&&day(end*1000)===today;
 for(let i=0;i<(c.timestamp??[]).length;i++){
  const date=day(c.timestamp[i]*1000);if(date>today||date===today&&!closedToday)continue;
  // An appended live quote is not another daily OHLC bar for that same date.
  if(rows.has(date)&&c.timestamp[i]===c.meta?.regularMarketTime)continue;
  const b={date,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],adjusted:adj&&!['forex','crypto'].includes(info.kind)?adj[i]:q.close[i],volume:info.volumeUnit!=='unavailable'&&finite(q.volume?.[i])&&q.volume[i]>0?q.volume[i]:null};
  if([b.open,b.high,b.low,b.close,b.adjusted].every(v=>finite(v)&&v>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close))rows.set(date,b);
 }
 return {...riskHistory([...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)),info.priceUnit||c.meta?.currency||'',annualizationDays),instrument:info};
}
export async function loadAssetRisk(symbol:string,read:typeof marketJson=marketJson,now=Date.now()):Promise<RiskData>{
 try{const raw=await read(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:8000,acceptPrimary:value=>chartRiskData(value?.chart?.result?.[0],symbol,now).history.length>0});
 return chartRiskData(raw?.chart?.result?.[0],symbol,now);
 }catch{return riskHistory([],'');}
}
export async function assetRisk(symbol:string):Promise<RiskData>{return cached('asset-risk-v2:'+symbol,300000,()=>loadAssetRisk(symbol));}

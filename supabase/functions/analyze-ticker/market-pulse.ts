import {cached} from './panels.ts';
import {instrumentInfo,indexDescription,sessionStats,type InstrumentInfo,type SessionStats} from './asset-instrument.ts';
import {chartCandles,type Candle} from './asset-snapshot.ts';
import {chartRiskData,type RiskData} from './asset-risk.ts';
import {prices,type PriceSeries} from './market-analytics.ts';
import {marketJson} from './eodhd-market-fetch.ts';
export type PulseTrend={date:string|null;return5:number|null;return20:number|null;ma20:number|null;ma50:number|null;aboveMa20:number|null;aboveMa50:number|null};
export type PulseVolume={time:number;volume:number;cumulative:number;comparison:number|null;samples:number};
export type PulseRotation={symbol:string;name:string;date:string;day:number|null;five:number|null;twenty:number|null;relative20:number|null};
export type MarketPulse={symbol:string;name:string;description:string;instrument:InstrumentInfo;currency:string;exchange:string;timezone:string;price:number|null;change:number|null;quoteAt:string|null;quoteBasis?:'quote'|'bar-close';dataOrigin?:'yahoo'|'eodhd'|'massive-fx';fetchedAt:string;session:SessionStats;rangePosition:number|null;vwapApprox:number|null;vwapAt:string|null;intraday:{date:string|null;intervalMinutes:number;candles:Candle[];volume:PulseVolume[];coverageStart:string|null};daily:Candle[];trend:PulseTrend;risk:RiskData;rotation:{date:string|null;items:PulseRotation[]}};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const positive=(value:unknown)=>finite(value)&&value>0?value:null;
function zoneOf(meta:any){let zone=String(meta?.exchangeTimezoneName??'UTC');try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{zone='UTC';}return zone;}
const dayAt=(time:number,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
const minuteAt=(time:number,zone:string)=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time);return Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);};
const change=(value:number|undefined,base:number|undefined)=>value!==undefined&&base!==undefined&&value>0&&base>0?(value/base-1)*100:null;
async function get(url:string,headers:Record<string,string>={}){return marketJson(url,{headers:{'User-Agent':'Mozilla/5.0',...headers},redirect:'error'},{timeoutMs:10000});}
const SECTORS=[['XLK','Tecnología'],['XLF','Finanzas'],['XLV','Salud'],['XLY','Consumo discrecional'],['XLP','Consumo básico'],['XLI','Industria'],['XLE','Energía'],['XLU','Servicios públicos'],['XLB','Materiales'],['XLRE','Inmobiliario'],['XLC','Comunicación']] as const;
const US_CONTEXT=new Set(['^GSPC','^IXIC','^DJI','^VIX','NQ=F','SPY','QQQ','IWM','URTH','VEA','VWO','TLT','GLD']);
export function rotationMetrics(series:PriceSeries[]):MarketPulse['rotation']{
 const present=series.filter(s=>s.dates.length>=2),dates=present.map(s=>new Set(s.dates));
 const common=present.length?present[0].dates.slice().reverse().find(d=>dates.every(set=>set.has(d))):undefined;
 if(!common)return {date:null,items:[]};
 const returns=(p:PriceSeries)=>{const i=p.dates.indexOf(common),c=p.closes;return {day:i>=1?change(c[i],c[i-1]):null,five:i>=5?change(c[i],c[i-5]):null,twenty:i>=20?change(c[i],c[i-20]):null};};
 const spy=present.find(s=>s.symbol==='SPY'),reference=spy?returns(spy).twenty:null;
 return {date:common,items:SECTORS.flatMap(([symbol,name])=>{const p=present.find(s=>s.symbol===symbol);if(!p)return [];const r=returns(p);return [{symbol,name,date:common,...r,relative20:r.twenty!==null&&reference!==null?r.twenty-reference:null}];})};
}
async function rotation(){return cached('market-pulse-rotation-v1',300000,async()=>rotationMetrics((await Promise.all([...SECTORS.map(p=>p[0]),'SPY'].map(s=>prices(s,'3mo')))).filter((p):p is PriceSeries=>p!==null)));}
export function pulseTrend(chart:any,riskDate:string|null):PulseTrend{
 const result:PulseTrend={date:riskDate,return5:null,return20:null,ma20:null,ma50:null,aboveMa20:null,aboveMa50:null};
 if(!riskDate)return result;
 const type=String(chart?.meta?.instrumentType??'').toUpperCase(),q=chart?.indicators?.quote?.[0],adj=chart?.indicators?.adjclose?.[0]?.adjclose;
 const closes=['CURRENCY','CRYPTOCURRENCY'].includes(type)?q?.close:Array.isArray(adj)?adj:['INDEX','INDICES','FUTURE'].includes(type)?q?.close:null;
 if(!Array.isArray(closes))return result;
 const byDate=new Map<string,number>(),zone=zoneOf(chart.meta);
 for(let i=0;i<(chart.timestamp??[]).length;i++){const date=dayAt(chart.timestamp[i]*1000,zone);if(date<=riskDate&&positive(closes[i])!==null&&!byDate.has(date))byDate.set(date,closes[i]);}
 const rows=[...byDate].sort((a,b)=>a[0].localeCompare(b[0])),values=rows.map(p=>p[1]),last=values.at(-1);
 if(rows.at(-1)?.[0]!==riskDate)return result;
 const average=(n:number)=>values.length>=n?values.slice(-n).reduce((a,v)=>a+v,0)/n:null;
 result.ma20=average(20);result.ma50=average(50);result.return5=values.length>=6?change(last,values.at(-6)):null;result.return20=values.length>=21?change(last,values.at(-21)):null;
 result.aboveMa20=result.ma20!==null?change(last,result.ma20):null;result.aboveMa50=result.ma50!==null?change(last,result.ma50):null;
 return result;
}
export function pulseVolume(candles:Candle[],date:string,zone:string):PulseVolume[]{
 const groups=new Map<string,Map<number,{time:number;volume:number;cumulative:number}>>();
 for(const c of candles){if(c.partial||!finite(c.volume)||c.volume<0)continue;const day=dayAt(c.time,zone),rows=groups.get(day)??new Map(),minute=minuteAt(c.time,zone),prior=[...rows.values()].at(-1)?.cumulative??0;rows.set(minute,{time:c.time,volume:c.volume,cumulative:prior+c.volume});groups.set(day,rows);}
 const current=groups.get(date),prior=[...groups.keys()].filter(d=>d<date).sort().slice(-4);if(!current)return [];
 return [...current].map(([minute,row])=>{const samples=prior.flatMap(d=>{const value=groups.get(d)?.get(minute)?.cumulative;return value===undefined?[]:[value];});return {...row,comparison:samples.length>=2?samples.reduce((a,v)=>a+v,0)/samples.length:null,samples:samples.length};});
}
export function buildMarketPulse(symbol:string,dailyRaw:any,intradayRaw:any,sectorRotation:MarketPulse['rotation']={date:null,items:[]},now=Date.now()):MarketPulse{
 const dailyChart=dailyRaw?.chart?.result?.[0],intradayChart=intradayRaw?.chart?.result?.[0],dm=dailyChart?.meta??{},im=intradayChart?.meta??{};
 // Use the freshest verified quote metadata, while keeping each chart's own timestamps.
 const meta=(im.regularMarketTime??0)>=(dm.regularMarketTime??0)?{...dm,...im}:{...im,...dm},zone=zoneOf(meta),info=instrumentInfo(meta,symbol);
 const sanitize=(rows:Candle[])=>rows.filter(c=>c.time<=now&&[c.open,c.high,c.low,c.close].every(n=>positive(n)!==null)).map(c=>({...c,volume:info.volumeUnit==='unavailable'?null:c.volume}));
 const daily=sanitize(chartCandles(dailyChart,86400000));
 const allIntraday=intradayChart?.meta?.dataGranularity==='5m'?sanitize(chartCandles(intradayChart,300000)).map(c=>({...c,partial:c.time+300000>now})):[];
 const quoteTime=positive(meta.regularMarketTime),quoteAt=quoteTime!==null&&quoteTime*1000<=now+60000?quoteTime*1000:null;
 const date=quoteAt===null?null:dayAt(quoteAt,zone),target=date&&allIntraday.some(c=>dayAt(c.time,zone)===date)?date:allIntraday.length?dayAt(allIntraday.at(-1)!.time,zone):null;
 const candles=allIntraday.filter(c=>dayAt(c.time,zone)===target),stats=sessionStats(meta,daily,info,now,symbol);
 const sameDate=target!==null&&target===stats.date,highs=sameDate?[stats.high,positive(meta.regularMarketDayHigh),...candles.map(c=>c.high)].filter((v):v is number=>v!==null):[],lows=sameDate?[stats.low,positive(meta.regularMarketDayLow),...candles.map(c=>c.low)].filter((v):v is number=>v!==null):[];
 if(highs.length)stats.high=Math.max(...highs);if(lows.length)stats.low=Math.min(...lows);
 stats.rangePercent=stats.high!==null&&stats.low!==null&&stats.previousClose?(stats.high-stats.low)/stats.previousClose*100:null;
 const price=quoteAt===null?null:positive(meta.regularMarketPrice),risk=chartRiskData(dailyChart,symbol,now),trend=pulseTrend(dailyChart,risk.asOf);
 if(risk.asOf)for(const candle of daily)candle.partial=dayAt(candle.time,zone)>risk.asOf;
 const regularStart=meta.currentTradingPeriod?.regular?.start,complete=candles.filter(c=>!c.partial),fullFromOpen=finite(regularStart)&&target!==null&&dayAt(regularStart*1000,zone)===target&&complete.length>0&&complete[0].time<=regularStart*1000+60000;
 const eligible=info.kind==='etf'&&sameDate&&fullFromOpen&&complete.every(c=>finite(c.volume)&&c.volume>=0),total=eligible?complete.reduce((sum,c)=>sum+c.volume!,0):0;
 const vwapApprox=eligible&&total>0?complete.reduce((sum,c)=>sum+(c.high+c.low+c.close)/3*c.volume!,0)/total:null;
 const rangePosition=price!==null&&stats.high!==null&&stats.low!==null&&stats.high>stats.low&&price>=stats.low&&price<=stats.high?(price-stats.low)/(stats.high-stats.low)*100:null;
 const description=info.kind==='forex'&&info.baseCurrency&&info.quoteCurrency?`El cruce expresa cuántas unidades de ${info.quoteCurrency} equivalen a una unidad de ${info.baseCurrency}. Las variaciones reflejan la evolución de la divisa base frente a la cotizada.`:info.kind==='crypto'?`Cotización de ${info.baseCurrency??symbol} en ${info.quoteCurrency??meta.currency??''}. Mercado continuo; la sesión y las métricas diarias siguen el corte horario indicado.`:indexDescription(symbol);
 return {symbol,name:info.kind==='forex'&&info.baseCurrency&&info.quoteCurrency?`${info.baseCurrency} / ${info.quoteCurrency}`:String(meta.longName??meta.shortName??symbol),description,instrument:info,currency:String(meta.currency??''),exchange:String(meta.exchangeName??''),timezone:zone,price,change:price!==null&&stats.previousClose?(price/stats.previousClose-1)*100:null,quoteAt:quoteAt===null?null:new Date(quoteAt).toISOString(),quoteBasis:meta.pulseOrigin==='massive-fx'?'bar-close':'quote',dataOrigin:meta.pulseOrigin==='massive-fx'?'massive-fx':meta._provider==='eodhd'?'eodhd':'yahoo',fetchedAt:new Date(now).toISOString(),session:stats,rangePosition,vwapApprox,vwapAt:vwapApprox!==null?new Date([...complete].reverse().find(c=>c.volume!>0)!.time+300000).toISOString():null,intraday:{date:target,intervalMinutes:5,candles,volume:info.kind==='etf'&&target?pulseVolume(allIntraday,target,zone):[],coverageStart:candles.length?new Date(candles[0].time).toISOString():null},daily,trend,risk,rotation:sectorRotation};
}
type PulseEnv={MASSIVE_API_KEY?:string};
type PulseGetter=(url:string,headers?:Record<string,string>)=>Promise<any>;
const hasBars=(raw:any)=>{const c=raw?.chart?.result?.[0];return Array.isArray(c?.timestamp)&&c.timestamp.some((t:number,i:number)=>finite(t)&&positive(c?.indicators?.quote?.[0]?.close?.[i])!==null);};
/** Quote-aggregate FX bars have no consolidated traded volume. Keep their UTC
 * boundaries and provenance, and never splice them into another provider's bars. */
export function massiveFxChart(raw:any,symbol:string,minutes:number,now=Date.now()){
 const pair=instrumentInfo({instrumentType:'CURRENCY'},symbol);if(!pair.baseCurrency||!pair.quoteCurrency)return null;
 const duration=minutes*60000,rows=(Array.isArray(raw?.results)?raw.results:[]).filter((r:any)=>finite(r.t)&&r.t>0&&r.t<=now&&[r.o,r.h,r.l,r.c].every(v=>positive(v)!==null)&&r.h>=Math.max(r.o,r.c)&&r.l<=Math.min(r.o,r.c)).sort((a:any,b:any)=>a.t-b.t);
 if(!rows.length)return null;
 const final=rows.at(-1),quoteBar=minutes===5?[...rows].reverse().find((r:any)=>r.t+duration<=now):null,quoteTime=quoteBar?quoteBar.t+duration-1:null,day=dayAt(quoteTime??final.t,'UTC'),start=Date.parse(day+'T00:00:00Z')/1000;
 return {chart:{result:[{meta:{symbol,instrumentType:'CURRENCY',currency:pair.quoteCurrency,exchangeName:'FX',exchangeTimezoneName:'UTC',longName:`${pair.baseCurrency} / ${pair.quoteCurrency}`,pulseOrigin:'massive-fx',dataGranularity:minutes===5?'5m':'1d',...(quoteTime?{regularMarketPrice:quoteBar.c,regularMarketTime:quoteTime/1000}:{}),currentTradingPeriod:{regular:{start,end:start+86400}}},timestamp:rows.map((r:any)=>r.t/1000),indicators:{quote:[{open:rows.map((r:any)=>r.o),high:rows.map((r:any)=>r.h),low:rows.map((r:any)=>r.l),close:rows.map((r:any)=>r.c),volume:rows.map(()=>null)}]}}]}};
}
export async function pulseChartData(symbol:string,env:PulseEnv={},getter:PulseGetter=get,now=Date.now()):Promise<{daily:any;intraday:any}>{
 const [daily,intraday]=await Promise.all([
  getter(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&includePrePost=false`),
  getter(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=false`),
 ]);
 if(hasBars(daily)&&hasBars(intraday)&&intraday?.chart?.result?.[0]?.meta?.dataGranularity==='5m'||!env.MASSIVE_API_KEY||!/^([A-Z]{3})([A-Z]{3})?=X$/.test(symbol))return {daily,intraday};
 const info=instrumentInfo({instrumentType:'CURRENCY'},symbol),ticker=`C:${info.baseCurrency}${info.quoteCurrency}`,end=new Date(now).toISOString().slice(0,10),headers={Authorization:`Bearer ${env.MASSIVE_API_KEY}`};
 const [md,mi]=await Promise.all([
  getter(`https://api.massive.com/v2/aggs/ticker/${ticker}/range/1/day/${new Date(now-730*86400000).toISOString().slice(0,10)}/${end}?sort=asc&limit=1000`,headers),
  getter(`https://api.massive.com/v2/aggs/ticker/${ticker}/range/5/minute/${new Date(now-5*86400000).toISOString().slice(0,10)}/${end}?sort=asc&limit=10000`,headers),
 ]);
 const fallbackDaily=massiveFxChart(md,symbol,1440,now),fallbackIntraday=massiveFxChart(mi,symbol,5,now);
 // Replace both sources together. A daily-only recovery is safe only if the
 // original daily history was absent; preserve a valid native history otherwise.
 return fallbackDaily&&(fallbackIntraday||!hasBars(daily))?{daily:fallbackDaily,intraday:fallbackIntraday}:{daily,intraday};
}
export async function marketPulse(symbol:string,env:PulseEnv={}):Promise<MarketPulse>{
 return cached('market-pulse-v2:'+symbol,60000,async()=>{
  const [{daily,intraday},sectors]=await Promise.all([
   cached('market-pulse-charts-v2:'+symbol,60000,()=>pulseChartData(symbol,env,(url,headers)=>cached('market-pulse-data-v2:'+url,url.includes('interval=1d')||url.includes('/range/1/day/')?300000:60000,()=>get(url,headers)))),
   US_CONTEXT.has(symbol)?rotation():Promise.resolve({date:null,items:[]}),
  ]);
  return buildMarketPulse(symbol,daily,intraday,sectors);
 });
}

import {cached} from './panels.ts';
import {marketJson} from './eodhd-market-fetch.ts';
import {chartCandles,hourlyToFourHours,previousSessionCandle,validCandle,type Candle,type CandleInterval,type CandleSeries} from './asset-candle-series.ts';
import {instrumentInfo,sessionStats,type InstrumentInfo,type SessionStats} from './asset-instrument.ts';

export type AssetCandleData={symbol:string;name:string;currency:string;exchange:string;timezone:string;price:number|null;change:number|null;quoteAt:string|null;instrument:InstrumentInfo;sessionStats:SessionStats;candles:Candle[];series:Partial<Record<CandleInterval,CandleSeries>>;session:string;fetchedAt:string};
type Getter=(url:string,headers?:Record<string,string>)=>Promise<any>;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const hourlyChart=(raw:any)=>{const chart=raw?.chart?.result?.[0];return ['60m','1h'].includes(chart?.meta?.dataGranularity)?chart:null;};
function hourlyRequest(value:string){try{return ['60m','1h'].includes(new URL(value).searchParams.get('interval')??'');}catch{return false;}}
/** Compare actual exchange session dates, not elapsed wall-clock hours. A dated
 * previous-close quote remains valid over a weekend or before the next open.
 * Only a confirmed regular session with no real bars triggers another source.
 */
export function acceptAssetCandlePrimary(url:string,raw:any,now=Date.now()):boolean{
 if(!hourlyRequest(url))return true;
 const chart=hourlyChart(raw),meta=chart?.meta,rows=chartCandles(chart,3600000,now);if(!rows.length)return false;
 if(!['EQUITY','ETF','INDEX','INDICES'].includes(String(meta?.instrumentType??'').toUpperCase()))return true;
 const quote=meta.regularMarketTime,start=meta.currentTradingPeriod?.regular?.start,end=meta.currentTradingPeriod?.regular?.end;
 if(!finite(quote)||quote<=0||quote*1000>now+60000||!finite(start)||!finite(end)||end<=start||quote<start+3600)return true;
 try{
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:meta.exchangeTimezoneName??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}),date=(time:number)=>format.format(time);
  const quotedDate=date(quote*1000);
  if(quotedDate!==date(start*1000))return true;
  return date(rows.at(-1)!.time)>=quotedDate;
 }catch{return false;}
}
export function createAssetCandleGetter(read:typeof marketJson=marketJson,clock:()=>number=Date.now):Getter{
 return async(url,headers={})=>{
  const now=clock();let history:any=null;
  const result=await read(url,{headers:{'User-Agent':'Mozilla/5.0',...headers},redirect:'error'},{timeoutMs:10000,acceptPrimary:raw=>{
   const accepted=acceptAssetCandlePrimary(url,raw,now);
   if(!accepted&&chartCandles(hourlyChart(raw),3600000,now).length)history=raw;
   return accepted;
  }});
  // Keep useful, honestly dated history when the attempted secondary feed is
  // offline, malformed or older; never fill today's missing bars with prices.
  if(history){const fallback=chartCandles(hourlyChart(result),3600000,now),prior=chartCandles(hourlyChart(history),3600000,now);if(!fallback.length||fallback.at(-1)!.time<prior.at(-1)!.time)return history;}
  return result;
 };
}
const get=createAssetCandleGetter();
const span=(rows:Candle[])=>rows.length>1?(rows.at(-1)!.time-rows[0].time)/86400000:0;
const enough=(rows:Candle[])=>rows.length>=30&&span(rows)>=25;
export function buildAssetCandles(symbol:string,hourlyRaw:any,dailyRaw:any,weeklyRaw:any,backup:Candle[]=[],now=Date.now()):{data:AssetCandleData;meta:Record<string,any>}{
 const hourly=hourlyChart(hourlyRaw),daily=dailyRaw?.chart?.result?.[0],weekly=weeklyRaw?.chart?.result?.[0],metas=[hourly?.meta,daily?.meta,weekly?.meta].filter(Boolean).sort((a,b)=>(b.regularMarketTime??0)-(a.regularMarketTime??0)),meta=Object.assign({},...metas.slice().reverse());
 const instrument=instrumentInfo(meta,symbol),normal=hourlyToFourHours(hourly,now),extra=backup.filter(c=>validCandle(c,now)&&c.time<=now).sort((a,b)=>a.time-b.time);
 // Extended-session bars are an explicitly labelled fallback, never spliced
 // into the regular-session series or preferred over adequate hourly history.
 const useBackup=!enough(normal)&&extra.length>normal.length&&(!normal.length||span(extra)>span(normal)&&extra.at(-1)!.time>=normal.at(-1)!.time-3*86400000);
 const session='Sesión regular · OHLC publicados',zone=meta.exchangeTimezoneName??'UTC';
 const series:AssetCandleData['series']={
  '1h':{candles:chartCandles(hourly,3600000,now),timezone:hourly?.meta?.exchangeTimezoneName??zone,session},
  '4h':{candles:useBackup?extra:normal,timezone:useBackup?'America/New_York':hourly?.meta?.exchangeTimezoneName??zone,session:useBackup?'Incluye negociación fuera de la sesión regular':'Sesión regular · último tramo diario puede ser inferior a cuatro horas'},
  '1d':{candles:chartCandles(daily,86400000,now),timezone:daily?.meta?.exchangeTimezoneName??zone,session},
  '1w':{candles:chartCandles(weekly,7*86400000,now),timezone:weekly?.meta?.exchangeTimezoneName??zone,session},
 };
 if(instrument.volumeUnit==='unavailable')for(const value of Object.values(series))value.candles=value.candles.map(c=>({...c,volume:null}));
 const at=finite(meta.regularMarketTime)&&meta.regularMarketTime>0&&meta.regularMarketTime*1000<=now+60000?meta.regularMarketTime*1000:null;
 const price=at!==null&&finite(meta.regularMarketPrice)&&meta.regularMarketPrice>0?meta.regularMarketPrice:null,previous=at!==null?previousSessionCandle(series['1d']!.candles,at,zone):undefined;
 const data:AssetCandleData={symbol,name:meta.longName??meta.shortName??symbol,currency:meta.currency??'',exchange:meta.exchangeName??'',timezone:zone,price,change:price!==null&&previous?(price/previous.close-1)*100:null,quoteAt:at===null?null:new Date(at).toISOString(),instrument,sessionStats:sessionStats(meta,series['1d']!.candles,instrument,now,symbol),candles:series['4h']!.candles,series,session:series['4h']!.session,fetchedAt:new Date(now).toISOString()};
 return {data,meta};
}
export async function fetchAssetCandles(symbol:string,env:{MASSIVE_API_KEY?:string}={},getter:Getter=get,now=Date.now()){
 const base=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
 const [hourly,daily,weekly]=await Promise.all([getter(base+'?range=3mo&interval=60m&includePrePost=false'),getter(base+'?range=2y&interval=1d&includePrePost=false'),getter(base+'?range=5y&interval=1wk&includePrePost=false')]);
 const chart=hourlyChart(hourly),normal=hourlyToFourHours(chart,now),kind=instrumentInfo(chart?.meta??daily?.chart?.result?.[0]?.meta??{},symbol).kind;
 let backup:Candle[]=[];
 if(!enough(normal)&&env.MASSIVE_API_KEY&&['equity','etf'].includes(kind)&&/^[A-Z][A-Z0-9-]{0,12}$/.test(symbol)){
  const start=new Date(now-100*86400000).toISOString().slice(0,10),end=new Date(now).toISOString().slice(0,10),raw=await getter(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/4/hour/${start}/${end}?adjusted=true&sort=asc&limit=50000`,{Authorization:'Bearer '+env.MASSIVE_API_KEY});
  backup=(raw?.results??[]).map((r:any)=>({time:r.t,open:r.o,high:r.h,low:r.l,close:r.c,volume:finite(r.v)?r.v:null,partial:r.t+14400000>now}));
 }
 return buildAssetCandles(symbol,hourly,daily,weekly,backup,now);
}
export function loadAssetCandles(symbol:string,env:{MASSIVE_API_KEY?:string}={}){return cached('asset-candles-v2:'+symbol,120000,()=>fetchAssetCandles(symbol,env));}
export async function assetCandles(symbol:string,env:{MASSIVE_API_KEY?:string}={}){return (await loadAssetCandles(symbol,env)).data;}

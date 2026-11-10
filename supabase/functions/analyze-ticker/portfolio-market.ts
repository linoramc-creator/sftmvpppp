import {marketJson} from './eodhd-market-fetch.ts';
import {portfolioSymbol} from './portfolio-request.ts';
import {portfolioSessionAt,portfolioRegularEnd,portfolioMarketDate,type PortfolioQuote,type PortfolioBar,type PortfolioMarket,type PortfolioCorporateAction} from './portfolio-model.ts';

const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
// A formatted locale date is not a stable ISO identifier across ICU runtimes.
const nyDate=portfolioMarketDate;
const US_EXCHANGES=new Set(['NMS','NGM','NCM','NYQ','ASE','PCX','BTS','BATS','NMQ','NASDAQ','NYSE','NYSEARCA','NYSEAMERICAN','AMEX','ARCA']);
export type PortfolioMarketResult={market:PortfolioMarket;actions:PortfolioCorporateAction[]};
type Loaded={quote:PortfolioQuote;actions:PortfolioCorporateAction[]};
/** A one-minute close is an observation, not a bid/ask or an executable trade.
 * Its real timestamp and delay stay visible. The engine only uses subsequent
 * complete candles for simulated executions. */
export function normalizePortfolioMarket(symbol:string,raw:any,now:number,closedDates:string[]=[]):Loaded|null{
 if(!portfolioSymbol(symbol))return null;const chart=raw?.chart?.result?.[0],meta=chart?.meta??{},type=String(meta.instrumentType??'').toUpperCase();
 if(meta.symbol!==symbol||meta.currency!=='USD'||!['EQUITY','ETF'].includes(type)||!US_EXCHANGES.has(String(meta.exchangeName??'').toUpperCase())||meta.exchangeTimezoneName!=='America/New_York')return null;
 const times=chart?.timestamp,quotes=chart?.indicators?.quote?.[0];if(!Array.isArray(times)||!quotes||meta.dataGranularity!=='1m')return null;
 const bars:PortfolioBar[]=[],observations:{price:number;at:number;session:PortfolioQuote['session']}[]=[];const seen=new Set<number>();
 for(let i=0;i<times.length;i++){
  const time=times[i]*1000;if(!positive(time)||time%60000!==0||time+60000>now-60000||time<now-5*86400000||seen.has(time))continue;seen.add(time);
  const [open,high,low,close,volume]=[quotes.open?.[i],quotes.high?.[i],quotes.low?.[i],quotes.close?.[i],quotes.volume?.[i]],sessionDate=nyDate(time),session=portfolioSessionAt(time,closedDates);
  if(session==='closed'||![open,high,low,close].every(positive)||low>Math.min(open,close)||high<Math.max(open,close)||low>high)continue;
  observations.push({price:close,at:time+60000,session});
  if(!finite(volume)||volume<0)continue;
  const regularEnd=portfolioRegularEnd(sessionDate);bars.push({time,open,high,low,close,volume,session,sessionDate,regularEnd});
 }
 bars.sort((a,b)=>a.time-b.time);observations.sort((a,b)=>a.at-b.at);const latest=observations.at(-1);
 const fallbackAt=positive(meta.regularMarketTime)?meta.regularMarketTime*1000:0;
 const at=latest?.at??(fallbackAt<=now?fallbackAt:0),price=latest?.price??(positive(meta.regularMarketPrice)&&at?meta.regularMarketPrice:null),session=latest?.session??(at?portfolioSessionAt(at,closedDates):'closed'),phase=portfolioSessionAt(now,closedDates),delaySeconds=at?Math.max(0,Math.floor((now-at)/1000)):0;
 const quote:PortfolioQuote={symbol,name:String(meta.longName??meta.shortName??symbol).slice(0,180),currency:'USD',kind:type==='ETF'?'etf':'stock',price,at,session,delaySeconds,tradable:price!==null&&at>0&&delaySeconds<=1200&&phase!=='closed'&&phase===session,bars};
 const actions:PortfolioCorporateAction[]=[];
 for(const event of Object.values(chart?.events?.splits??{}) as any[]){const stamp=event?.date*1000,ratio=positive(event?.numerator)&&positive(event?.denominator)?event.numerator/event.denominator:NaN;if(positive(stamp)&&stamp<=now&&positive(ratio)&&ratio>=.0001&&ratio<=10000)actions.push({id:`split:${symbol}:${stamp}:${ratio}`,symbol,at:stamp,type:'split',ratio});}
 // An ex-date alone is not a confirmed dividend payment/record date. Do not
 // manufacture cash income from Yahoo's ex-dividend event; dividends require
 // a separately verified record/payment event before the engine can credit it.
 return {quote,actions};
}
const cache=new Map<string,{at:number;value:Loaded|null}>(),pending=new Map<string,Promise<Loaded|null>>();
type MarketDeps={read?:(symbol:string)=>Promise<any>;calendar?:()=>Promise<string[]>};
let calendar:{at:number;dates:string[]}|null=null,calendarPending:Promise<string[]>|null=null;
async function closedCalendar(now:number):Promise<string[]>{
 if(calendar&&now-calendar.at<6*3600000)return calendar.dates;if(calendarPending)return calendarPending;
 const key=(globalThis as any).Deno?.env?.get('MASSIVE_API_KEY');if(!key)return [];
 calendarPending=(async()=>{try{const r=await fetch('https://api.massive.com/v1/marketstatus/upcoming',{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok){await r.body?.cancel();return [];}const rows=await r.json();return Array.isArray(rows)?[...new Set(rows.filter(v=>['NYSE','NASDAQ'].includes(v?.exchange)&&v?.status==='closed'&&/^\d{4}-\d{2}-\d{2}$/.test(v?.date)).map(v=>v.date as string))]:[];}catch{return [];}finally{}})().then(dates=>{calendar={at:now,dates};return dates;}).finally(()=>{calendarPending=null;});return calendarPending;
}
async function load(symbol:string,now:number,ttl:number,closedDates:string[],deps:MarketDeps):Promise<Loaded|null>{
 const hit=cache.get(symbol);if(!deps.read&&hit&&now-hit.at<ttl)return hit.value?{...hit.value,quote:{...hit.value.quote,delaySeconds:hit.value.quote.at?Math.max(0,Math.floor((now-hit.value.quote.at)/1000)):0,tradable:hit.value.quote.tradable&&now-hit.value.quote.at<=1200000&&portfolioSessionAt(now,closedDates)===hit.value.quote.session}}:null;
 if(!deps.read&&pending.has(symbol))return pending.get(symbol)!;
 const task=(async()=>{const read=deps.read??(value=>marketJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(value)}?range=1d&interval=1m&includePrePost=true&events=splits%2Cdiv`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:8000,acceptPrimary:raw=>raw?.chart?.result?.[0]?.meta?.dataGranularity==='1m'}));const value=normalizePortfolioMarket(symbol,await read(symbol),now,closedDates);if(!deps.read){if(cache.size>=80)cache.delete(cache.keys().next().value!);cache.set(symbol,{at:now,value});}return value;})().catch(()=>null).finally(()=>{if(!deps.read)pending.delete(symbol);});if(!deps.read)pending.set(symbol,task);return task;
}
export async function loadPortfolioMarket(symbols:string[],now=Date.now(),deps:MarketDeps={}):Promise<PortfolioMarketResult>{
 const all=[...new Set([...symbols.filter(portfolioSymbol),'SPY'])].slice(0,61),closedDates=await (deps.calendar??(()=>closedCalendar(now)))(),loaded:Loaded[]=[];
 let cursor=0;await Promise.all(Array.from({length:Math.min(4,all.length)},async()=>{while(cursor<all.length){const symbol=all[cursor++],value=await load(symbol,now,45000,closedDates,deps);if(value)loaded.push(value);}}));
 const quotes=loaded.map(v=>v.quote),benchmark=quotes.find(q=>q.symbol==='SPY')??null;
 return {market:{quotes,bars:Object.fromEntries(quotes.map(q=>[q.symbol,q.bars??[]])),benchmark,closedDates},actions:loaded.flatMap(v=>v.actions)};
}

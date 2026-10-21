import {eodhdGet,eodhdSymbol,eodhdEnabled} from './eodhd-client.ts';
import {eodhdFundamentalRaw} from './eodhd-fundamentals.ts';
type Row=Record<string,any>;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v),positive=(v:unknown):v is number=>finite(v)&&v>0;
const day=(time:number,zone='UTC')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
function localEpoch(date:string,time:string,zone:string){const parts=(at:number)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));let result=Date.parse(date+'T'+time.padEnd(8,':00')+'Z');for(let i=0;i<2;i++){const p=parts(result),local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);result+=Date.parse(date+'T'+time.padEnd(8,':00')+'Z')-local;}return result/1000;}
export function eodhdTradingPeriod(exchange:Row|null,now=Date.now()){
 const zone=exchange?.Timezone;try{if(typeof zone!=='string')return null;const date=day(now,zone),hours=exchange?.TradingHours,weekday=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short'}).format(now);
  if(typeof hours?.Open!=='string'||typeof hours?.Close!=='string'||!String(hours.WorkingDays??'').split(',').map((s:string)=>s.trim()).includes(weekday)||Object.values(exchange.ExchangeHolidays??{}).some((r:any)=>r.Date===date))return null;
  const early=Object.values(exchange.ExchangeEarlyCloseDays??{}).find((r:any)=>r.Date===date) as Row|undefined;
  const start=localEpoch(date,hours.Open,zone),end=localEpoch(date,early?.EarlyClose??hours.Close,zone);return finite(start)&&finite(end)&&end>start?{regular:{start,end,timezone:zone}}:null;
 }catch{return null;}
}
export function normalizeEodhdDaily(rows:unknown,now=Date.now()):Row[]{
 if(!Array.isArray(rows))return [];const out=new Map<string,Row>();for(const r of rows){const date=String(r?.date??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>day(now)||!positive(r.close)||!positive(r.open)||!positive(r.high)||!positive(r.low)||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close))continue;out.set(date,{date,open:r.open,high:r.high,low:r.low,close:r.close,adjusted:positive(r.adjusted_close)?r.adjusted_close:null,volume:finite(r.volume)&&r.volume>=0?r.volume:null});}return [...out.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export type EodhdMarketDependencies={request?:typeof eodhdGet;fundamentals?:(symbol:string)=>Promise<Row|null>;now?:number};
const tradingCurrency=(value:unknown)=>value==='GBp'?'GBX':typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;
function pairCurrency(id:string){const code=id.slice(0,id.lastIndexOf('.'));return id.endsWith('.FOREX')&&/^[A-Z]{6}$/.test(code)?code.slice(3):id.endsWith('.CC')?code.match(/-([A-Z]{3,5})$/)?.[1]??null:null;}
export async function eodhdQuote(symbol:string,deps:EodhdMarketDependencies={}):Promise<Row|null>{
 const id=eodhdSymbol(symbol);if(!id)return null;
 const request=deps.request??eodhdGet,now=deps.now??Date.now(),raw=await request<Row>('real-time/'+id,{}, {ttlMs:45000,cost:1});
 if(!raw||raw.code!==id||!positive(raw.close)||!positive(raw.timestamp)||raw.timestamp*1000>now+60000)return null;
 const identity=await (deps.fundamentals??eodhdFundamentalRaw)(symbol),currency=tradingCurrency(identity?.General?.CurrencyCode)??pairCurrency(id);
 // An exchange currency cannot distinguish GBP from GBX or an ADR's trading
 // currency from the currency of its financial statements. Unknown stays absent.
 return currency?{...raw,currency}:null;
}
function exchangeCode(symbol:string,g:Row){const id=eodhdSymbol(symbol);if(!id)return null;const suffix=id.split('.').at(-1);if(suffix==='INDX')return ({USA:'US','United States':'US',Japan:'TSE',Korea:'KO','South Korea':'KO','Hong Kong':'HK',China:'SHG',Germany:'XETRA',France:'PA',UK:'LSE','United Kingdom':'LSE'} as Row)[g.CountryName]??null;return ['FOREX','CC','GBOND'].includes(suffix!)?null:suffix;}
export function normalizeEodhdIntraday(data:unknown,exchange:Row|null,continuous:boolean,now=Date.now()):Row[]{
 if(!Array.isArray(data))return [];
 const result=new Map<number,Row>();
 for(const row of data){
  if(!positive(row?.timestamp)||row.timestamp*1000>now||![row.open,row.close,row.high,row.low].every(positive)||row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close))continue;
  const period=continuous?null:eodhdTradingPeriod(exchange,row.timestamp*1000)?.regular;
  // Some responses append a flat closing quote exactly at the session end.
  // It is not the opening timestamp of another tradable intraday bar.
  if(!continuous&&(!period||row.timestamp<period.start||row.timestamp>=period.end))continue;
  result.set(row.timestamp,{time:row.timestamp,open:row.open,high:row.high,low:row.low,close:row.close,adjusted:null,volume:finite(row.volume)&&row.volume>=0?row.volume:null});
 }
 return [...result.values()].sort((a,b)=>a.time-b.time);
}
export async function eodhdChart(symbol:string,range='3mo',interval='1d',includePrePost=false,deps:EodhdMarketDependencies={}):Promise<Row|null>{
 const id=eodhdSymbol(symbol),period=({'1d':7,'5d':9,'1mo':35,'3mo':100,'6mo':195,'1y':380,'2y':745,'5y':1840,'10y':3670,'max':22000} as Row)[range];
 if(!id||deps.request===undefined&&!eodhdEnabled()||includePrePost||!period||!['1d','1wk','1mo','1m','5m','15m','30m','60m','1h'].includes(interval))return null;
 // Native bars are only 1m, 5m and 1h. A 15m/30m request needs a real
 // aggregation contract; falling back is safer than relabelling a 5m bar.
 if(['15m','30m'].includes(interval))return null;
 const now=deps.now??Date.now(),request=deps.request??eodhdGet,raw=await (deps.fundamentals??eodhdFundamentalRaw)(symbol),g=raw?.General??{},code=exchangeCode(symbol,g),exchange=code?await request<Row>('exchange-details/'+code,{}, {ttlMs:6*3600000,cost:1}):null;
 const continuous=id.endsWith('.FOREX')||id.endsWith('.CC'),zone=exchange?.Timezone??(continuous?'UTC':null);if(!zone)return null;try{day(now,zone);}catch{return null;}
 const trading=eodhdTradingPeriod(exchange,now),today=day(now,zone),isDaily=['1d','1wk','1mo'].includes(interval),start=new Date(now-period*86400000).toISOString().slice(0,10);
 const [data,quote]=await Promise.all([isDaily?request<unknown[]>('eod/'+id,{from:start,to:day(now),order:'a'},{ttlMs:300000,cost:1}):request<unknown[]>('intraday/'+id,{interval:interval==='60m'?'1h':interval,from:Math.floor((now-period*86400000)/1000),to:Math.floor(now/1000)},{ttlMs:300000,cost:5}),eodhdQuote(symbol,{...deps,fundamentals:async()=>raw})]);
 let rows:Row[];
 if(isDaily)rows=normalizeEodhdDaily(data,now).filter(r=>r.date<today||trading&&now>=trading.regular.end*1000).map(r=>({...r,time:localEpoch(r.date,exchange?.TradingHours?.Open??'00:00:00',zone)}));
 else rows=normalizeEodhdIntraday(data,exchange,continuous,now);
 if(!rows.length)return null;
 const type=String(g.Type??''),kind=id.endsWith('.INDX')?'INDEX':id.endsWith('.FOREX')?'CURRENCY':id.endsWith('.CC')?'CRYPTOCURRENCY':/ETF/i.test(type)?'ETF':/^(Fund|Mutual Fund)$/i.test(type)?'MUTUALFUND':'EQUITY';
 if(isDaily&&['EQUITY','ETF','MUTUALFUND'].includes(kind)&&rows.some(row=>!positive(row.adjusted)))return null;
 const active=continuous||!!trading&&now>=trading.regular.start*1000&&now<trading.regular.end*1000;
 if(!isDaily&&active&&rows.at(-1)!.time*1000<now-90*60000)return null;
 if(interval==='1wk'||interval==='1mo'){const groups=new Map<string,Row>();for(const row of rows){const d=new Date(row.date+'T12:00Z');if(interval==='1wk')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const key=interval==='1mo'?row.date.slice(0,7):d.toISOString().slice(0,10),old=groups.get(key);groups.set(key,old?{...old,high:Math.max(old.high,row.high),low:Math.min(old.low,row.low),close:row.close,adjusted:row.adjusted,volume:old.volume===null||row.volume===null?null:old.volume+row.volume}:row);}rows=[...groups.values()];}
 const currency=tradingCurrency(g.CurrencyCode)??pairCurrency(id);if(!currency)return null;
 const last=rows.at(-1)!,validQuote=quote&&day(quote.timestamp*1000,zone)>=day(last.time*1000,zone)?quote:null,quoteDay=validQuote?day(validQuote.timestamp*1000,zone):null;
 const prior=positive(validQuote?.previousClose)?validQuote!.previousClose:isDaily?(quoteDay?rows.filter(r=>r.date<quoteDay).at(-1)?.close:rows.at(-2)?.close)??null:null;
 const volumeEligible=['EQUITY','ETF','MUTUALFUND'].includes(kind),volume=volumeEligible&&finite(validQuote?.volume)&&validQuote!.volume>=0?validQuote!.volume:undefined;
 return {chart:{result:[{meta:{symbol,currency,instrumentType:kind,exchangeName:g.Exchange??code,exchangeTimezoneName:zone,shortName:g.Name??symbol,longName:g.Name??symbol,dataGranularity:interval,regularMarketPrice:validQuote?.close??last.close,regularMarketTime:validQuote?.timestamp??null,regularMarketVolume:volume,regularMarketDayHigh:positive(validQuote?.high)?validQuote!.high:undefined,regularMarketDayLow:positive(validQuote?.low)?validQuote!.low:undefined,regularMarketOpen:positive(validQuote?.open)?validQuote!.open:undefined,chartPreviousClose:prior,currentTradingPeriod:trading??undefined,priceHint:currency==='GBX'?2:kind==='CURRENCY'?5:2,_provider:'eodhd',_historyDates:isDaily?rows.map(r=>r.date):undefined},timestamp:rows.map(r=>r.time),indicators:{quote:[{open:rows.map(r=>r.open),high:rows.map(r=>r.high),low:rows.map(r=>r.low),close:rows.map(r=>r.close),volume:rows.map(r=>['INDEX','CURRENCY','CRYPTOCURRENCY'].includes(kind)?null:r.volume)}],adjclose:[{adjclose:rows.map(r=>r.adjusted??(['INDEX','CURRENCY','CRYPTOCURRENCY'].includes(kind)?r.close:null))}]}}],error:null}};
}
export async function eodhdForYahooUrl(value:string):Promise<Row|null>{
 if(!eodhdEnabled())return null;try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||!['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(url.hostname))return null;const match=url.pathname.match(/^\/v8\/finance\/chart\/([^/]+)$/);if(!match||url.searchParams.has('period1')||url.searchParams.has('period2'))return null;return eodhdChart(decodeURIComponent(match[1]),url.searchParams.get('range')??'3mo',url.searchParams.get('interval')??'1d',url.searchParams.get('includePrePost')==='true');}catch{return null;}
}

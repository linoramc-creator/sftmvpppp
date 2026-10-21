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
export async function eodhdQuote(symbol:string):Promise<Row|null>{const id=eodhdSymbol(symbol);if(!id)return null;const raw=await eodhdGet<Row>('real-time/'+id,{}, {ttlMs:45000,cost:1});if(!raw||raw.code!==id||!positive(raw.close)||!positive(raw.timestamp)||raw.timestamp*1000>Date.now()+60000)return null;const identity=await eodhdFundamentalRaw(symbol);const currency=identity?.General?.CurrencyCode??(id.endsWith('.FOREX')?id.slice(3,6):id.endsWith('-USD.CC')?'USD':null);return {...raw,currency};}
function exchangeCode(symbol:string,g:Row){const id=eodhdSymbol(symbol);if(!id)return null;const suffix=id.split('.').at(-1);if(suffix==='INDX')return ({USA:'US','United States':'US',Japan:'TSE',Korea:'KO','Hong Kong':'HK'} as Row)[g.CountryName]??null;return ['FOREX','CC','GBOND'].includes(suffix!)?null:suffix;}
export async function eodhdChart(symbol:string,range='3mo',interval='1d',includePrePost=false):Promise<Row|null>{
 const id=eodhdSymbol(symbol);if(!id||!eodhdEnabled()||includePrePost)return null;
 const period=({'1d':1,'5d':9,'1mo':35,'3mo':100,'6mo':195,'1y':380,'2y':745,'5y':1840,'10y':3670,'max':7300} as Row)[range]??100;
 const now=Date.now(),raw=await eodhdFundamentalRaw(symbol),g=raw?.General??{},code=exchangeCode(symbol,g),exchange=code?await eodhdGet<Row>('exchange-details/'+code,{}, {ttlMs:6*3600000,cost:1}):null;
 let zone=exchange?.Timezone??(id.endsWith('.FOREX')||id.endsWith('.CC')?'UTC':null);if(!zone)return null;try{day(now,zone);}catch{return null;}
 const trading=eodhdTradingPeriod(exchange,now),today=day(now,zone),isDaily=['1d','1wk','1mo'].includes(interval),start=new Date(now-period*86400000).toISOString().slice(0,10);
 const [data,quote]=await Promise.all([isDaily?eodhdGet<unknown[]>('eod/'+id,{from:start,to:day(now),order:'a'},{ttlMs:300000,cost:1}):eodhdGet<unknown[]>('intraday/'+id,{interval:interval==='60m'?'1h':interval,from:Math.floor((now-period*86400000)/1000),to:Math.floor(now/1000)},{ttlMs:300000,cost:5}),eodhdQuote(symbol)]);
 let rows:Row[];
 if(isDaily)rows=normalizeEodhdDaily(data,now).filter(r=>r.date<today||trading&&now>=trading.regular.end*1000).map(r=>({...r,time:localEpoch(r.date,'12:00:00',zone)}));
 else rows=(Array.isArray(data)?data:[]).flatMap((r:any)=>positive(r?.timestamp)&&r.timestamp*1000<=now&&positive(r.open)&&positive(r.close)&&positive(r.high)&&positive(r.low)&&r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close)?[{time:r.timestamp,open:r.open,high:r.high,low:r.low,close:r.close,adjusted:null,volume:finite(r.volume)&&r.volume>=0?r.volume:null}]:[]).sort((a,b)=>a.time-b.time);
 if(!rows.length)return null;
 const active=trading&&now>=trading.regular.start*1000&&now<trading.regular.end*1000;
 if(!isDaily&&active&&rows.at(-1)!.time*1000<now-90*60000)return null;
 if(interval==='1wk'||interval==='1mo'){const groups=new Map<string,Row>();for(const row of rows){const d=new Date(row.date+'T12:00Z');if(interval==='1wk')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const key=interval==='1mo'?row.date.slice(0,7):d.toISOString().slice(0,10),old=groups.get(key);groups.set(key,old?{...old,high:Math.max(old.high,row.high),low:Math.min(old.low,row.low),close:row.close,adjusted:row.adjusted,volume:old.volume===null||row.volume===null?null:old.volume+row.volume}:row);}rows=[...groups.values()];}
 const type=String(g.Type??''),kind=id.endsWith('.INDX')?'INDEX':id.endsWith('.FOREX')?'CURRENCY':id.endsWith('.CC')?'CRYPTOCURRENCY':/ETF/i.test(type)?'ETF':'EQUITY';
 const currency=String(g.CurrencyCode??(kind==='CURRENCY'?id.slice(3,6):kind==='CRYPTOCURRENCY'?'USD':''));if(!currency)return null;
 const last=rows.at(-1)!,validQuote=quote&&day(quote.timestamp*1000,zone)>=day(last.time*1000,zone)?quote:null;
 return {chart:{result:[{meta:{symbol,currency,instrumentType:kind,exchangeName:g.Exchange??code,exchangeTimezoneName:zone,shortName:g.Name??symbol,longName:g.Name??symbol,dataGranularity:interval,regularMarketPrice:validQuote?.close??last.close,regularMarketTime:validQuote?.timestamp??null,chartPreviousClose:rows.at(-2)?.close??null,currentTradingPeriod:trading??undefined,priceHint:2,_provider:'eodhd',_historyDates:isDaily?rows.map(r=>r.date):undefined},timestamp:rows.map(r=>r.time),indicators:{quote:[{open:rows.map(r=>r.open),high:rows.map(r=>r.high),low:rows.map(r=>r.low),close:rows.map(r=>r.close),volume:rows.map(r=>kind==='INDEX'||kind==='CURRENCY'?null:r.volume)}],adjclose:[{adjclose:rows.map(r=>r.adjusted??(['INDEX','CURRENCY','CRYPTOCURRENCY'].includes(kind)?r.close:null))}]}}],error:null}};
}
export async function eodhdForYahooUrl(value:string):Promise<Row|null>{
 if(!eodhdEnabled())return null;try{const url=new URL(value);if(!['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(url.hostname))return null;const match=url.pathname.match(/^\/v8\/finance\/chart\/([^/]+)$/);if(!match)return null;return eodhdChart(decodeURIComponent(match[1]),url.searchParams.get('range')??'3mo',url.searchParams.get('interval')??'1d',url.searchParams.get('includePrePost')==='true');}catch{return null;}
}

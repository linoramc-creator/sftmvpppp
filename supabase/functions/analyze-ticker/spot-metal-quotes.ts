import {eodhdGet} from './eodhd-client.ts';
import {spotMetal} from './spot-metals.ts';
import type {SessionQuote} from './feed-quotes.ts';

const DAY=86400000,HOUR=3600000;
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const day=(at:number)=>new Date(at).toISOString().slice(0,10);
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&day(Date.parse(value))===value?value:null;
const key=()=>{try{return (globalThis as any).Deno?.env?.get('MASSIVE_API_KEY')??'';}catch{return '';}};
type Source='eodhd'|'massive';
type QuoteReader=(symbol:string,label?:string)=>Promise<SessionQuote|null>;

export function spotMetalDailyClose(symbol:string,raw:unknown,source:Source,now=Date.now()):SessionQuote|null{
 const metal=spotMetal(symbol);if(!metal)return null;
 const empty:SessionQuote={symbol,displaySymbol:metal.code,label:metal.name,price:null,change:null,date:null,currency:'USD',unit:'USD/oz t',session:'closed',at:null,delaySeconds:null,priceKind:'daily-close',reference:null,timezone:'UTC'};
 const body=raw as any;
 if(source==='massive'&&body?.ticker!==undefined&&body.ticker!==metal.massiveTicker)return empty;
 const rows=source==='eodhd'?(Array.isArray(raw)?raw:[]):Array.isArray(body?.results)?body.results:[];
 const values=new Map<string,number>(),today=day(now);
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const stamp=source==='eodhd'?date(row.date):positive(row.t)&&row.t<=now?day(row.t):null;
  const [open,high,low,close]=source==='eodhd'?[row.open,row.high,row.low,row.close]:[row.o,row.h,row.l,row.c];
  // UTC daily buckets identify observation dates, never a quote timestamp.
  // Keep only completed days with actual, internally consistent OHLC values.
  if(!stamp||stamp>=today||now-Date.parse(stamp)>14*DAY||![open,high,low,close].every(positive)||high<Math.max(open,close)||low>Math.min(open,close)||low>high)continue;
  values.set(stamp,close);
 }
 const points=[...values].sort(([a],[b])=>a.localeCompare(b)),last=points.at(-1),previous=points.at(-2);
 if(!last||now-Date.parse(last[0])>10*DAY)return empty;
 return {...empty,price:last[1],date:last[0],change:previous?(last[1]/previous[1]-1)*100:null,reference:previous?'previous-close':null};
}

export function createSpotMetalQuotes({request=eodhdGet,fetcher=(input,init)=>fetch(input,init),massiveKey=key,now=()=>Date.now()}:{request?:typeof eodhdGet;fetcher?:typeof fetch;massiveKey?:()=>string;now?:()=>number}={}):QuoteReader{
 const cache=new Map<string,{until:number;value:SessionQuote}>(),pending=new Map<string,Promise<SessionQuote>>();
 return async(symbol,label)=>{
  const metal=spotMetal(symbol);if(!metal)return null;
  const at=now(),hit=cache.get(symbol),name=label&&label!==symbol?label:metal.name;
  if(hit&&hit.until>at)return {...hit.value,label:name};
  if(pending.has(symbol))return {...await pending.get(symbol)!,label:name};
  const operation=(async()=>{
   const from=day(at-14*DAY),to=day(Date.parse(day(at))-DAY);
   let raw:unknown=null;try{raw=await request('eod/'+metal.providerSymbol,{from,to,order:'a'},{ttlMs:HOUR,cost:1});}catch{/* Keep unavailable data absent. */}
   let value=spotMetalDailyClose(symbol,raw,'eodhd',at)!;
   // The existing Massive plan permits historical daily metal bars. Ask only
   // through the last completed day: recent intraday quotes are not entitled.
   const token=value.price===null?massiveKey():'';
   if(token)try{
    const response=await fetcher(`https://api.massive.com/v2/aggs/ticker/${metal.massiveTicker}/range/1/day/${from}/${to}?sort=asc&limit=30`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(6000)});
    if(response.ok&&Number(response.headers.get('Content-Length')??0)<=1000000)value=spotMetalDailyClose(symbol,await response.json(),'massive',at)!;
    else await response.body?.cancel();
   }catch{/* Never substitute a futures price for unavailable spot. */}
   cache.set(symbol,{until:at+(value.price===null?120000:HOUR),value});
   return value;
  })().finally(()=>pending.delete(symbol));
  pending.set(symbol,operation);
  return {...await operation,label:name};
 };
}
export const spotMetalQuote=createSpotMetalQuotes();

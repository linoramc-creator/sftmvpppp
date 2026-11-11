import {spotOil} from './spot-oil.ts';
import type {SessionQuote} from './feed-quotes.ts';

const DAY=86400000,HOUR=3600000,MAX_BODY=50000;
export const SPOT_OIL_MAX_AGE_DAYS=14;
const day=(at:number)=>new Date(at).toISOString().slice(0,10);
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&day(Date.parse(value))===value?value:null;
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)?Number(value):null;
const key=()=>{try{const env=(globalThis as any).Deno?.env;return env?.get('Fred')||env?.get('FRED_KEY')||env?.get('FRED_API_KEY')||'';}catch{return '';}};
type QuoteReader=(symbol:string,label?:string)=>Promise<SessionQuote|null>;
async function boundedText(response:Response):Promise<string|null>{
 if(!response.body)return null;
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{for(;;){const part=await reader.read();if(part.done)return text+decoder.decode();bytes+=part.value.byteLength;if(bytes>MAX_BODY){await reader.cancel();return null;}text+=decoder.decode(part.value,{stream:true});}}finally{reader.releaseLock();}
}

/** An EIA daily observation has an observation date, never a live trade timestamp. */
export function spotOilDailyQuote(symbol:string,raw:unknown,now=Date.now()):SessionQuote|null{
 const oil=spotOil(symbol);if(!oil)return null;
 const empty:SessionQuote={symbol,displaySymbol:oil.code,label:oil.name,price:null,change:null,date:null,currency:'USD',unit:'USD/barril',session:'closed',at:null,delaySeconds:null,priceKind:'daily-close',reference:null,referenceDate:null,timezone:'UTC'};
 const body=raw as any;
 if(body?.series_id!==undefined&&body.series_id!==oil.series||body?.units!==undefined&&body.units!=='lin')return empty;
 const rows=Array.isArray(raw)?raw:Array.isArray(body?.observations)?body.observations:[];
 if(rows.length>100)return empty;
 const values=new Map<string,number>(),today=day(now);
 for(const row of rows){
  const stamp=date(row?.date),value=number(row?.value);
  if(!stamp||stamp>today||now-Date.parse(stamp)>45*DAY||value===null||!Number.isFinite(value)||Math.abs(value)>1000000)continue;
  // A conflicting duplicate cannot choose a price based on response order.
  if(values.has(stamp)&&values.get(stamp)!==value)return empty;
  values.set(stamp,value);
 }
 const points=[...values].sort(([a],[b])=>a.localeCompare(b)),last=points.at(-1),previous=points.at(-2);
 if(!last||now-Date.parse(last[0])>SPOT_OIL_MAX_AGE_DAYS*DAY)return empty;
 const comparable=previous&&previous[1]>0;
 return {...empty,price:last[1],date:last[0],change:comparable?(last[1]/previous[1]-1)*100:null,reference:comparable?'previous-close':null,referenceDate:comparable?previous[0]:null};
}

export function parseSpotOilCsv(symbol:string,text:string):{observations:{date:string;value:string}[]}|null{
 const oil=spotOil(symbol);if(!oil||text.length>MAX_BODY)return null;
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines[0]!==`observation_date,${oil.series}`&&lines[0]!==`DATE,${oil.series}`||lines.length>101)return null;
 const observations=[];
 for(const line of lines.slice(1)){
  const cells=line.split(',');if(cells.length!==2)return null;
  observations.push({date:cells[0],value:cells[1]});
 }
 return {observations};
}

/** Two allowlisted official series, bounded responses and one shared request per
 * series/hour. Public CSV is the same published data when the API is unavailable. */
export function createSpotOilQuotes({fetcher=(input,init)=>fetch(input,init),fredKey=key,now=()=>Date.now()}:{fetcher?:typeof fetch;fredKey?:()=>string;now?:()=>number}={}):QuoteReader{
 const cache=new Map<string,{until:number;value:SessionQuote}>(),pending=new Map<string,Promise<SessionQuote>>();
 return async(symbol,label)=>{
  const oil=spotOil(symbol);if(!oil)return null;
  const at=now(),hit=cache.get(symbol),name=label&&label!==symbol?label:oil.name;
  if(hit&&hit.until>at)return {...hit.value,label:name};
  if(pending.has(symbol))return {...await pending.get(symbol)!,label:name};
  const operation=(async()=>{
   const start=day(at-45*DAY),end=day(at);let value=spotOilDailyQuote(symbol,null,at)!;
   const read=async(url:URL,format:'json'|'csv')=>{
    try{
     const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(6000)});
     if(!response.ok||Number(response.headers.get('Content-Length')??0)>MAX_BODY){await response.body?.cancel();return null;}
     const text=await boundedText(response);if(text===null)return null;
     const raw=format==='json'?JSON.parse(text):parseSpotOilCsv(symbol,text);
     return spotOilDailyQuote(symbol,raw,at);
    }catch{return null;}
   };
   const token=fredKey();
   if(token){
    const url=new URL('https://api.stlouisfed.org/fred/series/observations');
    url.search=new URLSearchParams({series_id:oil.series,api_key:token,file_type:'json',observation_start:start,observation_end:end,units:'lin',output_type:'1',limit:'60',sort_order:'desc'}).toString();
    value=await read(url,'json')??value;
   }
   if(value.price===null){
    const url=new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');url.search=new URLSearchParams({id:oil.series,cosd:start,coed:end}).toString();
    value=await read(url,'csv')??value;
   }
   cache.set(symbol,{until:value.price===null?at+120000:Math.min(at+HOUR,Date.parse(value.date!)+SPOT_OIL_MAX_AGE_DAYS*DAY),value});return value;
  })().finally(()=>pending.delete(symbol));
  pending.set(symbol,operation);return {...await operation,label:name};
 };
}
export const spotOilQuote=createSpotOilQuotes();

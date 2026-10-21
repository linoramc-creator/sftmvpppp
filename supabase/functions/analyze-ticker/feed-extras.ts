import { cached } from './panels.ts';
import {TREASURY_MATURITIES,type TreasuryPoint} from './treasury-curve.ts';
import {eodhdTreasury} from './eodhd-bonds.ts';
import {eodhdGet} from './eodhd-client.ts';
export {type TreasuryPoint} from './treasury-curve.ts';
type Row=Record<string,any>;
export type EarningsEvent={symbol:string;date:string;session:string;eps:number|null;revenue:number|null;currency?:string|null;fiscalDate?:string|null};
async function get(url:string):Promise<any>{try{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});return r.ok?await r.json():null;}catch{return null;}}
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export async function treasury(key:string):Promise<TreasuryPoint[]>{return cached('feed-treasury-v3',3600000,async()=>{
 const primary=await eodhdTreasury(1);
 return Promise.all(TREASURY_MATURITIES.map(async({years,series})=>{
  const history=primary.find(s=>s.id===series)?.points;if(history?.length){const last=history.at(-1)!,previous=history.at(-2);return {years,yield:last.value,date:last.date,changeBp:previous?(last.value-previous.value)*100:null};}
  const raw=key?await get(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=12`):null;
  const values=(raw?.observations??[]).filter((r:Row)=>r.value!=='.'&&r.value!==''&&Number.isFinite(Number(r.value)));
  return {years,yield:values.length?Number(values[0].value):null,date:values[0]?.date??null,changeBp:values.length>1?(Number(values[0].value)-Number(values[1].value))*100:null};
}));});}
const calendarDay=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const estimate=(value:unknown)=>typeof value==='string'&&/^[-+]?\d+(?:\.\d+)?$/.test(value.trim())?number(Number(value)):number(value);
const calendarCurrency=(value:unknown)=>typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;
const unknownTime='Hora por confirmar';
function earningsSymbol(code:unknown):string|null{
 if(typeof code!=='string')return null;
 const match=/^([A-Z0-9][A-Z0-9.-]{0,14})\.([A-Z]+)$/.exec(code);if(!match)return null;
 const suffix=({US:'',LSE:'.L',XETRA:'.DE',AS:'.AS',PA:'.PA',MI:'.MI',MC:'.MC',SW:'.SW',TO:'.TO',V:'.V',AU:'.AX',HK:'.HK'} as Record<string,string>)[match[2]];
 return suffix===undefined?null:match[1]+suffix;
}
/** Calendar filtering uses announcement dates; fiscal period end is metadata,
 * never a substitute for a missing report_date. Only supported listings enter
 * clickable cards, preserving the exact listing instead of guessing US shares.
 */
export function normalizeEodhdEarnings(raw:unknown,start:string,end:string):EarningsEvent[]{
 const list=raw&&typeof raw==='object'&&Array.isArray((raw as Row).earnings)?(raw as Row).earnings:[];
 return list.flatMap((row:Row)=>{const day=calendarDay(row?.report_date),symbol=earningsSymbol(row?.code);if(!day||!symbol||day<start||day>end||number(row.actual)!==null)return [];
  const session=({BeforeMarket:'Antes de apertura',AfterMarket:'Después del cierre'} as Record<string,string>)[row.before_after_market]??unknownTime;
  return [{symbol,date:day,session,eps:estimate(row.estimate),revenue:null,currency:calendarCurrency(row.currency),fiscalDate:calendarDay(row.date)}];
 });
}
export function mergeEarningsCalendar(primary:EarningsEvent[],fallback:unknown[],start:string,end:string,excluded:ReadonlySet<string>=new Set()):EarningsEvent[]{
 const map=new Map<string,EarningsEvent>();
 const blocked=new Set(excluded);
 for(const value of fallback){const row=value as Row;if(!row||typeof row!=='object'||number(row.epsActual??row.actual)===null)continue;const day=calendarDay(typeof row.date==='string'?row.date.slice(0,10):null),symbol=typeof row.symbol==='string'?row.symbol:'';if(day&&day>=start&&day<=end)blocked.add(symbol+'|'+day);}
 for(const value of fallback){const row=value as Row;if(!row||typeof row!=='object')continue;const day=calendarDay(typeof row.date==='string'?row.date.slice(0,10):null),symbol=typeof row.symbol==='string'?row.symbol:'';if(!day||day<start||day>end||!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol))continue;
  const id=symbol+'|'+day;if(blocked.has(id))continue;const old=map.get(id),session=({bmo:'Antes de apertura',amc:'Después del cierre',dmh:'Durante sesión'} as Record<string,string>)[row.hour??row.time]??old?.session??unknownTime;
  map.set(id,{symbol,date:day,session,eps:estimate(row.epsEstimated??row.epsEstimate)??old?.eps??null,revenue:estimate(row.revenueEstimated??row.revenueEstimate)??old?.revenue??null,currency:calendarCurrency(row.currency)??old?.currency??null});
 }
 for(const row of primary){if(!calendarDay(row.date)||row.date<start||row.date>end||!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(row.symbol))continue;const id=row.symbol+'|'+row.date;if(blocked.has(id))continue;const old=map.get(id),currencyCompatible=!row.currency||!old?.currency||row.currency===old.currency,useFallbackEps=row.eps===null&&currencyCompatible&&old?.eps!==null&&old?.eps!==undefined;
  map.set(id,{...row,session:row.session===unknownTime?old?.session??row.session:row.session,eps:row.eps??(useFallbackEps?old?.eps:null)??null,revenue:old?.revenue??null,currency:useFallbackEps?old?.currency??null:row.currency??null});
 }
 // Rank only on supplied estimates. A missing estimate is not a zero or an
 // inferred market-cap ranking; alphabetical order breaks genuinely equal ties.
 const counts=new Map<string,number>();
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||(a.revenue===null&&b.revenue===null?0:a.revenue===null?1:b.revenue===null?-1:b.revenue-a.revenue)||a.symbol.localeCompare(b.symbol)).filter(event=>{const count=counts.get(event.date)??0;counts.set(event.date,count+1);return count<4;}).slice(0,24);
}
type EarningsDeps={now?:number;primary?:(start:string,end:string)=>Promise<unknown>;fallback?:(start:string,end:string)=>Promise<unknown[]>};
export async function loadEarningsCalendar(fmp:string,finnhub:string,deps:EarningsDeps={}):Promise<EarningsEvent[]>{
 const now=deps.now??Date.now(),start=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),end=new Date(Date.parse(start+'T12:00:00Z')+6*86400000).toISOString().slice(0,10);
 let raw:unknown=null;try{raw=await (deps.primary??((from,to)=>eodhdGet('calendar/earnings',{from,to},{ttlMs:3600000,cost:1})))(start,end);}catch{/* Retain the existing calendar when the primary transport fails. */}
 const primary=normalizeEodhdEarnings(raw,start,end);
 const announced=new Set<string>();
 for(const row of raw&&typeof raw==='object'&&Array.isArray((raw as Row).earnings)?(raw as Row).earnings:[]){const day=calendarDay(row?.report_date),symbol=earningsSymbol(row?.code);if(day&&symbol&&number(row.actual)!==null)announced.add(symbol+'|'+day);}
 // EODHD earnings includes EPS, but no estimated revenue. Existing feeds remain
 // useful for that missing field and announcements absent from one calendar.
 let fallback:unknown[]=[];try{fallback=deps.fallback?await deps.fallback(start,end):await (async()=>{const [a,b]=await Promise.all([fmp?get(`https://financialmodelingprep.com/stable/earnings-calendar?from=${start}&to=${end}&apikey=${encodeURIComponent(fmp)}`):null,finnhub?get(`https://finnhub.io/api/v1/calendar/earnings?from=${start}&to=${end}&token=${encodeURIComponent(finnhub)}`):null]);return [...(Array.isArray(a)?a:[]),...(Array.isArray(b?.earningsCalendar)?b.earningsCalendar:[])];})();}catch{/* A secondary outage must not discard a valid EODHD calendar. */}
 return mergeEarningsCalendar(primary,fallback,start,end,announced);
}
export async function earnings(fmp:string,finnhub:string):Promise<EarningsEvent[]>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());return cached('feed-earnings-eodhd-v1:'+day,3600000,()=>loadEarningsCalendar(fmp,finnhub));}

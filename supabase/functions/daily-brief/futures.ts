import type {BriefPoint} from './data.ts';

export const BRIEF_FUTURES=[['ES=F','S&P 500'],['NQ=F','Nasdaq 100'],['YM=F','Dow Jones'],['RTY=F','Russell 2000']] as const;
export type MorningFuture={symbol:string;name:string;contract:string|null;currency:string;unit:'pts';status:'overnight'|'intraday'|'previous-close'|'unavailable';price:number|null;change:number|null;date:string|null;at:string|null;referencePrice:number|null;referenceDate:string|null;points:BriefPoint[]};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
function local(time:number){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time),get=(key:string)=>parts.find(p=>p.type===key)?.value??'';return {date:`${get('year')}-${get('month')}-${get('day')}`,minute:+get('hour')*60+ +get('minute')};}
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T12:00Z')+days*86400000).toISOString().slice(0,10);
function tradingDay(time:number){const p=local(time);return p.minute>=18*60?shift(p.date,1):p.date;}
function sessionOpen(time:number){const p=local(time),weekday=new Date(p.date+'T12:00Z').getUTCDay();return weekday===0?p.minute>=18*60:weekday===6?false:weekday===5?p.minute<17*60:p.minute<17*60||p.minute>=18*60;}

/** Only dated observations already completed at the information cutoff enter the edition. */
export function normalizeMorningFuture(symbol:string,name:string,daily:any,intraday:any,cutoff:number):MorningFuture{
 const chart=daily?.chart?.result?.[0],meta=chart?.meta??{},minute=intraday?.chart?.result?.[0],mm=minute?.meta??{};
 const base:MorningFuture={symbol,name,contract:typeof mm.shortName==='string'?mm.shortName:typeof meta.shortName==='string'?meta.shortName:null,currency:meta.currency??mm.currency??'',unit:'pts',status:'unavailable',price:null,change:null,date:null,at:null,referencePrice:null,referenceDate:null,points:[]};
 if(!BRIEF_FUTURES.some(([s])=>s===symbol)||!Number.isFinite(cutoff))return base;
 const today=local(cutoff),day=tradingDay(cutoff),q=chart?.indicators?.quote?.[0];
 // A daily bar stamped on the current local date can contain the later close.
 // Keep only dates strictly before the information date/session date.
 const dailyRows=(chart?.timestamp??[]).flatMap((t:number,i:number)=>positive(t)&&t*1000<=cutoff&&positive(q?.close?.[i])&&(local(t*1000).date<today.date||local(t*1000).date===today.date&&today.minute>=17*60)?[{date:local(t*1000).date,value:q.close[i]}]:[]).sort((a:any,b:any)=>a.date.localeCompare(b.date));
 const bars=mm.dataGranularity==='5m'?(minute.timestamp??[]).flatMap((t:number,i:number)=>{
  const value=minute?.indicators?.quote?.[0]?.close?.[i],start=t*1000,end=start+300000;
  // Chart endpoints sometimes append a quote with a non-aligned timestamp.
  if(!positive(t)||t%300!==0||!positive(value)||end>cutoff||cutoff-end>7*86400000)return [];
  return [{date:new Date(end).toISOString(),value,start,end,day:tradingDay(start)}];
 }).sort((a:any,b:any)=>a.end-b.end):[];
 const recent=bars.filter((b:any)=>b.day===day&&sessionOpen(b.start)).at(-1);
 const nativeTime=positive(mm.regularMarketTime)?mm.regularMarketTime*1000:null;
 const native=nativeTime!==null&&nativeTime<=cutoff&&cutoff-nativeTime<=30*60000&&tradingDay(nativeTime)===day&&sessionOpen(nativeTime)&&positive(mm.regularMarketPrice)?{date:new Date(nativeTime).toISOString(),value:mm.regularMarketPrice,start:nativeTime,end:nativeTime,day}:null;
 const current=sessionOpen(cutoff)?native&&(!recent||native.end>recent.end)?native:recent:null;
 if(current&&cutoff-current.end<=45*60000){
  const reference=dailyRows.filter((r:any)=>r.date<day).at(-1);
  return {...base,status:today.minute<570||today.minute>=1080?'overnight':'intraday',price:current.value,change:reference?(current.value/reference.value-1)*100:null,date:local(current.end).date,at:current.date,referencePrice:reference?.value??null,referenceDate:reference?.date??null,points:bars.filter((b:any)=>b.day===day).slice(-180).map(({date,value}:BriefPoint)=>({date,value}))};
 }
 const last=dailyRows.at(-1),prior=dailyRows.at(-2);
 if(!last)return base;
 return {...base,status:'previous-close',price:last.value,date:last.date,change:prior?(last.value/prior.value-1)*100:null,referencePrice:prior?.value??null,referenceDate:prior?.date??null,points:bars.filter((b:any)=>b.day===last.date).slice(-180).map(({date,value}:BriefPoint)=>({date,value}))};
}
async function minuteChart(symbol:string){try{const response=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=true`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error',signal:AbortSignal.timeout(9000)});return response.ok?await response.json():null;}catch{return null;}}
export async function collectMorningFutures(cutoff:number,daily:(symbol:string)=>Promise<any>):Promise<MorningFuture[]>{
 const values:MorningFuture[]=new Array(BRIEF_FUTURES.length);let next=0;
 await Promise.all(Array.from({length:2},async()=>{while(next<BRIEF_FUTURES.length){const i=next++,[symbol,name]=BRIEF_FUTURES[i],[d,m]=await Promise.all([daily(symbol),minuteChart(symbol)]);values[i]=normalizeMorningFuture(symbol,name,d,m,cutoff);}}));
 return values;
}

import {cached} from './panels.ts';
export const ALERT_KINDS=['price_above','price_below','daily_up','daily_down','volume'];
export type Observation={price:number|null;change:number|null;relativeVolume:number|null;at:string|null;currency:string};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function alertValue(kind:string,q:Observation):number|null{return kind.startsWith('price_')?q.price:kind==='volume'?q.relativeVolume:q.change;}
export function isTriggered(kind:string,target:number,q:Observation){const value=alertValue(kind,q);if(value===null||!finite(value))return false;return kind==='price_below'?value<=target:kind==='daily_down'?value<=-target:value>=target;}
export async function alertQuote(symbol:string):Promise<Observation>{return cached('alert-quote:'+symbol,60000,async()=>{
 const empty:Observation={price:null,change:null,relativeVolume:null,at:null,currency:''};
 try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)});if(!r.ok)return empty;
 const c=(await r.json())?.chart?.result?.[0],m=c?.meta;if(!m||!finite(m.regularMarketTime))return empty;
 // Reject stale quotes beyond a long market weekend; never trigger on a missing price.
 if(Date.now()-m.regularMarketTime*1000>4*86400000||m.regularMarketTime*1000>Date.now()+60000)return empty;
 const zone=m.exchangeTimezoneName??'UTC',date=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(t*1000);
 const today=date(m.regularMarketTime),volumes=new Map<string,number>(),closes=new Map<string,number>();
 (c.timestamp??[]).forEach((t:number,i:number)=>{const day=date(t);if(day>=today)return;const v=c.indicators?.quote?.[0]?.volume?.[i],p=c.indicators?.quote?.[0]?.close?.[i];if(finite(v)&&v>=0)volumes.set(day,v);if(finite(p)&&p>0)closes.set(day,p);});
 const v=[...volumes.values()].slice(-20),average=v.length===20?v.reduce((a,b)=>a+b,0)/20:null,previous=[...closes.values()].at(-1);
 const price=finite(m.regularMarketPrice)&&m.regularMarketPrice>0?m.regularMarketPrice:null;
 return {price,change:price!==null&&previous?(price/previous-1)*100:null,relativeVolume:average&&finite(m.regularMarketVolume)?m.regularMarketVolume/average:null,at:new Date(m.regularMarketTime*1000).toISOString(),currency:m.currency??''};
 }catch{return empty;}
});}

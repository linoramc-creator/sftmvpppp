import {cached} from './panels.ts';
export type ExtendedQuote={session:'pre'|'post';price:number;date:string;at:string|null;change:number|null};
export type ExtendedHours={symbol:string;currency:string;quotes:ExtendedQuote[];fetchedAt:string};
const num=(v:any):number|null=>typeof(v?.raw??v)==='number'&&Number.isFinite(v?.raw??v)?v?.raw??v:null;
const etDate=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
export function normalizeExtended(symbol:string,price:any,daily:any,now=Date.now()):ExtendedHours{
 const quotes:ExtendedQuote[]=[];
 for(const [session,prefix] of [['pre','preMarket'],['post','postMarket']] as const){
  const value=num(price?.[prefix+'Price']),time=num(price?.[prefix+'Time']);
  if(value===null||value<=0||time===null||time*1000>now+60000||now-time*1000>5*86400000)continue;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time*1000),minutes=Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);
  if(session==='pre'&&(minutes<240||minutes>=570)||session==='post'&&(minutes<960||minutes>1200))continue;
  const delta=num(price?.[prefix+'ChangePercent']);quotes.push({session,price:value,date:etDate(time*1000),at:new Date(time*1000).toISOString(),change:delta!==null?delta*100:null});
 }
 if(daily?.symbol===symbol&&/^\d{4}-\d{2}-\d{2}$/.test(daily.from)&&Date.parse(daily.from)<=now&&now-Date.parse(daily.from)<6*86400000){
  for(const [session,field] of [['pre','preMarket'],['post','afterHours']] as const){const value=num(daily[field]);if(value===null||value<=0||quotes.some(q=>q.session===session&&q.date>=daily.from))continue;
   const old=quotes.findIndex(q=>q.session===session);if(old>=0)quotes.splice(old,1);
   const close=num(daily.close);quotes.push({session,price:value,date:daily.from,at:null,change:session==='post'&&close&&close>0?(value/close-1)*100:null});
  }
 }
 return {symbol,currency:typeof price?.currency==='string'?price.currency:daily?.symbol===symbol?'USD':'',quotes,fetchedAt:new Date(now).toISOString()};
}
async function get(url:string,headers:Record<string,string>={}){try{const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(7000)});return r.ok?await r.json():null;}catch{return null;}}
export async function extendedHours(symbol:string,key:string|undefined,summary:(s:string,m:string)=>Promise<any>,regularTime?:number,previousSession?:string):Promise<ExtendedHours>{return cached('extended-hours-v2:'+symbol,120000,async()=>{
 const [profile,chart]=await Promise.all([summary(symbol,'price'),regularTime?null:get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,{'User-Agent':'Mozilla/5.0'})]);
 const native=normalizeExtended(symbol,profile?.price,null);if(native.quotes.length===2)return native;
 const time=regularTime??chart?.chart?.result?.[0]?.meta?.regularMarketTime;
 const daily=key&&typeof time==='number'?await get(`https://api.massive.com/v1/open-close/${encodeURIComponent(symbol)}/${etDate(time*1000)}?adjusted=true`,{Authorization:`Bearer ${key}`}):null;
 const result=normalizeExtended(symbol,profile?.price,daily);
 if(!key||result.quotes.length===2)return result;
 const dates=(chart?.chart?.result?.[0]?.timestamp??[]).map((t:number)=>etDate(t*1000)).filter((d:string)=>typeof time==='number'&&d<etDate(time*1000));
 const previous=previousSession??dates.at(-1);
 if(!previous||!/^\d{4}-\d{2}-\d{2}$/.test(previous))return result;
 const prior=normalizeExtended(symbol,profile?.price,await get(`https://api.massive.com/v1/open-close/${encodeURIComponent(symbol)}/${previous}?adjusted=true`,{Authorization:`Bearer ${key}`}));
 for(const quote of prior.quotes)if(!result.quotes.some(q=>q.session===quote.session))result.quotes.push(quote);
 if(!result.currency)result.currency=prior.currency;return result;
});}

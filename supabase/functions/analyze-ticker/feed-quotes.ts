export type FeedSession='pre'|'regular'|'post'|'closed';
export type SessionQuote={symbol:string;label:string;price:number|null;change:number|null;date:string|null;currency:string;session:FeedSession;at:string|null;delaySeconds:number|null;priceKind:'quote'|'minute-close';reference:'previous-close'|'regular-close'|null};
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const etDate=(ms:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
export function feedSymbols(value:unknown):string[]|null{if(value===undefined||value==='')return [];if(typeof value!=='string'||value.length>100)return null;const items=value.split(',').map(s=>s.trim().toUpperCase());return items.length<=6&&items.every(s=>/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(s))?[...new Set(items)]:null;}
function phase(meta:any,time:number):FeedSession{for(const [key,name] of [['pre','pre'],['regular','regular'],['post','post']] as const){const p=meta?.currentTradingPeriod?.[key];if(positive(p?.start)&&positive(p?.end)&&time>=p.start*1000&&time<p.end*1000)return name;}return 'closed';}
export function normalizeFeedQuote(symbol:string,label:string,raw:any,intraday:any=null,now=Date.now()):SessionQuote{
 const daily=raw?.chart?.result?.[0],meta=daily?.meta??{},times=daily?.timestamp??[],closes=daily?.indicators?.quote?.[0]?.close??[];
 const regularAt=positive(meta.regularMarketTime)&&meta.regularMarketTime*1000<=now+60000?meta.regularMarketTime*1000:null;
 const regularPrice=regularAt!==null&&positive(meta.regularMarketPrice)?meta.regularMarketPrice:null;
 const date=regularAt===null?null:etDate(regularAt);
 const prior=times.flatMap((t:number,i:number)=>positive(t)&&positive(closes[i])?[{date:etDate(t*1000),value:closes[i]}]:[]).filter((p:any)=>p.date<(date??'')).at(-1)?.value??null;
 const result:SessionQuote={symbol,label,price:regularPrice,change:regularPrice!==null&&prior?(regularPrice/prior-1)*100:null,date,currency:typeof meta.currency==='string'?meta.currency:'',session:regularAt!==null&&phase(meta,now)==='regular'&&etDate(regularAt)===etDate(now)?'regular':'closed',at:regularAt===null?null:new Date(regularAt).toISOString(),delaySeconds:regularAt===null?null:Math.max(0,Math.floor((now-regularAt)/1000)),priceKind:'quote',reference:prior?'previous-close':null};
 const chart=intraday?.chart?.result?.[0],m=chart?.meta??{},active=phase(m,now),quote=chart?.indicators?.quote?.[0];
 if(m.dataGranularity!=='1m'||active==='closed'||!quote)return result;
 // Yahoo timestamps identify the START of a minute, including a partial last
 // bar. Select a completed bar whose END is at least one minute behind now.
 const bars=(chart.timestamp??[]).map((t:number,i:number)=>({start:t*1000,end:t*1000+60000,close:quote.close?.[i]})).filter((b:any)=>Number.isFinite(b.start)&&b.end<=now-60000&&positive(b.close)&&phase(m,b.start)===active).sort((a:any,b:any)=>a.start-b.start);
 const last=bars.at(-1);if(!last)return result;
 let reference:number|null=null,referenceKind:SessionQuote['reference']=null;
 if(active==='pre'&&regularAt!==null&&etDate(regularAt)<etDate(last.start)){reference=regularPrice;referenceKind='previous-close';}
 if(active==='regular'&&prior){reference=prior;referenceKind='previous-close';}
 if(active==='post'&&regularAt!==null&&etDate(regularAt)===etDate(last.start)){reference=regularPrice;referenceKind='regular-close';}
 return {...result,price:last.close,change:reference?(last.close/reference-1)*100:null,date:etDate(last.start),currency:typeof m.currency==='string'?m.currency:result.currency,session:active,at:new Date(last.end).toISOString(),delaySeconds:Math.max(0,Math.floor((now-last.end)/1000)),priceKind:'minute-close',reference:referenceKind};
}
async function chart(symbol:string,minute:boolean){try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=${minute?'1m':'1d'}${minute?'&includePrePost=true':''}`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error',signal:AbortSignal.timeout(8000)});return r.ok?await r.json():null;}catch{return null;}}
export async function feedSessionQuote(symbol:string,label:string,extended=false){const [daily,intraday]=await Promise.all([chart(symbol,false),extended?chart(symbol,true):null]);return normalizeFeedQuote(symbol,label,daily,intraday);}

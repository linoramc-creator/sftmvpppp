import {regularSessionEnd} from './market-session.ts';
import {instrumentInfo} from './asset-instrument.ts';
import {normalizeFeedSymbol,type FeedGroupKey} from './feed-preferences.ts';
import {marketJson} from './eodhd-market-fetch.ts';
import {ironReferenceQuote} from './iron-reference.ts';
import {spotMetal} from './spot-metals.ts';
import {spotMetalQuote} from './spot-metal-quotes.ts';
export type FeedSession='pre'|'regular'|'post'|'closed';
export type SessionQuote={symbol:string;label:string;displaySymbol?:string;contractLabel?:string;price:number|null;change:number|null;date:string|null;currency:string;unit?:string;session:FeedSession;at:string|null;delaySeconds:number|null;priceKind:'quote'|'minute-close'|'daily-close';reference:'previous-close'|'regular-close'|null;timezone?:string};
const commodityUnits:Record<string,string>={'GC=F':'USD/oz t','SI=F':'USD/oz t','CL=F':'USD/barril','BZ=F':'USD/barril','HG=F':'USD/libra','NG=F':'USD/MMBtu','ZW=F':'¢/bushel','ZC=F':'¢/bushel'};
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const localDate=(ms:number,timezone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
export function feedSymbols(value:unknown):string[]|null{if(value===undefined||value==='')return [];if(typeof value!=='string'||value.length>111)return null;const items=value.split(',').map(s=>s.trim().toUpperCase());return items.length<=7&&items.every(s=>/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(s))?[...new Set(items)]:null;}
function phase(meta:any,time:number,symbol=''):FeedSession{for(const [key,name] of [['pre','pre'],['regular','regular'],['post','post']] as const){const p=meta?.currentTradingPeriod?.[key];const end=key==='regular'?regularSessionEnd(meta,symbol):p?.end;if(positive(p?.start)&&positive(end)&&time>=p.start*1000&&time<end*1000)return name;}return 'closed';}
export function normalizeFeedQuote(symbol:string,label:string,raw:any,intraday:any=null,now=Date.now()):SessionQuote{
 const daily=raw?.chart?.result?.[0],meta=daily?.meta??{},times=daily?.timestamp??[],closes=daily?.indicators?.quote?.[0]?.close??[];
 let timezone=typeof meta.exchangeTimezoneName==='string'?meta.exchangeTimezoneName:'America/New_York';try{localDate(now,timezone);}catch{timezone='America/New_York';}
 const dateAt=(ms:number)=>localDate(ms,timezone);
 const regularAt=positive(meta.regularMarketTime)&&meta.regularMarketTime*1000<=now+60000?meta.regularMarketTime*1000:null;
 const regularPrice=regularAt!==null&&positive(meta.regularMarketPrice)?meta.regularMarketPrice:null;
 const date=regularAt===null?null:dateAt(regularAt),period=meta.currentTradingPeriod?.regular;
 const sameSession=regularAt!==null&&positive(period?.start)&&positive(period?.end)&&regularAt>=period.start*1000&&regularAt<=period.end*1000+60000;
 const prior=times.flatMap((t:number,i:number)=>positive(t)&&positive(closes[i])?[{time:t*1000,date:dateAt(t*1000),value:closes[i]}]:[]).filter((p:any)=>sameSession?p.time<period.start*1000:p.date<(date??'')).at(-1)?.value??null;
 const currency=typeof meta.currency==='string'?meta.currency:'';
 // Agricultural futures arrive in US cents; keep their raw magnitude and
 // display the contract unit instead of incorrectly labelling the price USD.
 const expectedCurrency=symbol==='ZW=F'||symbol==='ZC=F'?'USX':'USD';
 const unit=instrumentInfo(meta,symbol).priceUnit==='pts'?'pts':commodityUnits[symbol]&&currency===expectedCurrency?commodityUnits[symbol]:undefined;
 const result:SessionQuote={symbol,label:label===symbol?feedAssetLabel(symbol,meta):label,price:regularPrice,change:regularPrice!==null&&prior?(regularPrice/prior-1)*100:null,date,currency,...(unit?{unit}:{}),session:regularAt!==null&&phase(meta,now,symbol)==='regular'&&dateAt(regularAt)===dateAt(now)?'regular':'closed',at:regularAt===null?null:new Date(regularAt).toISOString(),delaySeconds:regularAt===null?null:Math.max(0,Math.floor((now-regularAt)/1000)),priceKind:'quote',reference:prior?'previous-close':null,timezone};
 const chart=intraday?.chart?.result?.[0],m=chart?.meta??{},active=phase(m,now,symbol),quote=chart?.indicators?.quote?.[0];
 if(m.dataGranularity!=='1m'||active==='closed'||!quote)return result;
 // Yahoo timestamps identify the START of a minute, including a partial last
 // bar. Select a completed bar whose END is at least one minute behind now.
 const bars=(chart.timestamp??[]).map((t:number,i:number)=>({start:t*1000,end:t*1000+60000,close:quote.close?.[i]})).filter((b:any)=>Number.isFinite(b.start)&&b.end<=now-60000&&positive(b.close)&&phase(m,b.start,symbol)===active).sort((a:any,b:any)=>a.start-b.start);
 const last=bars.at(-1);if(!last)return result;
 let reference:number|null=null,referenceKind:SessionQuote['reference']=null;
 if(active==='pre'&&regularAt!==null&&dateAt(regularAt)<dateAt(last.start)){reference=regularPrice;referenceKind='previous-close';}
 if(active==='regular'&&prior){reference=prior;referenceKind='previous-close';}
 if(active==='post'&&regularAt!==null&&dateAt(regularAt)===dateAt(last.start)){reference=regularPrice;referenceKind='regular-close';}
 return {...result,price:last.close,change:reference?(last.close/reference-1)*100:null,date:dateAt(last.start),currency:typeof m.currency==='string'?m.currency:result.currency,session:active,at:new Date(last.end).toISOString(),delaySeconds:Math.max(0,Math.floor((now-last.end)/1000)),priceKind:'minute-close',reference:referenceKind};
}
async function chart(symbol:string,minute:boolean){return marketJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=${minute?'1m':'1d'}${minute?'&includePrePost=true':''}`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:8000,acceptPrimary:raw=>{const meta=raw?.chart?.result?.[0]?.meta;return minute||positive(meta?.regularMarketTime)&&positive(meta?.regularMarketPrice);}});}
export async function feedSessionQuote(symbol:string,label:string,extended=false){if(spotMetal(symbol))return (await spotMetalQuote(symbol,label))!;const [daily,intraday]=await Promise.all([chart(symbol,false),extended?chart(symbol,true):null]);return normalizeFeedQuote(symbol,label,daily,intraday);}
function feedAssetLabel(symbol:string,meta:any):string{
 if(symbol.endsWith('=X')){const pair=symbol.slice(0,-2);return pair.length===6?`${pair.slice(0,3)}/${pair.slice(3)}`:`USD/${pair}`;}
 const name=typeof meta?.shortName==='string'?meta.shortName:typeof meta?.longName==='string'?meta.longName:symbol;
 return name.slice(0,100);
}
const verifiedAssets=new Map<string,{at:number;label:string}>();
const verifyingAssets=new Map<string,Promise<{symbol:string;label:string}|null>>();
// A metadata check is required when an asset is added. Persisted choices are
// subsequently priced from the existing quote cache, rather than researched again.
export async function validateFeedAsset(group:FeedGroupKey,input:string,deps:{read?:(symbol:string)=>Promise<any>;iron?:typeof ironReferenceQuote;spot?:typeof spotMetalQuote;now?:number}={}):Promise<{symbol:string;label:string}|null>{
 const symbol=normalizeFeedSymbol(group,input);if(!symbol)return null;
 const cacheable=!deps.read&&!deps.iron&&!deps.spot&&deps.now===undefined;
 const key=`${group}:${symbol}`,hit=verifiedAssets.get(key);
 if(cacheable&&hit&&Date.now()-hit.at<300000)return {symbol,label:hit.label};
 if(cacheable&&verifyingAssets.has(key))return verifyingAssets.get(key)!;
 const operation=(async()=>{
  if(spotMetal(symbol)&&!deps.read){
   const value=await (deps.spot??spotMetalQuote)(symbol),now=deps.now??Date.now(),stamp=value?.date?Date.parse(value.date+'T00:00Z'):NaN;
   if(value?.symbol!==symbol||value.currency!=='USD'||!positive(value.price)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value.date||stamp>=Date.parse(new Date(now).toISOString().slice(0,10))||now-stamp>10*86400000)return null;
   const label=spotMetal(symbol)!.name;if(cacheable)verifiedAssets.set(key,{at:Date.now(),label});return {symbol,label};
  }
  if(group==='commodities'&&symbol==='SGX-IODEX'){
   const now=deps.now??Date.now(),value=await (deps.iron??ironReferenceQuote)(now),date=typeof value.date==='string'?Date.parse(value.date+'T00:00:00Z'):NaN;
   if(!positive(value.price)||!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==value.date||date>now||now-date>10*86400000)return null;
   if(cacheable)verifiedAssets.set(key,{at:Date.now(),label:value.label});return{symbol,label:value.label};
  }
  const raw=await (deps.read??((value:string)=>chart(value,false)))(symbol),data=raw?.chart?.result?.[0],meta=data?.meta??{};
  const type=String(meta.instrumentType??'').toUpperCase();
  const allowed=group==='indices'?['INDEX','INDICES','FUTURE']:group==='etfs'?['ETF']:group==='commodities'?(spotMetal(symbol)?['CURRENCY']:['FUTURE']):['CURRENCY','CRYPTOCURRENCY'];
  if(!allowed.includes(type)||!positive(meta.regularMarketPrice)&&!(data?.indicators?.quote?.[0]?.close??[]).some(positive))return null;
  if(spotMetal(symbol)&&meta.currency!=='USD')return null;
  if(typeof meta.symbol==='string'&&normalizeFeedSymbol(group,meta.symbol)!==symbol)return null;
  const label=feedAssetLabel(symbol,meta);if(cacheable){if(verifiedAssets.size>=256)verifiedAssets.delete(verifiedAssets.keys().next().value!);verifiedAssets.set(key,{at:Date.now(),label});}return {symbol,label};
 })().catch(()=>null).finally(()=>{if(cacheable)verifyingAssets.delete(key);});if(cacheable)verifyingAssets.set(key,operation);return operation;
}

import {assetRisk,type RiskData} from './asset-risk.ts';
import {cached} from './panels.ts';
import {prices,type PriceSeries} from './market-analytics.ts';
const SECTORS:Record<string,string>={'communication services':'XLC','consumer cyclical':'XLY','consumer defensive':'XLP','energy':'XLE','financial services':'XLF','healthcare':'XLV','industrials':'XLI','technology':'XLK','basic materials':'XLB','real estate':'XLRE','utilities':'XLU'};
export type AssetEvent={kind:'earnings'|'ex_dividend'|'payment';date:string;session?:string;amount?:number;currency?:string};
export type AssetContext={symbol:string;sector:string|null;benchmark:string|null;series:PriceSeries[];missing:string[];events:AssetEvent[];risk:RiskData;fetchedAt:string};
async function get(url:string){try{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});return r.ok?await r.json():null;}catch{return null;}}
export function upcomingEvents(symbol:string,earnings:any[],dividends:any[],calendar:any,now=new Date()):AssetEvent[]{
 const start=now.toISOString().slice(0,10),end=new Date(now.getTime()+180*86400000).toISOString().slice(0,10),out=new Map<string,AssetEvent>();
 const add=(event:AssetEvent)=>{if(/^\d{4}-\d{2}-\d{2}$/.test(event.date)&&event.date>=start&&event.date<=end)out.set(event.kind+event.date,event);};
 for(const r of earnings)if(r.symbol===symbol)add({kind:'earnings',date:String(r.date??'').slice(0,10),session:({bmo:'Antes de apertura',amc:'Después del cierre',dmh:'Durante la sesión'} as Record<string,string>)[r.hour??r.time]??'Hora por confirmar'});
 if(![...out.values()].some(e=>e.kind==='earnings'))for(const value of calendar?.earnings?.earningsDate??[]){const t=typeof value==='number'?value:value?.raw;if(Number.isFinite(t))add({kind:'earnings',date:new Date(t*1000).toISOString().slice(0,10),session:'Fecha estimada'});}
 for(const r of dividends)if(r.symbol===symbol){const amount=typeof r.dividend==='number'&&r.dividend>0?r.dividend:undefined;for(const [kind,field] of [['ex_dividend','date'],['payment','paymentDate']] as const)add({kind,date:String(r[field]??'').slice(0,10),amount,currency:typeof r.currency==='string'?r.currency:undefined});}
 for(const [field,kind] of [['exDividendDate','ex_dividend'],['dividendDate','payment']] as const){const value=calendar?.[field],t=typeof value==='number'?value:value?.raw;if(![...out.values()].some(e=>e.kind===kind)&&Number.isFinite(t))add({kind,date:new Date(t*1000).toISOString().slice(0,10)});}
 return [...out.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,12);
}
export async function assetContext(symbol:string,benchmark:string|undefined,env:{FMP_KEY:string;FINNHUB_KEY:string},summary:(s:string,m:string)=>Promise<any>):Promise<AssetContext>{
 return cached(`asset-context-risk:${symbol}:${benchmark??'auto'}`,300000,async()=>{
 const profile=await cached('asset-profile:'+symbol,86400000,()=>summary(symbol,'quoteType,assetProfile,fundProfile'));
 const sector=profile?.assetProfile?.sector??null,reference=benchmark===undefined?SECTORS[String(sector??'').toLowerCase()]??null:benchmark||null;
 const symbols=[...new Set([symbol,'SPY',...(reference?[reference]:[])])];const [data,risk]=await Promise.all([Promise.all(symbols.map(s=>prices(s,'1y'))),assetRisk(symbol)]);
 return {symbol,sector,benchmark:reference,series:data.filter((p):p is PriceSeries=>!!p),missing:symbols.filter((_,i)=>!data[i]),events:[],risk,fetchedAt:new Date().toISOString()};
 });
}

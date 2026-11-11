import {eodhdForYahooUrl} from './eodhd-market.ts';
import {marketJson} from './eodhd-market-fetch.ts';
import {portfolioMarketDate,portfolioTradingDay,portfolioRegularEnd,portfolioSessionAt,type PortfolioState} from './portfolio-model.ts';
import {portfolioSymbol} from './portfolio-request.ts';

type Point={date:string;value:number};
export type PortfolioHistory={symbol:string;points:Point[];adjustment:'total-return'|'splits'};
export type PortfolioAssetRisk={symbol:string;status:'ready'|'insufficient'|'unavailable';sharpe:number|null;annualizedVolatilityPct:number|null;rolling:{date:string;value:number}[];observations:number;from:string|null;to:string|null;adjustment:PortfolioHistory['adjustment']|null};
export type PortfolioAnalytics={asOf:string;currency:'USD';portfolio:{sharpe:number|null;annualizedVolatilityPct:number|null;observations:number;from:string|null;to:string|null;riskFreeRatePct:0;status:'ready'|'insufficient'};assets:PortfolioAssetRisk[];notes:string[]};
export type PortfolioHistoryDependencies={primary?:(url:string)=>Promise<any>;massive?:(symbol:string,from:string,to:string)=>Promise<any>;fallback?:(url:string)=>Promise<any>};
export type PortfolioAnalyticsDependencies={history?:(symbol:string,now:number)=>Promise<PortfolioHistory|null>;timeoutMs?:number};
const DAY=86400000,ROOT_252=Math.sqrt(252),WINDOW=20;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const positive=(value:unknown):value is number=>finite(value)&&value>0;
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const nextDay=(value:string)=>new Date(Date.parse(value)+DAY).toISOString().slice(0,10);
const average=(values:number[])=>values.reduce((sum,v)=>sum+v,0)/values.length;
function deviation(values:number[]){if(values.length<2)return null;const mean=average(values),value=Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(values.length-1));return Number.isFinite(value)?value:null;}
function sharpe(values:number[]){const sd=deviation(values);return sd!==null&&sd>1e-12?average(values)/sd*ROOT_252:null;}
function consecutive(before:string,after:string){let d=nextDay(before);for(let i=0;i<14;i++,d=nextDay(d))if(portfolioTradingDay(d))return d===after;return false;}
function completeDate(value:string,now:number){const today=portfolioMarketDate(now);return date(value)&&portfolioTradingDay(value)&&(value<today||value===today&&portfolioSessionAt(now)==='closed'&&now>portfolioRegularEnd(value));}

/** Only explicit adjusted closing observations are accepted. An appended live
 * quote, an unfinished day, missing adjustments and mismatched identities are
 * never substituted for a closing price. Each history has one adjustment basis. */
export function normalizePortfolioHistory(symbol:string,raw:any,now:number):PortfolioHistory|null{
 const chart=raw?.chart?.result?.[0],meta=chart?.meta;
 if(!portfolioSymbol(symbol)||meta?.symbol!==symbol||meta.currency!=='USD'||!['EQUITY','ETF'].includes(meta.instrumentType)||meta.exchangeTimezoneName!=='America/New_York'||meta.dataGranularity!=='1d')return null;
 const times=chart.timestamp,adjusted=chart.indicators?.adjclose?.[0]?.adjclose,closes=chart.indicators?.quote?.[0]?.close;
 if(!Array.isArray(times)||!Array.isArray(adjusted)||!Array.isArray(closes))return null;
 const points=new Map<string,number>();
 for(let i=0;i<times.length;i++){
  const stamp=times[i]*1000;if(!positive(stamp)||stamp>now)continue;const d=portfolioMarketDate(stamp);
  if(!completeDate(d,now))continue;
  if(!positive(closes[i])||!positive(adjusted[i]))return null;
  if(points.has(d))continue;
  points.set(d,adjusted[i]);
 }
 return points.size?{symbol,points:[...points].map(([date,value])=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date)),adjustment:'total-return'}:null;
}
export function normalizeMassivePortfolioHistory(symbol:string,raw:any,now:number):PortfolioHistory|null{
 if(!portfolioSymbol(symbol)||raw?.ticker!==symbol||raw.adjusted!==true||!['OK','DELAYED'].includes(raw.status)||!Array.isArray(raw.results))return null;
 const points=new Map<string,number>();
 for(const row of raw.results){if(!positive(row?.t)||row.t>now||![row.o,row.h,row.l,row.c].every(positive)||row.l>Math.min(row.o,row.c)||row.h<Math.max(row.o,row.c)||row.l>row.h)continue;const d=portfolioMarketDate(row.t);if(completeDate(d,now)&&!points.has(d))points.set(d,row.c);}
 return points.size?{symbol,points:[...points].map(([date,value])=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date)),adjustment:'splits'}:null;
}
async function massiveHistory(symbol:string,from:string,to:string){
 const key=(globalThis as any).Deno?.env?.get('MASSIVE_API_KEY');if(!key)return null;
 try{const r=await fetch(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=500`,{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok){await r.body?.cancel();return null;}return await r.json();}catch{return null;}
}
function historyCoverage(history:PortfolioHistory|null,now:number){
 if(!history)return {fresh:false,count:0};let count=0,prior:string|null=null;
 for(const row of history.points){count=prior!==null&&consecutive(prior,row.date)?count+1:1;prior=row.date;}
 return {fresh:!!prior&&Date.parse(prior)>=now-10*DAY,count};
}
const enoughHistory=(history:PortfolioHistory|null,now:number)=>{const q=historyCoverage(history,now);return q.fresh&&q.count>=WINDOW+1;};
function betterHistory(before:PortfolioHistory|null,after:PortfolioHistory|null,now:number){const a=historyCoverage(before,now),b=historyCoverage(after,now);return !before||b.fresh&&!a.fresh||b.fresh===a.fresh&&b.count>a.count?after:before;}
/** Shared public-price cache only: no portfolio balances, user IDs or snapshots.
 * Concurrent requests share work; failures cool down for thirty seconds. */
export function createPortfolioHistoryLoader(deps:PortfolioHistoryDependencies={}){
 const cache=new Map<string,{at:number;value:PortfolioHistory|null}>(),pending=new Map<string,Promise<PortfolioHistory|null>>();
 return async(symbol:string,now=Date.now()):Promise<PortfolioHistory|null>=>{
  if(!portfolioSymbol(symbol))return null;
  const key=symbol+':'+portfolioMarketDate(now),hit=cache.get(key);
  if(hit&&now>=hit.at&&now-hit.at<(hit.value?300000:30000))return hit.value;
  if(pending.has(key))return pending.get(key)!;
  const task=(async()=>{
   const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,from=new Date(now-270*DAY).toISOString().slice(0,10),to=portfolioMarketDate(now);
   const primary=await (deps.primary??eodhdForYahooUrl)(url).catch(()=>null);
   let value=normalizePortfolioHistory(symbol,primary,now);
   if(!enoughHistory(value,now))value=betterHistory(value,normalizeMassivePortfolioHistory(symbol,await (deps.massive??massiveHistory)(symbol,from,to).catch(()=>null),now),now);
   if(!enoughHistory(value,now)){const fallback=await (deps.fallback??(value=>marketJson(value,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{primary:async()=>null,timeoutMs:6000})))(url).catch(()=>null);value=betterHistory(value,normalizePortfolioHistory(symbol,fallback,now),now);}
   if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{at:now,value});return value;
  })().catch(()=>{cache.set(key,{at:now,value:null});return null;}).finally(()=>pending.delete(key));
  pending.set(key,task);return task;
 };
}
export const loadPortfolioHistory=createPortfolioHistoryLoader();

function portfolioRisk(state:PortfolioState,now:number):PortfolioAnalytics['portfolio']{
 const daily=new Map<string,{at:number;value:number|null}>();
 for(const row of state.snapshots){
  if(!finite(row.at)||row.at>now)continue;const d=portfolioMarketDate(row.at);
  if(!completeDate(d,now)||row.at<portfolioRegularEnd(d))continue;
  const verified=finite(row.valuationAt)&&row.valuationAt<=row.at&&portfolioMarketDate(row.valuationAt)===d&&row.valuationAt>=portfolioRegularEnd(d);
  const prior=daily.get(d);if(!prior||row.at>prior.at)daily.set(d,{at:row.at,value:verified&&positive(row.returnFactor)&&positive(row.equity)?row.returnFactor:null});
 }
 let chain:Point[]=[];
 for(const [d,row]of [...daily].sort(([a],[b])=>a.localeCompare(b))){if(row.value===null){chain=[];continue;}if(chain.length&&!consecutive(chain.at(-1)!.date,d))chain=[];chain.push({date:d,value:row.value});}
 chain=chain.slice(-253);const returns=chain.slice(1).map((row,i)=>row.value/chain[i].value-1),ready=returns.length>=WINDOW,sd=ready?deviation(returns):null;
 return {sharpe:ready?sharpe(returns):null,annualizedVolatilityPct:sd===null?null:sd*ROOT_252*100,observations:returns.length,from:chain[0]?.date??null,to:chain.at(-1)?.date??null,riskFreeRatePct:0,status:ready?'ready':'insufficient'};
}
export function portfolioAssetRisk(symbol:string,history:PortfolioHistory|null,now:number):PortfolioAssetRisk{
 const empty:PortfolioAssetRisk={symbol,status:history&&history.symbol===symbol?'insufficient':'unavailable',sharpe:null,annualizedVolatilityPct:null,rolling:[],observations:0,from:null,to:null,adjustment:history?.adjustment??null};
 if(!history||history.symbol!==symbol)return empty;
 const since=new Date(now);since.setUTCMonth(since.getUTCMonth()-6);const cutoff=since.toISOString().slice(0,10),rolling:PortfolioAssetRisk['rolling']=[];
 let chain:Point[]=[];
 for(const row of [...history.points].sort((a,b)=>a.date.localeCompare(b.date))){
  if(!positive(row.value)||!completeDate(row.date,now)){chain=[];continue;}
  if(chain.length&&!consecutive(chain.at(-1)!.date,row.date))chain=[];chain.push(row);
  if(chain.length>=WINDOW+1&&row.date>=cutoff){const values=chain.slice(-(WINDOW+1)),logs=values.slice(1).map((p,i)=>Math.log(p.value/values[i].value)),sd=deviation(logs);if(sd!==null)rolling.push({date:row.date,value:sd*ROOT_252*100});}
 }
 const window=chain.slice(-(WINDOW+1)),returns=window.slice(1).map((p,i)=>p.value/window[i].value-1),logs=window.slice(1).map((p,i)=>Math.log(p.value/window[i].value)),sd=returns.length>=WINDOW?deviation(logs):null;
 return {...empty,status:returns.length>=WINDOW?'ready':'insufficient',sharpe:returns.length>=WINDOW?sharpe(returns):null,annualizedVolatilityPct:sd===null?null:sd*ROOT_252*100,rolling,observations:returns.length,from:window[0]?.date??null,to:window.at(-1)?.date??null};
}
export async function buildPortfolioAnalytics(state:PortfolioState,now=Date.now(),deps:PortfolioAnalyticsDependencies={}):Promise<PortfolioAnalytics>{
 const notes=['Sharpe con tipo libre de riesgo supuesto del 0 % anual; no se emplea una rentabilidad histórica anterior a la creación de la cartera.','Cartera: retornos simples de las últimas valoraciones observadas después del cierre regular de sesiones completas y consecutivas; mínimo 20 retornos diarios. No se interpolan sesiones ausentes.','Activos: volatilidad de 20 retornos logarítmicos diarios, desviación muestral y anualización de 252 sesiones; Sharpe sobre retornos simples de la misma ventana.'];
 const portfolio=portfolioRisk(state,now),symbols=[...new Set(state.positions.filter(p=>p.quantity!==0&&portfolioSymbol(p.symbol)).map(p=>p.symbol))].slice(0,20),assets:PortfolioAssetRisk[]=new Array(symbols.length);
 const deadline=performance.now()+Math.max(1,Math.min(30000,deps.timeoutMs??25000));let timedOut=false,cursor=0;
 await Promise.all(Array.from({length:Math.min(4,symbols.length)},async()=>{while(cursor<symbols.length){
  const i=cursor++,symbol=symbols[i],identity=state.marks?.find(q=>q.symbol===symbol&&q.currency==='USD'&&['stock','etf'].includes(q.kind));
  if(!identity){assets[i]=portfolioAssetRisk(symbol,null,now);notes.push(`${symbol}: falta una identidad de mercado verificada en el historial de la cartera.`);continue;}
  const remaining=deadline-performance.now();let history:PortfolioHistory|null=null;
  if(!timedOut&&remaining>0){let timer:ReturnType<typeof setTimeout>|undefined;try{history=await Promise.race([(deps.history??loadPortfolioHistory)(symbol,now).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve(null);},remaining);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}else timedOut=true;
  assets[i]=portfolioAssetRisk(symbol,history,now);if(!history)notes.push(`${symbol}: no hay una serie diaria ajustada verificable disponible.`);
 }}));
 if(timedOut)notes.push('Algunas series no han respondido dentro del plazo de consulta; se conservan las métricas disponibles y se puede reintentar.');
 if(portfolio.status==='insufficient')notes.push('La cartera aún no reúne 21 valoraciones de cierres consecutivos para calcular 20 retornos diarios.');
 if(state.snapshots.some(row=>!finite(row.valuationAt)))notes.push('Las valoraciones anteriores sin fecha de mercado verificable no se utilizan para calcular el riesgo diario de la cartera.');
 if(assets.some(a=>a.adjustment==='splits'))notes.push('Las series identificadas como ajuste por desdoblamientos no incorporan dividendos; no se mezclan con otra fuente dentro de la misma historia.');
 if(assets.some(a=>a.adjustment==='total-return'))notes.push('Las series de cierre ajustado incorporan ajustes corporativos y de distribuciones publicados; no se combinan con series ajustadas solo por desdoblamientos.');
 return {asOf:new Date(now).toISOString(),currency:'USD',portfolio,assets,notes};
}

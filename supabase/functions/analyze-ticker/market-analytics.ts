import { cached } from './panels.ts';
type Row = Record<string, any>;
export type PriceSeries = {symbol:string; currency:string; dates:string[]; closes:number[]; volumes:(number|null)[]; raw:number[]};
const mean=(xs:number[])=>xs.reduce((s,x)=>s+x,0)/xs.length;
export function stdev(xs:number[]):number|null { if(xs.length<2)return null;const m=mean(xs);return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1)); }
export function pearson(x:number[],y:number[]):number|null {if(x.length<3||x.length!==y.length)return null;const a=mean(x),b=mean(y);const dx=x.reduce((s,v)=>s+(v-a)**2,0),dy=y.reduce((s,v)=>s+(v-b)**2,0);return dx>0&&dy>0?Math.max(-1,Math.min(1,x.reduce((s,v,i)=>s+(v-a)*(y[i]-b),0)/Math.sqrt(dx*dy))):null;}
export function risk(prices:number[]) {const returns=prices.slice(1).map((v,i)=>v/prices[i]-1);let peak=prices[0],maxDrawdown=0;const drawdown=prices.map(v=>{peak=Math.max(peak,v);const dd=(v/peak-1)*100;maxDrawdown=Math.min(maxDrawdown,dd);return dd;});const sd=stdev(returns);return {returns,drawdown,maxDrawdown:prices.length>1?maxDrawdown:null,volatility:returns.length>=20&&sd!==null?sd*Math.sqrt(252)*100:null,totalReturn:prices.length>1?(prices.at(-1)!/prices[0]-1)*100:null};}
async function get(url:string):Promise<any>{try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});return r.ok?await r.json():null;}catch{return null;}}
export async function prices(symbol:string,range:string):Promise<PriceSeries|null>{return cached(`analytics-v2:${symbol}:${range}`,300000,async()=>{
  const raw=await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`);const chart=raw?.chart?.result?.[0];if(!chart)return null;
  const close=chart.indicators?.quote?.[0]?.close??[],adj=chart.indicators?.adjclose?.[0]?.adjclose;
  // Never forward-fill missing trading sessions or mix adjusted and raw prices.
  if(!Array.isArray(adj))return null;
  const rows=(chart.timestamp??[]).flatMap((t:number,i:number)=>Number.isFinite(adj[i])&&adj[i]>0&&Number.isFinite(close[i])?[{date:new Date(t*1000).toISOString().slice(0,10),price:adj[i],raw:close[i],volume:chart.indicators.quote[0].volume?.[i]??null}]:[]);
  return rows.length>1?{symbol,currency:chart.meta?.currency??'',dates:rows.map((r:Row)=>r.date),closes:rows.map((r:Row)=>r.price),raw:rows.map((r:Row)=>r.raw),volumes:rows.map((r:Row)=>r.volume)}:null;
});}
async function institutions(symbol:string,key:string){if(!key)return [];return cached(`comparison-institutions:${symbol}`,86400000,async()=>{
  // Two completed quarters with at least 60 days for filing availability.
  const cutoff=new Date(Date.now()-60*86400000);const q=Math.floor(cutoff.getUTCMonth()/3);const base=cutoff.getUTCFullYear()*4+q-1;
  return (await Promise.all([base,base-1].map(async period=>{
    const year=Math.floor(period/4),quarter=period%4+1;
    const raw=await get(`https://financialmodelingprep.com/stable/institutional-ownership/symbol-positions-summary?symbol=${encodeURIComponent(symbol)}&year=${year}&quarter=${quarter}&apikey=${encodeURIComponent(key)}`);
    const row=Array.isArray(raw)?raw.find((r:Row)=>r.symbol===symbol&&Number(r.year)===year&&Number(r.quarter)===quarter):null;
    if(!row)return null;
    const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
    return {period:`${year} T${quarter}`,shares:number(row.numberOfShares),sharesChange:number(row.numberOfSharesChange),investors:number(row.investorsHolding),value:number(row.totalInvested)};
  }))).filter(Boolean);
});}
export async function comparison(symbols:string[],key:string){const assets=await Promise.all(symbols.map(async symbol=>{
  const [p,holdings]=await Promise.all([prices(symbol,'6mo'),institutions(symbol,key)]);if(!p)return {symbol,available:false,institutions:holdings};
  const r=risk(p.closes),last=p.closes.length-1,volume=p.volumes[last],previous=p.volumes.slice(-21,-1).filter((v):v is number=>v!==null),average=previous.length?mean(previous):null;
  const monthly=new Map<string,number>();p.dates.forEach((date,i)=>{if(p.volumes[i]!==null)monthly.set(date.slice(0,7),(monthly.get(date.slice(0,7))??0)+p.volumes[i]!*p.raw[i]);});
  return {symbol,available:true,currency:p.currency,lastTradeDate:p.dates[last],price:p.raw[last],change1d:(p.closes[last]/p.closes[last-1]-1)*100,change1m:last>=21?(p.closes[last]/p.closes[last-21]-1)*100:null,change3m:last>=63?(p.closes[last]/p.closes[last-63]-1)*100:null,volume,dollarVolume:volume!==null?volume*p.raw[last]:null,avgVolume20:average,volumeVsAverage:average&&volume!==null?volume/average:null,volatility:r.volatility,maxDrawdown:r.maxDrawdown,totalReturn:r.totalReturn,netFundFlows:null,institutions:holdings,monthlyActivity:[...monthly].slice(-3).map(([month,value])=>({month,value})),dates:p.dates.map(d=>Date.parse(d)/1000),closes:p.closes};
}));return {assets,flowNote:'Las posiciones institucionales son declaraciones trimestrales con retraso, no entradas de dinero mensuales. El volumen negociado no equivale a flujos netos. Si no hay cifras autorizadas, se muestra sin datos.',fetchedAt:new Date().toISOString()};}
export async function correlations(requested:string[],range:string){const selected=({'1m':'1mo','3m':'3mo','6m':'6mo','1y':'1y'} as Record<string,string>)[range]??'3mo';
  const symbols=[...new Set([...requested,'SPY','URTH'])];const all=await Promise.all(symbols.map(s=>prices(s,selected)));const series=all.filter((p):p is PriceSeries=>!!p);const missing=symbols.filter(s=>!series.some(p=>p.symbol===s));
  const maps=series.map(p=>new Map(p.dates.map((d,i)=>[d,p.closes[i]])));const dates=[...(maps[0]?.keys()??[])].filter(d=>maps.every(m=>m.has(d))).sort();
  const risks=maps.map(m=>risk(dates.map(d=>m.get(d)!)));const spy=series.findIndex(p=>p.symbol==='SPY'),world=series.findIndex(p=>p.symbol==='URTH');
  const metrics=series.map((p,i)=>{const r=risks[i];const market=spy>=0?risks[spy].returns:[];const sd=stdev(market),corr=pearson(r.returns,market),assetSd=stdev(r.returns);return {symbol:p.symbol,volatility:r.volatility,maxDrawdown:r.maxDrawdown,totalReturn:r.totalReturn,correlationSP500:spy>=0?pearson(r.returns,risks[spy].returns):null,correlationWorld:world>=0?pearson(r.returns,risks[world].returns):null,betaSP500:corr!==null&&sd&&assetSd!==null?corr*assetSd/sd:null,trackingErrorSP500:market.length>=20?stdev(r.returns.map((v,j)=>v-market[j]))!*Math.sqrt(252)*100:null};});
  const chart=dates.map((date,j)=>Object.fromEntries([['date',date],...series.map((p,i)=>[p.symbol,(maps[i].get(date)!/maps[i].get(dates[0])!-1)*100])]));
  const drawdowns=dates.map((date,j)=>Object.fromEntries([['date',date],...series.map((p,i)=>[p.symbol,risks[i].drawdown[j]])]));
  const rolling=dates.slice(20).map((date,index)=>{const end=index+20;return Object.fromEntries([['date',date],...series.map((p,i)=>[p.symbol,spy<0?null:pearson(risks[i].returns.slice(end-20,end),risks[spy].returns.slice(end-20,end))])]);});
  return {symbols:series.map(p=>p.symbol),missing,correlation:risks.map(a=>risks.map(b=>pearson(a.returns,b.returns))),observations:Math.max(0,dates.length-1),chart,drawdowns,rolling,metrics,range,benchmarks:{SPY:'S&P 500 · SPY',URTH:'MSCI World · URTH'},fetchedAt:new Date().toISOString()};
}

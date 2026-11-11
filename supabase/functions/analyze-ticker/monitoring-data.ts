import {eodhdFundamentalRaw,normalizeEodhdSummary} from './eodhd-fundamentals.ts';
import {marketJson} from './eodhd-market-fetch.ts';
import {normalizeRegularQuote} from './regular-quote.ts';
import {eodhdNews} from './eodhd-news.ts';
import {massiveNews} from './massive-news.ts';
import {tickerPublisherNews} from './news-sources.ts';
import {companyNewsPattern} from './news-topics.ts';
import {loadEarningsPreview} from './earnings-preview.ts';
import {eodhdGet,eodhdSymbol} from './eodhd-client.ts';
import {summarizeNews} from './news-summary-ai.ts';
import type {Article} from './panels.ts';
import type {MonitorSnapshot,MonitorMetric,MonitorField,MonitorNews,MonitorCalendarEvent} from './monitoring-types.ts';

type Row=Record<string,any>;
export type MonitorDataDependencies={now?:()=>number;fundamentals?:(symbol:string)=>Promise<Row|null>;summary?:(symbol:string)=>Promise<Row|null>;chart?:(symbol:string)=>Promise<any>;news?:(symbol:string)=>Promise<Article[]>;calendar?:(symbol:string,raw:Row|null)=>Promise<Awaited<ReturnType<typeof loadEarningsPreview>>>};
const number=(v:any):number|null=>v&&typeof v==='object'?number(v.raw):typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))?Number(v):null;
const clean=(v:unknown,n=400)=>typeof v==='string'?v.replace(/<[^>]*>|[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;
const stamp=(v:any,now:number):string|null=>{const raw=v&&typeof v==='object'?v.raw:v,t=typeof raw==='number'?raw*1000:typeof raw==='string'?Date.parse(raw):NaN;return Number.isFinite(t)&&t>0&&t<=now+60000?new Date(t).toISOString():null;};
const currency=(v:unknown)=>typeof v==='string'&&/^[A-Z]{3}$/.test(v)?v:null;
const daysUntil=(date:string,now:number)=>Math.max(0,Math.round((Date.parse(date)-Date.parse(new Date(now).toISOString().slice(0,10)))/86400000));
export function monitorSourceUrl(value:unknown):string|null{
 if(typeof value!=='string'||value.length>2000)return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname.includes('.')||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)|:/.test(u.hostname)||/supabase\.(?:co|com)$/.test(u.hostname))return null;
  let decoded=u.href;for(let i=0;i<3;i++){const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}if(/(?:api[_-]?(?:key|token)|access[_-]?token|authorization|password|secret|bearer|[?&]token=)/i.test(decoded))return null;
  u.hash='';for(const k of [...u.searchParams.keys()])if(/^(?:utm_|guccounter|source$|ref$)/i.test(k))u.searchParams.delete(k);return u.href;
 }catch{return null;}
}
const safe=async<T>(p:Promise<T>):Promise<T|null>=>{try{return await p;}catch{return null;}};
async function monitorCalendar(symbol:string,raw:Row|null,env:Row,now:number){
 let primary:any=null,fmp:Row[]=[],finnhub:Row[]=[];
 const get=async(url:string)=>{try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(7000)});if(!r.ok){await r.body?.cancel();return null;}return r.json();}catch{return null;}};
 const result=await loadEarningsPreview(symbol,undefined,env,{now,fundamentals:async()=>raw,
  calendar:async(s,from,to)=>{primary=await eodhdGet('calendar/earnings',{symbols:eodhdSymbol(s)??undefined,from,to},{ttlMs:3600000,cost:1,timeoutMs:7000});return primary;},
  fallback:async(s,from,to)=>{const [a,b]=await Promise.all([env.FMP_KEY?get('https://financialmodelingprep.com/stable/earnings-calendar?from='+from+'&to='+to+'&apikey='+encodeURIComponent(env.FMP_KEY)):null,env.FINNHUB_KEY?get('https://finnhub.io/api/v1/calendar/earnings?symbol='+encodeURIComponent(s)+'&from='+from+'&to='+to+'&token='+encodeURIComponent(env.FINNHUB_KEY)):null]);fmp=Array.isArray(a)?a:[];finnhub=Array.isArray(b?.earningsCalendar)?b.earningsCalendar:[];return [...fmp,...finnhub];}});
 const date=result.next.date,source=(primary?.earnings??[]).some((r:Row)=>r.code===eodhdSymbol(symbol)&&r.report_date===date)||Object.values(raw?.Earnings?.History??{}).some((r:any)=>r.reportDate===date)?'EODHD':fmp.some(r=>r.symbol===symbol&&r.date?.slice(0,10)===date)?'Financial Modeling Prep':finnhub.some(r=>r.symbol===symbol&&r.date?.slice(0,10)===date)?'Finnhub':null;
 return {...result,_monitorSource:source,_monitorUrl:source==='EODHD'?'https://eodhd.com/financial-summary/'+encodeURIComponent(symbol):source==='Financial Modeling Prep'?'https://financialmodelingprep.com/financial-calendar':'https://finnhub.io/calendar/earnings'};
}
let yahooAuth:{cookie:string;crumb:string;expires:number}|null=null;
let authPending:Promise<{cookie:string;crumb:string}|null>|null=null;
/** Same Yahoo summary transport as reports; a worker has no report request to inject it from. */
async function yahooSummary(symbol:string):Promise<Row|null>{
 try{
  if(!yahooAuth||yahooAuth.expires<Date.now()){
   if(!authPending)authPending=(async()=>{try{const r=await fetch('https://fc.yahoo.com/',{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(5000)});const cookies=(r.headers as any).getSetCookie?.()??[r.headers.get('set-cookie')??''];await r.body?.cancel();const cookie=cookies.map((s:string)=>s.split(';')[0]).filter(Boolean).join('; '),c=await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':'Mozilla/5.0',...(cookie?{Cookie:cookie}:{})},redirect:'error',signal:AbortSignal.timeout(5000)}),crumb=c.ok?(await c.text()).trim():'';if(!c.ok)await c.body?.cancel();if(!crumb||crumb.length>200)return null;yahooAuth={cookie,crumb,expires:Date.now()+25*60000};return {cookie,crumb};}catch{return null;}})().finally(()=>{authPending=null;});
   await authPending;
  }
  const modules='quoteType,price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,earningsHistory,calendarEvents,topHoldings';
  const u=new URL('https://query2.finance.yahoo.com/v10/finance/quoteSummary/'+encodeURIComponent(symbol));u.searchParams.set('modules',modules);if(yahooAuth)u.searchParams.set('crumb',yahooAuth.crumb);
  const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0',...(yahooAuth?.cookie?{Cookie:yahooAuth.cookie}:{})},redirect:'error',signal:AbortSignal.timeout(7000)});if(!r.ok){await r.body?.cancel();return null;}const row=(await r.json())?.quoteSummary?.result?.[0];return row&&(row.quoteType?.symbol??row.price?.symbol)===symbol?row:null;
 }catch{return null;}
}
export function normalizeMonitorNews(rows:Article[],symbol:string,name:string,now=Date.now()):MonitorNews[]{
 const seen=new Set<string>(),titles=new Set<string>(),pattern=companyNewsPattern(symbol,name);
 return rows.slice().sort((a,b)=>Date.parse(b.publishedAt??b.date)-Date.parse(a.publishedAt??a.date)).flatMap(a=>{
  const url=monitorSourceUrl(a.url),date=stamp(a.publishedAt??a.date,now),title=clean(a.title,300),source=clean(a.source,100),key=title.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu,'');
  if(!url||!date||Date.parse(date)<now-7*86400000||!source||!title||seen.has(url)||titles.has(key)||!pattern.test(title+' '+(a.excerpt??''))||/prediction:|stocks? to buy|millionaire|class action|investor deadline|motley fool|zacks rank/i.test(title+' '+source))return [];
  seen.add(url);titles.add(key);return [{id:url,title,date,source,url,excerpt:clean(a.excerpt,900)}];
 }).slice(0,16);
}
export async function collectMonitorSnapshot(symbol:string,previous:MonitorSnapshot|null,env:Row={},deps:MonitorDataDependencies={}):Promise<MonitorSnapshot>{
 const now=(deps.now??Date.now)(),at=new Date(now).toISOString(),due=(!previous?.fundamentalsAt||now-Date.parse(previous.fundamentalsAt)>=86400000)&&(!previous?.fundamentalsAttemptAt||now-Date.parse(previous.fundamentalsAttemptAt)>=3600000);
 const newsTask=deps.news?safe(deps.news(symbol)):(async()=>{const first=await safe(eodhdNews(symbol));if((first?.length??0)>=5)return first!;const [massive,rss]=await Promise.all([safe(massiveNews(env.MASSIVE_API_KEY,symbol)),safe(tickerPublisherNews(symbol))]);return [...(first??[]),...(massive??[]),...(rss??[])];})();
 const [rawInput,chartInput]=await Promise.all([due?safe((deps.fundamentals??eodhdFundamentalRaw)(symbol)):null,safe((deps.chart??(s=>marketJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d&includePrePost=false`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:8000,acceptPrimary:value=>value?.chart?.result?.[0]?.meta?.symbol===symbol&&normalizeRegularQuote(symbol,value,now).price!==null})))(symbol))]);
 const raw=rawInput?.General?.Code===eodhdSymbol(symbol)?.split('.').slice(0,-1).join('.')&&rawInput?.General?.Type?rawInput:null,chart=chartInput?.chart?.result?.[0]?.meta?.symbol===symbol?chartInput:null;
 const previewTask=due?safe(deps.calendar?deps.calendar(symbol,raw):monitorCalendar(symbol,raw,env,now)):Promise.resolve(null);
 const primary=raw?normalizeEodhdSummary(raw,symbol):null,summary=due&&!primary?await safe((deps.summary??yahooSummary)(symbol)):primary,meta=chart?.chart?.result?.[0]?.meta??{},quote=normalizeRegularQuote(symbol,chart,now);
 const name=clean(raw?.General?.Name??summary?.quoteType?.longName??meta.longName??previous?.name??symbol,200),kind=raw?.General?.Type==='ETF'||summary?.quoteType?.quoteType==='ETF'||meta.instrumentType==='ETF'?'etf':raw||summary||meta.instrumentType==='EQUITY'?'stock':previous?.kind??'other';
 const out:MonitorSnapshot={schema:1,symbol,name,kind,currency:currency(quote.currency)??currency(raw?.General?.CurrencyCode)??currency(summary?.price?.currency)??previous?.currency??null,collectedAt:at,metrics:{...previous?.metrics},news:[],calendar:previous?.calendar??[],holdings:previous?.holdings??null,coverage:[],fundamentalsAt:due&&(raw||summary)?at:previous?.fundamentalsAt??null,fundamentalsAttemptAt:due?at:previous?.fundamentalsAttemptAt??null};
 const quoteDate=quote.at??quote.date,marketSource=meta._provider==='eodhd'?'EODHD':'Yahoo Finance',marketUrl=meta._provider==='eodhd'?'https://eodhd.com/financial-summary/'+encodeURIComponent(symbol):'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/';
 const put=(field:MonitorField,value:number|null,date:string|null,source:string,url:string,unit:string,money:string|null,maxAgeHours:number,period?:string|null,basis:MonitorMetric['dateBasis']='published')=>{const old=out.metrics[field];if(value===null||old?.asOf&&(!date||Date.parse(old.asOf)>Date.parse(date)))return;out.metrics[field]={value,asOf:date,source,url,unit,currency:money,maxAgeHours,...(period?{period}:{}),dateBasis:basis};};
 put('price',quote.price,quoteDate,marketSource,marketUrl,'currency',out.currency,96);put('changePct',quote.change,quoteDate,marketSource,marketUrl,'percent',null,96);
 let preview:Awaited<ReturnType<typeof loadEarningsPreview>>|null=null;
 if(due){
  const source=raw?'EODHD':'Yahoo Finance',url=raw?'https://eodhd.com/financial-summary/'+encodeURIComponent(symbol):'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/key-statistics/',updated=stamp(raw?.General?.UpdatedAt,now),financialDate=stamp(raw?.Highlights?.MostRecentQuarter,now)??stamp(summary?.defaultKeyStatistics?.mostRecentQuarter,now),p=summary?.summaryDetail??{},f=summary?.financialData??{},k=summary?.defaultKeyStatistics??{};
  put('pe',number(raw?.Valuation?.TrailingPE)??number(raw?.Highlights?.PERatio)??number(p.trailingPE),updated,source,url,'multiple',null,168);
  put('pb',number(raw?.Valuation?.PriceBookMRQ)??number(k.priceToBook),updated,source,url,'multiple',null,168);
  put('marketCap',number(raw?.Highlights?.MarketCapitalization)??number(p.marketCap)??number(summary?.price?.marketCap),raw?updated:stamp(summary?.price?.regularMarketTime,now),source,url,'currency',out.currency,168);
  const growth=number(raw?.Highlights?.QuarterlyRevenueGrowthYOY)??number(f.revenueGrowth);put('revenueGrowthPct',growth===null?null:growth*100,financialDate,source,url,'percent',null,24*190,day(raw?.Highlights?.MostRecentQuarter)??financialDate?.slice(0,10));
  const trend=summary?.earningsTrend?.trend?.find((r:Row)=>r.period==='0q'),estimate=number(trend?.earningsEstimate?.avg),period=day(trend?.endDate?.fmt??trend?.endDate)??stamp(trend?.endDate,now+370*86400000)?.slice(0,10);
  put('epsEstimate',estimate,updated,source,url,'currency',currency(f.financialCurrency)??out.currency,168,period);
  if(kind==='etf'){
   const h=raw?.ETF_Data,holdingDate=day(h?.Holdings_Date)??day(h?.HoldingsDate)??day(h?.Date),entries=Object.entries(h?.Holdings??h?.Top_10_Holdings??{}),items=entries.flatMap(([id,r]:[string,any])=>{const s=clean(r.Code??id.split('.')[0],30)+(r.Exchange&&r.Exchange!=='US'?'.'+r.Exchange:''),weight=number(r['Assets_%']);return /^[A-Z0-9][A-Z0-9.^=-]{0,29}$/.test(s)&&weight!==null&&weight>0&&weight<=100?[{symbol:s,name:clean(r.Name,160)||s,weightPct:weight}]:[];}).sort((a,b)=>b.weightPct-a.weightPct).slice(0,50);
   if(items.length)out.holdings={asOf:holdingDate,source,url,items,coveragePct:items.reduce((s,h)=>s+h.weightPct,0)<=100.01?Math.min(100,items.reduce((s,h)=>s+h.weightPct,0)):null};
   else if(!out.holdings)out.coverage.push('Composición del ETF no disponible con la cobertura actual.');
  }
  preview=await previewTask;
  if(preview?.next.date&&((preview as any)._monitorSource||deps.calendar)){const date=preview.next.date,source=(preview as any)._monitorSource??'Calendario de resultados',url=(preview as any)._monitorUrl??marketUrl;const events:MonitorCalendarEvent[]=[{id:'earnings:'+symbol+':'+date,symbol,kind:'earnings',title:'Resultados · '+name,date,source,url,confirmed:!preview.next.provisional,asOf:at,details:preview.next.session}];out.calendar=events;const days=daysUntil(date,now);put('earningsWithinDays',days,at,source,url,'days',null,30,preview.next.period,'observed');if(preview.next.eps.mean!==null&&preview.next.period)put('epsEstimate',preview.next.eps.mean,updated,source,url,'currency',preview.next.eps.currency,168,preview.next.period);}
  else {const dates=summary?.calendarEvents?.earnings?.earningsDate??[];const date=stamp(dates[0],now+90*86400000)?.slice(0,10);if(date&&date>=at.slice(0,10)){out.calendar=[{id:'earnings:'+symbol+':'+date,symbol,kind:'earnings',title:'Resultados · '+name,date,source,url,confirmed:false,asOf:at,details:dates.length>1?'Ventana estimada; fecha por confirmar':'Fecha estimada'}];put('earningsWithinDays',daysUntil(date,now),at,source,url,'days',null,30,null,'observed');}}
  // A filing date is indispensable: fiscal period-end is never labelled a new publication.
  if(raw)for(const r of Object.values(raw.Earnings?.History??{}) as Row[]){const date=day(r.reportDate),period=day(r.date);if(date&&date<=at.slice(0,10)&&Date.parse(date)>now-30*86400000)out.calendar.push({id:'publication:'+symbol+':'+date+':'+(period??''),symbol,kind:'publication',title:'Publicación de resultados · '+name,date,source:'EODHD',url,confirmed:true,asOf:updated??at,details:period?'Período '+period:undefined});}
 }
 // Countdown moves in code even when the daily calendar is reused.
 const next=out.calendar.filter(e=>e.kind==='earnings'&&e.date>=at.slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date))[0];
 if(next&&out.metrics.earningsWithinDays)out.metrics.earningsWithinDays={...out.metrics.earningsWithinDays,value:daysUntil(next.date,now)};else delete out.metrics.earningsWithinDays;
 const newsRows=await newsTask;
 const current=normalizeMonitorNews(newsRows??[],symbol,name,now),previousNews=new Map((previous?.news??[]).map(n=>[n.id,n]));out.news=current.map(n=>({...n,...(previousNews.get(n.id)?.analysisKey?{analysisKey:previousNews.get(n.id)!.analysisKey,summary:previousNews.get(n.id)!.summary}:{})}));
 for(const old of previous?.news??[])if(!out.news.some(n=>n.id===old.id)&&Date.parse(old.date)>now-7*86400000)out.news.push(old);out.news=out.news.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,24);
 if(!quote.price)out.coverage.push('Cotización no recuperada; se conserva la última observación con su fecha.');
 if(due&&!raw&&!summary)out.coverage.push('Fundamentales y estimaciones no recuperados con los proveedores actuales.');
 if(!out.news.length)out.coverage.push('Sin noticias recientes verificadas.');
 if(!out.calendar.some(e=>e.kind==='earnings'))out.coverage.push('Sin próxima fecha de resultados verificada.');
 if(out.holdings&&!out.holdings.asOf)out.coverage.push('Composición sin fecha de publicación: exposición indirecta no calculable.');
 if(!quote.price&&!raw&&!summary&&!current.length&&!previous)throw new Error('MONITOR_DATA_UNAVAILABLE');
 return out;
}
/** Small source-bound editorial batch, cached persistently by the worker, with no web grounding. */
export async function interpretMonitorNews(news:MonitorNews[],key:string|undefined):Promise<MonitorNews[]>{
 const selected=news.slice(0,6),summaries=await summarizeNews(selected,key);
 return news.map(n=>{const result=summaries.find(s=>s.id===n.id);return {...n,analysisKey:'monitor-news-v1:'+n.id,summary:result?.keyPoints?.join(' ').slice(0,650)||n.excerpt.slice(0,650)||n.title};});
}

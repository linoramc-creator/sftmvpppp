import {eodhdFundamentalRaw} from './eodhd-fundamentals.ts';
import {eodhdGet,eodhdSymbol} from './eodhd-client.ts';
import {cached} from './panels.ts';

type Row=Record<string,any>;
export type EstimateBand={mean:number|null;low:number|null;high:number|null;analysts:number|null;currency:string|null};
export type GrowthComparison={current:number;previous:number;changePct:number|null;period:string;currency:string};
export type EarningsHistoryRow={reportDate:string;period:string;epsActual:number;epsEstimate:number|null;surprisePct:number|null;currency:string|null;revenueActual:number|null};
export type EarningsPreview={
 symbol:string;name:string;fetchedAt:string;asOf:string|null;status:'ready'|'partial'|'unavailable';
 next:{date:string|null;session:string;period:string|null;periodLabel:string|null;provisional:boolean;currency:string|null;eps:EstimateBand;revenue:EstimateBand;epsYoY:GrowthComparison|null;revenueYoY:GrowthComparison|null;revisions:{days30Pct:number|null;days90Pct:number|null;up30:number|null;down30:number|null}};
 history:EarningsHistoryRow[];summary:{headline:string;points:string[]};notes:string[];
};
export type EarningsPreviewDependencies={now?:number;fundamentals?:(symbol:string)=>Promise<Row|null>;calendar?:(symbol:string,from:string,to:string)=>Promise<unknown>;fallback?:(symbol:string,from:string,to:string)=>Promise<unknown[]>};
type Env={FMP_KEY?:string;FINNHUB_KEY?:string};
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Object.values(object(v)).filter(v=>v!==null&&typeof v==='object'&&!Array.isArray(v));
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const count=(v:unknown)=>{const n=number(v);return n!==null&&Number.isInteger(n)&&n>=0?n:null;};
const day=(v:unknown):string|null=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;
const calendarToday=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const currency=(v:unknown):string|null=>typeof v==='string'&&/^[A-Z]{3}$/.test(v)?v:null;
const text=(v:unknown,max=160)=>typeof v==='string'&&v.trim()?v.trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):null;
const rate=(current:number|null,previous:number|null)=>current===null||previous===null||previous===0?null:(current-previous)/Math.abs(previous)*100;
const session=(v:unknown)=>({BeforeMarket:'Antes de apertura',AfterMarket:'Después del cierre',DuringMarket:'Durante sesión',bmo:'Antes de apertura',amc:'Después del cierre',dmh:'Durante sesión'} as Record<string,string>)[String(v)]??'Hora por confirmar';
const periodLabel=(period:string|null,label:unknown)=>period?(typeof label==='string'&&/^Q[1-4]$/.test(label)?label+' · ':'')+'Cierre '+new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(Date.parse(period+'T12:00:00Z')):null;
const emptyBand=(c:string|null=null):EstimateBand=>({mean:null,low:null,high:null,analysts:null,currency:c});
const band=(row:Row,prefix:string,c:string|null):EstimateBand=>{
 const result={mean:number(row[prefix+'Avg']),low:number(row[prefix+'Low']),high:number(row[prefix+'High']),analysts:count(row[prefix+'NumberOfAnalysts']),currency:c};
 // Contradictory ranges are not rendered as a trustworthy consensus interval.
 if(result.low!==null&&result.high!==null&&result.low>result.high||result.mean!==null&&(result.low!==null&&result.mean<result.low||result.high!==null&&result.mean>result.high)){result.low=null;result.high=null;}
 return result;
};
const sameQuarter=(target:string,period:string)=>{const days=(Date.parse(target)-Date.parse(period))/86400000;return days>=350&&days<=380;};
const percent=(v:number)=>new Intl.NumberFormat('es-ES',{style:'percent',maximumFractionDigits:1,signDisplay:'exceptZero'}).format(v/100);

/** Calendar dates are announcement dates; forecasts and accounts retain their
 * fiscal period and their own currency. Historical EPS uses the same analyst
 * earnings series as its consensus, never diluted GAAP EPS from statements.
 * Field definitions and the split quarterly/annual payload are documented at
 * https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits
 * https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds */
export function buildEarningsPreview(raw:Row|null,symbol:string,calendar:unknown=null,fallback:unknown[]=[],now=Date.now()):EarningsPreview{
 const today=calendarToday(now),end=new Date(Date.parse(today+'T12:00:00Z')+180*86400000).toISOString().slice(0,10),r=object(raw),g=object(r.General),financials=object(r.Financials),income=object(financials.Income_Statement),reportingCurrency=currency(income.currency_symbol)??currency(financials.Balance_Sheet?.currency_symbol)??currency(financials.Cash_Flow?.currency_symbol);
 const historyRows=rows(r.Earnings?.History),published=historyRows.filter(row=>day(row.reportDate)!==null&&row.reportDate<=today&&day(row.date)!==null&&row.date<=today&&number(row.epsActual)!==null);
 const publishedPeriods=new Set(published.map(row=>row.date)),statements=rows(income.quarterly).filter(row=>day(row.date)!==null&&row.date<=today&&(!day(row.filing_date)||row.filing_date<=today));
 for(const row of statements)if(day(row.filing_date))publishedPeriods.add(row.date);
 const history:EarningsHistoryRow[]=published.map(row=>{
  const c=currency(row.currency)??reportingCurrency,statement=statements.find(s=>s.date===row.date&&(currency(s.currency_symbol)??reportingCurrency)===c),actual=number(row.epsActual)!,estimate=number(row.epsEstimate);
  return {reportDate:row.reportDate,period:row.date,epsActual:actual,epsEstimate:estimate,surprisePct:rate(actual,estimate),currency:c,revenueActual:statement?number(statement.totalRevenue):null};
 }).sort((a,b)=>b.reportDate.localeCompare(a.reportDate)||b.period.localeCompare(a.period)).filter((v,i,a)=>a.findIndex(r=>r.period===v.period)===i).slice(0,8);
 const trend=object(r.Earnings?.Trend),split=Object.keys(object(trend.Quarterly)).length>0||Object.keys(object(trend.Annual)).length>0;
 const quarterly=(split?rows(trend.Quarterly):rows(trend).filter(row=>/^(?:[+-]?\d+q)$/.test(String(row.period))||/^Q[1-4]$/.test(String(row.fiscalQuarter??row.quarter)))).filter(row=>day(row.date)!==null&&row.date>=new Date(now-200*86400000).toISOString().slice(0,10)&&row.date<=end&&!publishedPeriods.has(row.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const providerSymbol=eodhdSymbol(symbol),native=(value:unknown)=>typeof value==='string'&&providerSymbol!==null&&(value.toUpperCase()===providerSymbol||value.toUpperCase()===symbol.toUpperCase());
 const calendarRows=Array.isArray(object(calendar).earnings)?object(calendar).earnings:[];
 const completed=calendarRows.filter((row:Row)=>native(row?.code)&&day(row.report_date)&&row.report_date<=today&&number(row.actual)!==null);
 for(const row of completed)if(day(row.date))publishedPeriods.add(row.date);
 type Event={date:string;period:string|null;session:string;eps:number|null;revenue:number|null;currency:string|null;priority:number};
 const events:Event[]=[];
 for(const row of calendarRows){if(!row||!native(row.code)||!day(row.report_date)||row.report_date<today||row.report_date>end||number(row.actual)!==null||day(row.date)&&publishedPeriods.has(row.date))continue;events.push({date:row.report_date,period:day(row.date),session:session(row.before_after_market),eps:number(row.estimate),revenue:null,currency:currency(row.currency),priority:0});}
 for(const row of historyRows){if(!day(row.reportDate)||row.reportDate<today||row.reportDate>end||!day(row.date)||number(row.epsActual)!==null||publishedPeriods.has(row.date))continue;if(events.some(e=>e.period===row.date))continue;events.push({date:row.reportDate,period:row.date,session:session(row.beforeAfterMarket??row.before_after_market),eps:number(row.epsEstimate),revenue:null,currency:currency(row.currency)??reportingCurrency,priority:1});}
 for(const value of fallback){const row=object(value),date=day(typeof row.date==='string'?row.date.slice(0,10):null),period=day(row.fiscalDate??row.fiscalDateEnding);if(!native(row.symbol)||!date||date<today||date>end||number(row.epsActual??row.actual)!==null||completed.some(c=>c.report_date===date)||period&&publishedPeriods.has(period))continue;
  const old=events.find(e=>e.date===date);const c=currency(row.currency),eps=number(row.epsEstimated??row.epsEstimate),revenue=number(row.revenueEstimated??row.revenueEstimate);
  if(old){if(old.session==='Hora por confirmar')old.session=session(row.hour??row.time);if(old.eps===null&&old.currency&&old.currency===c)old.eps=eps;if(old.revenue===null&&old.currency&&old.currency===c)old.revenue=revenue;}
  else events.push({date,period,session:session(row.hour??row.time),eps,revenue,currency:c,priority:2});
 }
 const event=events.sort((a,b)=>a.date.localeCompare(b.date)||a.priority-b.priority)[0]??null;
 const eligible=quarterly.filter(row=>!publishedPeriods.has(row.date));
 const forecast=event?.period?eligible.find(row=>row.date===event.period)??null:event?eligible.find(row=>row.date<=event.date&&(Date.parse(event.date)-Date.parse(row.date))/86400000<=120)??null:eligible[0]??null;
 const period=event?.period??day(forecast?.date),epsCurrency=currency(forecast?.earningsEstimateCurrency)??currency(forecast?.currency)??reportingCurrency,revenueCurrency=currency(forecast?.revenueEstimateCurrency)??currency(forecast?.currency)??reportingCurrency;
 const eps=forecast?band(forecast,'earningsEstimate',epsCurrency):emptyBand(event?.currency??null),revenue=forecast?band(forecast,'revenueEstimate',revenueCurrency):emptyBand(event?.currency??null);
 if(eps.mean===null&&event?.eps!==null&&event?.eps!==undefined&&(eps.currency===null||event.currency===eps.currency)){eps.mean=event.eps;eps.currency=event.currency;}
 if(revenue.mean===null&&event?.revenue!==null&&event?.revenue!==undefined&&(revenue.currency===null||event.currency===revenue.currency)){revenue.mean=event.revenue;revenue.currency=event.currency;}
 // Only compare like periods and explicit reporting currencies. The prior-year
 // EPS supplied with the forecast belongs to its analyst consensus basis.
 let epsYoY:GrowthComparison|null=null,revenueYoY:GrowthComparison|null=null;
 if(period&&eps.mean!==null&&eps.currency){const prior=number(forecast?.earningsEstimateYearAgoEps),previous=history.find(h=>sameQuarter(period,h.period)&&h.currency===eps.currency);if(prior!==null&&previous)epsYoY={current:eps.mean,previous:prior,changePct:rate(eps.mean,prior),period:previous.period,currency:eps.currency};}
 if(period&&revenue.mean!==null&&revenue.currency){const previous=statements.filter(s=>sameQuarter(period,s.date)&&(currency(s.currency_symbol)??reportingCurrency)===revenue.currency).sort((a,b)=>Math.abs(Date.parse(period)-Date.parse(a.date)-365.25*86400000)-Math.abs(Date.parse(period)-Date.parse(b.date)-365.25*86400000))[0],prior=number(previous?.totalRevenue);if(previous&&prior!==null)revenueYoY={current:revenue.mean,previous:prior,changePct:rate(revenue.mean,prior),period:previous.date,currency:revenue.currency};}
 const current=number(forecast?.epsTrendCurrent)??eps.mean,days30Pct=rate(current,number(forecast?.epsTrend30daysAgo)),days90Pct=rate(current,number(forecast?.epsTrend90daysAgo)),up30=count(forecast?.epsRevisionsUpLast30days),down30=count(forecast?.epsRevisionsDownLast30days);
 const notes:string[]=[];
 if(!event)notes.push('Fecha de publicación pendiente de confirmación.');
 else notes.push('Fecha prevista de publicación; puede actualizarse.');
 if(history.length)notes.push('El BPA publicado puede incluir partidas extraordinarias; la sorpresa frente al consenso no mide por sí sola el resultado recurrente.');
 if(!forecast)notes.push('Sin consenso trimestral completo para esta publicación.');
 if(eps.mean!==null&&!eps.currency||revenue.mean!==null&&!revenue.currency)notes.push('Moneda del consenso no informada; no se calcula su variación interanual.');
 if(history.some(h=>!h.currency))notes.push('Algunas publicaciones históricas no informan moneda.');
 if(period&&eps.mean!==null&&!epsYoY)notes.push('Comparación interanual de BPA omitida cuando no se confirma la misma base y moneda.');
 const points:string[]=[];
 if(epsYoY?.changePct!==null&&epsYoY?.changePct!==undefined)points.push(`El consenso de BPA implica ${percent(epsYoY.changePct)} frente al mismo trimestre anterior.`);
 if(revenueYoY?.changePct!==null&&revenueYoY?.changePct!==undefined)points.push(`Los ingresos esperados varían ${percent(revenueYoY.changePct)} interanual.`);
 if(days30Pct!==null)points.push(`El consenso de BPA se ha revisado ${percent(days30Pct)} en 30 días.`);
 const comparable=history.filter(h=>h.epsEstimate!==null&&h.currency===eps.currency).slice(0,4);
 if(comparable.length===1){const row=comparable[0],outcome=row.epsActual>row.epsEstimate!?'superó':row.epsActual<row.epsEstimate!?'quedó por debajo de':'coincidió con';points.push(`En la última publicación con estimación previa, el BPA ${outcome} el consenso.`);}
 else if(comparable.length>1)points.push(`En las últimas ${comparable.length} publicaciones con estimación previa, ${comparable.filter(h=>h.epsActual>h.epsEstimate!).length} superaron el BPA esperado y ${comparable.filter(h=>h.epsActual<h.epsEstimate!).length} quedaron por debajo.`);
 const hasData=eps.mean!==null||revenue.mean!==null||history.length>0;
 return {symbol,name:text(g.Name)??symbol,fetchedAt:new Date(now).toISOString(),asOf:day(g.UpdatedAt)&&g.UpdatedAt<=today?g.UpdatedAt:null,status:event&&forecast&&eps.mean!==null&&revenue.mean!==null&&eps.currency&&revenue.currency?'ready':hasData?'partial':'unavailable',next:{date:event?.date??null,session:event?.session??'Hora por confirmar',period,periodLabel:periodLabel(period,forecast?.fiscalQuarter??forecast?.quarter),provisional:true,currency:eps.currency===revenue.currency?eps.currency:null,eps,revenue,epsYoY,revenueYoY,revisions:{days30Pct,days90Pct,up30,down30}},history,summary:{headline:hasData?'Qué espera el mercado de la próxima publicación':'La próxima publicación aún no dispone de estimaciones verificables',points:points.slice(0,4)},notes};
}

async function get(url:string):Promise<any>{try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000)});return r.ok?await r.json():null;}catch{return null;}}
export async function loadEarningsPreview(symbol:string,eventDate:string|undefined,env:Env={},deps:EarningsPreviewDependencies={}):Promise<EarningsPreview>{
 const now=deps.now??Date.now(),today=calendarToday(now),end=new Date(Date.parse(today+'T12:00:00Z')+120*86400000).toISOString().slice(0,10);
 // The clicked date is an untrusted hint, never a replacement for a provider
 // announcement date. Bounded symbol-specific queries also avoid feed ranking.
 const [raw,calendar]=await Promise.all([(deps.fundamentals??eodhdFundamentalRaw)(symbol).catch(()=>null),(deps.calendar??((ticker,from,to)=>eodhdGet('calendar/earnings',{symbols:eodhdSymbol(ticker)??undefined,from,to},{ttlMs:3600000,cost:1,timeoutMs:12000})))(symbol,today,end).catch(()=>null)]);
 let result=buildEarningsPreview(raw,symbol,calendar,[],now);
 if(result.next.date===null||result.next.eps.mean===null||result.next.revenue.mean===null){
  let fallback:unknown[]=[];try{fallback=deps.fallback?await deps.fallback(symbol,today,end):await (async()=>{const date=day(eventDate),from=date&&date>=today&&date<=end?date:today,to=from===today?new Date(now+6*86400000).toISOString().slice(0,10):from;const [fmp,finnhub]=await Promise.all([env.FMP_KEY?get(`https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(env.FMP_KEY)}`):null,env.FINNHUB_KEY?get(`https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${today}&to=${end}&token=${encodeURIComponent(env.FINNHUB_KEY)}`):null]);return [...(Array.isArray(fmp)?fmp:[]),...(Array.isArray(finnhub?.earningsCalendar)?finnhub.earningsCalendar:[])];})();}catch{/* Keep usable primary data when a secondary provider is unavailable. */}
  result=buildEarningsPreview(raw,symbol,calendar,fallback,now);
 }
 return result;
}
export async function earningsPreview(symbol:string,eventDate:string|undefined,env:Env={}):Promise<EarningsPreview>{return cached('earnings-preview-v1:'+symbol+':'+calendarToday(Date.now()),10*60000,()=>loadEarningsPreview(symbol,eventDate,env));}

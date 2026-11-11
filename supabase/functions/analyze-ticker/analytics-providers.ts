import {cached} from './panels.ts';
import {eodhdFundamentalRaw,normalizeEodhdTimeseries} from './eodhd-fundamentals.ts';
import {marketJson} from './eodhd-market-fetch.ts';
import {regularSessionEnd} from './market-session.ts';
import type {AnalyticsFundamentalInput,AnalyticsMetric,AnalyticsPriceInput,AnalyticsSource} from './analytics-types.ts';

type Row=Record<string,any>;
const DAY=86400000;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const number=(v:unknown):number|null=>finite(v)?v:typeof v==='string'&&/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const money=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z]{3}$/.test(v);
const symbolOk=(v:string)=>/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/.test(v)&&!v.includes('..');
const exportEntitled=()=>{try{return (globalThis as any).Deno?.env?.get('ANALYTICS_DATA_EXPORT_ALLOWED')==='1';}catch{return false;}};
function source(id:string,name:string,url:string,through:string|null,now:number,publicFiling=false):AnalyticsSource{return {id,name,url,fetchedAt:new Date(now).toISOString(),dataThrough:through,exportAllowed:publicFiling||exportEntitled(),exportNote:publicFiling?'Cifras publicadas en EDGAR; conserva atribución y metodología.':exportEntitled()?'Exportación habilitada por el administrador según los derechos contratados.':'La licencia de exportación de datos de este proveedor no está acreditada. Gráfico derivado para uso personal.'};}
const FIELDS:Partial<Record<AnalyticsMetric,string>>={revenue:'TotalRevenue',netIncome:'NetIncome',grossProfit:'GrossProfit',operatingCashFlow:'OperatingCashFlow',freeCashFlow:'FreeCashFlow',capex:'CapitalExpenditure',cash:'CashAndCashEquivalents',totalDebt:'TotalDebt',equity:'StockholdersEquity',totalAssets:'TotalAssets'};
const STOCKS=new Set(['cash','totalDebt','equity','totalAssets']);

/** Close is the provider's split-adjusted price field, never adjclose (which
 * includes distributions). EODHD's synthetic raw closes are rejected for this
 * consumer because its dividend-adjusted field is not an equivalent substitute. */
export function normalizeAnalyticsPrices(symbol:string,input:unknown,now=Date.now()):AnalyticsPriceInput|null {
  const chart=object(input).chart?.result?.[0],meta=chart?.meta,quote=chart?.indicators?.quote?.[0];
  if(!meta||String(meta.symbol).toUpperCase()!==symbol||!Array.isArray(chart.timestamp)||!Array.isArray(quote?.close)||!money(meta.currency)||meta._provider==='eodhd'&&!['INDEX','CURRENCY','CRYPTOCURRENCY'].includes(meta.instrumentType))return null;
  let zone=meta.exchangeTimezoneName;try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{return null;}
  if(typeof zone!=='string')return null;
  const date=(ms:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms),today=date(now);
  const end=regularSessionEnd(meta,symbol),complete=end!==null&&end*1000<=now&&date(end*1000)===today;
  const points=new Map<string,number>(),conflicts=new Set<string>();
  for(let i=0;i<Math.min(5000,chart.timestamp.length);i++){
    const t=chart.timestamp[i],value=quote.close[i];if(!finite(t)||t<=0||t*1000>now||!finite(value)||value<=0)continue;
    const d=date(t*1000);if(!day(d)||d>today||d===today&&!complete)continue;
    if(points.has(d)){if(t===meta.regularMarketTime)continue;if(points.get(d)!==value)conflicts.add(d);continue;}points.set(d,value);
  }
  const rows=[...points].filter(([d])=>!conflicts.has(d)).map(([date,value])=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date));
  if(!rows.length)return null;
  const eod=meta._provider==='eodhd';
  return {symbol,currency:meta.currency,points:rows,source:source((eod?'eodhd':'yahoo')+':price:'+symbol,eod?'EODHD · cierre de índice/divisa':'Yahoo Finance · cierre de precio',eod?'https://eodhd.com/financial-apis/eod-historical-data-api':'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/history/',rows.at(-1)!.date,now),adjustment:'split-adjusted-price',notes:[]};
}
export async function analyticsPrices(symbol:string,from:string,to:string):Promise<AnalyticsPriceInput|null>{
  if(!symbolOk(symbol)||!day(from)||!day(to))return null;
  return cached('analytics-price-v1:'+symbol+':'+from+':'+to,300000,async()=>{
    const now=Date.now(),days=(now-Date.parse(from))/DAY,range=days<=365?'1y':days<=731?'2y':days<=1830?'5y':'10y';
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=splits`;
    const raw=await marketJson(url,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:10000,acceptPrimary:value=>normalizeAnalyticsPrices(symbol,value,now)!==null});
    return normalizeAnalyticsPrices(symbol,raw,now);
  });
}

/** Normalize only explicit 3M/12M time-series observations. A quarterly field
 * name by itself cannot prove that an accumulated YTD cash flow is standalone. */
export function analyticsFundamentalsFromTimeseries(symbol:string,input:unknown,meta?:AnalyticsSource,now=Date.now()):AnalyticsFundamentalInput|null {
  if(!Array.isArray(input)||!symbolOk(symbol))return null;
  const cutoff=new Date(now).toISOString().slice(0,10),rows=new Map<string,AnalyticsFundamentalInput['rows'][number]>(),conflicts=new Set<string>();
  let excluded=0;
  for(const series of input.slice(0,60)){
    const type=series?.meta?.type?.[0],declared=series?.meta?.symbol?.[0];if(typeof type!=='string'||declared&&declared!==symbol||!Array.isArray(series[type]))continue;
    const entry=Object.entries(FIELDS).find(([,field])=>type==='quarterly'+field||type==='annual'+field);if(!entry)continue;const metric=entry[0] as AnalyticsMetric;
    for(const point of series[type].slice(0,200)){
      const date=point?.asOfDate,period=point?.periodType,value=number(point?.reportedValue?.raw),currency=point?.currencyCode;
      if(!day(date)||date>cutoff||value===null||!money(currency))continue;
      if(!['3M','12M'].includes(period)||type.startsWith('quarterly')&&period!=='3M'||type.startsWith('annual')&&period!=='12M'){excluded++;continue;}
      const id=date+':'+period+':'+currency,field=id+':'+metric;if(conflicts.has(field))continue;
      const row=rows.get(id)??{date,currency,filingDate:null,periodType:period,values:{}};
      const normalized=metric==='capex'?Math.abs(value):value;
      if(row.values[metric]!==undefined&&row.values[metric]!==normalized){delete row.values[metric];conflicts.add(field);continue;}
      row.values[metric]=normalized;rows.set(id,row);
    }
  }
  for(const row of rows.values())if(row.values.freeCashFlow===undefined&&finite(row.values.operatingCashFlow)&&finite(row.values.capex))row.values.freeCashFlow=row.values.operatingCashFlow-row.values.capex;
  if(!rows.size)return null;
  const all=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
  return {symbol,rows:all,source:meta??source('yahoo:financials:'+symbol,'Yahoo Finance · estados financieros publicados','https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/financials/',all.at(-1)!.date,now),notes:[...(excluded?['Se excluyeron '+excluded+' observaciones sin duración 3M/12M compatible.']:[]),'El flujo de caja libre puede calcularse como flujo operativo menos CapEx total cuando ambos están disponibles para el mismo periodo y moneda.']};
}

function eodhdAnnual(raw:Row):Row[]{
  const blocks={income:object(raw.Financials?.Income_Statement),cash:object(raw.Financials?.Cash_Flow),balance:object(raw.Financials?.Balance_Sheet)},types:Row={revenue:['income','totalRevenue'],netIncome:['income','netIncome'],grossProfit:['income','grossProfit'],operatingCashFlow:['cash','totalCashFromOperatingActivities'],freeCashFlow:['cash','freeCashFlow'],capex:['cash','capitalExpenditures'],cash:['balance','cashAndEquivalents'],totalDebt:['balance','shortLongTermDebtTotal'],equity:['balance','totalStockholderEquity'],totalAssets:['balance','totalAssets']};
  return Object.entries(types).flatMap(([metric,[block,field]]:any)=>{
    const data=(blocks as Row)[block],type='annual'+FIELDS[metric as AnalyticsMetric];
    const points=Object.values(object(data.yearly)).flatMap((v:any)=>{const currency=v.currency_symbol??data.currency_symbol,value=number(v[field]);return day(v.date)&&money(currency)&&value!==null?[{asOfDate:v.date,currencyCode:currency,periodType:'12M',reportedValue:{raw:value}}]:[];});
    return points.length?[{meta:{type:[type],symbol:[raw.General.Code]},[type]:points}]:[];
  });
}

const SEC_CIKS:Record<string,string>={AAPL:'0000320193',MSFT:'0000789019',GOOGL:'0001652044',AMZN:'0001018724',META:'0001326801',NVDA:'0001045810',TSLA:'0001318605',VRT:'0001674101',JPM:'0000019617',BRK_B:'0001067983'};
const SEC_TAGS:Partial<Record<AnalyticsMetric,string[]>>={revenue:['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet','RevenueFromContractWithCustomerIncludingAssessedTax'],netIncome:['NetIncomeLoss'],grossProfit:['GrossProfit'],operatingCashFlow:['NetCashProvidedByUsedInOperatingActivities'],capex:['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets'],cash:['CashAndCashEquivalentsAtCarryingValue'],equity:['StockholdersEquity'],totalAssets:['Assets']};
type Fact={start:string|null;end:string;filed:string;value:number;currency:string;accession:string};
/** SEC facts retain their actual fiscal start/end and filing date. Standalone
 * quarters are accepted by duration, not by fp/frame labels. YTD is differenced
 * only within the same fiscal start, tag and currency with a 70–110 day step. */
export function analyticsFundamentalsFromSec(symbol:string,input:unknown,now=Date.now()):AnalyticsFundamentalInput|null {
  const raw=object(input),expected=SEC_CIKS[symbol],cik=String(raw.cik??'').padStart(10,'0');if(!expected||cik!==expected)return null;
  const cutoff=new Date(now).toISOString().slice(0,10),taxonomy=object(raw.facts?.['us-gaap']),rows=new Map<string,AnalyticsFundamentalInput['rows'][number]>(),capexTags=new Set<string>();let derived=0;
  const write=(metric:AnalyticsMetric,fact:Fact,periodType:'3M'|'12M',value:number,tag:string)=>{
    const id=fact.end+':'+periodType+':'+fact.currency,row=rows.get(id)??{date:fact.end,currency:fact.currency,filingDate:fact.filed,periodType,values:{}};
    if(row.values[metric]!==undefined)return;row.values[metric]=metric==='capex'?Math.abs(value):value;
    if(metric==='capex')capexTags.add(tag);
    if(!row.filingDate||fact.filed>row.filingDate)row.filingDate=fact.filed;rows.set(id,row);
  };
  for(const [metric,tags]of Object.entries(SEC_TAGS) as [AnalyticsMetric,string[]][]){
    // Prefer the first taxonomy tag per fiscal end, but never mix tags to
    // deaccumulate two incompatible accounting definitions.
    for(const tag of tags){
      const units=object(taxonomy[tag]?.units);
      for(const [currency,values]of Object.entries(units)){
        if(!money(currency)||!Array.isArray(values))continue;
        const latest=new Map<string,Fact>(),conflicting=new Map<string,string>();
        for(const f of values.slice(0,20000)){
          if(!day(f?.end)||!day(f?.filed)||f.end>cutoff||f.filed>cutoff||!finite(f.val)||!['10-Q','10-Q/A','10-K','10-K/A'].includes(f.form)||f.start!==undefined&&!day(f.start))continue;
          if(f.start&&f.start>f.end)continue;
          const item:Fact={start:f.start??null,end:f.end,filed:f.filed,value:f.val,currency,accession:typeof f.accn==='string'?f.accn:''},key=(f.start??'instant')+':'+f.end,prior=latest.get(key),conflict=conflicting.get(key);
          if(conflict&&conflict>=item.filed)continue;
          if(conflict&&conflict<item.filed)conflicting.delete(key);
          if(!prior||prior.filed<item.filed)latest.set(key,item);
          else if(prior.filed===item.filed&&prior.value!==item.value){latest.delete(key);conflicting.set(key,item.filed);}
        }
        const facts=[...latest.values()].sort((a,b)=>a.end.localeCompare(b.end));
        for(const f of facts){
          if(STOCKS.has(metric)){if(!f.start){write(metric,f,'3M',f.value,tag);write(metric,f,'12M',f.value,tag);}continue;}
          if(!f.start)continue;const duration=(Date.parse(f.end)-Date.parse(f.start))/DAY+1;
          if(duration>=70&&duration<=110)write(metric,f,'3M',f.value,tag);
          if(duration>=340&&duration<=385)write(metric,f,'12M',f.value,tag);
          if(duration>110&&duration<=385){
            const previous=facts.filter(p=>p.start===f.start&&p.end<f.end&&p.filed<=f.filed&&p.currency===f.currency&&Date.parse(f.end)-Date.parse(p.end)>=70*DAY&&Date.parse(f.end)-Date.parse(p.end)<=110*DAY).sort((a,b)=>b.end.localeCompare(a.end))[0];
            if(previous){write(metric,f,'3M',f.value-previous.value,tag);derived++;}
          }
        }
      }
    }
  }
  for(const row of rows.values())if(finite(row.values.operatingCashFlow)&&finite(row.values.capex))row.values.freeCashFlow=row.values.operatingCashFlow-row.values.capex;
  // A balance-sheet instant alone does not prove that a 3M or 12M flow exists.
  const all=[...rows.values()].filter(row=>Object.keys(row.values).some(k=>!STOCKS.has(k))).sort((a,b)=>a.date.localeCompare(b.date));
  if(!all.length)return null;
  return {symbol,rows:all,source:source('sec:financials:'+cik,'SEC EDGAR · cuentas publicadas','https://www.sec.gov/edgar/browse/?CIK='+Number(cik),all.at(-1)!.date,now,true),notes:[...(derived?['Los flujos acumulados YTD se convierten en trimestres independientes mediante diferencias dentro del mismo ejercicio fiscal, concepto y moneda; el cuarto trimestre puede derivarse del anual menos nueve meses.']:[]),...(capexTags.has('PaymentsToAcquireProductiveAssets')?['CapEx total de '+symbol+': el concepto publicado PaymentsToAcquireProductiveAssets incluye inmovilizado, software y otros intangibles. Su perímetro puede ser más amplio que el de empresas que solo presentan pagos por inmovilizado físico; no se trata de CapEx exclusivo de IA.']:[]),'Se usa la última cifra publicada disponible a fecha de consulta; no es una base de datos histórica libre de revisiones. El CapEx recoge pagos por inversión en activos, no un desglose de IA.']};
}

async function boundedJson(url:string,headers:Record<string,string>={},maxBytes=12000000):Promise<any|null>{
  try{const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok){await response.body?.cancel();return null;}
    const reader=response.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[],decoder=new TextDecoder();let bytes=0;
    try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>maxBytes)return null;chunks.push(r.value);}}finally{await reader.cancel();}
    return JSON.parse(chunks.map(c=>decoder.decode(c,{stream:true})).join('')+decoder.decode());
  }catch{return null;}
}
const secPending:(()=>void)[]=[];let secActive=0;
async function secRead(cik:string){if(secActive>=2)await new Promise<void>(r=>secPending.push(r));secActive++;try{let userAgent='MensorTerminal/1.0 (https://sftmvpppp.vercel.app/)';try{const configured=(globalThis as any).Deno?.env?.get('ANALYTICS_SEC_USER_AGENT');if(typeof configured==='string'&&configured.length<=250&&!/[\r\n]/.test(configured))userAgent=configured;}catch{/* truthful public application URL remains */}return await boundedJson('https://data.sec.gov/api/xbrl/companyfacts/CIK'+cik+'.json',{'User-Agent':userAgent,'Accept':'application/json'});}finally{secActive--;secPending.shift()?.();}}
type FundamentalOptions={timeseries?:(symbol:string)=>Promise<unknown[]|null>};
/** Fill absent fields only on the exact same fiscal date/type/currency. Every
 * inserted value retains its real source; never copy a different quarter. */
export function mergeAnalyticsFundamentals(primary:AnalyticsFundamentalInput|null,fallback:AnalyticsFundamentalInput|null):AnalyticsFundamentalInput|null{
  if(!primary)return fallback;if(!fallback||fallback.symbol!==primary.symbol)return primary;
  const rows=new Map(primary.rows.map(row=>[row.date+':'+row.periodType+':'+row.currency,{...row,values:{...row.values},valueSourceIds:Object.fromEntries(Object.keys(row.values).map(k=>[k,row.valueSourceIds?.[k as AnalyticsMetric]??primary.source.id]))}]));
  for(const row of fallback.rows){const key=row.date+':'+row.periodType+':'+row.currency,old=rows.get(key);
    if(!old){rows.set(key,{...row,values:{...row.values},valueSourceIds:Object.fromEntries(Object.keys(row.values).map(k=>[k,row.valueSourceIds?.[k as AnalyticsMetric]??fallback.source.id]))});continue;}
    for(const [metric,value]of Object.entries(row.values))if(!finite(old.values[metric as AnalyticsMetric])&&finite(value)){old.values[metric as AnalyticsMetric]=value;old.valueSourceIds[metric]=row.valueSourceIds?.[metric as AnalyticsMetric]??fallback.source.id;if(row.filingDate&&(!old.filingDate||row.filingDate>old.filingDate))old.filingDate=row.filingDate;}
  }
  return {symbol:primary.symbol,source:primary.source,sources:[...new Map([primary.source,...(primary.sources??[]),fallback.source,...(fallback.sources??[])].map(s=>[s.id,s])).values()],rows:[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)),notes:[...new Set([...(primary.notes??[]),...(fallback.notes??[]),'Las ausencias se completan con otra fuente solo para la misma fecha fiscal, duración y moneda; la atribución se conserva por observación.'])]};
}
export function analyticsFundamentalsFromEodhd(symbol:string,raw:Row,now=Date.now()):AnalyticsFundamentalInput|null{
  const flow=new Map(Object.values(object(raw.Financials?.Cash_Flow?.quarterly)).map((r:any)=>[r.date,r])),allowed=(date:string)=>{const row=flow.get(date);if(!row)return false;const start=row.startDate??row.start_date??row.start;return row.periodType==='3M'||row.period_type==='3M'||day(start)&&day(row.date)&&(Date.parse(row.date)-Date.parse(start))/DAY>=69&&(Date.parse(row.date)-Date.parse(start))/DAY<=110;};
  const quarterly=normalizeEodhdTimeseries(raw,symbol).map(series=>{
    const type=series.meta?.type?.[0];return ['quarterlyOperatingCashFlow','quarterlyFreeCashFlow','quarterlyCapitalExpenditure'].includes(type)?{...series,[type]:series[type].filter((p:any)=>allowed(p.asOfDate))}:series;
  }),annual=eodhdAnnual(raw).map(s=>({...s,meta:{...s.meta,symbol:[symbol]}}));
  const normalized=analyticsFundamentalsFromTimeseries(symbol,[...quarterly,...annual],source('eodhd:financials:'+symbol,'EODHD · estados financieros publicados','https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds',raw.General?.UpdatedAt??null,now),now);
  if(normalized)normalized.notes=[...(normalized.notes??[]),'Los flujos trimestrales de EODHD sin duración explícita se excluyen para evitar confundir acumulados YTD con trimestres.'];return normalized;
}
export async function analyticsFundamentals(symbol:string,from:string,to:string,options:FundamentalOptions={}):Promise<AnalyticsFundamentalInput|null>{
  if(!symbolOk(symbol)||!day(from)||!day(to))return null;
  return cached('analytics-fund-v2:'+symbol,6*3600000,async()=>{
    const now=Date.now(),raw=await eodhdFundamentalRaw(symbol);
    let normalized=raw?analyticsFundamentalsFromEodhd(symbol,raw,now):null;
    if(SEC_CIKS[symbol]){const sec=await secRead(SEC_CIKS[symbol]);normalized=mergeAnalyticsFundamentals(normalized,analyticsFundamentalsFromSec(symbol,sec,now));}
    const metrics=['revenue','netIncome','capex','operatingCashFlow'];
    if(normalized&&metrics.every(metric=>normalized!.rows.some(row=>row.periodType==='3M'&&finite(row.values[metric as AnalyticsMetric]))))return normalized;
    let ts:unknown[]|null=null;
    if(options.timeseries)try{ts=await options.timeseries(symbol);}catch{/* keep fallback independent */}
    else {
      const types=Object.values(FIELDS).flatMap(field=>['quarterly'+field,'annual'+field]).join(','),start=Math.floor((now-7*366*DAY)/1000),end=Math.floor(now/1000);
      const url='https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/'+encodeURIComponent(symbol)+'?symbol='+encodeURIComponent(symbol)+'&type='+types+'&period1='+start+'&period2='+end+'&merge=false';
      const yahoo=await boundedJson(url,{'User-Agent':'Mozilla/5.0'},4000000);ts=Array.isArray(yahoo?.timeseries?.result)?yahoo.timeseries.result:null;
    }
    return mergeAnalyticsFundamentals(normalized,analyticsFundamentalsFromTimeseries(symbol,ts,undefined,now));
  });
}
export async function analyticsFx(from:string,to:string,dates:string[]):Promise<{date:string;rate:number;source?:AnalyticsSource}[]>{
  if(!money(from)||!money(to)||!dates.length||dates.some(d=>!day(d)))return [];
  const unique=[...new Set(dates)].sort();if(from===to)return unique.map(date=>({date,rate:1}));
  // Direct currency pair only. No implicit inversion, GBX/GBP guessing or
  // carry-forward is used when an exact dated observation is unavailable.
  const p=await analyticsPrices(from+to+'=X',unique[0],unique.at(-1)!);if(!p||p.currency!==to)return [];
  return p.points.filter(point=>unique.includes(point.date)).map(point=>({date:point.date,rate:point.value,source:p.source}));
}

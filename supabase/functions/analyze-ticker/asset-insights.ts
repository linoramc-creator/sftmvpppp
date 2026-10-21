import {cached} from './panels.ts';
import {eodhdFundamentalRaw,normalizeEodhdQuarterly} from './eodhd-fundamentals.ts';
import {marketJson} from './eodhd-market-fetch.ts';
import {instrumentInfo,type InstrumentKind} from './asset-instrument.ts';
import {regularSessionEnd} from './market-session.ts';

type Row=Record<string,any>;
export type AssetInsightMetric={id:string;label:string;value:number;unit:'currency'|'percent'|'multiple'|'count';currency:string|null;period:'TTM'|'latest-quarter'|'record'|'fund';periodEnd:string|null};
export type AssetFinancialPoint={period:string;filingDate:string|null;currency:string|null;revenue:number|null;freeCashFlow:number|null;fcfMarginPct:number|null;grossMarginPct:number|null;operatingCashFlow:number|null;netIncome:number|null;cash:number|null;totalDebt:number|null;netDebt:number|null};
export type MonthlyReturn={year:number;month:number;returnPct:number;partial:boolean;from:string;to:string};
export type PriceStudy={from:string|null;to:string|null;observations:number;adjustment:'adjusted-close'|'price';annualizationDays:number;monthlyReturns:MonthlyReturn[];underwater:{date:string;drawdownPct:number;sessionsUnderwater:number}[];summary:{currentDrawdownPct:number|null;maximumDrawdownPct:number|null;currentSessionsUnderwater:number|null;longestSessionsUnderwater:number|null;trendEfficiency20Pct:number|null;trendDirection20:'up'|'down'|'flat'|null;sortino:number|null;downsideAnnualizedPct:number|null;upsideAnnualizedPct:number|null;returnSamples:number}};
export type AssetInsights={symbol:string;fetchedAt:string;profile:{name:string|null;kind:InstrumentKind;description:string|null;sector:string|null;industry:string|null;country:string|null;currency:string|null;financialCurrency:string|null;exchange:string|null;employees:number|null;updatedAt:string|null};metrics:AssetInsightMetric[];financials:{unit:'millions';scale:1000000;frequency:'quarterly';rows:AssetFinancialPoint[]};fund:{benchmark:string|null;manager:string|null;category:string|null;holdingsCount:number|null;inceptionDate:string|null;topHoldings:{symbol:string;name:string;weightPct:number}[];sectorWeights:{name:string;weightPct:number}[];regions:{name:string;weightPct:number}[];topTenWeightPct:number|null}|null;priceStudy:PriceStudy};
const record=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const text=(value:unknown,max=400)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
const num=(value:unknown):number|null=>{if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string'||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const day=(value:unknown):string|null=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const currency=(value:unknown)=>{const v=text(value,12);return v&&/^[A-Z]{3}$/.test(v)?v:null;};
const safeDay=(value:unknown,cutoff:string)=>{const d=day(value);return d&&d<=cutoff?d:null;};
const million=(value:number|null)=>value===null?null:value/1000000;

/** Consistent closing observations only: equities/funds require adjusted closes.
 * An unfinished session and the synthetic appended quote are never daily bars.
 * No adjustment, FX, institutional-flow or risk-free-rate assumptions are made.
 */
export function buildAssetPriceStudy(chartInput:unknown,symbol:string,now=Date.now()):PriceStudy{
 const chart=record(chartInput),meta=record(chart.meta),info=instrumentInfo(meta,symbol),quote=record(chart.indicators?.quote?.[0]),adjusted=chart.indicators?.adjclose?.[0]?.adjclose;
 const requiresAdjustment=!['index','future','forex','crypto'].includes(info.kind),annualizationDays=info.kind==='crypto'?365:252;
 let zone=text(meta.exchangeTimezoneName)??'UTC';try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{zone='UTC';}
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}),dateAt=(t:number)=>formatter.format(t);
 const today=dateAt(now),end=regularSessionEnd(meta,symbol),closedToday=finite(end)&&end*1000<=now&&dateAt(end*1000)===today,points=new Map<string,number>();
 let inconsistentAdjustment=false;
 const timestamps=Array.isArray(chart.timestamp)?chart.timestamp:[];
 for(let i=0;i<timestamps.length;i++){
  const t=timestamps[i];if(!finite(t)||t<=0||t*1000>now)continue;
  const date=dateAt(t*1000),close=quote.close?.[i];if(date>today||date===today&&!closedToday||!finite(close)||close<=0)continue;
  if(points.has(date)&&t===meta.regularMarketTime)continue;
  const value=requiresAdjustment?adjusted?.[i]:close;
  if(!finite(value)||value<=0){if(requiresAdjustment)inconsistentAdjustment=true;continue;}
  points.set(date,value);
 }
 const rows=inconsistentAdjustment?[]:[...points].map(([date,value])=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date));
 const returns=rows.slice(1).map((row,i)=>row.value/rows[i].value-1),recent=returns.slice(-252),samples=recent.length;
 const downside=samples>=60?Math.sqrt(recent.reduce((sum,r)=>sum+Math.min(r,0)**2,0)/samples)*Math.sqrt(annualizationDays):null;
 const upside=samples>=60?Math.sqrt(recent.reduce((sum,r)=>sum+Math.max(r,0)**2,0)/samples)*Math.sqrt(annualizationDays):null;
 const negativeCount=recent.filter(r=>r<0).length,mean=samples?recent.reduce((sum,r)=>sum+r,0)/samples:null;
 const sortino=downside!==null&&downside>0&&negativeCount>=10&&mean!==null?mean*annualizationDays/downside:null;
 const trend=rows.slice(-21),trendMoves=trend.slice(1).map((r,i)=>Math.log(r.value/trend[i].value)),path=trendMoves.reduce((sum,r)=>sum+Math.abs(r),0),direction=trend.length===21?Math.log(trend.at(-1)!.value/trend[0].value):null;
 const underwater:PriceStudy['underwater']=[];let peak=0,duration=0,longest=0,worst=0;
 for(const row of rows){if(row.value>=peak){peak=row.value;duration=0;}else duration++;const drawdownPct=(row.value/peak-1)*100;worst=Math.min(worst,drawdownPct);longest=Math.max(longest,duration);underwater.push({date:row.date,drawdownPct,sessionsUnderwater:duration});}
 const months=new Map<string,typeof rows[number]>();for(const row of rows)months.set(row.date.slice(0,7),row);
 const monthlyReturns:MonthlyReturn[]=[],monthly=[...months.entries()];
 for(let i=1;i<monthly.length;i++){
  const [month,row]=monthly[i],[previousMonth,previous]=monthly[i-1],y=Number(month.slice(0,4)),m=Number(month.slice(5,7));
  // A missing whole month cannot masquerade as a one-month observation.
  if((y*12+m)-(Number(previousMonth.slice(0,4))*12+Number(previousMonth.slice(5,7)))!==1)continue;
  // A following month's observation proves the earlier month closed. For the
  // last month, only a calendar-month-end observation can prove completeness
  // without introducing an exchange/holiday-calendar request.
  const calendarEnd=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  monthlyReturns.push({year:y,month:m,returnPct:(row.value/previous.value-1)*100,partial:i===monthly.length-1&&row.date<calendarEnd,from:previous.date,to:row.date});
 }
 const last=underwater.at(-1);
 return {from:rows[0]?.date??null,to:rows.at(-1)?.date??null,observations:rows.length,adjustment:requiresAdjustment?'adjusted-close':'price',annualizationDays,monthlyReturns,underwater,summary:{currentDrawdownPct:last?.drawdownPct??null,maximumDrawdownPct:rows.length?worst:null,currentSessionsUnderwater:last?.sessionsUnderwater??null,longestSessionsUnderwater:rows.length?longest:null,trendEfficiency20Pct:direction!==null?(path>0?Math.min(100,Math.abs(direction)/path*100):0):null,trendDirection20:direction===null?null:direction>0?'up':direction<0?'down':'flat',sortino,downsideAnnualizedPct:downside===null?null:downside*100,upsideAnnualizedPct:upside===null?null:upside*100,returnSamples:samples}};
}

/** Chart-ready, dated reported fundamentals. Monetary financial series are in
 * millions in each observation's statement currency, never trading currency.
 */
export function buildAssetInsights(rawInput:unknown,dailyChart:unknown,symbol:string,now=Date.now()):AssetInsights{
 const raw=record(rawInput),g=record(raw.General),h=record(raw.Highlights),v=record(raw.Valuation),etf=record(raw.ETF_Data),cutoff=new Date(now).toISOString().slice(0,10);
 const rawKind=String(g.Type??'').toUpperCase(),kind:InstrumentKind=rawKind==='ETF'?'etf':/COMMON STOCK|PREFERRED STOCK|EQUITY/.test(rawKind)?'equity':instrumentInfo(record(record(dailyChart).meta),symbol).kind;
 const quotedCurrency=currency(g.CurrencyCode)??currency(record(record(dailyChart).meta).currency),statementCurrency=currency(raw.Financials?.Income_Statement?.currency_symbol)??currency(raw.Financials?.Balance_Sheet?.currency_symbol)??currency(raw.Financials?.Cash_Flow?.currency_symbol);
 const updatedAt=safeDay(g.UpdatedAt,cutoff),periodEnd=safeDay(h.MostRecentQuarter,cutoff),metrics:AssetInsightMetric[]=[],metricsForStock=kind==='equity';
 const add=(id:string,label:string,value:unknown,unit:AssetInsightMetric['unit'],money:string|null=null,period:AssetInsightMetric['period']='record',at:string|null=updatedAt,scale=1)=>{const n=num(value);if(n===null||unit==='currency'&&!money)return;metrics.push({id,label,value:n*scale,unit,currency:money,period,periodEnd:at});};
 if(metricsForStock){
  add('marketCap','Capitalización bursátil',h.MarketCapitalization,'currency',quotedCurrency);
  add('enterpriseValue','Valor de empresa',v.EnterpriseValue,'currency',quotedCurrency);
  add('revenueTtm','Ingresos · doce meses',h.RevenueTTM,'currency',statementCurrency,'TTM',periodEnd);
  add('operatingMargin','Margen operativo',h.OperatingMarginTTM,'percent',null,'TTM',periodEnd,100);
  add('profitMargin','Margen neto',h.ProfitMargin,'percent',null,'TTM',periodEnd,100);
  add('roe','Rentabilidad sobre patrimonio',h.ReturnOnEquityTTM,'percent',null,'TTM',periodEnd,100);
  add('revenueGrowth','Crecimiento de ingresos interanual',h.QuarterlyRevenueGrowthYOY,'percent',null,'latest-quarter',periodEnd,100);
  add('evEbitda','Valor de empresa / EBITDA',v.EnterpriseValueEbitda,'multiple');
  add('forwardPe','PER previsto',v.ForwardPE,'multiple');
 }
 if(kind==='etf'){
  add('assets','Patrimonio del fondo',etf.TotalAssets,'currency',quotedCurrency,'fund');
  add('expenseRatio','Gastos anuales',etf.NetExpenseRatio,'percent',null,'fund',updatedAt,100);
  add('distributionYield','Rendimiento de distribución',etf.Yield,'percent',null,'fund');
  add('holdingsCount','Posiciones',etf.Holdings_Count,'count',null,'fund');
  add('portfolioPe','PER de la cartera previsto',record(etf.Valuations_Growth?.Valuations_Rates_Portfolio)['Price/Prospective Earnings'],'multiple',null,'fund');
  add('portfolioPb','Precio / patrimonio de la cartera',record(etf.Valuations_Growth?.Valuations_Rates_Portfolio)['Price/Book'],'multiple',null,'fund');
 }
 const quarters=metricsForStock?normalizeEodhdQuarterly(raw,12,now):[];
 const financials:AssetInsights['financials']={unit:'millions',scale:1000000,frequency:'quarterly',rows:quarters.map(q=>{const n=q.numeric;return {period:q.period,filingDate:q.filingDate,currency:q.currency,revenue:million(n.revenue),freeCashFlow:million(n.freeCashFlow),fcfMarginPct:n.revenue!==null&&n.revenue>0&&n.freeCashFlow!==null?n.freeCashFlow/n.revenue*100:null,grossMarginPct:n.revenue!==null&&n.revenue>0&&n.grossProfit!==null?n.grossProfit/n.revenue*100:null,operatingCashFlow:million(n.operatingCF),netIncome:million(n.netIncome),cash:million(n.cash),totalDebt:million(n.totalDebt),netDebt:million(n.netDebt)};}).reverse()};
 const weights=(input:unknown)=>Object.entries(record(input)).flatMap(([name,row])=>{const weight=num(record(row)['Equity_%']);return weight===null?[]:[{name,weightPct:weight}];}).sort((a,b)=>b.weightPct-a.weightPct);
 const holdingRows=Object.keys(record(etf.Top_10_Holdings)).length?record(etf.Top_10_Holdings):record(etf.Holdings);
 const topHoldings=Object.entries(holdingRows).flatMap(([key,value])=>{const row=record(value),weight=num(row['Assets_%']),name=text(row.Name,240),code=text(row.Code,40),exchange=text(row.Exchange,16),holdingSymbol=code&&exchange?`${code}.${exchange}`:key;if(weight===null||!name||!/^[A-Z0-9][A-Z0-9.-]{0,40}$/i.test(holdingSymbol))return [];return [{symbol:holdingSymbol.toUpperCase().replace(/\.US$/,''),name,weightPct:weight}];}).sort((a,b)=>b.weightPct-a.weightPct).slice(0,10);
 const fund:AssetInsights['fund']=kind==='etf'?{benchmark:text(etf.Index_Name,240),manager:text(etf.Company_Name,240),category:text(g.Category,160),holdingsCount:num(etf.Holdings_Count),inceptionDate:safeDay(etf.Inception_Date,cutoff),topHoldings,sectorWeights:weights(etf.Sector_Weights),regions:weights(etf.World_Regions),topTenWeightPct:topHoldings.length===10?topHoldings.reduce((sum,h)=>sum+h.weightPct,0):null}:null;
 return {symbol,fetchedAt:new Date(now).toISOString(),profile:{name:text(g.Name,300)??text(record(record(dailyChart).meta).longName,300),kind,description:text(g.Description,16000),sector:text(g.Sector,160),industry:text(g.Industry,240),country:kind==='etf'?text(etf.Domicile,100):text(g.AddressData?.Country,100),currency:quotedCurrency,financialCurrency:statementCurrency,exchange:text(g.Exchange,40),employees:num(g.FullTimeEmployees),updatedAt},metrics,financials,fund,priceStudy:buildAssetPriceStudy(dailyChart,symbol,now)};
}

type Dependencies={fundamentals?:typeof eodhdFundamentalRaw;read?:typeof marketJson;now?:number};
/** At most one cached fundamentals read and one cached two-year daily read;
 * no model generation, ticker universe crawl or benchmark request is needed.
 */
export async function loadAssetInsights(symbol:string,deps:Dependencies={}):Promise<AssetInsights>{
 const now=deps.now??Date.now(),read=deps.read??marketJson,fundamentals=deps.fundamentals??eodhdFundamentalRaw;
 const [raw,history]=await Promise.allSettled([fundamentals(symbol),read(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error'},{timeoutMs:8000,acceptPrimary:value=>buildAssetPriceStudy(value?.chart?.result?.[0],symbol,now).observations>=2})]);
 return buildAssetInsights(raw.status==='fulfilled'?raw.value:null,history.status==='fulfilled'?history.value?.chart?.result?.[0]:null,symbol,now);
}
export async function assetInsights(symbol:string):Promise<AssetInsights>{return cached('asset-insights-v1:'+symbol,300000,()=>loadAssetInsights(symbol));}

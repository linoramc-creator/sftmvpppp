import type {History} from './relative-comparison.ts';
import type {StockRadarHistory} from './stock-research-radar.ts';

type Row=Record<string,any>;
export type StockRadarFallbackDependencies={summary:(symbol:string,modules:string)=>Promise<Row|null>;timeseries:(symbol:string)=>Promise<unknown[]|null>;history?:(symbol:string)=>Promise<History|null>;fmpRead?:(path:string,query:Record<string,string|number>)=>Promise<unknown>;now?:number};
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const num=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:v&&typeof v==='object'?num((v as Row).raw):typeof v==='string'&&/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const text=(v:unknown,max=300)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
const day=(v:unknown,now:number)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&Date.parse(v)<=now?v:null;
const symbolOk=(s:string)=>/^[A-Z][A-Z0-9-]{0,15}$/.test(s);
const currency=(v:unknown)=>typeof v==='string'&&/^[A-Z]{3}$/.test(v)?v:null;
const TYPES={quarterlyTotalRevenue:['income','totalRevenue'],quarterlyNetIncome:['income','netIncome'],quarterlyGrossProfit:['income','grossProfit'],quarterlyEBITDA:['income','ebitda'],quarterlyOperatingCashFlow:['cash','totalCashFromOperatingActivities'],quarterlyFreeCashFlow:['cash','freeCashFlow'],quarterlyCapitalExpenditure:['cash','capitalExpenditures'],quarterlyCashAndCashEquivalents:['balance','cashAndEquivalents'],quarterlyTotalDebt:['balance','shortLongTermDebtTotal'],quarterlyStockholdersEquity:['balance','totalStockholderEquity'],quarterlyTotalAssets:['balance','totalAssets']} as const;
const SECTORS:Record<string,string>={'Consumer Cyclicals':'Consumer Cyclical','Consumer Discretionary':'Consumer Cyclical','Consumer Staples':'Consumer Defensive','Health Care':'Healthcare','Information Technology':'Technology',Materials:'Basic Materials','Financials':'Financial Services'};

function envelope(symbol:string,summary:Row|null,now:number):Row|null{
 const q=object(summary?.quoteType),p=object(summary?.price),profile=object(summary?.assetProfile),type=text(q.quoteType||p.quoteType),actual=text(q.symbol||p.symbol).toUpperCase(),c=currency(p.currency);
 const stamp=num(p.regularMarketTime);if(!symbolOk(symbol)||actual!==symbol||!['EQUITY','ETF'].includes(type)||!c||stamp===null||stamp<=0||stamp*1000>now||now-stamp*1000>7*86400000)return null;
 // Quote date anchors market data; capture date never becomes a statement,
 // forecast or holdings publication date. Exact fiscal dates stay in rows.
 return {General:{Code:symbol,Type:type==='ETF'?'ETF':'Common Stock',Name:text(q.longName||p.longName||q.shortName||p.shortName),CurrencyCode:c,UpdatedAt:new Date(stamp*1000).toISOString().slice(0,10),Sector:SECTORS[text(profile.sector)]??text(profile.sector),Industry:text(profile.industry),Description:text(profile.longBusinessSummary,16000),Exchange:text(q.exchange||p.exchangeName)},Highlights:{MarketCapitalization:num(p.marketCap)??num(summary?.summaryDetail?.marketCap)},Valuation:{ForwardPE:num(summary?.summaryDetail?.forwardPE)??num(summary?.defaultKeyStatistics?.forwardPE)},_radarFallback:{capturedAt:new Date(now).toISOString(),recordDateBasis:'quote-date',publicationDate:null,holdingsPublicationDate:null,forecastsAvailable:false}};
}

/** Preserve only true quarterly observations, exact dates and statement
 * currencies. No annual/YTD division, fuzzy matching or formatted numbers. */
export function stockRadarRawFromYahoo(symbol:string,summary:Row|null,series:unknown,now=Date.now()):Row|null{
 const raw=envelope(symbol,summary,now);if(!raw)return null;
 if(raw.General.Type==='ETF'){
  const holdings=Array.isArray(summary?.topHoldings?.holdings)?summary!.topHoldings.holdings:[],rows:Row={};
  for(const input of holdings.slice(0,50)){const row=object(input),s=text(row.symbol).toUpperCase(),weight=num(row.holdingPercent);if(!symbolOk(s)||weight===null||weight<=0||weight>1)continue;rows[s+'.US']={Code:s,Exchange:'US',Name:text(row.holdingName),Sector:SECTORS[text(row.sector)]??text(row.sector),'Assets_%':weight*100};}
  raw.ETF_Data={Holdings:rows};return raw;
 }
 const baseCurrency=currency(summary?.financialData?.financialCurrency),blocks:{income:Row;cash:Row;balance:Row}={income:{},cash:{},balance:{}},conflicts=new Set<string>();
 if(Array.isArray(series))for(const value of series.slice(0,40)){
  const row=object(value),type=row.meta?.type?.[0] as keyof typeof TYPES,mapping=Object.hasOwn(TYPES,type)?TYPES[type]:null;if(!mapping||!Array.isArray(row[type]))continue;
  for(const input of row[type].slice(0,40)){const point=object(input),at=day(point.asOfDate,now),amount=num(point.reportedValue),code=currency(point.currencyCode)||baseCurrency;if(!at||amount===null||!code||point.periodType&&point.periodType!=='3M')continue;
   const block=blocks[mapping[0]],existing=block[at],key=mapping[0]+':'+mapping[1]+':'+at;if(conflicts.has(key))continue;if(existing&&existing.currency_symbol!==code){if(existing[mapping[1]]!==undefined){delete existing[mapping[1]];conflicts.add(key);}continue;}
   const observation=block[at]??{date:at,filing_date:null,currency_symbol:code};if(observation[mapping[1]]!==undefined&&observation[mapping[1]]!==amount){delete observation[mapping[1]];conflicts.add(key);continue;}observation[mapping[1]]=amount;block[at]=observation;
  }
 }
 const statementCurrency=baseCurrency??currency(Object.values(blocks.income).find((r:any)=>r.currency_symbol)?.currency_symbol);
 raw.Financials={Income_Statement:{currency_symbol:statementCurrency,quarterly:blocks.income},Cash_Flow:{currency_symbol:statementCurrency,quarterly:blocks.cash},Balance_Sheet:{currency_symbol:statementCurrency,quarterly:blocks.balance}};
 const latest=Object.keys(blocks.income).sort().at(-1);if(latest)raw.Highlights.MostRecentQuarter=latest;
 return raw;
}

function publishedQuarter(input:unknown,symbol:string,now:number):Row|null{
 const row=object(input),at=day(row.date,now),published=day(text(row.filingDate||row.fillingDate,10),now),c=currency(row.reportedCurrency);
 if(row.symbol!==symbol||!at||!published||published<at||!c||!/^Q[1-4]$/.test(String(row.period)))return null;
 return {...row,date:at,filingDate:published,reportedCurrency:c};
}
export function stockRadarRawFromFmp(symbol:string,profileInput:unknown,income:unknown,cash:unknown,balance:unknown=[],now=Date.now(),quoteInput:unknown=null):Row|null{
 const profile=object(Array.isArray(profileInput)?profileInput[0]:profileInput),c=currency(profile.currency);
 const quote=object(Array.isArray(quoteInput)?quoteInput.find(r=>r?.symbol===symbol):quoteInput),stamp=num(quote.timestamp??profile.timestamp);
 if(!symbolOk(symbol)||profile.symbol!==symbol||profile.isEtf||profile.isFund||!c||!text(profile.companyName)||quote.symbol&&quote.symbol!==symbol||stamp===null||stamp<=0||stamp*1000>now||now-stamp*1000>7*86400000)return null;
 const raw:Row={General:{Code:symbol,Type:'Common Stock',Name:text(profile.companyName),CurrencyCode:c,UpdatedAt:new Date(stamp*1000).toISOString().slice(0,10),Sector:SECTORS[text(profile.sector)]??text(profile.sector),Industry:text(profile.industry),CIK:text(profile.cik)},Highlights:{MarketCapitalization:num(quote.marketCap??profile.marketCap??profile.mktCap)},Valuation:{},_radarFallback:{capturedAt:new Date(now).toISOString(),recordDateBasis:'quote-date',publicationDate:null,forecastsAvailable:false}};
 const convert=(data:unknown,fields:Record<string,string[]>)=>{const rows:Row={},conflicts=new Set<string>();if(!Array.isArray(data))return rows;for(const input of data.slice(0,30)){const row=publishedQuarter(input,symbol,now);if(!row||conflicts.has(row.date))continue;const record:Row={date:row.date,filing_date:row.filingDate,currency_symbol:row.reportedCurrency};for(const [target,alternatives]of Object.entries(fields)){const value=alternatives.map(key=>num(row[key])).find(v=>v!==null);if(value!==undefined)record[target]=value;}if(rows[row.date]){if(JSON.stringify(rows[row.date])!==JSON.stringify(record)){delete rows[row.date];conflicts.add(row.date);}}else rows[row.date]=record;}return rows;};
 const incomeRows=convert(income,{totalRevenue:['revenue'],netIncome:['netIncome'],grossProfit:['grossProfit'],ebitda:['ebitda']}),cashRows=convert(cash,{totalCashFromOperatingActivities:['operatingCashFlow','netCashProvidedByOperatingActivities'],freeCashFlow:['freeCashFlow'],capitalExpenditures:['capitalExpenditure']}),balanceRows=convert(balance,{cashAndEquivalents:['cashAndCashEquivalents'],shortLongTermDebtTotal:['totalDebt'],totalStockholderEquity:['totalStockholdersEquity','totalEquity'],totalAssets:['totalAssets']});
 const financialCurrency=Object.values(incomeRows).find((r:any)=>r.currency_symbol)?.currency_symbol??null;
 raw.Financials={Income_Statement:{currency_symbol:financialCurrency,quarterly:incomeRows},Cash_Flow:{currency_symbol:financialCurrency,quarterly:cashRows},Balance_Sheet:{currency_symbol:financialCurrency,quarterly:balanceRows}};const latest=Object.keys(incomeRows).sort().at(-1);if(latest)raw.Highlights.MostRecentQuarter=latest;
 return raw;
}

export function stockRadarHistoryFromRelative(symbol:string,expectedCurrency:string,input:History|null,now=Date.now()):StockRadarHistory|null{
 if(!input||input.symbol!==symbol||input.currency!==expectedCurrency||!['stock','etf'].includes(input.kind)||!Array.isArray(input.dates)||input.dates.length!==input.closes.length||input.dates.length!==input.raw.length)return null;
 const points:StockRadarHistory['points']=[];for(let i=0;i<input.dates.length&&i<600;i++){const at=day(input.dates[i],now),adjusted=num(input.closes[i]),close=num(input.raw[i]),volume=num(input.volumes[i]);if(!at||adjusted===null||adjusted<=0||close===null||close<=0)continue;points.push({date:at,adjustedClose:adjusted,close,volume:volume!==null&&volume>=0?volume:null});}
 return points.length?{symbol,currency:input.currency,points}:null;
}
const hasStatements=(raw:Row|null)=>Object.keys(object(raw?.Financials?.Income_Statement?.quarterly)).length>=5&&Object.keys(object(raw?.Financials?.Cash_Flow?.quarterly)).length>=4;
/** Transport injection reuses the authenticated server readers. It never asks
 * Gemini to reconstruct statements and never imports the HTTP entry point. */
export function createStockRadarFallback(deps:StockRadarFallbackDependencies){
 const clock=()=>deps.now??Date.now(),pending=new Map<string,{expires:number;task:Promise<Row|null>}>();
 const fundamentals=(symbol:string):Promise<Row|null>=>{
  if(!symbolOk(symbol))return Promise.resolve(null);const now=clock(),hit=pending.get(symbol);if(hit&&hit.expires>now)return hit.task;
  const task=(async()=>{
   const summary=await deps.summary(symbol,'quoteType,assetProfile,financialData,summaryDetail,defaultKeyStatistics,price,topHoldings').catch(()=>null),type=summary?.quoteType?.quoteType??summary?.price?.quoteType;
   const series=type==='ETF'?null:summary?await deps.timeseries(symbol).catch(()=>null):null,raw=stockRadarRawFromYahoo(symbol,summary,series,now);
   if(raw?.General?.Type==='ETF'||hasStatements(raw))return raw;
   if(!deps.fmpRead)return raw;
   const profile=await deps.fmpRead('profile',{symbol}).catch(()=>null);if(!Array.isArray(profile)||!profile.length)return raw;
   const [income,cash,quote]=await Promise.all([deps.fmpRead('income-statement',{symbol,period:'quarter',limit:8}).catch(()=>null),deps.fmpRead('cash-flow-statement',{symbol,period:'quarter',limit:8}).catch(()=>null),deps.fmpRead('quote',{symbol}).catch(()=>null)]),alternative=stockRadarRawFromFmp(symbol,profile,income,cash,[],now,quote);
   return hasStatements(alternative)?alternative:raw;
  })();if(pending.size>=100)pending.delete(pending.keys().next().value!);pending.set(symbol,{expires:now+6*3600000,task});void task.then(value=>{if(!value&&pending.get(symbol)?.task===task)pending.set(symbol,{expires:clock()+60000,task});});return task;
 };
 return {fundamentals,history:async(symbol:string,c:string)=>deps.history?stockRadarHistoryFromRelative(symbol,c,await deps.history(symbol).catch(()=>null),clock()):null};
}

import {eodhdGet,eodhdEnabled} from './eodhd-client.ts';
import {alignedTransform,yieldCurveSnapshots,type YieldCurveSnapshot} from './bonds-credit-analytics.ts';
import type {Point,Series} from './panels.ts';
import type {CreditSeries} from './bonds-credit.ts';

type Request=typeof eodhdGet;
export type SovereignCode='US'|'FR'|'DE'|'GB';
export type DailySovereignMarket={code:SovereignCode;name:string;currency:string;definition:'benchmark';frequency:'daily';tenors:{years:number;series:CreditSeries}[];reference10y:CreditSeries;dayChangeBp:number|null;monthChangeBp:number|null;yearChangeBp:number|null;curveSnapshots:YieldCurveSnapshot[];slopes:CreditSeries[]};
export type EodhdBondsData={sovereigns:DailySovereignMarket[];commonDate:string|null;spreads:{code:SovereignCode;date:string|null;value:number|null;points:Point[]}[];policyRates:CreditSeries[];referenceRates:CreditSeries[];fundingStress:CreditSeries[];corporateDistress:CreditSeries[]};
export const EODHD_SOVEREIGN_MARKETS=[{code:'US',prefix:'US',name:'Estados Unidos',currency:'USD',country:'USA'},{code:'FR',prefix:'FR',name:'Francia',currency:'EUR',country:'France'},{code:'DE',prefix:'DE',name:'Alemania',currency:'EUR',country:'Germany'},{code:'GB',prefix:'UK',name:'Reino Unido',currency:'GBP',country:'UK'}] as const;
const DAY=86400000,HOUR=3600000;
const day=(now=Date.now())=>new Date(now).toISOString().slice(0,10);
const completedDay=(now=Date.now())=>day(now-DAY);
const rows=(raw:unknown):any[]=>Array.isArray(raw)?raw:Array.isArray((raw as any)?.data)?(raw as any).data:[];
const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()&&Number.isFinite(Number(value))?Number(value):null;
function points(raw:unknown,dateKey:string,valueKey:string,now=Date.now(),weekdays=false,min=-Infinity,max=Infinity):Point[]{
 const normalized=new Map<string,number>(),last=completedDay(now);
 for(const row of rows(raw)){const date=String(row?.[dateKey]??'').slice(0,10),value=number(row?.[valueKey]);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||day(Date.parse(date))!==date||date>last||value===null||value<min||value>max)continue;const weekday=new Date(date).getUTCDay();if(weekdays&&(weekday===0||weekday===6))continue;normalized.set(date,value);}
 return [...normalized].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value}));
}
const monthTarget=(date:string,months:number)=>{const[y,m,d]=date.split('-').map(Number),target=new Date(Date.UTC(y,m-1-months,1)),maxDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(d,maxDay));return day(target.getTime());};
export function dailyYieldChange(history:Point[],months:number):number|null{
 const last=history.at(-1);if(!last)return null;const target=monthTarget(last.date,months),before=history.filter(p=>p.date<=target).at(-1);return before&&Date.parse(target)-Date.parse(before.date)<=7*DAY?(last.value-before.value)*100:null;
}
export function normalizeEodhdBondSeries(symbol:string,raw:unknown,now=Date.now()):CreditSeries|null{
 const match=symbol.match(/^(US|FR|DE|UK)(1M|3M|6M|1Y|2Y|3Y|5Y|7Y|10Y|20Y|30Y)\.GBOND$/);if(!match)return null;
 const market=EODHD_SOVEREIGN_MARKETS.find(m=>m.prefix===match[1])!,tenor=match[2],months=tenor.endsWith('M'),n=Number(tenor.slice(0,-1));
 const history=points(raw,'date','close',now,true);if(!history.length)return null;
 return {id:symbol,label:`${n} ${months?(n===1?'mes':'meses'):(n===1?'año':'años')}`,unit:'%',source:`https://eodhd.com/financial-apis/macroeconomic-data-api#${symbol}`,frequency:'daily',currency:market.currency,scope:'sovereign',points:history};
}
export async function getEodhdBondSeries(symbol:string,from=day(Date.now()-3660*DAY),to=completedDay(),request:Request=eodhdGet,now=Date.now()):Promise<CreditSeries|null>{
 if(!/^(US|FR|DE|UK)(1M|3M|6M|1Y|2Y|3Y|5Y|7Y|10Y|20Y|30Y)\.GBOND$/.test(symbol))return null;
 const raw=await request('eod/'+symbol,{from,to,period:'d',order:'a'},{ttlMs:6*HOUR,cost:1,timeoutMs:8000});return normalizeEodhdBondSeries(symbol,raw,now);
}
const UST_TENORS:Record<string,[string,string]>={'1M':['DGS1MO','1 mes'],'3M':['DGS3MO','3 meses'],'6M':['DGS6MO','6 meses'],'1Y':['DGS1','1 año'],'2Y':['DGS2','2 años'],'3Y':['DGS3','3 años'],'5Y':['DGS5','5 años'],'7Y':['DGS7','7 años'],'10Y':['DGS10','10 años'],'20Y':['DGS20','20 años'],'30Y':['DGS30','30 años']};
export function normalizeEodhdTreasury(raw:unknown,real=false,now=Date.now()):Series[]{
 return Object.entries(UST_TENORS).flatMap(([tenor,[nominal,label]])=>{if(real&&!['5Y','7Y','10Y','20Y','30Y'].includes(tenor))return [];const id=real?'DFII'+tenor.slice(0,-1):nominal,history=points(rows(raw).filter(row=>row.tenor===tenor),'date','rate',now,true);return history.length?[{id,label:real?'Tipo real · '+label:label,unit:'%',source:'https://eodhd.com/financial-apis/us-treasury-ust-interest-rates-api-beta',points:history}]:[];});
}
export async function eodhdTreasury(years=1,real=false,request:Request=eodhdGet,now=Date.now()):Promise<Series[]>{
 if(request===eodhdGet&&!eodhdEnabled())return [];const current=new Date(now).getUTCFullYear(),range=Array.from({length:Math.max(0,Math.min(10,Math.trunc(years)))+1},(_,i)=>current-i);
 const data=await Promise.all(range.map(year=>request(real?'ust/real-yield-rates':'ust/yield-rates',{'filter[year]':year},{ttlMs:6*HOUR,cost:1,timeoutMs:8000})));
 return normalizeEodhdTreasury(data.flatMap(rows),real,now);
}
/** The Treasury endpoints and H.15 constant-maturity series describe the same
 * official par-curve definitions. GBOND benchmark instruments are kept separate. */
export function preferEodhdTreasury(fallback:Series[],primary:Series[]):Series[]{
 const ids=new Set([...fallback.map(s=>s.id),...primary.map(s=>s.id)]);return [...ids].map(id=>{const old=fallback.find(s=>s.id===id),fresh=primary.find(s=>s.id===id);if(!fresh?.points.length)return old!;if(!old?.points.length)return fresh;const merged=new Map(old.points.map(p=>[p.date,p.value]));fresh.points.forEach(p=>merged.set(p.date,p.value));return {...fresh,source:fresh.source+' '+old.source,points:[...merged].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value}))};});
}
const labels:Record<string,[string,string|null]>={SOFR:['SOFR · financiación garantizada USD','USD'],EFFR:['Fed Funds efectivo','USD'],SONIA:['SONIA · financiación GBP','GBP'],ESTR:['€STR · financiación EUR','EUR'],FED_TARGET_LOWER:['Fed · objetivo inferior','USD'],FED_TARGET_UPPER:['Fed · objetivo superior','USD'],ECB_DFR:['BCE · facilidad de depósito','EUR'],BOE_BANK_RATE:['Banco de Inglaterra · Bank Rate','GBP'],EFFR_SOFR:['Fed Funds efectivo − SOFR','USD'],SOFR_TARGET_LOWER:['SOFR − objetivo inferior de la Fed','USD'],EFFR_TARGET_MID:['Fed Funds efectivo − objetivo medio','USD']};
export function normalizeEodhdRates(raw:unknown,kind:'reference'|'policy'|'funding',now=Date.now()):CreditSeries[]{
 const permitted=kind==='reference'?['SOFR','EFFR','SONIA','ESTR']:kind==='policy'?['FED_TARGET_LOWER','FED_TARGET_UPPER','ECB_DFR','BOE_BANK_RATE']:['EFFR_SOFR','SOFR_TARGET_LOWER','EFFR_TARGET_MID'];
 return permitted.flatMap(code=>{const history=points(rows(raw).filter(row=>row.code===code),'date',kind==='funding'?'value_bps':'rate',now);return history.length?[{id:'EODHD_'+code,label:labels[code][0],unit:kind==='funding'?'pb':'%',source:'https://eodhd.com/financial-apis/interest-rates-api-sofr-fed-funds-ecb-boe-policy-rates',frequency:'daily' as const,currency:labels[code][1],scope:'financial-conditions' as const,points:history}]:[];});
}
export function normalizeEodhdCmdi(raw:unknown,now=Date.now()):CreditSeries[]{
 return [['market_cmdi','Mercado corporativo'],['ig_cmdi','Investment grade'],['hy_cmdi','High yield']].flatMap(([field,label])=>{const history=points(raw,'as_of_date',field,now,false,0,1);return history.length?[{id:'CMDI_'+field,label,unit:'índice 0–1',source:'https://eodhd.com/financial-apis/credit-and-sovereign-risk-data-api',frequency:'weekly' as const,currency:null,scope:'financial-conditions' as const,points:history}]:[];});
}
export function buildDailySovereigns(series:CreditSeries[]):DailySovereignMarket[]{
 return EODHD_SOVEREIGN_MARKETS.flatMap(market=>{const matching=series.filter(s=>s.id.startsWith(market.prefix)&&s.currency===market.currency&&s.frequency==='daily'),reference10y=matching.find(s=>s.id===market.prefix+'10Y.GBOND');if(!reference10y?.points.length)return [];
  const tenors=matching.map(s=>{const tenor=s.id.slice(market.prefix.length,-6);return {years:Number(tenor.slice(0,-1))/(tenor.endsWith('M')?12:1),series:s};}).sort((a,b)=>a.years-b.years);
  const last=reference10y.points.at(-1)!,previous=reference10y.points.at(-2),find=(years:number)=>tenors.find(s=>s.years===years)?.series;
  const slopes=([[10,2],[30,5]] as const).flatMap(([long,short])=>find(long)&&find(short)?[alignedTransform(market.code+`_${long}Y_${short}Y`,`${long} años − ${short} años`,'pb',find(long),find(short),(a,b)=>(a-b)*100)]:[]);
  return [{code:market.code,name:market.name,currency:market.currency,definition:'benchmark' as const,frequency:'daily' as const,tenors,reference10y,dayChangeBp:previous?(last.value-previous.value)*100:null,monthChangeBp:dailyYieldChange(reference10y.points,1),yearChangeBp:dailyYieldChange(reference10y.points,12),curveSnapshots:yieldCurveSnapshots(matching,tenors.map(t=>[t.series.id,t.series.label,t.years] as const)),slopes}];
 });
}
export function buildEodhdBondsData(series:CreditSeries[],policyRates:CreditSeries[]=[],referenceRates:CreditSeries[]=[],fundingStress:CreditSeries[]=[],corporateDistress:CreditSeries[]=[]):EodhdBondsData{
 const sovereigns=buildDailySovereigns(series),germany=sovereigns.find(s=>s.code==='DE')?.reference10y,sets=sovereigns.map(s=>new Set(s.reference10y.points.map(p=>p.date))),commonDate=sovereigns[0]?.reference10y.points.slice().reverse().find(p=>sets.every(s=>s.has(p.date)))?.date??null;
 const spreads=sovereigns.map(m=>{const result=alignedTransform(m.code+'_DE_DAILY',m.name+' − Alemania · 10 años','pb',m.reference10y,germany,(a,b)=>(a-b)*100),last=result.points.at(-1);return {code:m.code,date:last?.date??null,value:last?.value??null,points:result.points};});
 return {sovereigns,commonDate,spreads,policyRates,referenceRates,fundingStress,corporateDistress};
}
export async function eodhdBondsData(request:Request=eodhdGet,now=Date.now()):Promise<EodhdBondsData|null>{
 if(request===eodhdGet&&!eodhdEnabled())return null;
 const from=day(now-3660*DAY),to=completedDay(now),yearFrom=day(now-370*DAY),recent=day(now-21*DAY);
 const [directory,reference,policy,funding,cmdi]=await Promise.all([
  request('exchange-symbol-list/GBOND',{}, {ttlMs:24*HOUR,cost:1,timeoutMs:8000}),
  request('rates/reference-rates',{'filter[code]':'SOFR,EFFR,SONIA,ESTR','filter[from]':recent,'filter[to]':to,'page[limit]':100},{ttlMs:6*HOUR,cost:1}),
  request('rates/policy-rates',{'filter[code]':'FED_TARGET_LOWER,FED_TARGET_UPPER,ECB_DFR,BOE_BANK_RATE','filter[from]':recent,'filter[to]':to,'page[limit]':100},{ttlMs:6*HOUR,cost:1}),
  request('spreads/funding-stress',{'filter[code]':'EFFR_SOFR,SOFR_TARGET_LOWER,EFFR_TARGET_MID','filter[from]':yearFrom,'filter[to]':to},{ttlMs:6*HOUR,cost:1}),
  request('credit-risk/corporate/cmdi',{'filter[from]':yearFrom,'filter[to]':to,'page[limit]':100},{ttlMs:6*HOUR,cost:1}),
 ]);
 const symbols=EODHD_SOVEREIGN_MARKETS.flatMap(m=>{const listed=rows(directory).filter(s=>s.Exchange==='GBOND'&&s.Currency===m.currency&&s.Country===m.country&&s.Type==='BOND').map(s=>s.Code);return ['2Y','5Y','10Y',listed.includes(m.prefix+'30Y')?'30Y':'1Y'].filter(t=>listed.includes(m.prefix+t)).map(t=>m.prefix+t+'.GBOND');});
 const histories=await Promise.all(symbols.map(symbol=>getEodhdBondSeries(symbol,from,to,request,now)));
 const data=buildEodhdBondsData(histories.filter((s):s is CreditSeries=>s!==null),normalizeEodhdRates(policy,'policy',now),normalizeEodhdRates(reference,'reference',now),normalizeEodhdRates(funding,'funding',now),normalizeEodhdCmdi(cmdi,now));
 return data.sovereigns.length||data.policyRates.length||data.referenceRates.length||data.fundingStress.length||data.corporateDistress.length?data:null;
}

import {bondsPanel,cached,type BondsPanel,type Point,type Series} from './panels.ts';
import type {PriceSeries} from './market-analytics.ts';
import {relativeHistory} from './relative-comparison.ts';
import {buildBondsCreditAnalytics,CURVE_TENORS,type BondsCreditAnalytics} from './bonds-credit-analytics.ts';
import {eodhdTreasury,eodhdBondsData,preferEodhdTreasury,treasuryDerivedSeries,type EodhdBondsData} from './eodhd-bonds.ts';
import {eodhdMacroIndices,buildBondsMacroIndicators,type BondsMacroIndicators} from './macro-indicators.ts';
import {fedPrivateCredit,FED_PRIVATE_URL} from './fed-private-credit.ts';
export type CreditFrequency='daily'|'weekly'|'monthly'|'quarterly';
export type CreditSeries=Series&{frequency:CreditFrequency;currency:string|null;scope:'sovereign'|'private-funds'|'banking'|'financial-conditions'|'derived'};
export type SovereignMarket={code:'US'|'FR'|'DE'|'GB';name:string;currency:string;series:CreditSeries;monthChangeBp:number|null;yearChangeBp:number|null};
export type CreditProxy={symbol:string;label:string;currency:string;price:number|null;date:string|null;returnsDate:string|null;return21:number|null;return63:number|null;points:Point[]};
export type BondsCreditPanel={fetchedAt:string;base:BondsPanel;sovereigns:SovereignMarket[];sovereignCommonDate:string|null;sovereignSpreads:{code:string;value:number|null}[];credit:CreditSeries[];privateValuation:CreditSeries;privateLiabilities:CreditSeries;privateGrowth:CreditSeries;proxies:CreditProxy[];analytics?:BondsCreditAnalytics;marketRates?:EodhdBondsData;macroIndicators?:BondsMacroIndicators};
export type BondsCreditEnv={FRED_KEY:string;MASSIVE_API_KEY?:string;FMP_KEY?:string;FINNHUB_KEY?:string};
type Config={id:string;label:string;unit:string;frequency:CreditFrequency;currency:string|null;scope:CreditSeries['scope'];scale?:number;start?:string};
export const SOVEREIGN_MARKETS=[{code:'US',name:'Estados Unidos',currency:'USD',id:'IRLTLT01USM156N'},{code:'FR',name:'Francia',currency:'EUR',id:'IRLTLT01FRM156N'},{code:'DE',name:'Alemania',currency:'EUR',id:'IRLTLT01DEM156N'},{code:'GB',name:'Reino Unido',currency:'GBP',id:'IRLTLT01GBM156N'}] as const;
export const CREDIT_CONFIG:Config[]=[
 {id:'BOGZ1FL444090000Q',label:'Activos de fondos de deuda privada',unit:'miles de millones USD',currency:'USD',frequency:'quarterly',scope:'private-funds',scale:.001,start:'2012-10-01'},
 {id:'BOGZ1FL443067205Q',label:'Préstamos privados · coste',unit:'miles de millones USD',currency:'USD',frequency:'quarterly',scope:'private-funds',scale:.001,start:'2012-10-01'},
 {id:'BOGZ1LM443067215Q',label:'Préstamos privados · valor razonable',unit:'miles de millones USD',currency:'USD',frequency:'quarterly',scope:'private-funds',scale:.001,start:'2012-10-01'},
 {id:'BOGZ1FL444190005Q',label:'Pasivos de fondos de deuda privada',unit:'miles de millones USD',currency:'USD',frequency:'quarterly',scope:'private-funds',scale:.001,start:'2012-10-01'},
 {id:'BOGZ1FL442000093Q',label:'Capital comprometido no exigido · dry powder',unit:'miles de millones USD',currency:'USD',frequency:'quarterly',scope:'private-funds',scale:.001,start:'2012-10-01'},
 {id:'DRTSCILM',label:'Endurecimiento · empresas grandes y medianas',unit:'% neto',currency:null,frequency:'quarterly',scope:'banking'},
 {id:'DRTSCIS',label:'Endurecimiento · pequeñas empresas',unit:'% neto',currency:null,frequency:'quarterly',scope:'banking'},
 {id:'DRSDCILM',label:'Demanda de préstamos · grandes y medianas',unit:'% neto',currency:null,frequency:'quarterly',scope:'banking'},
 {id:'DRBLACBS',label:'Morosidad de préstamos empresariales bancarios',unit:'%',currency:null,frequency:'quarterly',scope:'banking'},
 {id:'BUSLOANS',label:'Crédito comercial e industrial bancario',unit:'miles de millones USD',currency:'USD',frequency:'monthly',scope:'banking'},
 {id:'NFCI',label:'Condiciones financieras',unit:'índice',currency:null,frequency:'weekly',scope:'financial-conditions'},
];
const ADDITIONAL_MARKET_CONFIG:Config[]=[
 {id:'DGS20',label:'20 años',unit:'%',currency:'USD',frequency:'daily',scope:'sovereign'},
 {id:'T5YIFR',label:'Inflación implícita · 5 años dentro de 5 años',unit:'%',currency:null,frequency:'daily',scope:'sovereign'},
];
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const day=(time=Date.now())=>new Date(time).toISOString().slice(0,10);
export function normalizeCreditPoints(rows:unknown,scale=1,now=Date.now()):Point[]{
 if(!Array.isArray(rows))return [];const points=new Map<string,number>();
 for(const r of rows){const date=String(r?.date??'').slice(0,10),raw=r?.value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||day(Date.parse(date))!==date||date>day(now)||raw===null||raw===undefined||String(raw).trim()===''||raw==='.')continue;const value=typeof raw==='number'?raw:Number(raw);if(finite(value))points.set(date,value*scale);}
 return [...points].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,value])=>({date,value}));
}
function parseCsv(text:string,id:string){const lines=text.trim().split(/\r?\n/);if(lines[0]!==`observation_date,${id}`&&lines[0]!==`DATE,${id}`)return [];return lines.slice(1).map(line=>{const [date,value]=line.split(',');return {date,value};});}
async function observations(id:string,key:string,start:string){
 if(key)try{const response=await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}`,{redirect:'error',signal:AbortSignal.timeout(10000)});if(response.ok){const raw=await response.json();if(Array.isArray(raw.observations))return raw.observations;}}catch{/* The official public export is an independent fallback. */}
 try{const response=await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`,{redirect:'error',signal:AbortSignal.timeout(10000)});return response.ok?parseCsv(await response.text(),id):[];}catch{return [];}
}
async function loadSeries(config:Config,key:string):Promise<CreditSeries>{return cached('bonds-credit-series:'+config.id,3600000,async()=>{
 const source=`https://fred.stlouisfed.org/series/${config.id}`,points=normalizeCreditPoints(await observations(config.id,key,config.start??day(Date.now()-3660*86400000)),config.scale??1);
 if(points.length||config.scope!=='private-funds')return {...config,source,points};
 const official=(await fedPrivateCredit())[config.id];
 return {...config,source:official?.length?FED_PRIVATE_URL:source,points:official??[]};
 });}
const shiftMonth=(date:string,months:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10);};
export function periodChange(points:Point[],months:number):number|null{const last=points.at(-1);if(!last)return null;const old=points.find(p=>p.date===shiftMonth(last.date,-months));return old?(last.value-old.value)*100:null;}
function derived(id:string,label:string,unit:string,a:CreditSeries|undefined,b:CreditSeries|undefined,fn:(a:number,b:number)=>number|null):CreditSeries{
 const other=new Map(b?.points.map(p=>[p.date,p.value])??[]);return {id,label,unit,source:'',frequency:a?.frequency??'quarterly',currency:null,scope:'derived',points:(a?.points??[]).flatMap(p=>{const right=other.get(p.date);if(right===undefined)return [];const value=fn(p.value,right);return value===null||!finite(value)?[]:[{date:p.date,value}];})};
}
export function buildBondsCredit(base:BondsPanel,series:CreditSeries[],proxies:CreditProxy[]=[],now=Date.now()):BondsCreditPanel{
 const find=(id:string)=>series.find(s=>s.id===id),funds=find('BOGZ1FL444090000Q'),cost=find('BOGZ1FL443067205Q'),fair=find('BOGZ1LM443067215Q'),liabilities=find('BOGZ1FL444190005Q');
 const sovereigns:SovereignMarket[]=SOVEREIGN_MARKETS.map(m=>{const s=find(m.id)??{id:m.id,label:m.name+' · 10 años',unit:'%',source:'',frequency:'monthly' as const,currency:m.currency,scope:'sovereign' as const,points:[]};return {code:m.code,name:m.name,currency:m.currency,series:s,monthChangeBp:periodChange(s.points,1),yearChangeBp:periodChange(s.points,12)};});
 const dateSets=sovereigns.map(m=>new Set(m.series.points.map(p=>p.date))),common=sovereigns[0].series.points.slice().reverse().find(p=>dateSets.every(d=>d.has(p.date)))?.date??null;
 const germany=common?sovereigns.find(m=>m.code==='DE')?.series.points.find(p=>p.date===common)?.value:undefined;
 const privateValuation=derived('PRIVATE_FV_COST','Valor razonable frente a coste','%',fair,cost,(a,b)=>b>0?(a/b-1)*100:null);
 const privateLiabilities=derived('PRIVATE_LIABILITIES_ASSETS','Pasivos / activos','%',liabilities,funds,(a,b)=>b>0?a/b*100:null);
 const costByDate=new Map(cost?.points.map(p=>[p.date,p.value])??[]);
 const privateGrowth:CreditSeries={id:'PRIVATE_LOANS_YOY',label:'Crecimiento interanual de préstamos privados',unit:'%',source:'',frequency:'quarterly',currency:null,scope:'derived',points:(cost?.points??[]).flatMap(p=>{const before=costByDate.get(shiftMonth(p.date,-12));return before!==undefined&&before>0?[{date:p.date,value:(p.value/before-1)*100}]:[];})};
 return {fetchedAt:new Date(now).toISOString(),base,sovereigns,sovereignCommonDate:common,sovereignSpreads:sovereigns.map(m=>{const value=common?m.series.points.find(p=>p.date===common)?.value:undefined;return {code:m.code,value:value!==undefined&&germany!==undefined?(value-germany)*100:null};}),credit:series.filter(s=>s.scope!=='sovereign'),privateValuation,privateLiabilities,privateGrowth,proxies,analytics:buildBondsCreditAnalytics(base,series)};
}
export function proxyFromPrices(symbol:string,label:string,p:PriceSeries|null):CreditProxy{
 const last=p?.closes.at(-1),ret=(n:number)=>last!==undefined&&p&&p.closes.length>n&&p.closes.at(-n-1)!>0?(last/p.closes.at(-n-1)!-1)*100:null;
 return {symbol,label,currency:p?.currency??'USD',price:p?.raw.at(-1)??null,date:p?.dates.at(-1)??null,returnsDate:p?.dates.at(-1)??null,return21:ret(21),return63:ret(63),points:p?p.dates.map((date,i)=>({date,value:p.closes[i]})):[]};
}
export function closedProxyPrice(proxy:CreditProxy,rows:any[]):CreditProxy{
 const permitted=proxy.returnsDate;if(!permitted)return proxy;
 const candidates=rows.flatMap(row=>{if(!finite(row?.t)||row.t<=0||row.t>Date.now()||!finite(row.c)||row.c<=0)return [];const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(row.t);return date<=permitted&&(!proxy.date||date>=proxy.date)?[{date,price:row.c,time:row.t}]:[];}).sort((a,b)=>b.time-a.time);
 return candidates.length?{...proxy,price:candidates[0].price,date:candidates[0].date}:proxy;
}
async function listedProxies(key?:string):Promise<CreditProxy[]>{return cached('bonds-credit-listed-v1',300000,async()=>{
 const [bizd,bkln]=await Promise.all([relativeHistory('BIZD'),relativeHistory('BKLN')]),result=[proxyFromPrices('BIZD','BDCs cotizadas',bizd),proxyFromPrices('BKLN','Préstamos sindicados',bkln)];
 if(key&&result[0].price===null&&result[0].returnsDate)try{const r=await fetch(`https://api.massive.com/v2/aggs/ticker/BIZD/range/1/day/${day(Date.now()-10*86400000)}/${day()}?adjusted=true&sort=desc&limit=20`,{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(8000)});if(r.ok){const rows=(await r.json())?.results;if(Array.isArray(rows))result[0]=closedProxyPrice(result[0],rows);}}catch{/* Preserve the verified completed-session quote. */}
 return result;
 });}
/** Only used when the native Treasury series is absent. The provider's dates and
 * annual-percent units are preserved, and null fields never become zero yields. */
export function massiveTreasurySeries(raw:unknown,now=Date.now()):Series[]{
 const rows=Array.isArray(raw)?raw:(raw as {results?:unknown})?.results;
 const field:Record<string,string>={DGS1MO:'yield_1_month',DGS3MO:'yield_3_month',DGS6MO:'yield_6_month',DGS1:'yield_1_year',DGS2:'yield_2_year',DGS5:'yield_5_year',DGS10:'yield_10_year',DGS20:'yield_20_year',DGS30:'yield_30_year'};
 return CURVE_TENORS.map(([id,label])=>({id,label,unit:'%',source:'https://api.massive.com/fed/v1/treasury-yields',points:normalizeCreditPoints(Array.isArray(rows)?rows.map(row=>({date:row?.date,value:row?.[field[id]]})):[],1,now)}));
}
async function recoverBase(base:BondsPanel,massiveKey?:string):Promise<BondsPanel>{
 let series=base.series.map(s=>({...s,points:normalizeCreditPoints(s.points)}));
 if(massiveKey&&CURVE_TENORS.some(([id])=>id!=='DGS20'&&!series.find(s=>s.id===id)?.points.length)){
  const backup=await cached('bonds-credit-massive-treasury-v1',3600000,async()=>{try{const r=await fetch(`https://api.massive.com/fed/v1/treasury-yields?date.gte=${day(Date.now()-3660*86400000)}&sort=date.asc&limit=5000`,{headers:{Authorization:`Bearer ${massiveKey}`},redirect:'error',signal:AbortSignal.timeout(8000)});return r.ok?massiveTreasurySeries(await r.json()):[];}catch{return [];}});
  series=series.map(s=>s.points.length?s:backup.find(b=>b.id===s.id&&b.points.length)??s);
 }
 // bondsPanel already tried the keyed API. Retry missing series through the
 // official public export only, rather than repeating a failing API request.
 const fallback=await Promise.all(series.filter(s=>!s.points.length).map(async s=>({...s,points:normalizeCreditPoints(await observations(s.id,'',day(Date.now()-3660*86400000)))})));
 return {...base,series:series.map(s=>s.points.length?s:fallback.find(f=>f.id===s.id)??s)};
}
export async function bondsCreditPanel(env:BondsCreditEnv):Promise<BondsCreditPanel>{return cached('bonds-credit-v5',900000,async()=>{
 const sovereigns:Config[]=SOVEREIGN_MARKETS.map(m=>({id:m.id,label:m.name+' · 10 años',unit:'%',frequency:'monthly',currency:m.currency,scope:'sovereign'}));
 const primaryRequest=Promise.all([eodhdTreasury(10),eodhdTreasury(10,true)]).then(([nominal,real])=>treasuryDerivedSeries([...nominal,...real]));
 const marketRequest=eodhdBondsData();
 const baseRequest=primaryRequest.then(primary=>bondsPanel({FRED_KEY:env.FRED_KEY,FMP_KEY:env.FMP_KEY??'',FINNHUB_KEY:env.FINNHUB_KEY??'',TAVILY_KEY:''},undefined,primary).then(base=>recoverBase(base,env.MASSIVE_API_KEY)).then(base=>({...base,series:preferEodhdTreasury(base.series,primary)})));
 const sovereignRequest=marketRequest.then(market=>market?.sovereigns.length===SOVEREIGN_MARKETS.length?sovereigns.map(c=>({...c,source:'',points:[]} as CreditSeries)):Promise.all(sovereigns.map(c=>loadSeries(c,env.FRED_KEY))));
 const extraRequest=primaryRequest.then(primary=>Promise.all(ADDITIONAL_MARKET_CONFIG.map(config=>{const found=primary.find(s=>s.id===config.id&&s.points.length);return found?Promise.resolve({...found,frequency:config.frequency,currency:config.currency,scope:config.scope} as CreditSeries):loadSeries(config,env.FRED_KEY);})));
 const [base,credit,monthly,additional,proxies,marketRates,indices]=await Promise.all([baseRequest,Promise.all(CREDIT_CONFIG.map(c=>loadSeries(c,env.FRED_KEY))),sovereignRequest,extraRequest,listedProxies(env.MASSIVE_API_KEY),marketRequest,eodhdMacroIndices()]);
 const series=[...monthly,...credit,...additional];
 const extra=series.find(s=>s.id==='DGS20');if(extra?.points.length&&!base.series.some(s=>s.id==='DGS20'))base.series.push(extra);
 return {...buildBondsCredit(base,series,proxies),...(marketRates?{marketRates}:{}),macroIndicators:buildBondsMacroIndicators([...base.series,...series],marketRates,indices)};
});}

import {eodhdGet,eodhdEnabled} from './eodhd-client.ts';
import {alignedTransform} from './bonds-credit-analytics.ts';
import type {Point,Series} from './panels.ts';
import type {CreditSeries} from './bonds-credit.ts';
import type {EodhdBondsData} from './eodhd-bonds.ts';

export type BondsMacroIndicators={move:CreditSeries|null;vix:CreditSeries|null;stressPercentiles:CreditSeries[];yieldVolatility:CreditSeries[];breakevens:CreditSeries[];hyIgPremium:CreditSeries;commonStressDate:string|null;percentileWindow:number;realizedWindow:number};
const DAY=86400000,INDEX_IDS=['MOVE.INDX','VIX.INDX'] as const;
export function normalizeMacroIndex(symbol:string,raw:unknown,now=Date.now()):CreditSeries|null{
 if(!INDEX_IDS.includes(symbol as typeof INDEX_IDS[number])||!Array.isArray(raw))return null;
 const map=new Map<string,number>(),today=new Date(now).toISOString().slice(0,10);
 for(const row of raw){const date=String(row?.date??''),value=row?.close;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>=today||typeof value!=='number'||!Number.isFinite(value)||value<=0)continue;
  const weekday=new Date(date).getUTCDay();if(weekday!==0&&weekday!==6)map.set(date,value);
 }
 if(!map.size)return null;return {id:symbol,label:symbol==='MOVE.INDX'?'MOVE · volatilidad implícita de tipos':'VIX · volatilidad implícita de renta variable',unit:symbol==='MOVE.INDX'?'puntos':'%',source:symbol==='MOVE.INDX'?'https://developer.ice.com/fixed-income-data-services/catalog/ice-data-indices-move-index':'https://www.cboe.com/tradable_products/vix/',frequency:'daily',currency:null,scope:'financial-conditions',points:[...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value}))};
}
export async function eodhdMacroIndices(request:typeof eodhdGet=eodhdGet,now=Date.now()):Promise<CreditSeries[]>{
 if(request===eodhdGet&&!eodhdEnabled())return [];
 const from=new Date(now-3660*DAY).toISOString().slice(0,10),to=new Date(now-DAY).toISOString().slice(0,10);
 return (await Promise.all(INDEX_IDS.map(async symbol=>normalizeMacroIndex(symbol,await request('eod/'+symbol,{from,to,period:'d',order:'a'},{ttlMs:6*3600000,cost:1,timeoutMs:8000}),now)))).filter((s):s is CreditSeries=>s!==null);
}
/** Each percentile uses only its own preceding window ending on that date,
 * calculated over exact common MOVE/VIX dates. No look-ahead or interpolation. */
export function comparableStressPercentiles(left:CreditSeries|null,right:CreditSeries|null,window=252):CreditSeries[]{
 if(!left||!right||window<20)return [];
 const rightDates=new Map(right.points.map(p=>[p.date,p.value])),common=left.points.flatMap(p=>rightDates.has(p.date)?[{date:p.date,a:p.value,b:rightDates.get(p.date)!}]:[]);
 if(common.length<window)return [];
 return ([['a',left],['b',right]] as const).map(([key,s])=>({...s,id:s.id+'_PERCENTILE',label:s.id==='MOVE.INDX'?'MOVE · percentil 1 año':'VIX · percentil 1 año',unit:'percentil',scope:'derived' as const,points:common.slice(window-1).flatMap((row,j)=>{
  const sample=common.slice(j,j+window);if(Date.parse(row.date)-Date.parse(sample[0].date)>450*DAY)return [];
  return [{date:row.date,value:sample.filter(p=>p[key]<=row[key]).length/window*100}];
 })}));
}
/** Standard deviation of absolute daily yield changes, in basis points/day.
 * This is realized single-tenor volatility, never a synthetic MOVE index. */
export function realizedYieldVolatility(series:Series,label:string,window=20):CreditSeries{
 const diffs:Point[]=series.points.slice(1).flatMap((p,i)=>Date.parse(p.date)-Date.parse(series.points[i].date)<=7*DAY?[{date:p.date,value:(p.value-series.points[i].value)*100}]:[]);
 const points=diffs.slice(window-1).flatMap((last,i)=>{const sample=diffs.slice(i,i+window);if(window<2||Date.parse(last.date)-Date.parse(sample[0].date)>45*DAY)return [];const mean=sample.reduce((s,p)=>s+p.value,0)/window,variance=sample.reduce((s,p)=>s+(p.value-mean)**2,0)/(window-1);return [{date:last.date,value:Math.sqrt(variance)}];});
 return {id:series.id+'_REALIZED_20',label,unit:'pb/día',source:series.source,frequency:'daily',currency:null,scope:'derived',points};
}
export function buildBondsMacroIndicators(series:Series[],markets:EodhdBondsData|null,indices:CreditSeries[]):BondsMacroIndicators{
 const find=(id:string)=>series.find(s=>s.id===id),move=indices.find(s=>s.id==='MOVE.INDX')??null,vix=indices.find(s=>s.id==='VIX.INDX')??null;
 const stressPercentiles=comparableStressPercentiles(move,vix),yieldVolatility=markets?.sovereigns.length?markets.sovereigns.map(m=>realizedYieldVolatility(m.reference10y,m.name+' · 10 años')):find('DGS10')?[realizedYieldVolatility(find('DGS10')!,'Estados Unidos · 10 años')]:[];
 const breakevens=[5,10,30].map(n=>alignedTransform(`BREAKEVEN_${n}Y`,`${n} años · inflación implícita`,'%',find('DGS'+n),find('DFII'+n),(nominal,real)=>nominal-real)).filter(s=>s.points.length);
 const hyIgPremium=alignedTransform('HY_IG_PREMIUM','Prima high yield frente a investment grade','pb',find('BAMLH0A0HYM2'),find('BAMLC0A0CM'),(hy,ig)=>(hy-ig)*100);
 return {move,vix,stressPercentiles,yieldVolatility,breakevens,hyIgPremium,commonStressDate:stressPercentiles[0]?.points.at(-1)?.date??null,percentileWindow:252,realizedWindow:20};
}

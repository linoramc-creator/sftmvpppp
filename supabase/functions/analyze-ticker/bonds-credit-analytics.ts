import type {BondsPanel,Series} from './panels.ts';
import type {CreditSeries} from './bonds-credit.ts';

export type YieldCurvePoint={id:string;label:string;maturityYears:number;value:number};
export type YieldCurveSnapshot={key:'current'|'monthAgo'|'yearAgo';label:string;date:string;points:YieldCurvePoint[]};
export type CreditSpreadStat={id:string;label:string;value:number|null;date:string|null;change21Bp:number|null;change63Bp:number|null;percentile:number|null;windowStart:string|null;observations:number};
export type BondsCreditAnalytics={curveSnapshots:YieldCurveSnapshot[];curveSlopes:CreditSeries[];inflation:CreditSeries[];creditSpreads:CreditSeries[];spreadStats:CreditSpreadStat[];sovereignSpreadHistory:CreditSeries[];privateLeverage:CreditSeries;privateDryPowderRatio:CreditSeries};
export const CURVE_TENORS=[['DGS1MO','1 mes',1/12],['DGS3MO','3 meses',.25],['DGS6MO','6 meses',.5],['DGS1','1 año',1],['DGS2','2 años',2],['DGS5','5 años',5],['DGS10','10 años',10],['DGS20','20 años',20],['DGS30','30 años',30]] as const;
const DAY=86400000;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);

/** Match actual observation dates. No forward-fill between countries or tenors. */
export function alignedTransform(id:string,label:string,unit:string,left:Series|undefined,right:Series|undefined,fn:(a:number,b:number)=>number|null,frequency:CreditSeries['frequency']='daily'):CreditSeries{
 const rightByDate=new Map(right?.points.map(p=>[p.date,p.value])??[]);
 return {id,label,unit,source:[left?.source,right?.source].filter(Boolean).join(' '),frequency,currency:null,scope:'derived',points:(left?.points??[]).flatMap(p=>{const b=rightByDate.get(p.date);if(!finite(p.value)||!finite(b))return [];const value=fn(p.value,b);return finite(value)?[{date:p.date,value}]:[];})};
}
const shifted=(date:string,months:number)=>{const [y,m,d]=date.split('-').map(Number);const target=new Date(Date.UTC(y,m-1+months,1));const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(d,last));return target.toISOString().slice(0,10);};

export function yieldCurveSnapshots(series:Series[]):YieldCurveSnapshot[]{
 const available=CURVE_TENORS.flatMap(([id,label,maturityYears])=>{const s=series.find(s=>s.id===id);return s?.points.length?[{id,label,maturityYears,byDate:new Map(s.points.filter(p=>finite(p.value)).map(p=>[p.date,p.value]))}]:[];});
 if(available.length<3)return [];
 const common=[...available[0].byDate.keys()].filter(date=>available.every(s=>s.byDate.has(date))).sort();
 const current=common.at(-1);if(!current)return [];
 // Do not present an old common date as today's curve when a tenor is stale.
 const newest=available.flatMap(s=>[...s.byDate.keys()]).sort().at(-1)!;
 if(Date.parse(newest)-Date.parse(current)>7*DAY)return [];
 return ([['current','Última curva',0],['monthAgo','Hace un mes',-1],['yearAgo','Hace un año',-12]] as const).flatMap(([key,label,months])=>{
  const target=shifted(current,months),date=common.filter(d=>d<=target).at(-1);
  if(!date||Date.parse(target)-Date.parse(date)>7*DAY)return [];
  return [{key,label,date,points:available.map(s=>({id:s.id,label:s.label,maturityYears:s.maturityYears,value:s.byDate.get(date)!}))}];
 });
}

/** Statistics use the explicitly returned daily history, never a claimed ten-year distribution. */
export function creditSpreadStat(series:CreditSeries):CreditSpreadStat{
 const points=series.points,last=points.at(-1),previous=(n:number)=>points.length>n?points.at(-n-1):undefined;
 const change=(n:number)=>{const p=previous(n);return last&&p?last.value-p.value:null;};
 const percentile=last&&points.length>=100?points.filter(p=>p.value<=last.value).length/points.length*100:null;
 return {id:series.id,label:series.label,value:last?.value??null,date:last?.date??null,change21Bp:change(21),change63Bp:change(63),percentile,windowStart:points[0]?.date??null,observations:points.length};
}

export function buildBondsCreditAnalytics(base:BondsPanel,series:CreditSeries[]):BondsCreditAnalytics{
 const all=[...base.series,...series],find=(id:string)=>all.find(s=>s.id===id);
 const curveSlopes=[['UST_10Y_2Y','10 años − 2 años','DGS10','DGS2'],['UST_10Y_3M','10 años − 3 meses','DGS10','DGS3MO'],['UST_30Y_5Y','30 años − 5 años','DGS30','DGS5']].map(([id,label,a,b])=>alignedTransform(id,label,'pb',find(a),find(b),(a,b)=>(a-b)*100));
 const inflation=['DGS10','DFII10','T10YIE','T5YIFR'].flatMap(id=>{const s=find(id);return s?[{...s,frequency:'daily' as const,currency:null,scope:'sovereign' as const}]:[];});
 const creditSpreads=[['BAMLC0A0CM','Investment grade · diferencial OAS'],['BAMLH0A0HYM2','High yield · diferencial OAS']].flatMap(([id,label])=>{const s=find(id);return s?[{...s,label,unit:'pb',frequency:'daily' as const,currency:null,scope:'financial-conditions' as const,points:s.points.map(p=>({date:p.date,value:p.value*100}))}]:[];});
 const germany=find('IRLTLT01DEM156N');
 const sovereignSpreadHistory=[['FR','Francia'],['GB','Reino Unido'],['US','Estados Unidos']].map(([code,name])=>alignedTransform(code+'_DE_10Y',name+' − Alemania · 10 años','pb',find(`IRLTLT01${code}M156N`),germany,(a,b)=>(a-b)*100,'monthly'));
 const privateLeverage=alignedTransform('PRIVATE_LIABILITIES_NET_ASSETS','Pasivos / patrimonio financiero','x',find('BOGZ1FL444190005Q'),find('BOGZ1FL444090000Q'),(liabilities,assets)=>assets>liabilities&&liabilities>=0?liabilities/(assets-liabilities):null,'quarterly');
 const privateDryPowderRatio=alignedTransform('PRIVATE_DRY_POWDER_LOANS','Capital no exigido / préstamos privados','%',find('BOGZ1FL442000093Q'),find('BOGZ1FL443067205Q'),(dryPowder,loans)=>dryPowder>=0&&loans>0?dryPowder/loans*100:null,'quarterly');
 return {curveSnapshots:yieldCurveSnapshots(all),curveSlopes,inflation,creditSpreads,spreadStats:creditSpreads.map(creditSpreadStat),sovereignSpreadHistory,privateLeverage,privateDryPowderRatio};
}

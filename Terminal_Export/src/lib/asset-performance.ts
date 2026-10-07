import type {PriceSeries} from '../../../supabase/functions/analyze-ticker/market-analytics';
export function assetPerformance(series:PriceSeries[],symbol:string,days:number){
 const base=series.find(p=>p.symbol===symbol);
 if(!base?.currency)return {rows:[],symbols:[],excluded:series.map(p=>p.symbol)};
 const matching=series.filter(p=>p.currency===base.currency),excluded=series.filter(p=>p.currency!==base.currency).map(p=>p.symbol);
 const maps=matching.map(p=>new Map(p.dates.flatMap((d,i)=>Number.isFinite(p.closes[i])&&p.closes[i]>0?[[d,p.closes[i]] as const]:[])));
 const common=[...(maps[0]?.keys()??[])].filter(d=>maps.every(m=>m.has(d))).sort(),end=Date.parse(common.at(-1)??'');
 const dates=common.filter(d=>Date.parse(d)>=end-days*86400000);
 if(dates.length<2)return {rows:[],symbols:matching.map(p=>p.symbol),excluded};
 return {rows:dates.map(date=>Object.fromEntries([['date',date],...matching.map((p,i)=>[p.symbol,(maps[i].get(date)!/maps[i].get(dates[0])!-1)*100])])),symbols:matching.map(p=>p.symbol),excluded};
}

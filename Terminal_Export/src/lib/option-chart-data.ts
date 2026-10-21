import type {OptionContract} from '@/types/options';
export type StrikeMetric='volume'|'openInterest';
export type StrikeMetricRow={strike:number;calls:number|null;puts:number|null};
export function strikeMetricRows(calls:OptionContract[],puts:OptionContract[],spot:number,metric:StrikeMetric,width=.25):StrikeMetricRow[]{
 if(!Number.isFinite(spot)||spot<=0)return [];
 const rows=new Map<number,StrikeMetricRow>();
 const add=(contracts:OptionContract[],side:'calls'|'puts')=>{
  for(const contract of contracts){
   if(!Number.isFinite(contract.strike)||contract.strike<=0||Math.abs(contract.strike/spot-1)>width+Number.EPSILON)continue;
   const value=contract[metric];if(value===null||!Number.isFinite(value)||value<0)continue;
   const row=rows.get(contract.strike)??{strike:contract.strike,calls:null,puts:null};
   row[side]=(row[side]??0)+value;rows.set(contract.strike,row);
  }
 };
 add(calls,'calls');add(puts,'puts');return [...rows.values()].sort((a,b)=>a.strike-b.strike);
}

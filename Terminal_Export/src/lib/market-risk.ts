import type {RiskPoint} from '../../../supabase/functions/analyze-ticker/asset-risk';

export function marketRiskSummary(history:RiskPoint[],sessions:number){
 const points=history.slice(-sessions),last=history.at(-1);
 const change=(offset:number)=>{
  const previous=history.at(-1-offset);
  return last?.vol20!=null&&previous?.vol20!=null?last.vol20-previous.vol20:null;
 };
 return {points,last,change1:change(1),change5:change(5),worst:points.length?Math.min(...points.map(p=>p.drawdown)):null};
}

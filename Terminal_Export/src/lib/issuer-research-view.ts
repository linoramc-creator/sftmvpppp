import type {IssuerResearch} from '../../../supabase/functions/analyze-ticker/issuer-research';
export const researchNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export function alignedResearchTarget(data:IssuerResearch){
 const value=data.analysts,currency=value.targetCurrency;
 if(!currency||currency!==data.currency||!researchNumber(value.target)||value.target<=0)return null;
 const reference=researchNumber(value.referencePrice)&&value.referencePrice>0?value.referencePrice:null;
 return {value:value.target,currency,reference,at:value.referenceAt,distance:reference!==null&&researchNumber(value.targetDistancePct)?value.targetDistancePct:null};
}
export function publishedResearchEarnings(rows:IssuerResearch['earnings'],now=Date.now()){
 return rows.filter(row=>researchNumber(row.actual)&&Number.isFinite(Date.parse(row.date))&&Date.parse(row.date)<=now).sort((a,b)=>a.date.localeCompare(b.date)).slice(-8);
}
export function researchRatingRows(data:IssuerResearch){
 return (data.analysts?.ratings??[]).filter(row=>researchNumber(row.count)&&row.count>=0&&Number.isInteger(row.count));
}

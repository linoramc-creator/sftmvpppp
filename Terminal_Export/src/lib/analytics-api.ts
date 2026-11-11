import {authenticatedFetch} from '@/lib/beta-api';
import type {AnalyticsInterpretation,AnalyticsQuery,AnalyticsResult} from '../../../supabase/functions/analyze-ticker/analytics-types';
export type {AnalyticsInterpretation,AnalyticsQuery,AnalyticsResult,AnalyticsMetric,AnalyticsOperation,AnalyticsSeries} from '../../../supabase/functions/analyze-ticker/analytics-types';

export type SavedAnalyticsQuery={id:string;name:string;query:AnalyticsQuery;revision:number;created_at:string;updated_at:string};
async function analyticsApi<T>(accountAction:string,body:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
 const deadline=AbortSignal.timeout(['analyticsInterpret','analyticsRun'].includes(accountAction)?75000:20000);
 const response=await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountAction,...body}),signal:signal?AbortSignal.any([signal,deadline]):deadline});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'No se ha podido completar el análisis.');
 return data as T;
}
export const analyticsInterpret=(prompt:string,signal?:AbortSignal)=>analyticsApi<AnalyticsInterpretation>('analyticsInterpret',{prompt},signal);
export const analyticsRun=(query:AnalyticsQuery,signal?:AbortSignal)=>analyticsApi<AnalyticsResult>('analyticsRun',{query},signal);
export const analyticsList=(signal?:AbortSignal)=>analyticsApi<{items:SavedAnalyticsQuery[]}>('analyticsList',{},signal);
export const analyticsSave=(value:{name:string;query:AnalyticsQuery;id?:string;revision?:number;requestId?:string},signal?:AbortSignal)=>analyticsApi<SavedAnalyticsQuery>('analyticsSave',{...value},signal);
export const analyticsDelete=(value:Pick<SavedAnalyticsQuery,'id'|'revision'>,signal?:AbortSignal)=>analyticsApi<{ok:true}>('analyticsDelete',{id:value.id,revision:value.revision},signal);

export function analyticsSourceUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:'?url.href:null;}catch{return null;}}

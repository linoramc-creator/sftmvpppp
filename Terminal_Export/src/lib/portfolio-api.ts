import {authenticatedFetch} from './beta-api';
import type {PortfolioRecord,PortfolioQuote,PortfolioMetrics,PortfolioMarket,PortfolioOrderInput as ModelOrder} from '../../../supabase/functions/analyze-ticker/portfolio-model';
export type {PortfolioRecord};
export type PortfolioSummary=Omit<PortfolioRecord,'state'>;
export type PortfolioResponse={portfolio:PortfolioRecord;metrics:PortfolioMetrics;market?:PortfolioMarket};
export type PortfolioOrderInput=ModelOrder&{note?:string};
export type PortfolioRisk={asOf:string;currency:'USD';portfolio:{sharpe:number|null;annualizedVolatilityPct:number|null;observations:number;from:string|null;to:string|null;riskFreeRatePct:0;status:'ready'|'insufficient'};assets:{symbol:string;status?:'ready'|'insufficient'|'unavailable';sharpe:number|null;adjustment:'total-return'|'splits'|null;annualizedVolatilityPct:number|null;rolling:{date:string;value:number}[];observations:number;from:string|null;to:string|null}[];notes:string[]};
export async function portfolioApi<T>(action:'list'|'create'|'snapshot'|'quote'|'order'|'cancel'|'cash'|'settings'|'archive'|'journal'|'risk'|'rename',body:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
 const deadline=AbortSignal.timeout(action==='snapshot'?60000:45000);
 const response=await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'portfolioLab',action,...body}),signal:signal?AbortSignal.any([signal,deadline]):deadline});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'No se ha podido completar la operación de la cartera.');return value as T;
}
export const portfolioList=(signal?:AbortSignal)=>portfolioApi<{portfolios:PortfolioSummary[]}>('list',{},signal);
export const portfolioSnapshot=(portfolioId:string,signal?:AbortSignal)=>portfolioApi<PortfolioResponse>('snapshot',{portfolioId},signal);
export const portfolioQuote=(portfolioId:string,symbol:string,signal?:AbortSignal)=>portfolioApi<{quote:PortfolioQuote}>('quote',{portfolioId,symbol},signal);
export const portfolioRisk=(portfolioId:string,signal?:AbortSignal)=>portfolioApi<{analytics:PortfolioRisk}>('risk',{portfolioId},signal);

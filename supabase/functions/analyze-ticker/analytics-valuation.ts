import {cached} from './panels.ts';
import type {AnalyticsValuationInput,AnalyticsValuationMetric,AnalyticsSource} from './analytics-types.ts';

type Row=Record<string,any>;
const object=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const number=(value:unknown):number|null=>{const raw=object(value).raw??value;return typeof raw==='number'&&Number.isFinite(raw)?raw:null;};
const DAY=86400000;
const symbolOk=(symbol:string)=>/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/.test(symbol)&&!symbol.includes('..');

/** Read only direct Yahoo modules. Merged modules without per-field provenance
 * cannot be attributed to Yahoo and are rejected rather than mislabeled. No
 * estimate is reconstructed from a historical share price and today's EPS. */
export function analyticsValuationFromSummary(symbol:string,input:unknown,now=Date.now()):AnalyticsValuationInput|null{
 const root=object(input),raw=object(root.quoteSummary?.result?.[0]??input),qt=object(raw.quoteType),price=object(raw.price),stats=object(raw.defaultKeyStatistics),detail=object(raw.summaryDetail),financial=object(raw.financialData);
 if(!symbolOk(symbol)||raw.eodhd||qt.quoteType!=='EQUITY'||String(qt.symbol??price.symbol??'').toUpperCase()!==symbol)return null;
 const stamp=number(price.regularMarketTime),quoteAt=stamp!==null&&stamp>0&&stamp*1000<=now&&now-stamp*1000<=7*DAY?new Date(stamp*1000).toISOString():null;
 // Current means the latest completed or live quote, not a ratio inferred for
 // a stale/delisted security. Weekends/market holidays may span several days.
 if(!quoteAt||stamp!*1000>now||now-stamp!*1000>7*DAY)return null;
 const get=(...values:unknown[])=>values.map(number).find(value=>value!==null&&value>0)??null;
 const values:Partial<Record<AnalyticsValuationMetric,number|null>>={forwardPeCurrent:get(detail.forwardPE,stats.forwardPE),trailingPeCurrent:get(detail.trailingPE,stats.trailingPE),priceToBookCurrent:get(stats.priceToBook,detail.priceToBook),enterpriseToEbitdaCurrent:get(stats.enterpriseToEbitda)};
 const eps=number(stats.trailingEps);if(eps!==null&&eps<=0)values.trailingPeCurrent=null;
 const book=number(stats.bookValue);if(book!==null&&book<=0)values.priceToBookCurrent=null;
 const ebitda=number(financial.ebitda);if(ebitda!==null&&ebitda<=0)values.enterpriseToEbitdaCurrent=null;
 if(!Object.values(values).some(value=>value!==null))return null;
 const exportAllowed=(()=>{try{return (globalThis as any).Deno?.env?.get('ANALYTICS_DATA_EXPORT_ALLOWED')==='1';}catch{return false;}})();
 const source:AnalyticsSource={id:'yahoo:valuation:'+symbol,name:'Yahoo Finance · múltiplos actuales',url:'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/key-statistics/',fetchedAt:new Date(now).toISOString(),dataThrough:quoteAt,exportAllowed,exportNote:exportAllowed?'Exportación habilitada por el administrador según los derechos contratados.':'La licencia de exportación de datos no está acreditada; gráfico derivado para uso personal.'};
 return {symbol,asOf:new Date(now).toISOString(),quoteAt,currency:typeof price.currency==='string'&&/^[A-Z]{3}$/.test(price.currency)?price.currency:null,values,source,notes:['Instantánea de los múltiplos publicados consultados en esta fecha; no reconstruye su evolución histórica ni conserva las estimaciones conocidas en fechas pasadas.','El PER forward utiliza el múltiplo de previsiones publicado por el proveedor. El horizonte exacto del consenso y su fecha de revisión no se facilitan; no se etiqueta como NTM ni como un ejercicio fiscal concreto.','PER TTM, precio/valor contable y EV/EBITDA conservan la definición publicada por el proveedor; no se recomputan combinando monedas, clases de acciones o periodos incompatibles.']};
}

export type AnalyticsValuationOptions={summary?:(symbol:string)=>Promise<unknown>};
export async function analyticsValuation(symbol:string,options:AnalyticsValuationOptions={}):Promise<AnalyticsValuationInput|null>{
 if(!symbolOk(symbol))return null;
 return cached('analytics-valuation-v1:'+symbol,300000,async()=>{
  let raw:unknown=null;
  try{
   if(options.summary)raw=await options.summary(symbol);
   else{
    const url='https://query2.finance.yahoo.com/v10/finance/quoteSummary/'+encodeURIComponent(symbol)+'?modules=quoteType,financialData,summaryDetail,defaultKeyStatistics,price',response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok){await response.body?.cancel();return null;}
    const reader=response.body?.getReader();if(!reader)return null;const decoder=new TextDecoder();let bytes=0,text='';
    try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>500000)return null;text+=decoder.decode(next.value,{stream:true});}}finally{await reader.cancel();}
    raw=JSON.parse(text+decoder.decode());
   }
  }catch{return null;}
  return analyticsValuationFromSummary(symbol,raw);
 });
}

import {executeAnalytics,validateAnalyticsQuery,analyticsBounds,AnalyticsValidationError} from './analytics-engine.ts';
import {analyticsPrices} from './analytics-providers.ts';
import {analyticsResultAlternatives} from './analytics-recommendations.ts';
import type {AnalyticsDependencies,AnalyticsResult} from './analytics-types.ts';
import type {LabDefinition,LabStudy,LabRun,LabRunDependencies,LabStudyResult,LabAssetMetrics,LabScenario} from './mensorlab-types.ts';

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const reject=(message:string):never=>{throw new AnalyticsValidationError(message);};
const extra=(value:Record<string,unknown>,keys:string[])=>{if(Object.keys(value).some(key=>!keys.includes(key)))reject('El estudio contiene parámetros no admitidos.');};
const name=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=100&&!/[\p{Cc}\p{Cf}<>]/u.test(value);
export const LAB_LIMITS={projects:20,studies:6,assets:8,snapshots:10,runs:10,runHours:48,snapshotBytes:1500000,annualization:252,minimumRiskReturns:20};

export function validateLabDefinition(input:unknown):LabDefinition{
 const raw=record(input);extra(raw,['version','studies']);
 if(raw.version!==1||!Array.isArray(raw.studies)||raw.studies.length<1||raw.studies.length>LAB_LIMITS.studies)reject('Añade entre uno y seis estudios al proyecto.');
 const ids=new Set<string>();
 const studies=(raw.studies as unknown[]).map(value=>{
  const r=record(value);extra(r,['id','name','kind','query','benchmark','weights','cashWeight']);
  if(typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(r.id)||ids.has(r.id)||!name(r.name)||!['comparison','scenario','analytics'].includes(String(r.kind)))reject('Identifica cada estudio con un nombre y un identificador único.');
  ids.add(r.id as string);const query=validateAnalyticsQuery(r.query);
  if(query.metric==='portfolioExposure'||query.portfolioId)reject('Los escenarios son hipotéticos: no acceden al registro de operaciones ni a posiciones del simulador.');
  const kind=r.kind as LabStudy['kind'];
  if(kind==='analytics'){
   if(r.benchmark!==undefined||r.weights!==undefined||r.cashWeight!==undefined)reject('Un gráfico de Analytics no admite pesos o referencia ocultos.');
   return {id:r.id as string,name:(r.name as string).trim(),kind,query};
  }
  if(query.metric!=='price'||query.operation!=='base100'||query.frequency!=='daily'||!['USD','EUR','GBP'].includes(query.currency)||query.chart!=='line')reject('Las comparaciones y escenarios utilizan cierres diarios en base 100, líneas y una moneda común USD, EUR o GBP.');
  if(r.benchmark!==undefined&&(typeof r.benchmark!=='string'||!query.assets.includes(r.benchmark)))reject('La referencia debe estar entre los activos del estudio.');
  if(kind==='comparison'&&(r.weights!==undefined||r.cashWeight!==undefined))reject('Los pesos pertenecen únicamente a escenarios hipotéticos.');
  const out:LabStudy={id:r.id as string,name:(r.name as string).trim(),kind,query,...(r.benchmark?{benchmark:r.benchmark as string}:{})};
  if(kind==='scenario'){
   if(!Array.isArray(r.weights)||r.weights.length>8||r.weights.length<1||!finite(r.cashWeight)||r.cashWeight<0||r.cashWeight>100)reject('Indica pesos positivos y un porcentaje explícito de efectivo.');
   const seen=new Set<string>();const weights=(r.weights as unknown[]).map(value=>{const w=record(value);extra(w,['symbol','weight']);if(typeof w.symbol!=='string'||!query.assets.includes(w.symbol)||seen.has(w.symbol)||!finite(w.weight)||w.weight<0||w.weight>100)reject('Cada peso debe ser único, estar entre 0 y 100 y corresponder a un activo del estudio.');seen.add(w.symbol as string);return {symbol:w.symbol as string,weight:w.weight as number};});
   if(Math.abs(weights.reduce((sum,w)=>sum+w.weight,0)+(r.cashWeight as number)-100)>0.000001)reject('Los pesos y el efectivo deben sumar exactamente 100 %. No se normalizan automáticamente.');
   out.weights=weights;out.cashWeight=r.cashWeight as number;
  }
  return out;
 });
 return {version:1,studies};
}
const average=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
const covariance=(a:number[],b:number[])=>{if(a.length<2||a.length!==b.length)return null;const ma=average(a),mb=average(b);return a.reduce((sum,value,i)=>sum+(value-ma)*(b[i]-mb),0)/(a.length-1);};
const variance=(a:number[])=>covariance(a,a);
const corr=(a:number[],b:number[])=>{const va=variance(a),vb=variance(b),c=covariance(a,b);return c===null||va===null||vb===null||va<=0||vb<=0?null:Math.max(-1,Math.min(1,c/Math.sqrt(va*vb)));};
const pctChange=(values:number[])=>values.length>1?(values.at(-1)!/values[0]-1)*100:null;
const drawdown=(values:number[])=>{if(values.length<2)return null;let peak=values[0],lowest=0;for(const value of values){peak=Math.max(peak,value);lowest=Math.min(lowest,value/peak-1);}return lowest*100;};
const isoDay=(now:number)=>new Date(now).toISOString().slice(0,10);

function studyMetrics(study:LabStudy,analytics:AnalyticsResult,now:number):LabStudyResult{
 const observations=analytics.series.filter(series=>series.points.some(p=>finite(p.value)&&p.value>0));
 const maps=new Map(observations.map(series=>[series.symbol,new Map(series.points.filter(p=>finite(p.value)&&p.value>0).map(p=>[p.date,p.value as number]))]));
 const common=observations.length?observations[0].points.map(p=>p.date).filter(date=>observations.every(series=>maps.get(series.symbol)!.has(date))).sort():[];
 const validIntervals=common.slice(1).map((date,i)=>({date,previous:common[i],index:i+1})).filter(item=>Date.parse(item.date)-Date.parse(item.previous)<=7*86400000);
 const samples=new Map(observations.map(series=>[series.symbol,common.map(date=>maps.get(series.symbol)!.get(date)!)]));
 const returns=new Map(observations.map(series=>{const values=samples.get(series.symbol)!;return [series.symbol,validIntervals.map(item=>values[item.index]/values[item.index-1]-1)] as const;}));
 const benchmark=study.benchmark??(study.kind==='comparison'?study.query.assets.at(-1)??null:null),reference=benchmark?returns.get(benchmark):undefined,referencePrices=benchmark?samples.get(benchmark):undefined;
 const enough=validIntervals.length>=LAB_LIMITS.minimumRiskReturns,stale=!!common.at(-1)&&Date.parse(isoDay(now))-Date.parse(common.at(-1)!)>7*86400000;
 const warnings=[...analytics.warnings];
 if(observations.length<study.query.assets.length)warnings.push('Cobertura parcial: no se excluye silenciosamente del proyecto a los activos sin serie.');
 if(!enough)warnings.push('Se necesitan al menos 20 variaciones de cierres comunes para estimar volatilidad, correlación, beta y riesgo de escenario.');
 if(stale)warnings.push('La última observación común tiene más de siete días. Los resultados describen la muestra publicada, no el mercado actual.');
 if(validIntervals.length<Math.max(0,common.length-1))warnings.push('Se excluyen variaciones entre cierres separados más de siete días; no se interpretan como variaciones de una sesión.');
 const metrics:LabAssetMetrics[]=study.query.assets.map(symbol=>{
  const prices=samples.get(symbol)??[],ret=returns.get(symbol)??[],v=enough?variance(ret):null,rv=reference&&enough?variance(reference):null,c=reference&&enough?covariance(ret,reference):null;
  const missing=!prices.length,notes=[...(analytics.series.find(s=>s.symbol===symbol)?.notes??[])];
  if(missing)notes.push('No hay precios compatibles en la muestra común; no se sustituye por cero.');
  if(!enough)notes.push('Muestra insuficiente para métricas de riesgo.');
  return {symbol,observations:prices.length,returns:ret.length,from:common[0]??null,to:common.at(-1)??null,priceChange:pctChange(prices),volatility:v===null?null:Math.sqrt(Math.max(0,v)*252)*100,drawdown:drawdown(prices),beta:c===null||rv===null||rv<=0?null:c/rv,correlation:reference&&enough?corr(ret,reference):null,relativeStrength:prices.length>1&&referencePrices&&referencePrices.length>1?((prices.at(-1)!/prices[0])/(referencePrices.at(-1)!/referencePrices[0])-1)*100:null,status:missing?'unavailable':!enough||stale||notes.length?'partial':'available',notes};
 });
 const symbols=study.query.assets;
 const result:LabStudyResult={id:study.id,name:study.name,kind:study.kind,analytics,benchmark,metrics,correlations:{symbols,values:symbols.map(a=>symbols.map(b=>enough&&returns.has(a)&&returns.has(b)?corr(returns.get(a)!,returns.get(b)!):null)),observations:validIntervals.length},sample:{from:common[0]??null,to:common.at(-1)??null,observations:common.length,returns:validIntervals.length,annualization:252,minimumRiskReturns:20},methodology:[
  'Métricas sobre las mismas fechas observadas comunes entre las series disponibles, en la moneda elegida. No se interpolan cierres ni se rellenan ausencias con cero.',
  'Variación de precio = último cierre / primer cierre − 1. Cierres ajustados por splits, sin reinversión de dividendos: no representa rentabilidad total.',
  'Volatilidad = desviación típica muestral de variaciones simples × √252. La convención es de 252 observaciones anuales, también si un activo negocia otros días; no es una previsión.',
  'Drawdown = mayor descenso desde un máximo de cierre dentro de la muestra común. Beta = covarianza del activo y referencia / varianza de referencia; correlación de Pearson.',
  'Fortaleza relativa = (variación multiplicativa del activo / variación multiplicativa de la referencia − 1) × 100; no implica causalidad ni una recomendación.',
 ],warnings};
 if(study.kind==='scenario'){
  const weights=study.weights!,cashWeight=study.cashWeight!,positive=weights.filter(w=>w.weight>0),coveredWeight=positive.filter(w=>returns.has(w.symbol)&&returns.get(w.symbol)!.length>0).reduce((sum,w)=>sum+w.weight,0)+cashWeight;
  const covered=positive.every(w=>returns.has(w.symbol)&&returns.get(w.symbol)!.length>0),portfolioReturns=covered&&enough?validIntervals.map((_,i)=>positive.reduce((sum,w)=>sum+w.weight/100*returns.get(w.symbol)![i],0)):[];
  const v=portfolioReturns.length?variance(portfolioReturns):null,risk=v===null?null:Math.sqrt(Math.max(0,v)*252)*100;
  const weightedIndividualVolatility=risk===null?null:positive.reduce((sum,w)=>sum+w.weight/100*metrics.find(m=>m.symbol===w.symbol)!.volatility!,0);
  const hhi=weights.reduce((sum,w)=>sum+w.weight*w.weight,0)+cashWeight*cashWeight;
  const scenario:LabScenario={weights:weights.map(w=>({...w,covered:returns.has(w.symbol)&&returns.get(w.symbol)!.length>0})),cashWeight,coveredWeight,concentration:hhi,effectiveHoldings:hhi>0?10000/hhi:null,largestWeight:Math.max(cashWeight,...weights.map(w=>w.weight)),annualizedVolatility:risk,weightedIndividualVolatility,diversificationBenefit:risk!==null&&weightedIndividualVolatility!==null?weightedIndividualVolatility-risk:null,observations:portfolioReturns.length,from:common[0]??null,to:common.at(-1)??null,status:!covered||!enough?'unavailable':stale?'partial':'available',notes:[
   'Escenario hipotético independiente: no consulta ni modifica posiciones, órdenes, saldo o valoración del portfolio simulado.',
   'Riesgo estimado = √(wᵀΣw × 252), con covarianza histórica muestral y los pesos indicados. No se simula una trayectoria de patrimonio ni una estrategia histórica.',
   'El efectivo se supone constante: variación y riesgo cero, sin interés ni garantía de conservación de poder adquisitivo. No se modelan impuestos, comisiones, liquidez ni rebalanceos.',
   'HHI = suma de pesos porcentuales al cuadrado, incluido efectivo; número efectivo de posiciones = 10000 / HHI.',
   ...(!covered?['Falta una posición con peso positivo: el riesgo agregado queda desconocido, sin renormalizar el resto.']:[]),
  ]};
  result.scenario=scenario;result.methodology.push(...scenario.notes);
 }
 return result;
}

export function mensorLabResultStatus(results:LabStudyResult[]):LabRun['status']{
 const statuses=results.map(result=>result.analytics.status==='unavailable'?'unavailable':result.warnings.length||result.analytics.status==='partial'||result.scenario?.status==='unavailable'?'partial':'complete');
 return statuses.every(status=>status==='unavailable')?'unavailable':statuses.every(status=>status==='complete')?'complete':'partial';
}
export async function executeMensorLab(input:unknown,deps:LabRunDependencies={}):Promise<LabRun>{
 const definition=validateLabDefinition(input),now=deps.now??Date.now(),cache=new Map<string,Promise<Awaited<ReturnType<NonNullable<AnalyticsDependencies['prices']>>>> >();
 // Check every date range before any provider work, including later studies.
 for(const study of definition.studies)analyticsBounds(study.query,now);
 const prices:NonNullable<AnalyticsDependencies['prices']>=(symbol,from,to)=>{const key=[symbol,from,to].join(':');if(!cache.has(key))cache.set(key,(deps.prices??analyticsPrices)(symbol,from,to).catch(()=>null));return cache.get(key)!;};
 // Sequential studies keep provider concurrency bounded to the existing eight
 // per query; identical raw asset windows share a single promise for this run.
 const results:LabStudyResult[]=[];
 for(const study of definition.studies){const analytics=await(deps.execute??executeAnalytics)(study.query,{now,prices,fundamentals:deps.fundamentals,valuation:deps.valuation,fx:deps.fx});
  const alternatives=new Set(analytics.alternatives.map(item=>JSON.stringify(item.query)));
  for(const alternative of analyticsResultAlternatives(analytics))if(!alternatives.has(JSON.stringify(alternative.query))){analytics.alternatives.push(alternative);alternatives.add(JSON.stringify(alternative.query));}
  results.push(study.kind==='analytics'?{id:study.id,name:study.name,kind:study.kind,analytics,benchmark:null,metrics:[],correlations:{symbols:[],values:[],observations:0},sample:{from:analytics.from,to:analytics.to,observations:analytics.table.length,returns:0,annualization:252,minimumRiskReturns:20},methodology:analytics.methodology,warnings:analytics.warnings}:studyMetrics(study,analytics,now));
 }
 const run:LabRun={runId:crypto.randomUUID(),definition,generatedAt:new Date(now).toISOString(),results,status:mensorLabResultStatus(results),warnings:['Investigación descriptiva con cobertura disponible. Los escenarios no son predicciones ni recomendaciones de inversión.']};
 if(new TextEncoder().encode(JSON.stringify(run)).length>LAB_LIMITS.snapshotBytes)reject('El proyecto supera el límite de 1,5 MB por instantánea. Reduce estudios, activos o periodo; no se recortan datos silenciosamente.');
 return run;
}

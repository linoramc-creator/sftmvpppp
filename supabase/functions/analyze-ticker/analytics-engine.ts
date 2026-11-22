import type {AnalyticsDependencies,AnalyticsFrequency,AnalyticsFundamentalInput,AnalyticsMetric,AnalyticsPoint,AnalyticsQuery,AnalyticsResult,AnalyticsSeries,AnalyticsSource} from './analytics-types.ts';
import {analyticsFundamentals,analyticsPrices,analyticsFx} from './analytics-providers.ts';
import {analyticsValuation} from './analytics-valuation.ts';
export type {AnalyticsQuery,AnalyticsResult,AnalyticsDependencies} from './analytics-types.ts';

export class AnalyticsValidationError extends Error {
  readonly code:string;
  constructor(message:string,code='invalid'){super(message);this.name='AnalyticsValidationError';this.code=code;}
}
export const ANALYTICS_CATALOG = {
  price:{label:'Precio de cierre',kind:'price'},realizedVolatility:{label:'Volatilidad realizada móvil',kind:'computed-price'},drawdown:{label:'Drawdown desde máximo de cierre',kind:'computed-price'},rollingCorrelation:{label:'Correlación móvil',kind:'computed-price'},rollingBeta:{label:'Beta móvil',kind:'computed-price'},relativeStrength:{label:'Fortaleza relativa',kind:'computed-price'},revenue:{label:'Ingresos',kind:'flow'},netIncome:{label:'Beneficio neto',kind:'flow'},grossProfit:{label:'Beneficio bruto',kind:'flow'},operatingIncome:{label:'Beneficio operativo',kind:'flow'},researchDevelopment:{label:'Investigación y desarrollo',kind:'flow'},operatingCashFlow:{label:'Flujo de caja operativo',kind:'flow'},freeCashFlow:{label:'Flujo de caja libre',kind:'flow'},capex:{label:'CapEx total',kind:'flow'},capexAI:{label:'CapEx específico de IA',kind:'unavailable'},cash:{label:'Efectivo y equivalentes',kind:'stock'},totalDebt:{label:'Deuda total',kind:'stock'},netDebt:{label:'Deuda neta',kind:'stock'},currentAssets:{label:'Activos corrientes',kind:'stock'},currentLiabilities:{label:'Pasivos corrientes',kind:'stock'},forwardPeCurrent:{label:'PER forward · instantánea actual',kind:'snapshot'},trailingPeCurrent:{label:'PER TTM · instantánea actual',kind:'snapshot'},priceToBookCurrent:{label:'Precio / valor contable · actual',kind:'snapshot'},enterpriseToEbitdaCurrent:{label:'EV / EBITDA · actual',kind:'snapshot'},equity:{label:'Patrimonio neto',kind:'stock'},totalAssets:{label:'Activos totales',kind:'stock'},portfolioExposure:{label:'Exposición del portfolio',kind:'portfolio'},
} as const;
const METRICS=new Set(Object.keys(ANALYTICS_CATALOG));
const OPS=new Set(['level','base100','growth_yoy','growth_qoq','ratio']);
const FREQ=new Set(['daily','weekly','monthly','quarterly','annual']);
const RATIO_PAIRS=new Set(['netIncome/revenue','grossProfit/revenue','freeCashFlow/revenue','operatingCashFlow/revenue','capex/revenue','totalDebt/equity','totalDebt/totalAssets','cash/totalDebt','operatingIncome/revenue','researchDevelopment/revenue','currentAssets/currentLiabilities','cash/currentLiabilities','capex/operatingCashFlow']);
export const ANALYTICS_VALUATION_METRICS=new Set<AnalyticsMetric>(['forwardPeCurrent','trailingPeCurrent','priceToBookCurrent','enterpriseToEbitdaCurrent']);
const TIMES_RATIOS=new Set(['totalDebt/equity','cash/totalDebt','currentAssets/currentLiabilities','cash/currentLiabilities']);
export const ANALYTICS_PRICE_STUDIES=new Set<AnalyticsMetric>(['realizedVolatility','drawdown','rollingCorrelation','rollingBeta','relativeStrength']);
const ROLLING_METRICS=new Set<AnalyticsMetric>(['realizedVolatility','rollingCorrelation','rollingBeta']);
const RELATION_METRICS=new Set<AnalyticsMetric>(['rollingCorrelation','rollingBeta','relativeStrength']);
const DAY=86400000;
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const currency=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z]{3}$/.test(v);
const symbol=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/.test(v)&&!v.includes('..');
const noExtra=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))throw new AnalyticsValidationError('La consulta contiene parámetros no admitidos.');};

/** Only the versioned catalog is executable. Unknown fields/operations never
 * become provider URLs, expressions, generated code or database statements. */
export function validateAnalyticsQuery(input:unknown):AnalyticsQuery {
  const r=object(input);noExtra(r,['version','assets','metric','operation','denominator','period','frequency','currency','chart','dataKind','portfolioId','window','benchmark']);
  if(r.version!==1||!METRICS.has(String(r.metric))||!OPS.has(String(r.operation))||!FREQ.has(String(r.frequency))||!['original','USD','EUR','GBP'].includes(String(r.currency))||!['line','bar','scatter'].includes(String(r.chart))||r.dataKind!==(r.metric==='forwardPeCurrent'?'estimate':'reported'))throw new AnalyticsValidationError('Revisa la métrica, operación, frecuencia y tipo de datos. Las previsiones solo se admiten en la instantánea forward identificada del catálogo.');
  if(!Array.isArray(r.assets)||r.assets.length>8||r.assets.some(s=>!symbol(s)))throw new AnalyticsValidationError('Indica hasta ocho símbolos válidos.');
  const assets=[...new Set((r.assets as string[]).map(s=>s==='GOOG'?'GOOGL':s))];
  if(r.metric!=='portfolioExposure'&&!assets.length)throw new AnalyticsValidationError('Selecciona al menos un activo.');
  if(r.portfolioId!==undefined&&(typeof r.portfolioId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.portfolioId)))throw new AnalyticsValidationError('El identificador de portfolio no es válido.');
  if(r.metric!=='portfolioExposure'&&r.portfolioId!==undefined)throw new AnalyticsValidationError('El portfolio solo se utiliza para analizar sus exposiciones.');
  const p=object(r.period);noExtra(p,['range','from','to']);
  if(!['1y','2y','5y','custom'].includes(String(p.range)))throw new AnalyticsValidationError('Elige un periodo de uno, dos o cinco años, o fechas concretas.');
  if(p.range==='custom'){
    if(!day(p.from)||!day(p.to)||p.from>p.to||Date.parse(p.to)-Date.parse(p.from)>10*366*DAY)throw new AnalyticsValidationError('Las fechas deben ser válidas, ordenadas y cubrir como máximo diez años.');
  }else if(p.from!==undefined||p.to!==undefined)throw new AnalyticsValidationError('Un periodo móvil no admite fechas fijas ocultas.');
  const metric=r.metric as AnalyticsMetric,operation=r.operation as AnalyticsQuery['operation'];
  const snapshot=ANALYTICS_VALUATION_METRICS.has(metric),advanced=ANALYTICS_PRICE_STUDIES.has(metric),rolling=ROLLING_METRICS.has(metric),related=RELATION_METRICS.has(metric);
  if(advanced&&(operation!=='level'||!['daily','weekly','monthly'].includes(String(r.frequency))))throw new AnalyticsValidationError('Los estudios de riesgo y relaciones utilizan nivel y frecuencia de visualización diaria, semanal o mensual.');
  if(rolling&&r.window!==undefined&&![20,60,120].includes(r.window as number))throw new AnalyticsValidationError('Elige una ventana de 20, 60 o 120 variaciones de cierres observados.');
  if(!rolling&&r.window!==undefined)throw new AnalyticsValidationError('La ventana solo se utiliza para volatilidad, correlación o beta móviles.');
  const benchmark=typeof r.benchmark==='string'&&r.benchmark==='GOOG'?'GOOGL':r.benchmark;
  if(related&&(!symbol(benchmark)||!assets.includes(benchmark)||assets.length<2||r.currency==='original'))throw new AnalyticsValidationError('Incluye una referencia explícita entre al menos dos activos y elige USD, EUR o GBP para homogeneizar la divisa.');
  if(!related&&r.benchmark!==undefined)throw new AnalyticsValidationError('La referencia solo se admite para correlación móvil, beta móvil o fortaleza relativa.');
  if(snapshot&&(operation!=='level'||r.frequency!=='daily'||r.chart!=='bar'))throw new AnalyticsValidationError('Los múltiplos actuales son una instantánea fechada: nivel, frecuencia diaria y barras, sin evolución histórica.');
  if(metric==='price'&&(!['daily','weekly','monthly'].includes(String(r.frequency))||!['level','base100'].includes(operation)))throw new AnalyticsValidationError('Los precios admiten niveles o base 100 con frecuencia diaria, semanal o mensual.');
  if(metric==='portfolioExposure'&&(operation!=='level'||r.frequency!=='daily'||r.chart!=='bar'||assets.length))throw new AnalyticsValidationError('La exposición utiliza las posiciones actuales del portfolio, sin una cartera duplicada. Usa barras, nivel y frecuencia diaria.');
  if(metric==='portfolioExposure'&&r.currency!=='original')throw new AnalyticsValidationError('La exposición reutiliza la moneda de la valoración existente. Selecciona moneda original.');
  if(!['price','portfolioExposure'].includes(metric)&&!advanced&&!snapshot&&!['quarterly','annual'].includes(String(r.frequency)))throw new AnalyticsValidationError('Los fundamentales publicados admiten frecuencia trimestral o anual.');
  if(metric!=='price'&&operation==='base100')throw new AnalyticsValidationError('La base 100 inicial está disponible para precios de cierre.');
  if(operation==='growth_qoq'&&r.frequency!=='quarterly')throw new AnalyticsValidationError('El crecimiento entre trimestres requiere datos trimestrales.');
  if(operation==='ratio'){
    if(!METRICS.has(String(r.denominator))||!RATIO_PAIRS.has(metric+'/'+r.denominator))throw new AnalyticsValidationError('Ese ratio no tiene una combinación compatible en el catálogo.');
  }else if(r.denominator!==undefined)throw new AnalyticsValidationError('El denominador solo se admite para un ratio.');
  if(metric==='capexAI'&&operation==='ratio')throw new AnalyticsValidationError('No hay un desglose normalizado de CapEx de IA para formar ese ratio.');
  return {version:1,assets,metric,operation,...(operation==='ratio'?{denominator:r.denominator as AnalyticsMetric}:{}),period:{range:p.range as AnalyticsQuery['period']['range'],...(p.range==='custom'?{from:p.from as string,to:p.to as string}:{})},frequency:r.frequency as AnalyticsFrequency,currency:r.currency as AnalyticsQuery['currency'],chart:r.chart as AnalyticsQuery['chart'],dataKind:metric==='forwardPeCurrent'?'estimate':'reported',...(r.portfolioId?{portfolioId:r.portfolioId as string}:{}),...(rolling?{window:(r.window??20) as 20|60|120}:{}),...(related?{benchmark:benchmark as string}:{})};
}
export function analyticsBounds(query:AnalyticsQuery,now=Date.now()):{from:string;to:string} {
  const to=new Date(now).toISOString().slice(0,10);
  if(query.period.range==='custom'){
    if(query.period.to!>to)throw new AnalyticsValidationError('Las previsiones y las fechas futuras no forman parte de este catálogo.');
    return {from:query.period.from!,to:query.period.to!};
  }
  const from=new Date(to+'T00:00:00Z');from.setUTCFullYear(from.getUTCFullYear()-Number(query.period.range.slice(0,-1)));
  return {from:from.toISOString().slice(0,10),to};
}
const sourceOk=(s:AnalyticsSource|undefined)=>Boolean(s&&typeof s.id==='string'&&s.id.length<=100&&typeof s.name==='string'&&s.name.length<=200&&/^https:\/\//.test(s.url)&&typeof s.fetchedAt==='string'&&Number.isFinite(Date.parse(s.fetchedAt)));
function emptySeries(symbol:string,query:AnalyticsQuery,note:string):AnalyticsSeries{return {id:symbol,symbol,label:symbol,unit:unit(query,null),currency:null,points:[],status:'unavailable',sourceIds:[],notes:[note]};}
function unit(query:AnalyticsQuery,money:string|null):string {
  if(ANALYTICS_VALUATION_METRICS.has(query.metric))return 'x';
  if(ANALYTICS_PRICE_STUDIES.has(query.metric))return ['rollingCorrelation','rollingBeta'].includes(query.metric)?'x':'%';
  if(query.operation==='base100')return 'base 100';
  if(query.operation.startsWith('growth_'))return '%';
  if(query.operation==='ratio')return TIMES_RATIOS.has(query.metric+'/'+query.denominator)?'x':'%';
  return query.metric==='portfolioExposure'?'% del patrimonio':money??'moneda no disponible';
}
function makeResult(query:AnalyticsQuery,now:number):AnalyticsResult {
  const bounds=analyticsBounds(query,now),label=ANALYTICS_CATALOG[query.metric].label;
  return {version:1,query,generatedAt:new Date(now).toISOString(),...bounds,title:query.operation==='base100'?'Evolución de precios · base 100':query.operation==='growth_yoy'?label+' · crecimiento interanual':query.operation==='growth_qoq'?label+' · crecimiento entre trimestres':query.operation==='ratio'?label+' / '+ANALYTICS_CATALOG[query.denominator!].label:label,status:'unavailable',series:[],table:[],sources:[],methodology:[query.dataKind==='estimate'?'Estimaciones publicadas por el proveedor, identificadas como una instantánea actual; no son resultados realizados. Las ausencias se conservan como nulos. No se reconstruyen estimaciones pasadas.':'Solo datos publicados; las ausencias se conservan como nulos. No se estiman valores ni se completan con cero.'],warnings:[],alternatives:[],export:{chart:false,table:false,reason:'No hay observaciones para exportar.'}};
}
function finish(result:AnalyticsResult):AnalyticsResult {
  const dates=[...new Set(result.series.flatMap(s=>s.points.map(p=>p.date)))].sort();
  const maps=result.series.map(s=>new Map(s.points.map(p=>[p.date,p.value])));
  result.table=dates.map(date=>({date,values:Object.fromEntries(result.series.map((s,i)=>[s.id,maps[i].get(date)??null]))}));
  const count=result.series.reduce((sum,s)=>sum+s.points.filter(p=>p.value!==null).length,0);
  result.status=!count?'unavailable':result.series.some(s=>s.status!=='complete')||result.warnings.length?'partial':'complete';
  result.sources=[...new Map(result.sources.map(s=>[s.id,s])).values()];
  const used=result.sources.filter(source=>result.series.some(series=>series.points.some(p=>p.value!==null&&(p.sourceId===source.id||p.sourceIds?.includes(source.id)))));
  const table=count>0&&used.length>0&&used.every(s=>s.exportAllowed);
  result.export={chart:count>0,table,reason:!count?'No hay observaciones para exportar.':table?'Exportación para uso autorizado; conserva atribución, definición y metodología.':'El gráfico derivado se puede descargar para uso personal. La exportación de la tabla de datos está desactivada porque no se han acreditado sus derechos de redistribución.'};
  return result;
}
function cleanPrices(input:unknown,from:string,to:string):{date:string;value:number}[] {
  if(!Array.isArray(input))return [];
  const values=new Map<string,number>(),conflicts=new Set<string>();
  for(const p of input.slice(0,4000)){if(!day(p?.date)||p.date<from||p.date>to||!finite(p?.value)||p.value<=0)continue;if(values.has(p.date)&&values.get(p.date)!==p.value){conflicts.add(p.date);continue;}values.set(p.date,p.value);}
  return [...values].filter(([date])=>!conflicts.has(date)).map(([date,value])=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date));
}
function samplePrices(points:{date:string;value:number}[],frequency:AnalyticsFrequency){
  if(frequency==='daily')return points;
  const groups=new Map<string,typeof points[number]>();
  for(const p of points){const d=new Date(p.date+'T12:00:00Z');if(frequency==='weekly')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const key=frequency==='weekly'?d.toISOString().slice(0,10):p.date.slice(0,7);groups.set(key,p);}
  return [...groups.values()];
}
async function priceResult(result:AnalyticsResult,deps:AnalyticsDependencies,now:number){
  const q=result.query,load=deps.prices??analyticsPrices;
  const data=await Promise.all(q.assets.map(async s=>{try{return await load(s,result.from,result.to);}catch{return null;}}));
  const prepared=await Promise.all(data.map(async (raw,i)=>{
    const symbol=q.assets[i];if(!raw||raw.symbol!==symbol||!sourceOk(raw.source))return {symbol,points:[],money:null,source:null,notes:['No hay una serie de precios verificable para este activo.']};
    let points=cleanPrices(raw.points,result.from,result.to),money=currency(raw.currency)?raw.currency:null;
    const notes=[...(raw.notes??[])],fxSources:AnalyticsSource[]=[];
    if(raw.adjustment!=='split-adjusted-price'&&q.operation==='base100'){
      points=[];notes.push('La fuente no acredita el ajuste exclusivo por splits. No se calcula una base 100 que pueda confundir una operación corporativa con una caída.');
    }
    if(q.currency!=='original'&&money!==q.currency){
      if(!money){points=[];notes.push('La moneda de cotización no está identificada.');}
      else {const converted=await convertDated(points,money,q.currency,deps);points=converted.points;money=q.currency;notes.push(...converted.notes);fxSources.push(...converted.sources);}
    }
    return {symbol,points,money,source:raw.source,fxSources,notes};
  }));
  const available=prepared.filter(p=>p.points.length),dateSets=available.map(series=>new Set(series.points.map(point=>point.date))),common=available.length?available[0].points.map(point=>point.date).filter(date=>dateSets.every(dates=>dates.has(date))):[];
  // Every base-100 series uses one common first date. Do not quietly rebase a
  // late listing to its own IPO date or forward-fill another exchange's holiday.
  const commonStart=q.operation==='base100'?samplePrices(common.map(date=>({date,value:1})),q.frequency)[0]?.date:null;
  if(q.operation==='base100')result.methodology.push('Base 100 = cierre / cierre de la primera fecha común × 100. Se utilizan precios ajustados por splits, sin reinversión de dividendos; no es rentabilidad total. Solo se representan fechas observadas comunes, sin interpolación.');
  else result.methodology.push('Cierres de sesión completos. Se excluye una sesión en curso. Precio no equivale a rentabilidad total.');
  if(q.frequency!=='daily')result.methodology.push('La frecuencia '+(q.frequency==='weekly'?'semanal':'mensual')+' toma el último cierre observado de cada periodo; el último periodo puede estar incompleto.');
  if(available.length>1&&q.currency==='original'&&new Set(available.map(p=>p.money)).size>1)result.warnings.push(q.operation==='base100'?'Comparación en las monedas de origen: la base 100 elimina la escala, pero no incorpora el efecto de divisa de un inversor.':'Las series tienen monedas distintas; los niveles monetarios no son directamente comparables. Elige una moneda común para convertirlas.');
  if(q.operation==='base100'&&common.length<2)result.warnings.push('No hay al menos dos fechas comunes para calcular una comparación base 100.');
  if(q.operation==='base100'&&commonStart&&commonStart>result.from)result.methodology.push('Primera observación común: '+commonStart+'. La fecha inicial solicitada puede ser festiva o preceder al comienzo de una serie.');
  prepared.forEach(p=>{
    if(p.source)result.sources.push(p.source);
    result.sources.push(...(p.fxSources??[]));
    let points=p.points;
    if(q.operation==='base100')points=common.length>=2?points.filter(point=>common.includes(point.date)):[];
    const sampled=samplePrices(points,q.frequency),first=sampled[0]?.value;
    const ids=[...(p.source?[p.source.id]:[]),...(p.fxSources??[]).map(s=>s.id)];
    const observations:AnalyticsPoint[]=sampled.map(point=>({date:point.date,value:q.operation==='base100'&&first?point.value/first*100:point.value,originalValue:point.value,currency:p.money,periodType:'price',status:'available',sourceId:p.source?.id??'',sourceIds:ids}));
    result.series.push({id:p.symbol,symbol:p.symbol,label:p.symbol,unit:unit(q,p.money),currency:q.operation==='base100'?null:p.money,points:observations,status:observations.length?(p.notes.length?'partial':'complete'):'unavailable',sourceIds:ids,notes:p.notes});
  });
}
const sampleCovariance=(a:number[],b:number[]):number|null=>{
  if(a.length<2||a.length!==b.length)return null;
  const ma=a.reduce((sum,value)=>sum+value/a.length,0),mb=b.reduce((sum,value)=>sum+value/b.length,0);
  const value=a.reduce((sum,current,i)=>sum+(current-ma)*(b[i]-mb)/(a.length-1),0);
  return finite(value)?value:null;
};
/** Code-only daily studies; resampling happens after calculation. A bounded
 * pre-window supplies trailing observations and can never introduce lookahead. */
async function advancedPriceResult(result:AnalyticsResult,deps:AnalyticsDependencies,now:number){
  const q=result.query,rolling=ROLLING_METRICS.has(q.metric),related=RELATION_METRICS.has(q.metric),window=q.window??20;
  const warmupDays=rolling?Math.min(365,window*3+14):0;
  const start=new Date(result.from+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-warmupDays);
  const priceQuery:AnalyticsQuery={version:1,assets:q.assets,metric:'price',operation:'base100',period:q.period,frequency:'daily',currency:q.currency,chart:'line',dataKind:'reported'};
  const raw=makeResult(priceQuery,now);raw.from=start.toISOString().slice(0,10);
  await priceResult(raw,deps,now);
  result.sources.push(...raw.sources);
  result.title=ANALYTICS_CATALOG[q.metric].label+(rolling?' · '+window+' sesiones':'')+(related?' · referencia '+q.benchmark:'');
  const bySymbol=new Map(raw.series.map(series=>[series.symbol,series]));
  const maps=new Map(raw.series.map(series=>[series.symbol,new Map(series.points.filter(point=>finite(point.originalValue)&&point.originalValue!>0).map(point=>[point.date,point.originalValue as number]))]));
  const common=[...new Set(raw.series.flatMap(series=>series.points.map(point=>point.date)))].sort(),indexByDate=new Map(common.map((date,index)=>[date,index]));
  const gaps=common.map((date,index)=>index>0&&Date.parse(date)-Date.parse(common[index-1])<=7*DAY);
  const closes=new Map(q.assets.map(symbol=>[symbol,common.map(date=>maps.get(symbol)?.get(date))]));
  const dailyChanges=new Map(q.assets.map(symbol=>{const values=closes.get(symbol)!;return [symbol,values.map((current,index)=>{const previous=values[index-1],change=finite(previous)&&finite(current)&&gaps[index]?current/previous-1:null;return finite(change)?change:null;})] as const;}));
  const visible=common.filter(date=>date>=result.from&&date<=result.to),reference=q.benchmark?maps.get(q.benchmark):undefined;
  const first=visible.find(date=>!related||reference?.has(date))??null;
  // base-100 helper stores currency=null on derived series; inspect each price
  // point's converted currency, preserving the actual observed FX requirements.
  const badCurrency=related&&raw.series.some(series=>series.points.some(point=>point.value!==null&&point.currency!==q.currency));
  result.methodology.push('Cálculo determinista sobre cierres diarios ajustados únicamente por splits, sin dividendos reinvertidos. No es rentabilidad total, previsión ni señal de ejecución.');
  result.methodology.push('Se utilizan fechas observadas comunes entre las series disponibles. Activos sin cobertura permanecen ausentes; no se rellenan precios ni divisas, ni se arrastran observaciones.');
  if(q.currency==='original')result.methodology.push('Cada activo conserva su moneda de cotización. La volatilidad y el drawdown no incorporan el riesgo de una conversión a la moneda de otro inversor.');
  else result.methodology.push('Precios homogeneizados a '+q.currency+' con el cambio observado de cada fecha; las fechas sin cambio verificable se excluyen.');
  if(rolling){
    result.methodology.push('Ventana móvil de '+window+' cambios simples entre '+(window+1)+' cierres diarios observados. Se requieren todos los cambios de la ventana; una variación no finita o un intervalo superior a siete días deja el resultado nulo. No se acorta ni renormaliza la ventana.');
    result.methodology.push('Precalentamiento: se solicitan '+warmupDays+' días naturales anteriores al periodo visible, desde '+raw.from+'. Solo se usan observaciones conocidas hasta cada fecha; no se muestra ni se utiliza información futura.');
  }
  if(q.metric==='realizedVolatility')result.methodology.push('Volatilidad realizada = desviación típica muestral de los cambios simples × √252 × 100. Convención de 252 sesiones anuales también para activos con otros calendarios; cada punto conserva sus fechas y tamaño de muestra.');
  if(q.metric==='rollingCorrelation')result.methodology.push('Correlación móvil de Pearson frente a '+q.benchmark+': covarianza muestral / producto de desviaciones típicas. Una varianza nula deja el coeficiente indefinido. La correlación no prueba causalidad.');
  if(q.metric==='rollingBeta')result.methodology.push('Beta móvil frente a '+q.benchmark+' = covarianza muestral de cambios / varianza muestral de la referencia. Una varianza nula de la referencia deja beta indefinida.');
  if(q.metric==='drawdown')result.methodology.push('Drawdown de cierre = (cierre / máximo de cierre observado desde el inicio visible − 1) × 100. El máximo se inicia en la primera observación del periodo mostrado; no es un máximo histórico anterior ni utiliza precios futuros.');
  if(q.metric==='relativeStrength')result.methodology.push('Fortaleza relativa = ((precio / precio inicial) / (precio de referencia / referencia inicial) − 1) × 100. Ambas bases usan la primera fecha visible común, '+(first??'no disponible')+'. Excluye dividendos y no atribuye causas.');
  if(related)result.methodology.push('La propia referencia '+q.benchmark+' se conserva como serie: correlación/beta 1 cuando existe varianza, o fortaleza relativa 0. No se presenta como un activo independiente.');
  if(q.frequency!=='daily')result.methodology.push('Visualización '+(q.frequency==='weekly'?'semanal':'mensual')+': último punto diario observado de cada periodo, incluidos sus nulos; la ventana sigue expresada en sesiones diarias.');
  if(!visible.length)result.warnings.push('No hay cierres comunes verificables dentro del periodo solicitado.');
  if(related&&!reference?.size)result.warnings.push('No se dispone de una serie compatible para la referencia seleccionada; las relaciones se conservan como desconocidas.');
  if(badCurrency)result.warnings.push('No se han homogeneizado todas las monedas; no se calculan relaciones con divisas incompatibles.');
  if(visible.at(-1)&&now-Date.parse(visible.at(-1)!+'T23:59:59Z')>7*DAY)result.warnings.push('La última observación común tiene más de siete días; el gráfico describe la muestra publicada, no el mercado actual.');
  for(const symbol of q.assets){
    const source=bySymbol.get(symbol),ids=[...new Set([...(source?.sourceIds??[]),...(related?(bySymbol.get(q.benchmark!)?.sourceIds??[]):[])])],notes=[...(source?.notes??[])];
    const ownChanges=dailyChanges.get(symbol)!,referenceChangesByDate=q.benchmark?dailyChanges.get(q.benchmark):undefined,ownCloses=closes.get(symbol)!,referenceCloses=q.benchmark?closes.get(q.benchmark):undefined,knownPrefix=[0];
    for(let i=0;i<common.length;i++)knownPrefix.push(knownPrefix[i]+(finite(ownCloses[i])&&(!related||finite(referenceCloses?.[i]))?1:0));
    let peak:number|null=null,initial:number|null=null,initialReference:number|null=null,observed=0,observedFrom:string|null=null;
    const points:AnalyticsPoint[]=visible.map(date=>{
      const index=indexByDate.get(date)!,sampleStart=Math.max(0,index-window),value=ownCloses[index],referenceValue=referenceCloses?.[index],sampleDates=rolling?common.slice(sampleStart,index+1):[];
      if(finite(value)&&(!related||finite(referenceValue))){observed++;observedFrom??=date;}
      const changes:number[]=[],referenceChanges:number[]=[];
      if(rolling)for(let i=sampleStart+1;i<=index;i++){
        const change=ownChanges[i],referenceChange=referenceChangesByDate?.[i];
        if(!finite(change)||related&&!finite(referenceChange))continue;
        changes.push(change);if(finite(referenceChange))referenceChanges.push(referenceChange);
      }
      let computed:number|null=null,detail:string|undefined;
      if(!finite(value))detail='Cierre compatible ausente para este activo; no se utiliza cero.';
      else if(related&&(!finite(referenceValue)||badCurrency))detail='Referencia o divisa compatible ausente; no se sustituye por otro índice.';
      else if(rolling){
        if(changes.length!==window||sampleDates.length!==window+1)detail='Ventana incompleta: '+changes.length+' cambios válidos de '+window+' requeridos. No se estima una ventana más corta.';
        else if(q.metric==='realizedVolatility'){const variance=sampleCovariance(changes,changes);computed=variance===null?null:Math.sqrt(Math.max(0,variance))*Math.sqrt(252)*100;}
        else {const variance=sampleCovariance(referenceChanges,referenceChanges),covariance=sampleCovariance(changes,referenceChanges);if(q.metric==='rollingBeta')computed=variance!==null&&variance>0&&covariance!==null?covariance/variance:null;else{const own=sampleCovariance(changes,changes);computed=variance!==null&&variance>0&&own!==null&&own>0&&covariance!==null?Math.max(-1,Math.min(1,covariance/Math.sqrt(variance)/Math.sqrt(own))):null;}if(computed===null)detail='La varianza necesaria es nula o no verificable; el coeficiente queda indefinido.';}
      }else if(q.metric==='drawdown'){peak=peak===null?value:Math.max(peak,value);computed=(value/peak-1)*100;}
      else if(q.metric==='relativeStrength'){if(initial===null){initial=value;initialReference=referenceValue!;}computed=((value/initial)/(referenceValue!/initialReference!)-1)*100;}
      if(!finite(computed)){computed=null;detail??='El cálculo no tiene una muestra numérica compatible.';}
      return {date,value:computed,currency:null,periodType:'price',status:computed===null?'missing':'available',sourceId:ids[0]??'',sourceIds:ids,...(detail?{detail}:{}),sample:{from:rolling?sampleDates[0]??null:observedFrom,to:date,observations:rolling?knownPrefix[index+1]-knownPrefix[sampleStart]:observed,returns:rolling?changes.length:Math.max(0,observed-1),window:rolling?window:null,...(related?{benchmark:q.benchmark}:{}),...(q.metric==='realizedVolatility'?{annualization:252}:{})}};
    });
    const chosen=new Set(samplePrices(points.map(point=>({date:point.date,value:1})),q.frequency).map(point=>point.date)),sampled=points.filter(point=>chosen.has(point.date));
    if(sampled.some(point=>point.value===null))notes.push('Los puntos sin muestra suficiente o relación compatible permanecen nulos; consulta el detalle de cada observación.');
    result.series.push({id:symbol,symbol,label:symbol+(symbol===q.benchmark?' · referencia':''),unit:unit(q,null),currency:null,points:sampled,status:sampled.some(point=>point.value!==null)?notes.length?'partial':'complete':'unavailable',sourceIds:ids,notes});
  }
}
async function convertDated(points:{date:string;value:number}[],from:string,to:string,deps:AnalyticsDependencies){
  let rates:{date:string;rate:number;source?:AnalyticsSource}[]=[];try{rates=await(deps.fx??analyticsFx)(from,to,points.map(p=>p.date));}catch{/* unavailable stays missing */}
  const usable=rates.filter(r=>day(r.date)&&finite(r.rate)&&r.rate>0&&sourceOk(r.source));
  const valid=new Map(usable.map(r=>[r.date,r.rate])),sources=[...new Map(usable.map(r=>[r.source!.id,r.source!])).values()];
  const out=points.filter(p=>valid.has(p.date)).map(p=>({date:p.date,value:p.value*valid.get(p.date)!}));
  return {points:out,sources,notes:out.length<points.length?['Conversión '+from+' → '+to+': faltan tipos de cambio observados y con fuente identificada en '+(points.length-out.length)+' fechas; se excluyen, sin arrastrar cotizaciones.']:['Conversión '+from+' → '+to+' al tipo de cambio de cierre observado de cada fecha.']};
}
type FundamentalRow=AnalyticsFundamentalInput['rows'][number];
function cleanFundamentals(raw:AnalyticsFundamentalInput,now:number):FundamentalRow[]{
  const cutoff=new Date(now).toISOString().slice(0,10),out=new Map<string,FundamentalRow>(),conflicts=new Set<string>();
  for(const r of raw.rows.slice(0,200)){
    if(!day(r.date)||r.date>cutoff||r.filingDate!==null&&(!day(r.filingDate)||r.filingDate>cutoff)||!['3M','12M','instant','YTD'].includes(r.periodType))continue;
    const key=r.date+':'+r.periodType,money=currency(r.currency)?r.currency:null,values:FundamentalRow['values']={};
    for(const [key,v]of Object.entries(object(r.values)))if(METRICS.has(key))values[key as AnalyticsMetric]=finite(v)?v:null;
    // Do not trust a differently defined provider net-debt field. This catalog
    // consistently means total debt less cash/equivalents, same fiscal row.
    values.netDebt=finite(values.totalDebt)&&finite(values.cash)?values.totalDebt-values.cash:null;
    const row={date:r.date,currency:money,filingDate:r.filingDate,periodType:r.periodType,values,...(r.valueSourceIds?{valueSourceIds:r.valueSourceIds}:{})};
    if(out.has(key)&&JSON.stringify(out.get(key))!==JSON.stringify(row)){conflicts.add(key);continue;}out.set(key,row);
  }
  return [...out].filter(([key])=>!conflicts.has(key)).map(([,r])=>r).sort((a,b)=>a.date.localeCompare(b.date));
}
function previousPeriod(rows:FundamentalRow[],row:FundamentalRow,operation:AnalyticsQuery['operation']):FundamentalRow|null {
  const quarterly=operation==='growth_qoq',min=quarterly?70:345,max=quarterly?110:385,target=quarterly?91:365;
  return rows.filter(p=>{const diff=(Date.parse(row.date)-Date.parse(p.date))/DAY;return p.periodType===row.periodType&&p.currency===row.currency&&diff>=min&&diff<=max;}).sort((a,b)=>Math.abs((Date.parse(row.date)-Date.parse(a.date))/DAY-target)-Math.abs((Date.parse(row.date)-Date.parse(b.date))/DAY-target))[0]??null;
}
async function fundamentalsResult(result:AnalyticsResult,deps:AnalyticsDependencies,now:number){
  const q=result.query,load=deps.fundamentals??analyticsFundamentals;
  // Fetch a further year for true comparable-period growth; it is used only as
  // a denominator and never extends the visible request range.
  const prior=new Date(result.from+'T00:00:00Z');prior.setUTCFullYear(prior.getUTCFullYear()-1);prior.setUTCDate(prior.getUTCDate()-30);
  const all=await Promise.all(q.assets.map(async symbol=>{try{return await load(symbol,prior.toISOString().slice(0,10),result.to);}catch{return null;}}));
  const expected=q.frequency==='quarterly'?'3M':'12M';
  result.methodology.push('Fechas de cierre fiscal reales de cada emisor; los trimestres de empresas distintas pueden tener cierres diferentes. No se renombran como un mismo trimestre natural. Importes en unidades monetarias completas, sin escalas implícitas.');
  result.methodology.push('Solo observaciones identificadas como '+(expected==='3M'?'trimestres independientes (3M)':'ejercicios completos (12M)')+'. Los acumulados YTD y los datos sin duración verificada no se tratan como trimestres.');
  if(q.operation.startsWith('growth_'))result.methodology.push((q.operation==='growth_yoy'?'Crecimiento interanual':'Crecimiento entre trimestres')+' = (actual − anterior) / |anterior| × 100. Se exige una observación fiscal comparable en la misma moneda y duración; denominador cero o periodo ausente → nulo.');
  if(q.operation==='ratio')result.methodology.push('Ratio calculado con numerador y denominador publicados del mismo emisor, fecha fiscal, duración y moneda. Se exige denominador positivo. '+(TIMES_RATIOS.has(q.metric+'/'+q.denominator)?'Se expresa en veces.':'Se expresa en porcentaje.'));
  if(q.metric==='capex')result.methodology.push('CapEx total: desembolso de inversión en activos, presentado positivo. No mide específicamente inversión en inteligencia artificial y no incluye automáticamente arrendamientos u otros compromisos.');
  if(q.metric==='netDebt')result.methodology.push('Deuda neta = deuda total − efectivo y equivalentes de la misma fecha fiscal, duración y moneda. Un valor negativo representa caja neta. No se agregan inversiones financieras ni se convierten datos desconocidos en cero.');
  const mismatched=new Set<string>();
  for(let i=0;i<q.assets.length;i++){
    const symbol=q.assets[i],raw=all[i];if(!raw||raw.symbol!==symbol||!sourceOk(raw.source)){result.series.push(emptySeries(symbol,q,'No hay fundamentales publicados verificables con la cobertura autorizada.'));continue;}
    const allSources=[raw.source,...(raw.sources??[]).filter(sourceOk)];result.sources.push(...allSources);
    const valid=cleanFundamentals(raw,now),rows=valid.filter(r=>r.periodType===expected&&r.date>=result.from&&r.date<=result.to),notes=[...(raw.notes??[])];
    if(valid.some(r=>r.periodType==='YTD'))notes.push('Se excluyen cifras acumuladas YTD; no se confunden con flujos de un trimestre.');
    const points:AnalyticsPoint[]=[];
    for(const row of rows){
      const base=row.values[q.metric],den=q.operation==='ratio'?row.values[q.denominator!]:null;
      const idsFor=(r:FundamentalRow,metric:AnalyticsMetric)=>metric==='netDebt'?[r.valueSourceIds?.totalDebt??raw.source.id,r.valueSourceIds?.cash??raw.source.id]:[r.valueSourceIds?.[metric]??raw.source.id];
      const sourceIds=idsFor(row,q.metric);
      let value=finite(base)?base:null,status:AnalyticsPoint['status']=value===null?'missing':'available',detail:string|undefined;
      if(q.operation.startsWith('growth_')){
        const previous=previousPeriod(valid,row,q.operation),before=previous?.values[q.metric];
        if(previous)sourceIds.push(...idsFor(previous,q.metric));
        value=finite(base)&&finite(before)&&before!==0?(base-before)/Math.abs(before)*100:null;
        if(value===null){status='missing';detail='Falta una observación fiscal comparable o el denominador es cero.';}
      }else if(q.operation==='ratio'){
        sourceIds.push(row.valueSourceIds?.[q.denominator!]??raw.source.id);
        value=finite(base)&&finite(den)&&den>0?base/den*(TIMES_RATIOS.has(q.metric+'/'+q.denominator)?1:100):null;
        if(value===null){status='missing';detail='Numerador o denominador compatible ausente; no se calcula con cero ni con otra frecuencia.';}
      }
      if(!row.currency){value=null;status='incompatible';detail='La moneda del estado financiero no está identificada.';}
      if(q.currency!=='original'&&row.currency!==q.currency&&q.operation==='level'){
        // A period-end FX quote does not correctly translate a quarterly cash
        // flow. Until exact fiscal starts/average FX are available, keep the
        // amount explicitly unavailable rather than fabricating a conversion.
        if(ANALYTICS_CATALOG[q.metric].kind==='stock'&&row.currency&&value!==null){const converted=await convertDated([{date:row.date,value}],row.currency,q.currency,deps);value=converted.points[0]?.value??null;result.sources.push(...converted.sources);sourceIds.push(...converted.sources.map(s=>s.id));if(value===null){status='incompatible';detail=converted.notes[0];}}
        else {value=null;status='incompatible';detail='La conversión de un flujo fiscal necesita su fecha inicial y el tipo de cambio medio del periodo; no se usa el cambio de cierre como sustituto.';mismatched.add(symbol);}
      }
      if(!finite(value))value=null;
      points.push({date:row.date,value,originalValue:finite(base)?base:null,currency:q.currency!=='original'&&q.operation==='level'?q.currency:row.currency,fiscalPeriod:row.date,filingDate:row.filingDate,periodType:expected,status:value===null?status:'available',sourceId:sourceIds[0],sourceIds:[...new Set(sourceIds)],...(detail?{detail}:{})});
    }
    const monies=[...new Set(points.filter(p=>p.value!==null).map(p=>p.currency).filter((c):c is string=>!!c))],money=monies.length===1?monies[0]:null;
    if(monies.length>1&&q.operation==='level'){points.forEach(p=>{if(p.value!==null){p.value=null;p.status='incompatible';p.detail='La moneda de presentación cambia dentro de la serie; no se comparan importes sin homogeneizar.';}});notes.push('La moneda de presentación varía; los niveles se ocultan hasta disponer de una conversión compatible.');}
    if(!rows.length)notes.push('No hay periodos '+expected+' verificables en las fechas solicitadas.');
    if(rows.some(r=>r.filingDate===null))notes.push('La fuente no facilita la fecha de publicación de todas las cifras; se conserva la fecha fiscal, sin inventar una publicación.');
    result.series.push({id:symbol,symbol,label:symbol,unit:unit(q,money),currency:q.operation==='level'?money:null,points,status:points.some(p=>p.value!==null)?points.some(p=>p.value===null)||notes.length?'partial':'complete':'unavailable',sourceIds:[...new Set(points.flatMap(p=>p.sourceIds??[p.sourceId]))],notes});
  }
  if(mismatched.size){result.warnings.push('No se puede convertir de forma rigurosa el flujo fiscal de '+[...mismatched].join(', ')+'.');result.alternatives.push({label:'Ver cifras en moneda de origen',reason:'Mantiene las cifras publicadas sin una conversión de divisa no verificable.',query:{...q,currency:'original'}});}
  if(q.operation==='level'&&q.currency==='original'&&new Set(result.series.filter(s=>s.points.some(p=>p.value!==null)).map(s=>s.currency)).size>1)result.warnings.push('Las empresas presentan sus cuentas en monedas diferentes; los niveles no son directamente comparables. Los crecimientos y ratios usan únicamente observaciones compatibles de cada empresa.');
}
async function valuationResult(result:AnalyticsResult,deps:AnalyticsDependencies,now:number){
  const q=result.query,metric=q.metric as 'forwardPeCurrent'|'trailingPeCurrent'|'priceToBookCurrent'|'enterpriseToEbitdaCurrent';
  const load=deps.valuation??analyticsValuation;
  result.methodology.push('Instantánea fechada, no evolución histórica: un múltiplo actual no se copia sobre precios antiguos. La fecha del punto es la de consulta del múltiplo; la fecha de su última cotización se conserva por separado.');
  result.methodology.push('Unidad: veces (x), sin conversión monetaria. Son ratios publicados para acciones individuales; no se usan valoraciones agregadas de ETF ni se mezclan estimaciones de clases de acciones. Los valores no positivos se consideran no interpretables.');
  if(metric==='forwardPeCurrent')result.methodology.push('El PER forward incorpora previsiones del proveedor y se identifica como estimación. No se acredita un histórico de consensos point-in-time ni un horizonte NTM uniforme. No se infiere una valoración pasada usando las estimaciones actuales.');
  const inputs=await Promise.all(q.assets.map(async symbol=>{try{return await load(symbol);}catch{return null;}}));
  let excludedByPeriod=false;
  for(let i=0;i<q.assets.length;i++){
    const symbol=q.assets[i],raw=inputs[i],observed=raw?Date.parse(raw.asOf):NaN,quote=raw?.quoteAt?Date.parse(raw.quoteAt):NaN;
    if(!raw||raw.symbol!==symbol||!sourceOk(raw.source)||!Number.isFinite(observed)||observed>now||now-observed>7*DAY||!Number.isFinite(quote)||quote>observed||now-quote>7*DAY){result.series.push(emptySeries(symbol,q,'No hay una instantánea actual verificable con la cobertura autorizada. No se fabrican múltiplos históricos.'));continue;}
    const date=raw.asOf.slice(0,10);
    if(date<result.from||date>result.to){excludedByPeriod=true;result.series.push(emptySeries(symbol,q,'La instantánea actual está fuera de las fechas solicitadas; no se presenta como dato de aquel periodo.'));continue;}
    result.sources.push(raw.source);
    const value=raw.values[metric],valid=finite(value)&&value>0,notes=[...raw.notes,'Cotización de referencia: '+raw.quoteAt+'. Consulta del múltiplo: '+raw.asOf+'.'];
    const points:AnalyticsPoint[]=[{date,value:valid?value:null,currency:null,periodType:'instant',status:valid?'available':'missing',sourceId:raw.source.id,detail:valid?'Instantánea consultada el '+raw.asOf+'; última cotización '+raw.quoteAt+'.':'El múltiplo no está disponible o no tiene un denominador positivo interpretable.'}];
    result.series.push({id:symbol,symbol,label:symbol,unit:'x',currency:null,points,status:valid?'partial':'unavailable',sourceIds:[raw.source.id],notes});
  }
  result.warnings.push('Solo una observación actual por activo. No representa cómo evolucionaron los múltiplos durante el periodo seleccionado.');
  if(excludedByPeriod)result.alternatives.push({label:'Consultar instantánea actual por separado',reason:'Las fechas originales no incluyen la instantánea disponible; esta alternativa termina hoy y no reemplaza el periodo solicitado.',query:{...q,period:{range:'1y'}}});
}
async function portfolioResult(result:AnalyticsResult,deps:AnalyticsDependencies){
  const q=result.query;if(!deps.portfolio)throw new AnalyticsValidationError('El portfolio simulado no está disponible para esta cuenta.','forbidden');
  const p=await deps.portfolio(q.portfolioId);if(!p)throw new AnalyticsValidationError('No se encontró un portfolio propio accesible.','forbidden');
  if(q.portfolioId&&p.id!==q.portfolioId)throw new AnalyticsValidationError('No puedes consultar el portfolio de otra cuenta.','forbidden');
  if(!currency(p.currency)||!Number.isFinite(Date.parse(p.asOf)))throw new AnalyticsValidationError('La valoración actual del portfolio no se puede verificar.','unavailable');
  const source:AnalyticsSource={id:'portfolio:'+p.id,name:'Portfolio simulado · valoración existente',url:'https://sftmvpppp.vercel.app/',fetchedAt:result.generatedAt,dataThrough:p.asOf,exportAllowed:true,exportNote:'Datos propios del usuario. Exportación permitida.'};result.sources.push(source);
  result.methodology.push('Instantánea de la valoración existente del portfolio simulado. No ejecuta órdenes, no altera posiciones ni crea otra cartera. Peso = valor de mercado / patrimonio × 100, con signo negativo para posiciones cortas.');
  const equity=finite(p.equity)&&p.equity>0?p.equity:null;
  for(const position of p.positions.slice(0,100)){
    if(!symbol(position.symbol)||!finite(position.quantity))continue;
    const compatible=position.currency===p.currency,known=compatible&&finite(position.marketValue)&&equity!==null;
    result.series.push({id:position.symbol,symbol:position.symbol,label:position.symbol,unit:'% del patrimonio',currency:null,points:[{date:p.asOf.slice(0,10),value:known?position.marketValue!/equity!*100:null,originalValue:finite(position.marketValue)?position.marketValue:null,currency:p.currency,periodType:'instant',status:known?'available':'missing',sourceId:source.id,...(!known?{detail:'Valoración, moneda o patrimonio incompletos; una exposición desconocida no se considera cero.'}:{})}],status:known?'complete':'unavailable',sourceIds:[source.id],notes:position.priceAt?['Precio utilizado: '+position.priceAt]:['La hora del precio no está disponible.']});
  }
  if(equity!==null&&finite(p.cash))result.series.push({id:'portfolio-cash',symbol:'CASH',label:'Efectivo',unit:'% del patrimonio',currency:null,points:[{date:p.asOf.slice(0,10),value:p.cash/equity*100,originalValue:p.cash,currency:p.currency,periodType:'instant',status:'available',sourceId:source.id}],status:'complete',sourceIds:[source.id],notes:[]});
  result.from=p.asOf.slice(0,10);result.to=p.asOf.slice(0,10);result.warnings.push(...p.notes);if(equity===null)result.warnings.push('El patrimonio no está disponible o no es positivo; no se calculan pesos.');
}

export async function executeAnalytics(input:unknown,deps:AnalyticsDependencies={}):Promise<AnalyticsResult>{
  const query=validateAnalyticsQuery(input),now=deps.now??Date.now(),result=makeResult(query,now);
  if(query.metric==='capexAI'){
    result.warnings.push('No hay un desglose trimestral homogéneo y verificable de CapEx exclusivo de inteligencia artificial para los activos seleccionados. CapEx total, centros de datos, infraestructura y compromisos de inversión no equivalen a CapEx de IA. No se estiman porcentajes ni se combinan anuncios con cifras realizadas.');
    result.methodology.push('El catálogo disponible no ofrece una serie independiente de CapEx de IA publicada y comparable entre emisores. La ausencia no significa que la inversión sea cero.');
    result.series=query.assets.map(s=>emptySeries(s,query,'Desglose específico de IA no disponible.'));
    result.alternatives.push({label:'Ver CapEx total por separado',reason:'CapEx total publicado; incluye inversiones ajenas a IA. No sustituye la métrica solicitada.',query:{...query,metric:'capex'}});
  }else if(ANALYTICS_PRICE_STUDIES.has(query.metric))await advancedPriceResult(result,deps,now);
  else if(query.metric==='price')await priceResult(result,deps,now);
  else if(ANALYTICS_VALUATION_METRICS.has(query.metric))await valuationResult(result,deps,now);
  else if(query.metric==='portfolioExposure')await portfolioResult(result,deps);
  else await fundamentalsResult(result,deps,now);
  if(query.chart==='scatter')result.methodology.push('Dispersión: las dos series seleccionadas se emparejan exclusivamente en fechas observadas comunes. La relación visual no prueba causalidad. No se mezclan cierres fiscales diferentes.');
  return finish(result);
}

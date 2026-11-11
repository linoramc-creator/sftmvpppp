import type {AnalyticsDependencies,AnalyticsFrequency,AnalyticsFundamentalInput,AnalyticsMetric,AnalyticsPoint,AnalyticsQuery,AnalyticsResult,AnalyticsSeries,AnalyticsSource} from './analytics-types.ts';
import {analyticsFundamentals,analyticsPrices,analyticsFx} from './analytics-providers.ts';
export type {AnalyticsQuery,AnalyticsResult,AnalyticsDependencies} from './analytics-types.ts';

export class AnalyticsValidationError extends Error {
  readonly code:string;
  constructor(message:string,code='invalid'){super(message);this.name='AnalyticsValidationError';this.code=code;}
}
export const ANALYTICS_CATALOG = {
  price:{label:'Precio de cierre',kind:'price'},revenue:{label:'Ingresos',kind:'flow'},netIncome:{label:'Beneficio neto',kind:'flow'},grossProfit:{label:'Beneficio bruto',kind:'flow'},operatingCashFlow:{label:'Flujo de caja operativo',kind:'flow'},freeCashFlow:{label:'Flujo de caja libre',kind:'flow'},capex:{label:'CapEx total',kind:'flow'},capexAI:{label:'CapEx específico de IA',kind:'unavailable'},cash:{label:'Efectivo y equivalentes',kind:'stock'},totalDebt:{label:'Deuda total',kind:'stock'},equity:{label:'Patrimonio neto',kind:'stock'},totalAssets:{label:'Activos totales',kind:'stock'},portfolioExposure:{label:'Exposición del portfolio',kind:'portfolio'},
} as const;
const METRICS=new Set(Object.keys(ANALYTICS_CATALOG));
const OPS=new Set(['level','base100','growth_yoy','growth_qoq','ratio']);
const FREQ=new Set(['daily','weekly','monthly','quarterly','annual']);
const RATIO_PAIRS=new Set(['netIncome/revenue','grossProfit/revenue','freeCashFlow/revenue','operatingCashFlow/revenue','capex/revenue','totalDebt/equity','totalDebt/totalAssets','cash/totalDebt']);
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
  const r=object(input);noExtra(r,['version','assets','metric','operation','denominator','period','frequency','currency','chart','dataKind','portfolioId']);
  if(r.version!==1||!METRICS.has(String(r.metric))||!OPS.has(String(r.operation))||!FREQ.has(String(r.frequency))||!['original','USD','EUR','GBP'].includes(String(r.currency))||!['line','bar','scatter'].includes(String(r.chart))||r.dataKind!=='reported')throw new AnalyticsValidationError('Revisa la métrica, operación, frecuencia y tipo de datos. Solo se admiten datos publicados del catálogo.');
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
  if(metric==='price'&&(!['daily','weekly','monthly'].includes(String(r.frequency))||!['level','base100'].includes(operation)))throw new AnalyticsValidationError('Los precios admiten niveles o base 100 con frecuencia diaria, semanal o mensual.');
  if(metric==='portfolioExposure'&&(operation!=='level'||r.frequency!=='daily'||r.chart!=='bar'||assets.length))throw new AnalyticsValidationError('La exposición utiliza las posiciones actuales del portfolio, sin una cartera duplicada. Usa barras, nivel y frecuencia diaria.');
  if(metric==='portfolioExposure'&&r.currency!=='original')throw new AnalyticsValidationError('La exposición reutiliza la moneda de la valoración existente. Selecciona moneda original.');
  if(!['price','portfolioExposure'].includes(metric)&&!['quarterly','annual'].includes(String(r.frequency)))throw new AnalyticsValidationError('Los fundamentales publicados admiten frecuencia trimestral o anual.');
  if(metric!=='price'&&operation==='base100')throw new AnalyticsValidationError('La base 100 inicial está disponible para precios de cierre.');
  if(operation==='growth_qoq'&&r.frequency!=='quarterly')throw new AnalyticsValidationError('El crecimiento entre trimestres requiere datos trimestrales.');
  if(operation==='ratio'){
    if(!METRICS.has(String(r.denominator))||!RATIO_PAIRS.has(metric+'/'+r.denominator))throw new AnalyticsValidationError('Ese ratio no tiene una combinación compatible en el catálogo.');
  }else if(r.denominator!==undefined)throw new AnalyticsValidationError('El denominador solo se admite para un ratio.');
  if(metric==='capexAI'&&operation==='ratio')throw new AnalyticsValidationError('No hay un desglose normalizado de CapEx de IA para formar ese ratio.');
  return {version:1,assets,metric,operation,...(operation==='ratio'?{denominator:r.denominator as AnalyticsMetric}:{}),period:{range:p.range as AnalyticsQuery['period']['range'],...(p.range==='custom'?{from:p.from as string,to:p.to as string}:{})},frequency:r.frequency as AnalyticsFrequency,currency:r.currency as AnalyticsQuery['currency'],chart:r.chart as AnalyticsQuery['chart'],dataKind:'reported',...(r.portfolioId?{portfolioId:r.portfolioId as string}:{})};
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
  if(query.operation==='base100')return 'base 100';
  if(query.operation.startsWith('growth_'))return '%';
  if(query.operation==='ratio')return ['totalDebt/equity','cash/totalDebt'].includes(query.metric+'/'+query.denominator)?'x':'%';
  return query.metric==='portfolioExposure'?'% del patrimonio':money??'moneda no disponible';
}
function makeResult(query:AnalyticsQuery,now:number):AnalyticsResult {
  const bounds=analyticsBounds(query,now),label=ANALYTICS_CATALOG[query.metric].label;
  return {version:1,query,generatedAt:new Date(now).toISOString(),...bounds,title:query.operation==='base100'?'Evolución de precios · base 100':query.operation==='growth_yoy'?label+' · crecimiento interanual':query.operation==='growth_qoq'?label+' · crecimiento entre trimestres':query.operation==='ratio'?label+' / '+ANALYTICS_CATALOG[query.denominator!].label:label,status:'unavailable',series:[],table:[],sources:[],methodology:['Solo datos publicados; las ausencias se conservan como nulos. No se estiman valores ni se completan con cero.'],warnings:[],alternatives:[],export:{chart:false,table:false,reason:'No hay observaciones para exportar.'}};
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
  const available=prepared.filter(p=>p.points.length),common=available.length?available[0].points.map(p=>p.date).filter(d=>available.every(s=>s.points.some(p=>p.date===d))):[];
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
  if(q.operation==='ratio')result.methodology.push('Ratio calculado con numerador y denominador publicados del mismo emisor, fecha fiscal, duración y moneda. Se exige denominador positivo. '+(['totalDebt/equity','cash/totalDebt'].includes(q.metric+'/'+q.denominator)?'Se expresa en veces.':'Se expresa en porcentaje.'));
  if(q.metric==='capex')result.methodology.push('CapEx total: desembolso de inversión en activos, presentado positivo. No mide específicamente inversión en inteligencia artificial y no incluye automáticamente arrendamientos u otros compromisos.');
  const mismatched=new Set<string>();
  for(let i=0;i<q.assets.length;i++){
    const symbol=q.assets[i],raw=all[i];if(!raw||raw.symbol!==symbol||!sourceOk(raw.source)){result.series.push(emptySeries(symbol,q,'No hay fundamentales publicados verificables con la cobertura autorizada.'));continue;}
    const allSources=[raw.source,...(raw.sources??[]).filter(sourceOk)];result.sources.push(...allSources);
    const valid=cleanFundamentals(raw,now),rows=valid.filter(r=>r.periodType===expected&&r.date>=result.from&&r.date<=result.to),notes=[...(raw.notes??[])];
    if(valid.some(r=>r.periodType==='YTD'))notes.push('Se excluyen cifras acumuladas YTD; no se confunden con flujos de un trimestre.');
    const points:AnalyticsPoint[]=[];
    for(const row of rows){
      const base=row.values[q.metric],den=q.operation==='ratio'?row.values[q.denominator!]:null;
      const sourceIds=[row.valueSourceIds?.[q.metric]??raw.source.id];
      let value=finite(base)?base:null,status:AnalyticsPoint['status']=value===null?'missing':'available',detail:string|undefined;
      if(q.operation.startsWith('growth_')){
        const previous=previousPeriod(valid,row,q.operation),before=previous?.values[q.metric];
        if(previous)sourceIds.push(previous.valueSourceIds?.[q.metric]??raw.source.id);
        value=finite(base)&&finite(before)&&before!==0?(base-before)/Math.abs(before)*100:null;
        if(value===null){status='missing';detail='Falta una observación fiscal comparable o el denominador es cero.';}
      }else if(q.operation==='ratio'){
        sourceIds.push(row.valueSourceIds?.[q.denominator!]??raw.source.id);
        value=finite(base)&&finite(den)&&den>0?base/den*(['totalDebt/equity','cash/totalDebt'].includes(q.metric+'/'+q.denominator)?1:100):null;
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
  }else if(query.metric==='price')await priceResult(result,deps,now);
  else if(query.metric==='portfolioExposure')await portfolioResult(result,deps);
  else await fundamentalsResult(result,deps,now);
  if(query.chart==='scatter')result.methodology.push('Dispersión: las dos series seleccionadas se emparejan exclusivamente en fechas observadas comunes. La relación visual no prueba causalidad. No se mezclan cierres fiscales diferentes.');
  return finish(result);
}

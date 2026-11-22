import {validateAnalyticsQuery,AnalyticsValidationError,ANALYTICS_PRICE_STUDIES,ANALYTICS_VALUATION_METRICS} from './analytics-engine.ts';
import type {AnalyticsMetric,AnalyticsQuery,AnalyticsResult,AnalyticsSuggestion} from './analytics-types.ts';

export type AnalyticsIdeasContext={symbol?:string;kind?:'stock'|'etf'|'index'|'forex'|'crypto'|'future'|'commodity'|'bond'|'sector';sector?:string};
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const BIG7=['AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA'];
const kinds=new Set(['stock','etf','index','forex','crypto','future','commodity','bond','sector']);
const symbolOk=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/.test(value)&&!value.includes('..');

/** Public context is metadata, not a provider URL, database selector or prompt.
 * Unknown sectors never become fabricated exchange symbols. */
export function validateAnalyticsIdeasContext(input:unknown):AnalyticsIdeasContext{
 if(input===undefined)return {};
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AnalyticsValidationError('Contexto de Analytics inválido.');
 const row=input as Record<string,unknown>;
 if(Object.keys(row).some(key=>!['symbol','kind','sector'].includes(key)))throw new AnalyticsValidationError('El contexto contiene parámetros no admitidos.');
 if(row.symbol!==undefined&&!symbolOk(row.symbol))throw new AnalyticsValidationError('El símbolo del contexto no es válido.');
 const rawKind=typeof row.kind==='string'?row.kind.toLowerCase():undefined;
 const kind=rawKind==='equity'||rawKind==='ticker'?'stock':rawKind;
 if(row.kind!==undefined&&(!kind||!kinds.has(kind)))throw new AnalyticsValidationError('El tipo de activo del contexto no es válido.');
 if(row.sector!==undefined&&(typeof row.sector!=='string'||!row.sector.trim()||row.sector.length>100||/[\p{Cc}\p{Cf}<>]|https?:\/\//u.test(row.sector)))throw new AnalyticsValidationError('El sector del contexto no es válido.');
 return {...(row.symbol?{symbol:row.symbol==='GOOG'?'GOOGL':row.symbol as string}:{}),...(kind?{kind:kind as AnalyticsIdeasContext['kind']}:{}),...(row.sector?{sector:(row.sector as string).trim()}:{})};
}

type QueryOptions=Partial<Pick<AnalyticsQuery,'metric'|'operation'|'denominator'|'frequency'|'currency'|'chart'|'period'|'window'|'benchmark'>>;
export function analyticsSuggestedQuery(assets:string[],options:QueryOptions={}):AnalyticsQuery{
 const metric=options.metric??'price',operation=options.operation??(metric==='price'?'base100':'level');
 const snapshot=ANALYTICS_VALUATION_METRICS.has(metric),advanced=ANALYTICS_PRICE_STUDIES.has(metric),related=['rollingCorrelation','rollingBeta','relativeStrength'].includes(metric),selected=[...assets];
 if(related&&selected.length===1)selected.push(selected[0]==='^GSPC'?'^NDX':'^GSPC');
 const benchmark=related?(options.benchmark??selected.find(symbol=>symbol.startsWith('^'))??selected.at(-1)):undefined;
 return validateAnalyticsQuery({version:1,assets:selected,metric,operation,period:options.period??{range:'2y'},frequency:options.frequency??(metric==='price'||advanced||snapshot?'daily':'quarterly'),currency:related?(options.currency&&options.currency!=='original'?options.currency:'USD'):options.currency??'original',chart:snapshot?'bar':options.chart??(metric==='price'||advanced||operation.startsWith('growth_')?'line':'bar'),dataKind:metric==='forwardPeCurrent'?'estimate':'reported',...(options.denominator?{denominator:options.denominator}:{}),...(options.window?{window:options.window}:{}),...(benchmark?{benchmark}:{})});
}
/** The original request exceeded a supported period, not its metric. Retain
 * the independently validated definition and offer a shorter window by name. */
export function analyticsShorterPeriodSuggestion(query:AnalyticsQuery):AnalyticsSuggestion{
 const shorter=validateAnalyticsQuery({...query,period:{range:'5y'}});
 return suggestion('alternative-five-years','Misma métrica · últimos cinco años','Alternativa con un periodo más corto: conserva activos, métrica, operación, frecuencia y moneda. El límite del catálogo es diez años; elige esta ventana de cinco años si te resulta útil.',shorter,'alternative');
}
function suggestion(id:string,label:string,reason:string,query:AnalyticsQuery,kind:AnalyticsSuggestion['kind']):AnalyticsSuggestion{
 return {id,label,reason,query,kind,coverage:{status:'catalog',notice:'Consulta compatible con el catálogo. La cobertura de activos y fechas se verifica al abrirla; los datos ausentes se conservan como tales.'}};
}
function unique(rows:AnalyticsSuggestion[]){return [...new Map(rows.map(row=>[JSON.stringify(row.query),row])).values()];}
const sectorRepresentatives:[RegExp,string,string][]=[
 [/semiconductor|chips?/, 'SOXX','semiconductores'],[/inteligencia artificial|artificial intelligence|tecnolog|technology|software/,'XLK','tecnología'],[/energia|energy|petroleo|oil/,'XLE','energía'],[/banca|bancos?|finanzas|financial/,'XLF','finanzas'],[/salud|health|farmaceut/,'XLV','salud'],[/industria|industrial/,'XLI','industria'],[/consumo discrecional|consumer discretionary/,'XLY','consumo discrecional'],[/consumo basico|consumer staples/,'XLP','consumo básico'],[/utilities|servicios publicos/,'XLU','utilities'],[/inmobiliari|real estate/,'XLRE','inmobiliario'],[/materiales|materials/,'XLB','materiales'],[/comunicacion|communication/,'XLC','comunicación'],[/defensa|defense/,'ITA','aeroespacial y defensa'],
];

/** Curated research themes are not claims of popularity, fund inflows or
 * current recommendations. No model or market fetch is needed to show a card.
 * Every offered definition passes the same validator as analyticsRun. */
export function analyticsIdeas(input:AnalyticsIdeasContext={}):AnalyticsSuggestion[]{
 const context=validateAnalyticsIdeasContext(input),symbol=context.symbol,kind=context.kind;
 if(symbol&&['WTI-SPOT','BRENT-SPOT'].includes(symbol))return [suggestion('context-energy-equities','Energía cotizada frente al mercado','Alternativa distinta: compara el ETF XLE con el S&P 500. No es la serie física del petróleo al contado, que no tiene cobertura histórica acreditada en Analytics.',analyticsSuggestedQuery(['XLE','^GSPC']),'context')];
 if(kind==='sector'||!symbol&&context.sector){
  const representative=sectorRepresentatives.find(([pattern])=>pattern.test(normalize(context.sector??'')));
  const [etf,label]=representative?[representative[1],representative[2]]:['SPY','mercado estadounidense'];
  return [
   suggestion('sector-benchmark-'+etf,representative?'Sector frente al S&P 500':'Mercado estadounidense como referencia',`El ETF ${etf} se usa como representante negociable de ${label}; ${representative?'no es el índice ni el flujo de todas las empresas del sector.':'es una alternativa de mercado amplio, no una medición del sector solicitado.'}`,analyticsSuggestedQuery([etf,'^GSPC']),'context'),
   suggestion('sector-peers','Sectores de crecimiento frente a defensivos','Compara el precio de los ETF XLK, XLF, XLE y XLV en base 100. Son ETF sectoriales estadounidenses, sin reinversión de dividendos.',analyticsSuggestedQuery(['XLK','XLF','XLE','XLV']),'context'),
   suggestion('sector-regions','EE. UU. frente a Europa','S&P 500 y EURO STOXX 50, en monedas de origen; base 100 de precios, sin asumir exposición idéntica ni rentabilidad total.',analyticsSuggestedQuery(['^GSPC','^STOXX50E']),'context'),
  ];
 }
 if(symbol){
  const benchmark=symbol==='^GSPC'?'^STOXX50E':kind==='forex'?(symbol==='EURUSD=X'?'GBPUSD=X':'EURUSD=X'):kind==='crypto'?(symbol==='BTC-USD'?'ETH-USD':'BTC-USD'):'^GSPC';
  const peerAssets=[...new Set([symbol,benchmark])];
  const currencyNote=kind==='forex'?'Compara la evolución de los cruces de divisas normalizada; una cotización no representa la rentabilidad de una inversión financiada.':kind==='future'?'Serie de precios del futuro continuo; no incluye el efecto de renovar contratos ni equivale a rentabilidad total o al mercado físico al contado.':'Precios de cierre en base 100, sin reinversión de dividendos y con fechas observadas comunes.';
  const rows=[suggestion('context-base100-'+symbol,'Evolución frente a una referencia',currencyNote,analyticsSuggestedQuery(peerAssets),'context'),suggestion('context-price-'+symbol,'Evolución mensual de cinco años','Último cierre observado de cada mes; no hay relleno de festivos ni interpolación.',analyticsSuggestedQuery([symbol],{period:{range:'5y'},frequency:'monthly',operation:'level'}),'context')];
  rows.push(
   suggestion('context-volatility-'+symbol,'Cómo cambia la volatilidad','Volatilidad realizada anualizada de 20 variaciones de cierre. Se calcula con código; no es volatilidad implícita ni una predicción.',analyticsSuggestedQuery([symbol],{metric:'realizedVolatility',window:20}),'context'),
   suggestion('context-drawdown-'+symbol,'Distancia al máximo observado','Caída desde el máximo de cierre alcanzado desde el inicio del periodo mostrado; no afirma un máximo histórico anterior.',analyticsSuggestedQuery([symbol],{metric:'drawdown'}),'context'),
  );
  // A quoted FX cross is not a cash asset: translating one base unit back
  // into that base currency may become constant. Do not promote that as a
  // useful converted correlation study; native cross volatility remains valid.
  if(kind!=='forex')rows.push(
   suggestion('context-correlation-'+symbol,'Diversificación que cambia','Correlación móvil de 60 cambios diarios frente a '+benchmark+', en USD con cambio observado. Muestra relaciones, no causalidad.',analyticsSuggestedQuery(peerAssets,{metric:'rollingCorrelation',window:60,benchmark}),'context'),
   suggestion('context-beta-'+symbol,'Sensibilidad móvil a la referencia','Beta de 60 cambios frente a '+benchmark+'. No se calcula cuando la muestra es incompleta o la referencia no tiene varianza.',analyticsSuggestedQuery(peerAssets,{metric:'rollingBeta',window:60,benchmark}),'context'),
   suggestion('context-relative-'+symbol,'Fortaleza relativa observada','Variación del cociente de precios frente a '+benchmark+', desde la misma fecha y en USD. Excluye dividendos y no es RSI.',analyticsSuggestedQuery(peerAssets,{metric:'relativeStrength',benchmark}),'context'),
  );
  // Fundamentals are only suggested for an explicitly identified company.
  // ETF/indices/FX do not acquire corporate revenue merely by being selected.
  if(kind==='stock')rows.push(
   suggestion('context-valuation-'+symbol,'Valoración forward actual','PER forward publicado y fechado; contiene estimaciones, no un histórico de consensos conocidos en cada fecha.',analyticsSuggestedQuery([symbol],{metric:'forwardPeCurrent'}),'context'),
   suggestion('context-opmargin-'+symbol,'Margen de explotación','Beneficio operativo / ingresos de la misma fecha fiscal y moneda. No se mezcla con beneficio neto ni con EBITDA.',analyticsSuggestedQuery([symbol],{metric:'operatingIncome',operation:'ratio',denominator:'revenue',chart:'line'}),'context'),
   suggestion('context-liquidity-'+symbol,'Liquidez corriente','Activos corrientes / pasivos corrientes, en veces. No se calcula si el pasivo está ausente o no es positivo.',analyticsSuggestedQuery([symbol],{metric:'currentAssets',operation:'ratio',denominator:'currentLiabilities',chart:'line'}),'context'),
   suggestion('context-growth-'+symbol,'Crecimiento de ingresos publicados','Crecimiento interanual de trimestres independientes con la fecha fiscal real de la empresa.',analyticsSuggestedQuery([symbol],{metric:'revenue',operation:'growth_yoy'}),'context'),
   suggestion('context-cash-'+symbol,'Caja libre sobre ventas','Flujo de caja libre / ingresos del mismo periodo y moneda. No equivale a rentabilidad por valoración ni a precio objetivo.',analyticsSuggestedQuery([symbol],{metric:'freeCashFlow',operation:'ratio',denominator:'revenue',chart:'line'}),'context'),
  );
  return unique(rows);
 }
 return [
  suggestion('theme-risk-regimes','Cambios de volatilidad entre activos','Volatilidad realizada de SPY, TLT y GLD sobre 20 cambios de cierre, anualizada con 252 sesiones. No depende de fundamentales ni de previsiones.',analyticsSuggestedQuery(['SPY','TLT','GLD'],{metric:'realizedVolatility',window:20,currency:'USD'}),'theme'),
  suggestion('theme-stock-bond-correlation','Relación entre bolsa y bonos','Correlación móvil de TLT frente a SPY con 60 cambios observados en USD. Una relación pasada no garantiza diversificación futura.',analyticsSuggestedQuery(['TLT','SPY'],{metric:'rollingCorrelation',window:60,benchmark:'SPY'}),'theme'),
  suggestion('theme-ai-capex','Inversión de las Big 7','CapEx total publicado: compara la intensidad de inversión y su evolución. No es un desglose de gasto exclusivo en IA.',analyticsSuggestedQuery(BIG7,{metric:'capex',chart:'line'}),'theme'),
  suggestion('theme-ai-cash','Inversión frente a ventas de las Big 7','CapEx total / ingresos del mismo trimestre fiscal; permite evaluar la intensidad de inversión sin equipararla a CapEx de IA.',analyticsSuggestedQuery(BIG7,{metric:'capex',operation:'ratio',denominator:'revenue',chart:'line'}),'theme'),
  suggestion('theme-cash-quality','Conversión de ventas en caja','Caja libre / ingresos de Microsoft, Alphabet y Meta; importes publicados y periodos fiscales identificados.',analyticsSuggestedQuery(['MSFT','GOOGL','META'],{metric:'freeCashFlow',operation:'ratio',denominator:'revenue',chart:'line'}),'theme'),
  suggestion('theme-chip-leadership','Semiconductores frente al Nasdaq 100','SOXX es un ETF de semiconductores; se compara su precio con el Nasdaq 100 en base 100, sin reinvertir dividendos.',analyticsSuggestedQuery(['SOXX','^NDX']),'theme'),
  suggestion('theme-regional-markets','EE. UU. frente a Europa y Japón','S&P 500, EURO STOXX 50 y Nikkei 225: evolución de precios en las monedas originales, sin incorporar el efecto de divisa de un inversor.',analyticsSuggestedQuery(['^GSPC','^STOXX50E','^N225']),'theme'),
  suggestion('theme-growth-margins','Márgenes netos de las Big 7','Margen neto publicado: beneficio neto / ingresos. No es una estimación ni una clasificación de oportunidades.',analyticsSuggestedQuery(BIG7,{metric:'netIncome',operation:'ratio',denominator:'revenue',chart:'line'}),'theme'),
 ];
}

export type AnalyticsAlternativeCategory='total-return'|'forecast'|'valuation'|'risk'|'unsupported-ratio'|'unsupported-chart'|'metric-mismatch'|'unknown'|'interpretation-unavailable';
/** Preserve requested dates and display currency when possible. This helper
 * only supplies parameters for separate alternatives, never an original query. */
function alternativeParameters(prompt:string,now:number):Pick<AnalyticsQuery,'period'|'currency'>{
 const text=normalize(prompt),today=new Date(now).toISOString().slice(0,10),dates=prompt.match(/\b\d{4}-\d{2}-\d{2}\b/g)??[];
 let period:AnalyticsQuery['period']={range:'2y'};
 if(dates.length===2&&dates[0]<=dates[1]&&dates[1]<=today&&dates.every(date=>Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)&&Date.parse(dates[1])-Date.parse(dates[0])<=10*366*86400000)period={range:'custom',from:dates[0],to:dates[1]};
 else {
  const amountMatch=/(\d+|un|uno|dos|tres|cuatro|cinco|seis|one|two|three|four|five|six)\s*(anos?|years?|mes(?:es)?|months?)/.exec(text);
  if(amountMatch){const counts:Record<string,number>={un:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,one:1,two:2,three:3,four:4,five:5,six:6},amount=Number(amountMatch[1])||counts[amountMatch[1]],months=/mes|month/.test(amountMatch[2]);if(amount>0&&amount<=(months?120:10)){if(!months&&[1,2,5].includes(amount))period={range:amount+'y' as '1y'|'2y'|'5y'};else{const from=new Date(now);if(months)from.setUTCMonth(from.getUTCMonth()-amount);else from.setUTCFullYear(from.getUTCFullYear()-amount);period={range:'custom',from:from.toISOString().slice(0,10),to:today};}}}
 }
 const currency:AnalyticsQuery['currency']=/\b(?:en|a|in)\s*(?:eur|euros?)\b/.test(text)?'EUR':/\b(?:en|a|in)\s*(?:usd|dolares|dollars?)\b/.test(text)?'USD':/\b(?:en|a|in)\s*(?:gbp|libras?|pounds?)\b/.test(text)?'GBP':'original';
 return {period,currency};
}

export function analyticsAlternativeSuggestions(options:{prompt:string;assets:string[];category:AnalyticsAlternativeCategory;now?:number;metric?:AnalyticsMetric}):AnalyticsSuggestion[]{
 const assets=[...new Set(options.assets.map(symbol=>symbol==='GOOG'?'GOOGL':symbol))].filter(symbolOk).slice(0,8),parameters=alternativeParameters(options.prompt,options.now??Date.now());
 if(!assets.length)return analyticsIdeas().slice(0,3).map(row=>({...row,id:'alternative-'+row.id,kind:'alternative',reason:'No se identificaron todos los activos de la petición. Idea independiente para explorar: '+row.reason}));
 const make=(id:string,label:string,reason:string,query:QueryOptions)=>suggestion('alternative-'+id,label,reason,analyticsSuggestedQuery(assets,{...parameters,...query}),'alternative');
 if(options.category==='metric-mismatch'){
  if(options.metric==='capexAI')return [make('total-capex','CapEx total publicado por separado','El desglose específico de IA no se ha acreditado. CapEx total incluye inversión ajena a IA y se ofrece como una consulta distinta, nunca como el dato solicitado.',{metric:'capex',operation:'level',chart:'line'})];
  if(options.metric&&options.metric!=='portfolioExposure')return [make('explicit-metric','Métrica publicada solicitada','Definición separada: conserva la métrica explícita y muestra sus valores publicados. No reutiliza la métrica diferente de una interpretación incompatible; puedes editar operación y frecuencia antes de actualizar.',{metric:options.metric,operation:options.metric==='price'?'base100':'level',chart:'line'})];
 }
 if(options.category==='total-return')return [make('price','Precio en base 100','Alternativa de precio: excluye dividendos reinvertidos y no equivale a la rentabilidad total solicitada.',{metric:'price',operation:'base100'})];
 if(options.category==='forecast'){
  const metric=options.metric&&options.metric!=='portfolioExposure'&&options.metric!=='capexAI'?options.metric:'revenue';
  return [make('reported-'+metric,'Evolución de cifras publicadas','Datos históricos publicados; no son estimaciones ni proyecciones futuras. El periodo termina en la última observación disponible.',{metric,operation:'level',chart:'line'}),make('reported-growth','Crecimiento histórico de ingresos','Crecimiento interanual publicado; sirve de contexto y no predice los resultados futuros.',{metric:'revenue',operation:'growth_yoy'})];
 }
 if(options.category==='valuation')return [
  make('forward-current','PER forward · instantánea actual','Consulta distinta y actual: múltiplo de previsiones publicado, sin histórico point-in-time ni horizonte NTM acreditado. No reproduce la evolución pedida.',{metric:'forwardPeCurrent',operation:'level',frequency:'daily',chart:'bar',period:{range:'1y'}}),
  make('trailing-current','PER TTM · instantánea actual','Múltiplo actual de beneficios de los últimos doce meses, consultado y fechado hoy. No es una serie histórica ni una estimación de beneficios futuros.',{metric:'trailingPeCurrent',operation:'level',frequency:'daily',chart:'bar',period:{range:'1y'}}),
  make('cash-margin','Margen de caja libre publicado','Caja libre / ingresos del mismo periodo fiscal. Es una evolución fundamental distinta, no un múltiplo de valoración.',{metric:'freeCashFlow',operation:'ratio',denominator:'revenue',chart:'line'})
 ];
 if(options.category==='unsupported-ratio')return [make('leverage','Deuda sobre patrimonio','Ratio compatible de deuda total / patrimonio publicado; no equivale a deuda neta/EBITDA, ROE o al ratio original.',{metric:'totalDebt',operation:'ratio',denominator:'equity',chart:'line'}),make('net-margin','Margen neto publicado','Beneficio neto / ingresos publicados; alternativa diferenciada y nunca sustitución del ratio solicitado.',{metric:'netIncome',operation:'ratio',denominator:'revenue',chart:'line'})];
 if(options.category==='risk')return [make('realized-volatility','Volatilidad realizada · 20 sesiones','Estudio distinto sobre 20 cambios de cierre, sin tipo libre de riesgo. No sustituye Sharpe, Sortino, volatilidad implícita, RSI ni una ventana no admitida.',{metric:'realizedVolatility',window:20,operation:'level'}),make('price','Trayectoria del precio','Cierres observados en base 100; no equivalen a una medida de riesgo solicitada.',{metric:'price',operation:'base100'})];
 return [make('price','Evolución del precio en base 100','Alternativa explícita con cierres observados; no representa una métrica desconocida ni reproduce el gráfico original.',{metric:'price',operation:'base100'}),make('revenue','Crecimiento de ingresos publicados','Consulta distinta de la petición original, con cifras publicadas y fechas fiscales verificadas.',{metric:'revenue',operation:'growth_yoy'})];
}

/** Missing data produces alternatives, never a synthetic zero or a different
 * series under the original title. Selecting a suggestion reuses analyticsRun. */
export function analyticsResultAlternatives(result:AnalyticsResult):AnalyticsSuggestion[]{
 if(result.status!=='unavailable')return [];
 const query=result.query,assets=query.assets;
 if(!assets.length||query.metric==='portfolioExposure')return [];
 if(query.metric==='capexAI')return [suggestion('alternative-total-capex','CapEx total publicado','Se presenta separado del CapEx específico de IA, cuyo desglose no se ha verificado.',analyticsSuggestedQuery(assets,{...query,metric:'capex',operation:'level'}),'alternative')];
 if(query.metric==='price')return [];
 if(ANALYTICS_VALUATION_METRICS.has(query.metric))return [suggestion('alternative-reported-operating-margin','Margen operativo publicado por separado','La instantánea de valoración no está cubierta para estos activos o fechas. Se ofrece una métrica fundamental distinta; no reemplaza el múltiplo.',analyticsSuggestedQuery(assets,{period:query.period,metric:'operatingIncome',operation:'ratio',denominator:'revenue'}),'alternative')];
 if(ANALYTICS_PRICE_STUDIES.has(query.metric))return [suggestion('alternative-observed-price','Precios observados por separado','La muestra o la referencia no permiten calcular el estudio solicitado. Se ofrece una consulta distinta de precios, sin sustituir ni estimar la métrica ausente.',analyticsSuggestedQuery(assets,{period:query.period,currency:query.currency}),'alternative')];
 return [suggestion('alternative-price','Evolución del precio en base 100','No hay cobertura suficiente para el fundamental solicitado. Esta es una consulta de precios diferente; no reemplaza la métrica original.',analyticsSuggestedQuery(assets,{period:query.period,currency:query.currency}),'alternative')];
}

/** Stamp only observed coverage of the exact alternative. Never marks a whole
 * theme as available just because a single sample asset returned a quote. */
export function analyticsSuggestionCoverage(idea:AnalyticsSuggestion,result:AnalyticsResult):AnalyticsSuggestion{
 if(JSON.stringify(validateAnalyticsQuery(idea.query))!==JSON.stringify(validateAnalyticsQuery(result.query)))return idea;
 const availableAssets=result.series.filter(series=>series.points.some(point=>point.value!==null&&Number.isFinite(point.value))).map(series=>series.symbol),missingAssets=idea.query.assets.filter(symbol=>!availableAssets.includes(symbol));
 return {...idea,coverage:{status:result.status==='complete'?'available':availableAssets.length?'partial':'unavailable',checkedAt:result.generatedAt,availableAssets,missingAssets,notice:availableAssets.length?'Cobertura verificada para esta definición; las fechas fiscales y ausencias se conservan en el resultado.':'No hay observaciones verificables para esta definición y periodo con la cobertura actual.'}};
}

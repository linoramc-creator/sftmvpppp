import {MONITOR_FIELDS,type MonitorAlert,type MonitorCalendarEvent,type MonitorCondition,type MonitorContext,type MonitorEvaluation,type MonitorExposure,type MonitorAgendaItem,type MonitorMetric,type MonitorNews,type MonitorSnapshot,type MonitorChange} from './monitoring-types.ts';
import {portfolioMarketDate} from './portfolio-model.ts';

const DAY=86400000,HOUR=3600000;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const stamp=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)).toISOString().slice(0,10)===value.slice(0,10)?Date.parse(value):null;
const currency=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z]{3}$/.test(value);
const round=(value:number)=>Math.round((value+Number.EPSILON)*1e6)/1e6;
const safeUrl=(value:string)=>{try{if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value)||/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value))return null;const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,'');if(url.protocol!=='https:'||url.username||url.password||!host.includes('.')||host.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)||[...url.searchParams.keys()].some(key=>/^(?:api[_-]?key|access[_-]?token|token|auth|authorization|secret|password|signature|key)$/i.test(key)))return null;return url;}catch{return null;}};
export const monitoringSourceUrl=(value:string)=>safeUrl(value)?.href??'';
const text=(value:unknown)=>typeof value==='string'?value.trim():'';

/** Stable event keys are identities, not cryptographic authorization tokens. */
export function monitoringKey(value:string){let hash=14695981039346656037n;for(const character of value){hash^=BigInt(character.codePointAt(0)!);hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(16).padStart(16,'0');}
export function canonicalMonitoringUrl(value:string){const url=safeUrl(value);if(!url)return '';url.hash='';for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|mc_|ref$|referrer$|source$)/i.test(key))url.searchParams.delete(key);url.searchParams.sort();return url.hostname.toLowerCase()+url.pathname.replace(/\/amp\/?$/i,'').replace(/\/+$/,'')+(url.searchParams.size?'?'+url.searchParams.toString():'');}
export const monitoringTitleKey=(value:string)=>text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const monitoringNewsKey=(news:Pick<MonitorNews,'url'|'title'>)=>canonicalMonitoringUrl(news.url)||monitoringTitleKey(news.title);

function metricStatus(metric:MonitorMetric|undefined,now:number):'ready'|'missing'|'stale'{
 if(!metric||!finite(metric.value)||!text(metric.source)||!text(metric.unit)||!finite(metric.maxAgeHours)||metric.maxAgeHours<=0||metric.maxAgeHours>366*24)return 'missing';
 const at=stamp(metric.asOf);if(at===null||at>now)return 'missing';return now-at>metric.maxAgeHours*HOUR?'stale':'ready';
}
function validCondition(condition:MonitorCondition){return !!condition&&MONITOR_FIELDS.includes(condition.field)&&['gt','gte','lt','lte'].includes(condition.op)&&finite(condition.value)&&(condition.currency===undefined||currency(condition.currency))&&(condition.period===undefined||!!text(condition.period));}
function comparableCondition(condition:MonitorCondition,metric:MonitorMetric){
 if(['price','marketCap','epsEstimate'].includes(condition.field)&&!currency(metric.currency))return false;
 if(condition.field==='earningsWithinDays'&&metric.value!<0)return false;
 if(condition.currency!==undefined&&condition.currency!==metric.currency)return false;
 if(['revenueGrowthPct','epsEstimate'].includes(condition.field)&&!text(metric.period))return false;
 return condition.period===undefined||text(condition.period)===text(metric.period);
}
function matchedReason(conditions:MonitorEvaluation['conditions'],snapshot:MonitorSnapshot){
 const labels:Record<MonitorCondition['field'],string>={price:'Cotización',changePct:'Variación de sesión',pe:'PER',pb:'Precio/valor contable',marketCap:'Capitalización',revenueGrowthPct:'Crecimiento de ingresos',epsEstimate:'BPA estimado',earningsWithinDays:'Días hasta resultados'},operators={gt:'>',gte:'≥',lt:'<',lte:'≤'},number=(value:number)=>new Intl.NumberFormat('es-ES',{maximumSignificantDigits:10}).format(value);
 return ('Condiciones cumplidas: '+conditions.map(row=>{const {condition}=row,metric=snapshot.metrics[condition.field]!,unit=['price','marketCap','epsEstimate'].includes(condition.field)?condition.currency??metric.currency??'':['changePct','revenueGrowthPct'].includes(condition.field)?'%':['pe','pb'].includes(condition.field)?'x':'días',period=text(condition.period??metric.period).slice(0,80),suffix=unit?' '+unit:'';return `${labels[condition.field]} ${operators[condition.op]} ${number(condition.value)}${suffix}; actual ${number(row.value!)}${suffix}${period?' ['+period+']':''} (dato ${row.asOf})`;}).join(' · ')).slice(0,2000);
}
/** Unknown evidence never means false. An AND rule is, however, definitely
 * false when any fresh condition is false, even if another field is missing. */
export function evaluateMonitoringAlert(alert:MonitorAlert,snapshot:MonitorSnapshot,now=Date.now()):MonitorEvaluation{
 const checkedAt=new Date(now).toISOString();
 if(!alert.enabled)return {status:'paused',matched:null,reason:'Seguimiento en pausa.',checkedAt,conditions:[]};
 if(alert.symbol!==snapshot.symbol||!Array.isArray(alert.conditions)||alert.conditions.length<1||alert.conditions.length>5||alert.conditions.some(condition=>!validCondition(condition)))return {status:'missing',matched:null,reason:'La regla necesita entre una y cinco condiciones válidas del mismo activo.',checkedAt,conditions:[]};
 const conditions:MonitorEvaluation['conditions']=alert.conditions.map(condition=>{
  const metric=snapshot.metrics[condition.field],freshness=metricStatus(metric,now),ready=freshness==='ready'&&comparableCondition(condition,metric!),value=finite(metric?.value)?metric.value:null;
  let status:MonitorEvaluation['conditions'][number]['status']=freshness==='stale'?'stale':'missing';
  if(ready)status=(condition.op==='gt'?value!>condition.value:condition.op==='gte'?value!>=condition.value:condition.op==='lt'?value!<condition.value:value!<=condition.value)?'met':'unmet';
  return {condition:{...condition},status,value,asOf:metric?.asOf??null,source:metric?.source??'',url:monitoringSourceUrl(metric?.url??'')};
 });
 if(conditions.some(condition=>condition.status==='unmet'))return {status:'unmatched',matched:false,reason:'Al menos una condición no se cumple con información vigente.',checkedAt,conditions};
 if(conditions.every(condition=>condition.status==='met'))return {status:'matched',matched:true,reason:matchedReason(conditions,snapshot),checkedAt,conditions};
 const missing=conditions.some(condition=>condition.status==='missing');return {status:missing?'missing':'stale',matched:null,reason:missing?'Falta información comparable, su moneda o su período; se conserva el estado anterior.':'La información ha superado su vigencia; se conserva el estado anterior.',checkedAt,conditions};
}

function newNews(previous:MonitorSnapshot|null,current:MonitorSnapshot,now:number){
 const urls=new Set<string>(),titles=new Set<string>();for(const item of previous?.news??[]){const url=canonicalMonitoringUrl(item.url),title=monitoringTitleKey(item.title);if(url)urls.add(url);if(title)titles.add(title);}
 return current.news.filter(item=>{const at=stamp(item.date),url=canonicalMonitoringUrl(item.url),title=monitoringTitleKey(item.title);if(at===null||at>now||now-at>7*DAY||!url||!title||urls.has(url)||titles.has(title))return false;urls.add(url);titles.add(title);return true;});
}
const calendarKey=(event:MonitorCalendarEvent)=>[event.symbol,event.kind,event.date].join(':');
/** Changes describe observations, never a causal explanation for a move or a
 * recommendation. A daily quote direction has one stable key across polls. */
export function detectMonitoringChanges(previous:MonitorSnapshot|null,current:MonitorSnapshot,now=Date.now()):MonitorChange[]{
 if(previous&&previous.symbol!==current.symbol)return [];
 const changes:MonitorChange[]=[],price=current.metrics.changePct;
 if(metricStatus(price,now)==='ready'&&Math.abs(price!.value!)>=3){
  const at=stamp(price!.asOf)!,day=price!.asOf!.length===10?price!.asOf!:portfolioMarketDate(at),direction=price!.value!>=0?'up':'down',prior=previous?.metrics.changePct,priorAt=stamp(prior?.asOf),priorDay=priorAt===null?null:prior!.asOf!.length===10?prior!.asOf!:portfolioMarketDate(priorAt),sameDirection=priorDay===day&&finite(prior?.value)&&Math.abs(prior.value)>=3&&(prior.value>=0?'up':'down')===direction;
  if(!sameDirection)changes.push({key:`price:${current.symbol}:${day}:${direction}`,symbol:current.symbol,kind:'price',title:`${current.symbol}: variación de sesión ${round(price!.value!)} %`,detail:'Movimiento respecto a la referencia de sesión publicada. El cambio de precio no identifica por sí solo su causa.',occurredAt:price!.asOf!,source:price!.source,url:monitoringSourceUrl(price!.url),importance:'high',before:finite(prior?.value)?prior.value:null,after:price!.value!,unit:'%',currency:null});
 }
 const before=previous?.metrics.epsEstimate,after=current.metrics.epsEstimate;
 if(metricStatus(before,now)==='ready'&&metricStatus(after,now)==='ready'&&before!.value!==0&&currency(before!.currency)&&before!.currency===after!.currency&&text(before!.period)&&text(before!.period)===text(after!.period)&&before!.unit===after!.unit&&stamp(after!.asOf)!>=stamp(before!.asOf)!){
  const changePct=(after!.value!-before!.value!)/Math.abs(before!.value!)*100;
  if(finite(changePct)&&Math.abs(changePct)+1e-9>=2)changes.push({key:`estimate:${current.symbol}:${monitoringKey([after!.period,after!.currency,after!.value,after!.asOf].join(':'))}`,symbol:current.symbol,kind:'estimate',title:`${current.symbol}: revisión de estimación de BPA`,detail:`La estimación para ${after!.period} cambia un ${round(changePct)} %; comparación del mismo período y moneda.`,occurredAt:after!.asOf!,source:after!.source,url:monitoringSourceUrl(after!.url),importance:'high',before:before!.value,after:after!.value,unit:after!.unit,currency:after!.currency});
 }
 for(const article of newNews(previous,current,now))changes.push({key:`news:${monitoringKey(monitoringNewsKey(article))}`,symbol:current.symbol,kind:'news',title:article.title,detail:article.summary||article.excerpt||'Nueva información publicada sobre el activo.',occurredAt:article.date,source:article.source,url:article.url,importance:'medium',...(article.analysisKey?{analysisKey:article.analysisKey}:{})});
 const priorCalendar=new Set((previous?.calendar??[]).map(calendarKey));for(const event of current.calendar){const at=stamp(event.date),observed=stamp(event.asOf);if(event.kind!=='publication'||event.symbol!==current.symbol||!event.confirmed||at===null||at>now||now-at>7*DAY||observed===null||observed>now||!text(event.source)||!safeUrl(event.url)||priorCalendar.has(calendarKey(event)))continue;changes.push({key:`publication:${current.symbol}:${monitoringKey(calendarKey(event))}`,symbol:current.symbol,kind:'publication',title:event.title,detail:event.details||'Nueva publicación fechada; no equivale a una estimación de resultados.',occurredAt:event.date,source:event.source,url:event.url,importance:'high'});}
 return changes;
}

type ExposureAccumulator={symbol:string;direct:number[];indirect:number[];missingDirect:boolean;missingIndirect:boolean;currencies:Set<string>;unknownCurrency:boolean;positive:boolean;negative:boolean;portfolios:Set<string>;via:Set<string>;dates:Set<string>;coverage:number[];complete:boolean;notes:Set<string>};
function exposures(context:MonitorContext,now:number){
 const snapshots=new Map(context.snapshots.map(snapshot=>[snapshot.symbol,snapshot])),rows=new Map<string,ExposureAccumulator>(),get=(symbol:string)=>{let row=rows.get(symbol);if(!row){row={symbol,direct:[],indirect:[],missingDirect:false,missingIndirect:false,currencies:new Set(),unknownCurrency:false,positive:false,negative:false,portfolios:new Set(),via:new Set(),dates:new Set(),coverage:[],complete:true,notes:new Set()};rows.set(symbol,row);}return row;};
 for(const symbol of [...context.watchlist,...context.symbols])get(symbol);
 const equities=new Map<string,{value:number;currency:string}>(),seenPositions=new Map<string,string>();let denominatorComplete=true,heldFundMissing=false;
 const markDirection=(row:ExposureAccumulator,value:number)=>{if(value>0)row.positive=true;if(value<0)row.negative=true;};
 const markCurrency=(row:ExposureAccumulator,value:unknown)=>{if(currency(value))row.currencies.add(value);else{row.unknownCurrency=true;row.complete=false;row.notes.add('Moneda sin verificar: no se agregan importes.');}};
 for(const position of context.positions){
  if(!finite(position.quantity)||position.quantity===0)continue;const row=get(position.symbol),positionKey=position.portfolioId+':'+position.symbol,signature=JSON.stringify(position),seen=seenPositions.get(positionKey);if(seen!==undefined){if(seen!==signature){row.missingDirect=true;row.complete=false;row.notes.add('Hay posiciones duplicadas con valores incompatibles; no se agregan.');denominatorComplete=false;}continue;}seenPositions.set(positionKey,signature);row.portfolios.add(position.portfolioName);markCurrency(row,position.currency);markDirection(row,position.quantity);
  const quotedAt=stamp(position.quoteAt),valued=finite(position.marketValue)&&quotedAt!==null&&quotedAt<=now&&now-quotedAt<=7*DAY;
  if(valued&&currency(position.currency)){row.direct.push(position.marketValue!);}else{row.missingDirect=true;row.complete=false;row.notes.add('Hay una posición directa sin valoración verificable.');}
  if(!currency(position.currency)||!finite(position.equity)||position.equity<=0)denominatorComplete=false;else{const prior=equities.get(position.portfolioId);if(prior&&(prior.value!==position.equity||prior.currency!==position.currency))denominatorComplete=false;else equities.set(position.portfolioId,{value:position.equity,currency:position.currency});}
  const fund=snapshots.get(position.symbol);if(fund?.kind!=='etf')continue;
  const holdings=fund.holdings,at=stamp(holdings?.asOf),valid=holdings&&at!==null&&at<=now&&now-at<=180*DAY&&text(holdings.source)&&safeUrl(holdings.url),items=valid?holdings!.items:[];
  row.notes.add('El valor del fondo y su desglose en subyacentes son vistas de la misma inversión y no se suman entre sí.');
  if(!valid||!items.length){row.complete=false;row.notes.add('No hay un desglose de participaciones vigente y verificable.');heldFundMissing=true;continue;}
  const combined=new Map<string,number>();let conflicting=false;for(const holding of items)if(text(holding.symbol)&&holding.symbol!==position.symbol&&finite(holding.weightPct)&&holding.weightPct>0&&holding.weightPct<=100){const prior=combined.get(holding.symbol);if(prior!==undefined&&prior!==holding.weightPct)conflicting=true;else combined.set(holding.symbol,holding.weightPct);}
  const total=[...combined.values()].reduce((sum,value)=>sum+value,0);if(total>100.01||conflicting){row.complete=false;row.notes.add('El desglose publicado tiene pesos incompatibles; no se calcula exposición indirecta.');heldFundMissing=true;continue;}
  const coverage=finite(holdings!.coveragePct)&&holdings!.coveragePct>=0&&holdings!.coveragePct<=100?Math.min(holdings!.coveragePct,total):null,full=coverage!==null&&coverage>=99.9;
  if(!full){row.complete=false;row.notes.add('La cobertura de participaciones es parcial; no representa toda la cartera del fondo.');}
  for(const [symbol,weight]of combined){const target=get(symbol);target.via.add(position.symbol);target.portfolios.add(position.portfolioName);target.dates.add(holdings!.asOf!);markCurrency(target,position.currency);markDirection(target,position.quantity);if(coverage!==null)target.coverage.push(coverage);else target.complete=false;
   if(valued&&currency(position.currency))target.indirect.push(position.marketValue!*weight/100);else{target.missingIndirect=true;target.complete=false;}
   if(!full){target.complete=false;target.notes.add('Exposición indirecta calculada sólo con los pesos publicados; la cobertura del fondo es parcial.');}
   target.notes.add('La exposición indirecta es un desglose del fondo, no capital adicional.');
  }
 }
 // Following a fund is an information relationship, not an investment. Its
 // verified constituents can explain an agenda entry without inventing cash
 // exposure or confusing published portfolio weights with the user's weights.
 const heldSymbols=new Set(context.positions.filter(position=>finite(position.quantity)&&position.quantity!==0).map(position=>position.symbol));
 for(const symbol of new Set(context.watchlist)){
  if(heldSymbols.has(symbol))continue;const fund=snapshots.get(symbol);if(fund?.kind!=='etf')continue;const holdings=fund.holdings,at=stamp(holdings?.asOf),parent=get(symbol);
  if(!holdings||at===null||at>now||now-at>180*DAY||!text(holdings.source)||!safeUrl(holdings.url)||!holdings.items.length){parent.complete=false;parent.notes.add('El ETF en seguimiento no tiene una composición vigente y verificable.');continue;}
  const combined=new Map<string,number>();let conflicting=false;for(const holding of holdings.items)if(text(holding.symbol)&&holding.symbol!==symbol&&finite(holding.weightPct)&&holding.weightPct>0&&holding.weightPct<=100){const prior=combined.get(holding.symbol);if(prior!==undefined&&prior!==holding.weightPct)conflicting=true;else combined.set(holding.symbol,holding.weightPct);}
  const total=[...combined.values()].reduce((sum,value)=>sum+value,0);if(conflicting||total>100.01){parent.complete=false;parent.notes.add('La composición del ETF en seguimiento tiene pesos incompatibles.');continue;}
  const coverage=finite(holdings.coveragePct)&&holdings.coveragePct>=0&&holdings.coveragePct<=100?Math.min(holdings.coveragePct,total):null,full=coverage!==null&&coverage>=99.9;
  for(const [underlying,weight]of combined){const target=get(underlying);target.via.add(symbol);target.dates.add(holdings.asOf!);if(coverage!==null)target.coverage.push(coverage);if(!full)target.complete=false;target.notes.add(`Composición de ${symbol} en seguimiento: peso publicado ${round(weight)} %. Sin posición en el fondo no se atribuye exposición monetaria a la cartera.`);}
 }
 const currencies=new Set([...equities.values()].map(item=>item.currency)),denominator=denominatorComplete&&currencies.size===1?[...equities.values()].reduce((sum,item)=>sum+item.value,0):null,portfolioCurrency=currencies.size===1?[...currencies][0]:null;
 return [...rows.values()].map(row=>{
  const incompatible=row.unknownCurrency||row.currencies.size>1;if(row.currencies.size>1){row.complete=false;row.notes.add('Exposiciones en monedas distintas: no se suman sin una conversión verificada.');}
  if(heldFundMissing){row.complete=false;row.notes.add('Al menos un fondo de la cartera no tiene participaciones verificables; la exposición indirecta puede estar incompleta.');}
  const financial=row.direct.length>0||row.indirect.length>0||row.missingDirect||row.missingIndirect,unit=!incompatible&&row.currencies.size===1?[...row.currencies][0]:null,directValue=incompatible||row.missingDirect?null:row.direct.length?round(row.direct.reduce((sum,value)=>sum+value,0)):financial?0:null,indirectValue=incompatible||row.missingIndirect?null:row.indirect.length?round(row.indirect.reduce((sum,value)=>sum+value,0)):financial&&!heldFundMissing?0:null,total=directValue===null||indirectValue===null?null:directValue+indirectValue;
  const value:MonitorExposure={symbol:row.symbol,directValue,indirectValue,currency:unit,weightPct:total!==null&&denominator!==null&&denominator>0&&unit===portfolioCurrency?total/denominator*100:null,direction:row.positive&&row.negative?'mixed':row.negative?'short':row.positive?'long':'watchlist',portfolios:[...row.portfolios].sort(),holdingsAsOf:[...row.dates].sort(),holdingsCoveragePct:row.coverage.length?Math.min(...row.coverage):null,complete:row.complete&&!incompatible,notes:[...row.notes]};return {value,via:[...row.via].sort()};
 });
}
export function buildMonitoringExposure(context:MonitorContext,now=Date.now()):MonitorExposure[]{return exposures(context,now).map(row=>row.value).sort((a,b)=>a.symbol.localeCompare(b.symbol));}
export function buildMonitoringAgenda(context:MonitorContext,now=Date.now()):MonitorAgendaItem[]{
 const bySymbol=new Map(exposures(context,now).map(row=>[row.value.symbol,row])),seen=new Set<string>(),today=portfolioMarketDate(now),end=now+90*DAY,items:MonitorAgendaItem[]=[];
 for(const snapshot of context.snapshots)for(const event of snapshot.calendar){const at=stamp(event.date),published=stamp(event.asOf);
  if(at===null||published===null||published>now||now-published>90*DAY||at>end||!text(event.source)||!safeUrl(event.url))continue;if(event.date.length===10?event.date<today:at<now)continue;
  const exposure=bySymbol.get(event.symbol),key=calendarKey(event);if(!exposure||seen.has(key))continue;seen.add(key);items.push({...event,exposure:exposure.value,indirectVia:exposure.via});
 }
 const amount=(item:MonitorAgendaItem)=>Math.abs((item.exposure.directValue??0)+(item.exposure.indirectValue??0));return items.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||amount(b)-amount(a)||a.symbol.localeCompare(b.symbol)).slice(0,150);
}

import {eodhdGet,eodhdSymbol,terminalInstrumentSymbol} from './eodhd-client.ts';
import {eodhdFundamentalRaw,normalizeEodhdQuarterly} from './eodhd-fundamentals.ts';
import {normalizeEodhdDaily} from './eodhd-market.ts';
import {buildAssetInsights} from './asset-insights.ts';
import {buildIssuerResearch} from './issuer-research.ts';
import {stdev} from './market-analytics.ts';
import type {ResearchMetric} from './research-types.ts';

type Row=Record<string,any>;
export type StockRadarCategory='Calidad y crecimiento'|'Mejora de expectativas'|'Fortaleza relativa';
export type StockRadarCandidate={symbol:string;name:string;sector:string;category:StockRadarCategory;asOf:string;financialDate:string;recordDate:string;metrics:ResearchMetric[];reasons:string[];risks:string[];watchpoints:string[];evidenceCount:number};
export type StockResearchRadar={fetchedAt:string;asOf:string;horizonMonths:6;status:'ready'|'partial'|'unavailable';refreshing?:boolean;universe:{label:string;size:number;screened:number;coverage:string};candidates:StockRadarCandidate[];methodology:{selection:string;criteria:string[]};coverageNotes:string[]};
export type StockRadarHistory={symbol:string;currency:string;points:{date:string;close:number;adjustedClose:number;volume:number|null}[]};
export type StockRadarDependencies={request?:typeof eodhdGet;fundamentals?:(symbol:string)=>Promise<Row|null>;history?:(symbol:string,currency:string)=>Promise<StockRadarHistory|null>;fallback?:{fundamentals:(symbol:string)=>Promise<Row|null>;history?:(symbol:string,currency:string)=>Promise<StockRadarHistory|null>};now?:number};
type UniverseEntry={symbol:string;sector:string;priority:number;screened:boolean};
type Universe={entries:UniverseEntry[];size:number;label:string;coverage:string;partial:boolean};
type Ranked={candidate:StockRadarCandidate;rank:number;issuer:string};
const DAY=86400000,MAX_CANDIDATES=18,MAX_RESULTS=9;
const SECTOR_REFERENCE:Record<string,string>={Technology:'XLK',Industrials:'XLI',Healthcare:'XLV',Energy:'XLE','Consumer Defensive':'XLP','Consumer Cyclical':'XLY','Communication Services':'XLC','Basic Materials':'XLB',Utilities:'XLU'};
const FINANCIAL=/financial|real estate|bank|insurance|reit/i;
const sectorName=(value:unknown)=>{const name=text(value);return ({'Consumer Cyclicals':'Consumer Cyclical','Consumer Discretionary':'Consumer Cyclical','Consumer Staples':'Consumer Defensive','Health Care':'Healthcare','Information Technology':'Technology',Materials:'Basic Materials'} as Record<string,string>)[name]??name;};
const FILTER='General,Highlights,Valuation,Technicals,Earnings,Financials';
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const num=(v:unknown):number|null=>finite(v)?v:typeof v==='string'&&/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const record=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown,max=200)=>typeof v==='string'?v.replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim().slice(0,max):'';
const day=(v:unknown,now:number):string|null=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&Date.parse(v)<=now?v:null;
const age=(date:string,now:number)=>(now-Date.parse(date))/DAY;
const pct=(v:number)=>v.toLocaleString('es-ES',{maximumFractionDigits:1})+' %';
const multiple=(v:number)=>v.toLocaleString('es-ES',{maximumFractionDigits:2})+'×';
const canonical=(v:unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9.-]{0,16}(?:\.US)?$/i.test(v)?terminalInstrumentSymbol(v.toUpperCase()):null;
const eligibleSector=(sector:string)=>Object.hasOwn(SECTOR_REFERENCE,sector)&&!FINANCIAL.test(sector);
const methodology=()=>({selection:'Muestra líquida de acciones estadounidenses no financieras, con contraste de cuentas publicadas y cierres ajustados.',criteria:['Capitalización superior a 2.000 millones USD y volumen medio superior a 300.000 acciones.','Acumulados de beneficio, caja operativa y caja libre positivos en los últimos cuatro trimestres consecutivos comparables.','Ingresos del último trimestre superiores al mismo trimestre del año anterior.','Confirmación adicional: revisión del BPA ≥ 3 % en treinta días con al menos tres analistas, ventaja histórica frente al sector ≥ 3 puntos, caja libre / capitalización ≥ 3 % o mejora trimestral del margen ≥ 1 punto.','Orden por número de señales verificadas y diversificación sectorial. No es una probabilidad ni una previsión de rentabilidad.']});
export function emptyStockResearchRadar(now=Date.now(),note='No hay suficientes datos recientes para publicar una selección fundamentada.',status:StockResearchRadar['status']='unavailable'):StockResearchRadar{return {fetchedAt:new Date(now).toISOString(),asOf:new Date(now).toISOString(),horizonMonths:6,status,universe:{label:'Acciones de EE. UU. · muestra acotada',size:0,screened:0,coverage:'Sin universo verificable disponible.'},candidates:[],methodology:methodology(),coverageNotes:[note]};}

async function parallel<T,R>(values:T[],count:number,fn:(value:T)=>Promise<R>):Promise<(R|null)[]>{const result:(R|null)[]=Array(values.length).fill(null);let next=0;await Promise.all(Array.from({length:Math.min(count,values.length)},async()=>{while(next<values.length){const i=next++;try{result[i]=await fn(values[i]);}catch{/* One failed issuer never invalidates the rest of the sample. */}}}));return result;}
function diversify(entries:UniverseEntry[],limit:number):UniverseEntry[]{
 const groups=new Map<string,UniverseEntry[]>(),seen=new Set<string>();
 for(const entry of [...entries].sort((a,b)=>b.priority-a.priority||a.symbol.localeCompare(b.symbol))){if(seen.has(entry.symbol)||!eligibleSector(entry.sector))continue;seen.add(entry.symbol);const rows=groups.get(entry.sector)??[];rows.push(entry);groups.set(entry.sector,rows);}
 const result:UniverseEntry[]=[];for(let round=0;result.length<limit;round++){let added=false;for(const rows of groups.values())if(rows[round]&&result.length<limit){result.push(rows[round]);added=true;}if(!added)break;}return result;
}
export function stockRadarScreenEntries(raw:unknown,now=Date.now()):UniverseEntry[]{
 const data=record(raw).data;if(!Array.isArray(data))return [];
 return data.slice(0,80).flatMap((input:unknown)=>{const row=record(input),symbol=canonical(row.code),at=day(row.last_day_data_date,now),sector=sectorName(row.sector),cap=num(row.market_capitalization),eps=num(row.earnings_share),volume=num(row.avgvol_200d),price=num(row.adjusted_close);
  return symbol&&String(row.exchange).toUpperCase()==='US'&&at&&age(at,now)<=7&&eligibleSector(sector)&&cap!==null&&cap>2e9&&eps!==null&&eps>0&&volume!==null&&volume>300000&&price!==null&&price>0?[{symbol,sector,priority:volume,screened:true}]:[];
 });
}
function holdingEntries(raw:Row|null,expected:string,now:number,sectorHint=''):UniverseEntry[]{
 const g=record(raw?.General),fund=record(raw?.ETF_Data),at=day(g.UpdatedAt,now);if(g.Code!==expected||String(g.Type).toUpperCase()!=='ETF'||!at||age(at,now)>45)return [];
 const all=record(fund.Holdings),positions=Object.keys(all).length?all:record(fund.Top_10_Holdings);
 return Object.entries(positions).slice(0,700).flatMap(([key,input])=>{const row=record(input),symbol=canonical(row.Code&&String(row.Exchange).toUpperCase()==='US'?row.Code:key.endsWith('.US')?key:''),sector=sectorName(row.Sector)||sectorHint,weight=num(row['Assets_%']);return symbol&&weight!==null&&weight>0&&eligibleSector(sector)?[{symbol,sector,priority:weight,screened:false}]:[];});
}
async function universe(request:typeof eodhdGet,read:(symbol:string)=>Promise<Row|null>,now:number):Promise<Universe>{
 const raw=await request<Row>('screener',{filters:JSON.stringify([['exchange','=','us'],['market_capitalization','>',2000000000],['earnings_share','>',0],['avgvol_200d','>',300000]]),sort:'avgvol_200d.desc',limit:80},{ttlMs:86400000,cost:5,timeoutMs:8000}).catch(()=>null);
 if(raw&&Array.isArray(raw.data)){
  const entries=stockRadarScreenEntries(raw,now);return {entries:diversify(entries,MAX_CANDIDATES),size:new Set(entries.map(r=>r.symbol)).size,label:'Acciones líquidas de EE. UU. · cribado acotado',coverage:'Hasta 80 valores del filtro inicial por liquidez; se verifican como máximo 18 empresas con diversificación sectorial.',partial:false};
 }
 const base=await read('SPY').catch(()=>null),entries=holdingEntries(base,'SPY',now),sectors=new Set(entries.map(r=>r.sector));
 // Actual holdings determine the symbols. Sector ETFs fill a limited sample
 // only when the broad fund lacks a sufficiently diversified holdings block.
 const missing=Object.entries(SECTOR_REFERENCE).filter(([sector])=>!sectors.has(sector)).slice(0,9);
 if(sectors.size<6){const additions=await parallel(missing,2,async([sector,symbol])=>holdingEntries(await read(symbol),symbol,now,sector));for(const rows of additions)if(rows)entries.push(...rows);}
 return {entries:diversify(entries,MAX_CANDIDATES),size:new Set(entries.map(r=>r.symbol)).size,label:'EE. UU. · muestra de posiciones de fondos de referencia',coverage:'El cribado global no está disponible. La selección parte de posiciones de SPY y de hasta nueve fondos sectoriales, observadas al consultar los fondos; no se presupone su fecha de publicación. No representa todo el mercado.',partial:true};
}
function completedDate(now:number){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));return {today:`${parts.year}-${parts.month}-${parts.day}`,closed:Number(parts.hour)>=16};}
export function normalizeStockRadarHistory(symbol:string,currency:string,rows:unknown,now=Date.now()):StockRadarHistory|null{
 const session=completedDate(now),data=normalizeEodhdDaily(rows,now).filter(r=>r.date<session.today||r.date===session.today&&session.closed);
 if(!/^[A-Z]{3}$/.test(currency)||!data.length||data.some(r=>!finite(r.adjusted)||r.adjusted<=0))return null;
 return {symbol,currency,points:data.map(r=>({date:r.date,close:r.close,adjustedClose:r.adjusted,volume:r.volume}))};
}
function safeHistory(history:StockRadarHistory|null,symbol:string,now:number):StockRadarHistory|null{
 if(!history||history.symbol!==symbol||history.currency!=='USD'||!Array.isArray(history.points))return null;
 const session=completedDate(now),rows=new Map<string,StockRadarHistory['points'][number]>();
 for(const point of history.points.slice(0,600)){const date=day(point.date,now);if(!date||date>session.today||date===session.today&&!session.closed||!finite(point.close)||point.close<=0||!finite(point.adjustedClose)||point.adjustedClose<=0)continue;rows.set(date,{date,close:point.close,adjustedClose:point.adjustedClose,volume:finite(point.volume)&&point.volume>=0?point.volume:null});}
 const points=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));return points.length>=2&&age(points.at(-1)!.date,now)<=7?{...history,points}:null;
}
function relativeSixMonths(asset:StockRadarHistory|null,benchmark:StockRadarHistory|null):{value:number;from:string;to:string}|null{
 if(!asset||!benchmark||asset.currency!==benchmark.currency)return null;
 const a=new Map(asset.points.map(p=>[p.date,p.adjustedClose])),b=new Map(benchmark.points.map(p=>[p.date,p.adjustedClose])),last=asset.points.at(-1)!.date;
 // Both series must contain the same completed final session, not merely
 // overlap somewhere in the past. No latest-vs-stale return comparison.
 if(last!==benchmark.points.at(-1)!.date)return null;
 const cutoff=new Date(last+'T12:00Z'),month=cutoff.getUTCMonth();cutoff.setUTCDate(1);cutoff.setUTCMonth(month-6);const end=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();cutoff.setUTCDate(Math.min(Number(last.slice(8)),end));const minimum=cutoff.toISOString().slice(0,10),dates=[...a.keys()].filter(d=>b.has(d)&&d>=minimum).sort();
 if(dates.length<100||Date.parse(dates.at(-1)!)-Date.parse(dates[0])<150*DAY)return null;
 const from=dates[0],to=dates.at(-1)!;return {value:((a.get(to)!/a.get(from)!-1)-(b.get(to)!/b.get(from)!-1))*100,from,to};
}

/** Deterministic evidence, not a forecast or a recommendation. All amounts in
 * a TTM sum have the same statement currency and four consecutive quarters. */
export function buildStockRadarCandidate(symbol:string,raw:Row|null,history:StockRadarHistory|null,benchmark:StockRadarHistory|null,now=Date.now(),screened=false):Ranked|null{
 const g=record(raw?.General),at=day(g.UpdatedAt,now),sector=sectorName(g.Sector),name=text(g.Name,240),code=eodhdSymbol(symbol)?.replace(/\.US$/,'');
 if(!raw||g.Code!==code||!/^common stock$/i.test(String(g.Type))||!name||g.CurrencyCode!=='USD'||!at||age(at,now)>45||!eligibleSector(sector))return null;
 const prices=safeHistory(history,symbol,now);if(!prices)return null;
 const volume=prices.points.slice(-200).map(p=>p.volume),average=volume.length>=200&&volume.every(finite)?(volume as number[]).reduce((a,b)=>a+b,0)/volume.length:null;
 if(average!==null&&average<=300000||!screened&&average===null)return null;
 const insights=buildAssetInsights(raw,null,symbol,now),issuer=buildIssuerResearch(raw,symbol,null,now),quarters=insights.financials.rows.slice(-5).reverse(),latest=quarters[0],four=quarters.slice(0,4),cap=insights.metrics.find(m=>m.id==='marketCap')?.value??null;
 if(cap===null||cap<=2e9||four.length!==4||!latest||age(latest.period,now)>195||!latest.currency||four.some((q,i)=>q.currency!==latest.currency||q.revenue===null||q.revenue<=0||q.netIncome===null||q.operatingCashFlow===null||q.freeCashFlow===null||q.filingDate!==null&&(q.filingDate<q.period||!day(q.filingDate,now))||i>0&&((Date.parse(four[i-1].period)-Date.parse(q.period))/DAY<60||(Date.parse(four[i-1].period)-Date.parse(q.period))/DAY>120)))return null;
 const span=(Date.parse(latest.period)-Date.parse(four.at(-1)!.period))/DAY;if(span<250||span>305)return null;
 const sum=(field:'revenue'|'netIncome'|'operatingCashFlow'|'freeCashFlow')=>four.reduce((total,q)=>total+q[field]!,0),revenue=sum('revenue'),profit=sum('netIncome'),ocf=sum('operatingCashFlow'),fcf=sum('freeCashFlow');
 if(profit<=0||ocf<=0||fcf<=0||fcf>ocf*1.05)return null;
 const yearAgo=quarters.find(q=>{const distance=(Date.parse(latest.period)-Date.parse(q.period))/DAY;return distance>=350&&distance<=380&&q.currency===latest.currency&&q.revenue!==null&&q.revenue>0;}),growth=yearAgo?(latest.revenue!/yearAgo.revenue!-1)*100:null;
 if(growth===null||growth<=0||growth>500)return null;
 const margin=fcf/revenue*100,conversion=ocf/profit,fcfYield=latest.currency==='USD'&&age(at,now)<=14?fcf*1e6/cap*100:null,relative=relativeSixMonths(prices,safeHistory(benchmark,SECTOR_REFERENCE[sector],now));
 const estimate=age(at,now)<=14?issuer.estimates.find(e=>e.type==='quarterly'&&e.period>latest.period&&Date.parse(e.period)<=now+195*DAY&&e.currency===latest.currency&&e.eps.analysts!==null&&e.eps.analysts>=3&&e.epsTrend.current!==null&&e.epsTrend.current>0&&e.epsTrend.days30!==null&&e.epsTrend.days30>0):null;
 const revision=estimate?(estimate.epsTrend.current!/estimate.epsTrend.days30!-1)*100:null;
 const prior=quarters[1],marginImprovement=prior?.fcfMarginPct!==null&&prior?.fcfMarginPct!==undefined&&latest.fcfMarginPct!==null?latest.fcfMarginPct-prior.fcfMarginPct:null;
 const signals={revision:revision!==null&&revision>=3,relative:relative!==null&&relative.value>=3,cashYield:fcfYield!==null&&fcfYield>=3,margin:marginImprovement!==null&&marginImprovement>=1&&latest.fcfMarginPct!==null&&latest.fcfMarginPct>0};
 if(!Object.values(signals).some(Boolean))return null;
 const stamp=prices.points.at(-1)!.date,period=four.at(-1)!.period+' a '+latest.period,metrics:ResearchMetric[]=[];
 const add=(id:string,label:string,value:number|null,unit:string,currency:string|null,date:string,atPeriod:string)=>{if(value!==null&&finite(value))metrics.push({id:symbol+':radar:'+id,label,value,unit,currency,date,period:atPeriod,symbol});};
 add('revenueGrowth','Ingresos · variación interanual',growth,'percent',null,latest.period,latest.period+' vs '+yearAgo!.period);
 add('fcfMargin','Margen de caja libre',margin,'percent',null,latest.period,'TTM · '+period);
 if(signals.revision)add('epsRevision30','Revisión del BPA · 30 días',revision,'percent',null,at,'Estimación · '+estimate!.period);
 else if(signals.relative)add('relative6m','Frente al sector · 6 meses',relative!.value,'pp',null,relative!.to,relative!.from+' a '+relative!.to+' · '+SECTOR_REFERENCE[sector]);
 else add('fcfYield','Caja libre / capitalización',fcfYield,'percent',null,at,'FCF TTM · '+latest.period);
 add('netIncome','Beneficio publicado',profit,'millions',latest.currency,latest.period,'TTM · '+period);add('fcf','Caja libre publicada',fcf,'millions',latest.currency,latest.period,'TTM · '+period);add('cashConversion','Caja operativa / beneficio',conversion,'multiple',null,latest.period,'TTM · '+period);
 if(!signals.revision)add('epsRevision30','Revisión del BPA · 30 días',revision,'percent',null,at,'Estimación · '+(estimate?.period??''));
 if(estimate)add('epsAnalysts','Analistas en la estimación de BPA',estimate.eps.analysts,'count',null,at,'Estimación · '+estimate.period);
 if(!signals.relative)add('relative6m','Frente al sector · 6 meses',relative?.value??null,'pp',null,relative?.to??stamp,relative?relative.from+' a '+relative.to+' · '+SECTOR_REFERENCE[sector]:'');
 if(signals.revision||signals.relative)add('fcfYield','Caja libre / capitalización',fcfYield,'percent',null,at,'FCF TTM · '+latest.period);
 const forward=insights.metrics.find(m=>m.id==='forwardPe')?.value??null;if(age(at,now)<=14&&forward!==null&&forward>0)add('forwardPe','PER previsto · consenso',forward,'multiple',null,at,'Estimación');
 const changes=prices.points.slice(-21).slice(1).map((p,i)=>p.adjustedClose/prices.points.slice(-21)[i].adjustedClose-1),sd=changes.length===20?stdev(changes):null,volatility=sd===null?null:sd*Math.sqrt(252)*100;
 add('volatility20','Volatilidad · 20 sesiones',volatility,'percent',null,stamp,'Anualizada · 252 sesiones');add('close','Último cierre',prices.points.at(-1)!.close,'currency','USD',stamp,'Cierre de sesión');
 const reasons=[`Beneficio y caja libre acumulados positivos en los doce meses publicados hasta ${latest.period}.`,`Ingresos del último trimestre: ${pct(growth)} interanual; margen de caja libre TTM: ${pct(margin)}.`];
 if(signals.revision)reasons.push(`El BPA estimado para ${estimate!.period} se ha revisado ${pct(revision!)} en treinta días.`);
 if(signals.relative)reasons.push(`Supera a ${SECTOR_REFERENCE[sector]} en ${relative!.value.toLocaleString('es-ES',{maximumFractionDigits:1})} puntos durante seis meses de sesiones comunes.`);
 if(signals.cashYield)reasons.push(`La caja libre publicada equivale al ${pct(fcfYield!)} de la capitalización fechada al ${at}.`);
 if(signals.margin)reasons.push(`El margen de caja libre del trimestre mejora ${marginImprovement!.toLocaleString('es-ES',{maximumFractionDigits:1})} puntos respecto al trimestre anterior.`);
 const risks:string[]=[],watchpoints=[`Verificar en la próxima publicación que continúen el crecimiento de ingresos y la conversión del beneficio en caja.`,`Contrastar la evolución del negocio durante los próximos seis meses; el horizonte no es una fecha objetivo de precio.`];
 if(conversion<1)risks.push(`La caja operativa TTM cubre ${multiple(conversion)} el beneficio; la conversión es inferior a la unidad.`);
 if(forward!==null&&forward>35)risks.push(`El PER previsto es ${multiple(forward)}; la valoración depende de que se materialicen las estimaciones.`);
 if(volatility!==null&&volatility>45)risks.push(`Volatilidad anualizada reciente del ${pct(volatility)}; existe riesgo de oscilaciones amplias.`);
 if(revision!==null&&revision<0)risks.push(`El consenso de BPA del próximo trimestre se ha recortado ${pct(Math.abs(revision))} durante treinta días.`);
 if(relative!==null&&relative.value<0)risks.push(`Rentabilidad ajustada inferior al fondo sectorial en el último semestre comparable.`);
 if(signals.margin)risks.push('La mejora del margen frente al trimestre anterior puede contener estacionalidad; debe contrastarse con períodos equivalentes.');
 if(latest.currency!=='USD')risks.push(`Las cuentas están publicadas en ${latest.currency}; no se calcula caja libre sobre capitalización USD sin conversión de divisa.`);
 if(!risks.length)risks.push('El crecimiento y los márgenes publicados pueden deteriorarse; las señales históricas no aseguran rentabilidad futura.');
 if(estimate)watchpoints.push(`Revisar el BPA estimado y su dispersión para el trimestre ${estimate.period}, sin confundirlo con un resultado publicado.`);
 const issuerId=text(g.CIK,20).replace(/^0+/,''),issuerKey=/^\d+$/.test(issuerId)?'cik:'+issuerId:'name:'+name.toLowerCase().replace(/\b(class\s+[a-z]|incorporated|inc|corporation|corp|limited|ltd|plc)\b/g,'').replace(/[^a-z0-9]/g,'');
 return {candidate:{symbol,name,sector,category:signals.revision?'Mejora de expectativas':signals.relative?'Fortaleza relativa':'Calidad y crecimiento',asOf:stamp,financialDate:latest.period,recordDate:at,metrics,reasons,risks:risks.slice(0,4),watchpoints:watchpoints.slice(0,3),evidenceCount:reasons.length},rank:3+Object.values(signals).filter(Boolean).length+(conversion>=1?1:0),issuer:issuerKey};
}

export async function loadStockResearchRadar(overrides:StockRadarDependencies={}):Promise<StockResearchRadar>{
 const now=overrides.now??Date.now(),request=overrides.request??eodhdGet;
 const primaryFundamentals=overrides.fundamentals??(async(symbol:string)=>eodhdFundamentalRaw(symbol,(path,query,options)=>request(path,{...query,filter:['SPY',...Object.values(SECTOR_REFERENCE)].includes(symbol)?'General,ETF_Data':FILTER},{...options,timeoutMs:8000})));
 // One broad-fund entitlement probe per build. If it fails, avoid repeating
 // the same unavailable fundamentals capability for every sector and issuer.
 // A later shared-cache refresh probes SPY again and restores primary access.
 let primaryUnavailableForBuild=false;
 const fundamentals=async(symbol:string)=>{const raw=primaryUnavailableForBuild?null:await primaryFundamentals(symbol).catch(()=>null);if(symbol==='SPY'&&!raw&&overrides.fallback)primaryUnavailableForBuild=true;const fund=record(raw?.ETF_Data),updated=day(raw?.General?.UpdatedAt,now),quarters=raw?normalizeEodhdQuarterly(raw,5,now):[],fresh=updated!==null&&age(updated,now)<=45&&raw?.General?.Code===eodhdSymbol(symbol)?.replace(/\.US$/,''),complete=fresh&&(raw?.General?.Type==='ETF'?Object.keys(record(fund.Holdings)).length>0||Object.keys(record(fund.Top_10_Holdings)).length>0:quarters.length>=5&&age(quarters[0].period,now)<=195&&quarters.slice(0,4).every(q=>q.numeric.revenue!==null&&q.numeric.netIncome!==null&&q.numeric.operatingCF!==null&&q.numeric.freeCashFlow!==null));if(raw&&complete||!overrides.fallback)return raw;return await overrides.fallback.fundamentals(symbol).catch(()=>null)??raw;};
 const primaryHistory=overrides.history??(async(symbol:string,currency:string)=>{const id=eodhdSymbol(symbol);if(!id)return null;const raw=await request<unknown[]>('eod/'+id,{from:new Date(now-400*DAY).toISOString().slice(0,10),to:new Date(now).toISOString().slice(0,10),order:'a'},{ttlMs:6*3600000,cost:1,timeoutMs:8000});return normalizeStockRadarHistory(symbol,currency,raw,now);});
 const history=async(symbol:string,currency:string)=>{const primary=await primaryHistory(symbol,currency).catch(()=>null);return primary??await overrides.fallback?.history?.(symbol,currency).catch(()=>null)??null;};
 const sample=await universe(request,fundamentals,now),result=emptyStockResearchRadar(now);result.universe={label:sample.label,size:sample.size,screened:sample.entries.length,coverage:sample.coverage};
 if(!sample.entries.length){result.coverageNotes=['No hay una muestra verificable de acciones que permita publicar candidatos.','Se excluyen financieras y REIT: los criterios de caja operativa de este radar no son comparables para esos negocios.'];return result;}
 const references=[...new Set(sample.entries.map(r=>SECTOR_REFERENCE[r.sector]).filter(Boolean))],referencesMap=new Map<string,StockRadarHistory|null>();
 const [issuers]=await Promise.all([parallel(sample.entries,2,async entry=>{const [raw,prices]=await Promise.all([fundamentals(entry.symbol),history(entry.symbol,'USD')]);return {entry,raw,prices};}),parallel(references,2,async reference=>{referencesMap.set(reference,await history(reference,'USD'));return true;})]);
 const ranked=issuers.flatMap(row=>{if(!row)return [];const rawSector=sectorName(row.raw?.General?.Sector),value=buildStockRadarCandidate(row.entry.symbol,row.raw,row.prices,referencesMap.get(SECTOR_REFERENCE[rawSector])??null,now,row.entry.screened);return value?[value]:[];}).sort((a,b)=>b.rank-a.rank||b.candidate.recordDate.localeCompare(a.candidate.recordDate)||a.candidate.symbol.localeCompare(b.candidate.symbol));
 const seen=new Set<string>(),sectorCounts=new Map<string,number>();for(const row of ranked){if(seen.has(row.issuer)||(sectorCounts.get(row.candidate.sector)??0)>=2)continue;seen.add(row.issuer);sectorCounts.set(row.candidate.sector,(sectorCounts.get(row.candidate.sector)??0)+1);result.candidates.push(row.candidate);if(result.candidates.length===MAX_RESULTS)break;}
 const available=issuers.filter(row=>row?.raw&&row.prices).length;
 result.status=result.candidates.length?(sample.partial||result.candidates.length<6||available<sample.entries.length?'partial':'ready'):'unavailable';
 result.coverageNotes=[`${sample.entries.length} empresas consultadas; ${available} tienen respuesta de cuentas y precios; ${result.candidates.length} reúnen evidencia suficiente para la selección. No se completa la lista con empresas sin datos.`,'Financieras y REIT excluidos por la distinta interpretación de sus flujos de caja.','Volumen negociado no equivale a compras institucionales. Las revisiones son consenso, no beneficios obtenidos ni promesas de rentabilidad.'];
 if(available<sample.entries.length)result.coverageNotes.push('La información no disponible no se interpreta como un resultado financiero negativo.');
 if(sample.partial)result.coverageNotes.unshift('Universo de muestra: posiciones verificadas de fondos, sin acceso al cribado global.');
 return result;
}
export const stockResearchRadar=loadStockResearchRadar;

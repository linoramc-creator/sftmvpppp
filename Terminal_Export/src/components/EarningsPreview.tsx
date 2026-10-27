import {useEffect,useRef,useState,type ReactNode} from 'react';
import {CalendarDays,RefreshCw} from 'lucide-react';
import {Bar,BarChart,CartesianGrid,Legend,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {authenticatedFetch} from '@/lib/beta-api';
import {chartDateLabel,formatChartMoney} from '@/lib/financial-chart-data';
import {useProfile} from './AuthGate';
import {usePanelActive} from './KeepPanel';
import {ttStyle} from './options/theme';
import type {EarningsPreview as Preview,EstimateBand,GrowthComparison} from '../../../supabase/functions/analyze-ticker/earnings-preview';

const TTL=600000;
const memory=new Map<string,{at:number;data:Preview}>();
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const number=(value:number|null|undefined,digits=2)=>finite(value)?value.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const pct=(value:number|null|undefined)=>finite(value)?`${value>0?'+':''}${number(value)}%`:'—';
const button='rounded-lg border border-slate-700/50 p-2 text-slate-400 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:opacity-40';
const heading='!m-0 !border-0 !p-0 !font-sans !text-sm !font-semibold !normal-case !tracking-normal text-slate-100';
function calendarTodayMadrid(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const field=(type:string)=>parts.find(part=>part.type===type)?.value;
 return `${field('year')}-${field('month')}-${field('day')}`;
}

function valid(value:Preview,symbol:string){
 return value?.symbol===symbol&&['ready','partial','unavailable'].includes(value.status)&&Number.isFinite(Date.parse(value.fetchedAt))&&!!value.next?.eps&&!!value.next?.revenue&&!!value.next?.revisions&&Array.isArray(value.history)&&Array.isArray(value.summary?.points)&&typeof value.summary?.headline==='string'&&Array.isArray(value.notes);
}

function Metric({label,value,children}:{label:string;value:ReactNode;children?:ReactNode}){
 return <div className="min-w-0 rounded-xl border border-slate-700/40 bg-slate-950/25 p-4"><p className="!m-0 !text-xs text-slate-400">{label}</p><p className="!mb-0 mt-2 !text-xl font-semibold tracking-tight tabular-nums text-slate-100">{value}</p>{children&&<div className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-500">{children}</div>}</div>;
}

function Growth({data}:{data:GrowthComparison|null}){
 if(!data)return null;
 return <p className="!m-0"><span className="font-medium tabular-nums text-slate-300">{pct(data.changePct)}</span>{finite(data.changePct)?' interanual':' · Base interanual no comparable'}<span className="mt-0.5 block text-[10px] text-slate-500">Frente al período cerrado el {chartDateLabel(data.period,true)}</span></p>;
}

function Estimate({label,band,growth,compact=false}:{label:string;band:EstimateBand;growth:GrowthComparison|null;compact?:boolean}){
 return <Metric label={label} value={formatChartMoney(band.mean,band.currency??undefined,compact)}>
  {(finite(band.low)||finite(band.high))&&<p className="!m-0">Rango <span className="tabular-nums text-slate-300">{formatChartMoney(band.low,undefined,compact)} — {formatChartMoney(band.high,undefined,compact)}</span>{band.currency?` ${band.currency}`:''}</p>}
  {finite(band.analysts)&&<p className="!m-0">{number(band.analysts,0)} analistas</p>}
  <Growth data={growth}/>
 </Metric>;
}

function History({data}:{data:Preview}){
 const [unit,setUnit]=useState<string|null>(null),[allRows,setAllRows]=useState(false);
 const today=calendarTodayMadrid();
 const published=data.history.filter(row=>finite(row.epsActual)&&row.reportDate<=today&&row.period<=today&&Number.isFinite(Date.parse(row.reportDate))&&Number.isFinite(Date.parse(row.period))).sort((a,b)=>a.reportDate.localeCompare(b.reportDate));
 const currencies=[...new Set(published.map(row=>row.currency??''))];
 const desired=data.next.eps.currency??data.next.currency??'';
 const currency=unit!==null&&currencies.includes(unit)?unit:currencies.includes(desired)?desired:currencies.at(-1)??'';
 const rows=published.filter(row=>(row.currency??'')===currency).slice(-8);
 if(!rows.length)return null;
 const hasEstimates=rows.some(row=>finite(row.epsEstimate)),hasRevenue=rows.some(row=>finite(row.revenueActual)),visible=allRows?rows.slice().reverse():rows.slice(-4).reverse();
 return <div className="rounded-xl border border-slate-700/35 bg-slate-950/15 p-4 sm:p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className={heading}>Resultados anteriores</h3><p className="!mb-0 mt-1 !text-[11px] text-slate-500">{hasEstimates?'EPS publicado frente al consenso previo':'EPS publicado'} · {currency?`${currency} por acción`:'Por acción'}</p></div>{currencies.length>1&&<select aria-label="Moneda de los resultados anteriores" value={currency} onChange={event=>setUnit(event.target.value)} className="rounded-lg border border-slate-700 bg-[#0b131f] px-2 py-1.5 text-xs text-slate-300">{currencies.map(value=><option key={value} value={value}>{value||'Moneda no informada'}</option>)}</select>}</div>
  {rows.length>1&&<div aria-label="EPS histórico publicado y estimado" className="mt-4 h-52 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer data={rows} margin={{top:8,right:8,left:0,bottom:0}} barGap={4} barCategoryGap="24%"><CartesianGrid stroke="#243142" strokeDasharray="2 5" vertical={false}/><XAxis dataKey="period" tickFormatter={value=>chartDateLabel(String(value))} tick={{fill:'#8190a6',fontSize:10}} tickLine={false} axisLine={false} minTickGap={22}/><YAxis width={44} tickFormatter={value=>number(Number(value),1)} tick={{fill:'#8190a6',fontSize:10}} tickLine={false} axisLine={false}/><ReferenceLine y={0} stroke="#52647d"/><Tooltip contentStyle={ttStyle} cursor={false} labelFormatter={(value,payload)=>{const row=payload?.[0]?.payload;return `Período ${chartDateLabel(String(value),true)}${row?` · Publicado ${chartDateLabel(row.reportDate,true)}`:''}`;}} formatter={(value:number,name)=>[formatChartMoney(value,currency||undefined),name]}/><Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>{hasEstimates&&<Bar dataKey="epsEstimate" name="Consenso previo" fill="#52647d" maxBarSize={22} radius={[3,3,0,0]} isAnimationActive={false}/>}<Bar dataKey="epsActual" name="EPS publicado" fill="#60a5fa" maxBarSize={22} radius={[3,3,0,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>}
  <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Historial de publicaciones y sorpresas de resultados de {data.symbol}</caption><thead><tr className="border-b border-slate-700/60 text-[10px] text-slate-500"><th className="whitespace-nowrap pb-2 pr-3 font-medium">Publicación / período fiscal</th>{hasEstimates&&<th className="px-2 pb-2 text-right font-medium">Consenso EPS</th>}<th className="px-2 pb-2 text-right font-medium">EPS publicado</th>{hasEstimates&&<th className="px-2 pb-2 text-right font-medium">Sorpresa</th>}{hasRevenue&&<th className="whitespace-nowrap pl-2 pb-2 text-right font-medium">Ingresos publicados</th>}</tr></thead><tbody>{visible.map(row=><tr key={`${row.reportDate}:${row.period}`} className="border-b border-slate-800/55 last:border-0"><td className="whitespace-nowrap py-3 pr-3"><span className="block text-slate-300">{chartDateLabel(row.reportDate,true)}</span><span className="mt-0.5 block text-[10px] text-slate-500">Hasta {chartDateLabel(row.period,true)}</span></td>{hasEstimates&&<td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-slate-400">{number(row.epsEstimate)}</td>}<td className="whitespace-nowrap px-2 py-3 text-right font-medium tabular-nums text-slate-100">{number(row.epsActual)}</td>{hasEstimates&&<td className={`whitespace-nowrap px-2 py-3 text-right tabular-nums ${finite(row.surprisePct)&&row.surprisePct<0?'text-rose-300':'text-blue-300'}`}>{pct(row.surprisePct)}</td>}{hasRevenue&&<td className="whitespace-nowrap py-3 pl-2 text-right tabular-nums text-slate-300">{formatChartMoney(row.revenueActual,currency||undefined,true)}</td>}</tr>)}</tbody></table></div>
  {rows.length>4&&<button type="button" onClick={()=>setAllRows(value=>!value)} className="mt-3 rounded-md py-1 text-[11px] text-blue-300 outline-none hover:text-blue-200 focus-visible:ring-2 focus-visible:ring-blue-400/70">{allRows?'Ver últimas cuatro publicaciones':`Ver las ${rows.length} publicaciones`}</button>}
 </div>;
}

export default function EarningsPreview({symbol,eventDate,revision=0}:{symbol:string;eventDate?:string;revision?:number}){
 const active=usePanelActive(),profile=useProfile(),subject=symbol.trim().toUpperCase();
 const hint=/^\d{4}-\d{2}-\d{2}$/.test(eventDate??'')?eventDate:undefined;
 const key=`${profile?.id??'session'}:${subject}:${hint??''}`;
 const[state,setState]=useState<{key:string;data:Preview|null;busy:boolean;error:boolean}>({key,data:memory.get(key)?.data??null,busy:!memory.get(key)?.data,error:false});
 const[manual,setManual]=useState(0),applied=useRef({key:'',revision,manual:0});
 const data=state.key===key?state.data:null,busy=state.key!==key||state.busy,error=state.key===key&&state.error;
 useEffect(()=>{
  if(!active||!subject)return;
  let live=true;const controller=new AbortController(),stored=memory.get(key);
  const force=applied.current.key===key&&(applied.current.revision!==revision||applied.current.manual!==manual);
  applied.current={key,revision,manual};
  if(!force&&stored&&Date.now()-stored.at<TTL){setState({key,data:stored.data,busy:false,error:false});return()=>controller.abort();}
  setState(previous=>({key,data:previous.key===key?previous.data:stored?.data??null,busy:true,error:false}));
  authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'earningsPreview',subject,...(hint?{eventDate:hint}:{})}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])}).then(async response=>{
   if(!response.ok)throw Error();const value:Preview=await response.json();if(!valid(value,subject))throw Error();
   if(live){memory.delete(key);memory.set(key,{at:Date.now(),data:value});while(memory.size>40)memory.delete(memory.keys().next().value!);setState({key,data:value,busy:false,error:false});}
  }).catch(()=>{if(live)setState(previous=>({key,data:previous.key===key?previous.data:null,busy:false,error:true}));});
  return()=>{live=false;controller.abort();};
 },[active,key,subject,hint,revision,manual]);
 if(!subject)return null;
 const next=data?.next,hasEPS=next&&finite(next.eps.mean),hasRevenue=next&&finite(next.revenue.mean),revisions=next?.revisions;
 const hasRevision=!!revisions&&[revisions.days30Pct,revisions.up30,revisions.down30].some(finite);
 const hasCoverage=data&&(hasEPS||hasRevenue||data.history.length>0);
 const today=calendarTodayMadrid(),futureDate=next?.date&&next.date>=today?next.date:null;
 return <section aria-label={`Previa de resultados de ${subject}`} aria-busy={busy} className="overflow-hidden rounded-2xl border border-slate-700/50 bg-[#0b131f] font-sans text-slate-300">
  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/40 bg-gradient-to-r from-blue-400/[0.06] to-transparent px-5 py-4 sm:px-6"><div><p className="!m-0 !text-[10px] font-medium uppercase tracking-[0.14em] text-blue-300">{subject} · Próximos resultados</p><h2 className={`${heading} !mt-1.5`}>Expectativas y publicaciones anteriores</h2></div><button type="button" aria-label="Actualizar previa de resultados" title="Actualizar expectativas" disabled={busy} className={button} onClick={()=>setManual(value=>value+1)}><RefreshCw size={14} className={busy?'motion-safe:animate-spin':''}/></button></header>
  {!data?(busy?<div role="status" className="space-y-4 px-5 py-5 sm:px-6"><span className="sr-only">Cargando expectativas de resultados…</span><div className="h-3 w-52 max-w-full rounded bg-slate-700/40 motion-safe:animate-pulse"/><div className="grid grid-cols-2 gap-3">{[0,1].map(value=><div key={value} className="h-24 rounded-xl bg-slate-800/45 motion-safe:animate-pulse"/>)}</div></div>:<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"><p role="alert" className="!m-0 !text-xs text-slate-400">No se han podido consultar las expectativas de resultados.</p><button type="button" onClick={()=>setManual(value=>value+1)} className="rounded-md text-xs text-blue-300 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70">Reintentar expectativas</button></div>):<div className="space-y-5 px-5 py-5 sm:px-6">
   {error&&<p role="status" className="!m-0 !text-xs text-slate-500">No se ha podido actualizar. Se conserva la última consulta.</p>}
   <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><span className="inline-flex items-center gap-2 font-medium text-slate-200"><CalendarDays size={14} className="text-blue-300"/>{futureDate?chartDateLabel(futureDate,true):'Fecha pendiente de confirmación'}</span>{futureDate&&<span className="text-slate-400">{next.session}</span>}{futureDate&&next.provisional&&<span className="rounded-md border border-slate-700/60 px-2 py-1 text-[10px] text-slate-400">Fecha prevista</span>}</div>{(next.periodLabel||next.period)&&<span className="text-[11px] text-slate-400">{next.periodLabel||`Período hasta ${chartDateLabel(next.period!,true)}`}</span>}</div>
   {(hasEPS||hasRevenue||hasRevision)&&<div className={`grid gap-3 ${Number(hasEPS)+Number(hasRevenue)+Number(hasRevision)>2?'sm:grid-cols-2 xl:grid-cols-3':'sm:grid-cols-2'}`}>
    {hasEPS&&<Estimate label="EPS esperado · por acción" band={next.eps} growth={next.epsYoY}/>}
    {hasRevenue&&<Estimate label="Ingresos esperados" band={next.revenue} growth={next.revenueYoY} compact/>}
    {hasRevision&&<Metric label="Revisiones del EPS · 30 días" value={finite(revisions.days30Pct)?pct(revisions.days30Pct):`${finite(revisions.up30)?number(revisions.up30,0):'—'} ↑ / ${finite(revisions.down30)?number(revisions.down30,0):'—'} ↓`}>{finite(revisions.days30Pct)&&<p className="!m-0">Cambio del consenso de beneficio por acción</p>}{(finite(revisions.up30)||finite(revisions.down30))&&<p className="!m-0"><span className="tabular-nums text-slate-300">{finite(revisions.up30)?number(revisions.up30,0):'—'}</span> al alza · <span className="tabular-nums text-slate-300">{finite(revisions.down30)?number(revisions.down30,0):'—'}</span> a la baja</p>}{finite(revisions.days90Pct)&&<p className="!m-0">Últimos 90 días <span className="tabular-nums text-slate-300">{pct(revisions.days90Pct)}</span></p>}</Metric>}
   </div>}
   {data.summary.headline&&<div className="rounded-xl border border-blue-400/15 bg-blue-400/[0.035] px-4 py-3.5"><h3 className="!m-0 !border-0 !p-0 !text-xs !font-semibold !normal-case !tracking-normal text-slate-200">{data.summary.headline}</h3>{data.summary.points.length>0&&<ul className="!mb-0 mt-2.5 space-y-2 !pl-0 text-xs leading-relaxed text-slate-400">{data.summary.points.slice(0,4).map((point,index)=><li key={index} className="flex gap-2.5"><span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-blue-300/70"/><span>{point}</span></li>)}</ul>}</div>}
   {hasCoverage&&<History key={subject} data={data}/>}
   {!hasCoverage&&!data.summary.headline&&<p className="!m-0 !text-xs leading-relaxed text-slate-400">Todavía no hay estimaciones publicadas para el próximo resultado de {subject}.</p>}
   <footer className="space-y-1.5 border-t border-slate-800/70 pt-3 text-[10px] leading-relaxed text-slate-500"><p className="!m-0">{data.asOf?`Datos disponibles al ${chartDateLabel(data.asOf,true)}`:`Consultado ${new Date(data.fetchedAt).toLocaleString('es-ES')}`} · Las estimaciones pueden cambiar antes de la publicación.</p>{data.notes.slice(0,3).map((note,index)=><p className="!m-0" key={index}>{note}</p>)}</footer>
  </div>}
 </section>;
}

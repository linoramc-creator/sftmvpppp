import {useEffect,useRef,useState,type ReactNode} from 'react';
import {AlertCircle,ArrowUpRight,ChartNoAxesCombined,Check,ChevronRight,Loader2,ShieldAlert} from 'lucide-react';
import {Bar,BarChart,CartesianGrid,Cell,Legend,Line,LineChart,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {authenticatedFetch} from '@/lib/beta-api';
import {NewsCards} from '@/components/FeedCards';
import {EvidenceCards} from './RelativeAnalysis';
import type {ComparisonAsset,ComparisonChartRow,ComparisonPair,ComparisonRange,MarketComparison} from '../../../supabase/functions/analyze-ticker/market-comparison';

const ENDPOINT=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`;
const COLORS=['#60a5fa','#34d399','#c4b5fd','#fbbf24','#fb7185','#94a3b8','#38bdf8'];
const RANGES:{value:ComparisonRange;label:string}[]=[{value:'1m',label:'1 mes'},{value:'3m',label:'3 meses'},{value:'6m',label:'6 meses'},{value:'1y',label:'1 año'}];
const n=(value:number|null|undefined,digits=2)=>value==null||!Number.isFinite(value)?'—':value.toLocaleString('es-ES',{maximumFractionDigits:digits});
const pct=(value:number|null|undefined)=>value==null?'—':`${value>0?'+':''}${n(value)}%`;
const compact=(value:number|null|undefined)=>value==null?'—':value.toLocaleString('es-ES',{notation:'compact',maximumFractionDigits:2});
const dated=(value:string|null|undefined)=>!value?'Sin fecha':/^\d{4}-\d{2}-\d{2}/.test(value)?new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'}):value;
const tone=(value:number|null|undefined)=>value==null?'text-slate-500':value>=0?'text-emerald-300':'text-rose-300';
const benchmark=(symbol:string)=>symbol==='SPY'?'S&P 500 · SPY':symbol==='URTH'?'MSCI World · URTH':symbol;
const chartTip={background:'#111b29',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',fontSize:11};

export function parseComparisonInput(value:string):{symbols:string[];error:string}{
 const symbols=value.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
 if(!symbols.length)return{symbols,error:''};
 if(symbols.length>5)return{symbols,error:'Puedes comparar un máximo de cinco activos. Retira los tickers sobrantes.'};
 if(symbols.some(s=>!/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(s)))return{symbols,error:'Cada ticker debe ser válido y tener un máximo de 15 caracteres.'};
 if(new Set(symbols).size!==symbols.length)return{symbols,error:'Cada activo debe aparecer una sola vez.'};
 return{symbols,error:symbols.length<2?'Introduce al menos dos activos.':''};
}
function Panel({title,note,children,id}:{title:string;note?:string;children:ReactNode;id?:string}){
 return <section id={id} className="min-w-0 rounded-xl border border-slate-700/60 bg-slate-950/30 p-4 sm:p-5"><h2 className="text-sm font-semibold text-slate-100">{title}</h2>{note&&<p className="mt-1 text-[11px] leading-relaxed text-slate-500">{note}</p>}<div className="mt-4">{children}</div></section>;
}
function Metric({label,value,note}:{label:string;value:ReactNode;note?:string}){return <div><p className="text-[10px] leading-relaxed text-slate-500">{label}</p><p className="mt-1.5 text-base font-medium tabular-nums text-slate-200">{value}</p>{note&&<p className="mt-1 text-[10px] text-slate-500">{note}</p>}</div>;}
function Empty({children}:{children:ReactNode}){return <p className="py-9 text-center text-xs leading-relaxed text-slate-500">{children}</p>;}
function MarketChart({rows,symbols,correlation=false,ratio=false,labels={}}:{rows:ComparisonChartRow[];symbols:string[];correlation?:boolean;ratio?:boolean;labels?:Record<string,string>}){
 const hasData=rows.some(row=>symbols.some(s=>typeof row[s]==='number'));
 if(!hasData)return <Empty>No hay suficientes observaciones coincidentes para esta vista.</Empty>;
 return <div className="h-72 sm:h-80"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{top:8,right:10,left:0,bottom:0}}><CartesianGrid stroke="#263447" strokeDasharray="2 5" vertical={false}/><XAxis dataKey="date" tick={{fontSize:10,fill:'#94a3b8'}} tickLine={false} axisLine={false} minTickGap={40} tickFormatter={v=>dated(String(v)).replace(/ \d{4}$/,'')}/><YAxis width={54} domain={correlation?[-1,1]:['auto','auto']} tick={{fontSize:10,fill:'#94a3b8'}} tickLine={false} axisLine={false} tickFormatter={v=>`${n(v,1)}${correlation||ratio?'':'%'}`}/><Tooltip cursor={{stroke:'#64748b',strokeDasharray:'3 3'}} contentStyle={chartTip} labelFormatter={v=>dated(String(v))} formatter={(v:number)=>`${n(v)}${correlation||ratio?'':'%'}`}/><ReferenceLine y={ratio?100:0} stroke="#475569" strokeDasharray="4 4"/><Legend wrapperStyle={{fontSize:10,paddingTop:12}}/>{symbols.map((s,i)=><Line key={s} dataKey={s} name={labels[s]??benchmark(s)} stroke={COLORS[i%COLORS.length]} strokeWidth={s==='SPY'||s==='URTH'?1.4:2} strokeDasharray={s==='SPY'||s==='URTH'?'4 4':undefined} type="linear" dot={false} activeDot={{r:3,strokeWidth:0}} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>;
}
function Performance({data}:{data:MarketComparison}){
 const [view,setView]=useState<'returns'|'drawdowns'>('returns');
 return <Panel title="Rentabilidad y caídas" note={`${dated(data.window.start)} — ${dated(data.window.end)} · ${data.window.observations} sesiones comunes`}>
  <div role="group" aria-label="Vista de rendimiento" className="mb-4 flex gap-1">{[['returns','Rentabilidad'],['drawdowns','Caídas desde máximos']].map(([key,label])=><button key={key} type="button" aria-pressed={view===key} onClick={()=>setView(key as typeof view)} className={`rounded-md px-3 py-2 text-xs ${view===key?'bg-slate-700 text-white':'text-slate-400 hover:bg-slate-800'}`}>{label}</button>)}</div>
  <MarketChart rows={view==='returns'?data.chart:data.drawdowns} symbols={data.universe}/>
  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">SPY y URTH son ETF de referencia para S&P 500 y MSCI World. Rentabilidades en la moneda de cada activo, sin convertir divisas. Índices y futuros conservan su propia serie de cotización.</p>
 </Panel>;
}
function CorrelationMatrix({data}:{data:MarketComparison}){
 return <Panel title="Correlación entre activos" note="Rendimientos diarios · Cada celda conserva su número de sesiones coincidentes."><div className="overflow-x-auto"><table className="w-full min-w-[410px] text-center text-xs"><thead><tr><th className="p-2 text-left font-normal text-slate-500">Activo</th>{data.universe.map(s=><th key={s} className="p-2 text-[11px] font-medium text-slate-300">{s}</th>)}</tr></thead><tbody>{data.universe.map((s,i)=><tr key={s}><th className="p-2 text-left text-[11px] font-medium text-slate-300">{s}</th>{data.universe.map((t,j)=>{const value=data.matrix[i]?.[j]??null,samples=data.matrixSamples[i]?.[j]??0;return <td key={t} title={`${s} / ${t}: ${samples} sesiones comunes`} className="border border-slate-950/30 px-2 py-3 tabular-nums" style={{background:value==null?'transparent':value>=0?`rgba(52,211,153,${Math.abs(value)*.25})`:`rgba(251,113,133,${Math.abs(value)*.25})`}}><span className="text-slate-100">{n(value)}</span><span className="mt-1 block text-[9px] text-slate-500">{samples} s.</span></td>;})}</tr>)}</tbody></table></div><p className="mt-3 text-[11px] leading-relaxed text-slate-500">Entre −1 y +1. Una correlación elevada puede reducir la diversificación; no garantiza que la relación se mantenga.</p></Panel>;
}
function PairExplorer({pairs}:{pairs:ComparisonPair[]}){
 const [selected,setSelected]=useState('');
 const pair=pairs.find(p=>`${p.a}|${p.b}`===selected)??pairs[0];
 if(!pair)return null;
 const rows=pair.ratio.map(p=>({date:p.date,ratio:p.value}));
 return <Panel title="Fuerza relativa entre dos activos" note={`${dated(pair.start)} — ${dated(pair.end)} · ${pair.observations} sesiones comunes`}>
  <label className="mb-5 block text-[11px] text-slate-400">Par de activos<select aria-label="Par de activos" value={`${pair.a}|${pair.b}`} onChange={e=>setSelected(e.target.value)} className="ml-3 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">{pairs.map(p=><option key={`${p.a}|${p.b}`} value={`${p.a}|${p.b}`}>{p.a} / {p.b}</option>)}</select></label>
  <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Diferencia · 20 sesiones" value={pair.relative20==null?'—':`${n(pair.relative20)} pp`}/><Metric label="Diferencia · 63 sesiones" value={pair.relative63==null?'—':`${n(pair.relative63)} pp`}/><Metric label="Desviación relativa · Z" value={pair.spreadZ==null?'—':`${n(pair.spreadZ)} σ`}/><Metric label="Correlación" value={n(pair.correlation)}/></div>
  {pair.currencyAligned?<MarketChart rows={rows} symbols={['ratio']} labels={{ratio:`${pair.a} / ${pair.b}`}} ratio/>:<Empty>La ratio requiere dos activos en la misma moneda. No se mezclan precios sin ajuste de divisa.</Empty>}
  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Ratio base 100: una subida indica mejor comportamiento de {pair.a} frente a {pair.b}. Z describe una desviación histórica; no confirma reversión ni una oportunidad de arbitraje.</p>
 </Panel>;
}
type RiskRow={label:string;format:(asset:ComparisonAsset)=>ReactNode};
function AssetTable({assets,rows}:{assets:ComparisonAsset[];rows:RiskRow[]}){
 return <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-xs"><thead><tr className="border-b border-slate-700/60"><th className="py-3 text-left font-normal text-slate-500">Métrica</th>{assets.map((a,i)=><th key={a.symbol} className="px-3 py-3 text-right font-semibold" style={{color:COLORS[i]}}>{a.symbol}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.label} className="border-b border-slate-800/70 last:border-0"><th className="py-3 text-left font-normal text-slate-400">{row.label}</th>{assets.map(a=><td key={a.symbol} className="px-3 py-3 text-right tabular-nums text-slate-200">{row.format(a)}</td>)}</tr>)}</tbody></table></div>;
}
function BarMetric({assets,field,unit}:{assets:ComparisonAsset[];field:'volatility'|'activity';unit:string}){
 const rows=assets.map((a,i)=>({symbol:a.symbol,value:field==='volatility'?a.window.volatility:a.relativeVolume,color:COLORS[i]}));
 if(!rows.some(r=>r.value!==null))return <Empty>No hay datos completos para esta métrica.</Empty>;
 return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows}><CartesianGrid stroke="#263447" vertical={false} strokeDasharray="2 5"/><XAxis dataKey="symbol" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#94a3b8'}}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#94a3b8'}} tickFormatter={v=>`${n(v,1)}${unit}`}/><Tooltip cursor={{fill:'#33415533'}} contentStyle={chartTip} formatter={(v:number)=>`${n(v)}${unit}`}/><Bar dataKey="value" name={field==='volatility'?'Volatilidad anualizada':'Volumen / media 20 s.'} radius={[4,4,0,0]}>{rows.map(r=><Cell key={r.symbol} fill={r.color}/>)}</Bar></BarChart></ResponsiveContainer></div>;
}
function HoldingsHistory({assets}:{assets:ComparisonAsset[]}){
 const stocks=assets.filter(a=>a.institutions.status!=='not-applicable');if(!stocks.length)return null;
 return <Panel title="Histórico de posiciones declaradas" note="Trimestres publicados · Las participaciones declaradas no representan entradas netas de dinero actuales."><div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-xs"><thead><tr className="border-b border-slate-700/60">{['Activo','Período','Participaciones','Cambio de participaciones','Instituciones'].map(h=><th key={h} className="p-3 font-normal text-slate-500">{h}</th>)}</tr></thead><tbody>{stocks.flatMap(a=>a.institutionalHistory.length?a.institutionalHistory.map(h=><tr key={a.symbol+h.period} className="border-b border-slate-800/60"><td className="p-3 font-medium text-slate-200">{a.symbol}</td><td className="p-3">{h.period}</td><td className="p-3 tabular-nums">{compact(h.shares)}</td><td className="p-3 tabular-nums">{compact(h.sharesChange)}</td><td className="p-3 tabular-nums">{n(h.investors,0)}</td></tr>):[<tr key={a.symbol} className="border-b border-slate-800/60"><td className="p-3 font-medium">{a.symbol}</td><td colSpan={4} className="p-3 text-slate-500">No hay una serie de declaraciones verificada disponible.</td></tr>])}</tbody></table></div></Panel>;
}
function MonthlyActivity({assets}:{assets:ComparisonAsset[]}){
 return <Panel title="Actividad negociada por mes" note="Importe negociado en la moneda del activo. No son flujos netos ni compras institucionales. El mes actual y el primer mes disponible pueden ser parciales."><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{assets.map(a=><div key={a.symbol} className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4"><p className="text-xs font-semibold text-slate-200">{a.symbol} <span className="ml-1 text-[10px] font-normal text-slate-500">{a.currency}</span></p>{a.monthlyActivity.length?a.monthlyActivity.map(m=><div key={m.month} className="mt-3 flex items-start justify-between gap-3 text-xs"><div className="text-slate-400">{m.month}<p className="mt-1 text-[9px] text-slate-500">{m.observations} sesiones{m.month===a.asOf?.slice(0,7)?' · mes en curso':''}</p></div><span className="tabular-nums text-slate-200">{m.value===null?'Sin volumen completo':compact(m.value)}</span></div>):<p className="mt-3 text-xs leading-relaxed text-slate-500">No hay volumen negociado verificable para este activo.</p>}</div>)}</div></Panel>;
}
function FactorTable({data}:{data:MarketComparison}){
 return <Panel title="Sensibilidad al contexto global" note="Correlaciones sobre hasta 63 sesiones comunes; el movimiento de la referencia recoge 20 sesiones."><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead><tr className="border-b border-slate-700/60"><th className="py-3 font-normal text-slate-500">Referencia</th><th className="px-3 py-3 text-right font-normal text-slate-500">20 sesiones</th>{data.symbols.map((s,i)=><th key={s} className="px-3 py-3 text-right" style={{color:COLORS[i]}}>{s}</th>)}</tr></thead><tbody>{data.factors.map(f=><tr key={f.symbol} className="border-b border-slate-800/70"><th className="py-3 font-normal text-slate-300">{f.label}<span className="mt-1 block text-[10px] text-slate-500">{dated(f.asOf)}</span></th><td className={`px-3 py-3 text-right tabular-nums ${tone(f.change20)}`}>{pct(f.change20)}</td>{data.symbols.map(s=><td key={s} className="px-3 py-3 text-right tabular-nums">{n(f.correlations.find(c=>c.symbol===s)?.value)}</td>)}</tr>)}</tbody></table></div><p className="mt-3 text-[11px] text-slate-500">La correlación no prueba causalidad ni anticipa el siguiente movimiento.</p></Panel>;
}
function Analysis({data,busy,onAnalyze}:{data:MarketComparison;busy:boolean;onAnalyze:()=>void}){
 return <Panel title="Análisis de las métricas" note={`Selección analizada: ${data.symbols.join(' · ')} · ${RANGES.find(r=>r.value===data.range)?.label}`}>
  {data.analysis.status!=='ready'?<div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><p className="max-w-xl text-xs leading-relaxed text-slate-400">Detecta diferencias de riesgo, fortalezas relativas, concentraciones y cambios de actividad en los datos mostrados.</p><button type="button" disabled={busy} onClick={onAnalyze} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-emerald-400/50 bg-emerald-400/10 px-4 py-2.5 text-xs font-semibold text-emerald-200 disabled:opacity-50">{busy?<Loader2 className="size-4 animate-spin"/>:<ChartNoAxesCombined className="size-4"/>}{busy?'Analizando…':'Analizar métricas'}</button></div>:<>
   <div className="grid gap-3 lg:grid-cols-2">{data.analysis.items.map(item=>{const Icon=item.kind==='advantage'?Check:item.kind==='vulnerability'?ShieldAlert:ChevronRight;return <article key={item.id} className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4"><div className="flex items-start justify-between gap-3"><div className="flex gap-2"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${item.kind==='advantage'?'text-emerald-400':item.kind==='vulnerability'?'text-amber-300':'text-sky-400'}`}/><div><p className="text-[9px] uppercase tracking-wider text-slate-500">{item.symbols.join(' · ')}</p><h3 className="mt-1 text-sm font-medium text-slate-200">{item.title}</h3></div></div><strong className="shrink-0 text-sm font-semibold tabular-nums text-slate-100">{item.value}</strong></div><p className="mt-3 text-xs leading-relaxed text-slate-400">{item.detail}</p>{item.comment&&<p className="mt-3 border-t border-slate-700/40 pt-3 text-xs leading-relaxed text-slate-300">{item.comment}</p>}</article>;})}</div>
   {!data.analysis.items.length&&<Empty>No hay suficientes diferencias verificadas para destacar una ventaja o vulnerabilidad.</Empty>}
   {data.analysis.context.length>0&&<div className="mt-4 grid gap-3 sm:grid-cols-2">{data.analysis.context.map((c,i)=><article key={i} className="rounded-lg border border-sky-500/20 bg-sky-950/10 p-4"><h3 className="text-sm font-medium text-sky-200">{c.title}</h3><p className="mt-2 text-xs leading-relaxed text-slate-400">{c.detail}</p></article>)}</div>}
  </>}
  {data.news.length>0&&<div className="mt-5 border-t border-slate-700/50 pt-5"><h3 className="mb-4 text-xs font-medium text-slate-300">Noticias relacionadas</h3><NewsCards articles={data.news} compact/></div>}
 </Panel>;
}

export default function UnifiedComparison(){
 const [input,setInput]=useState(''),[range,setRange]=useState<ComparisonRange>('3m'),[data,setData]=useState<MarketComparison|null>(null),[phase,setPhase]=useState<'load'|'analysis'|null>(null),[error,setError]=useState('');
 const revision=useRef(0),controller=useRef<AbortController|null>(null);
 const parsed=parseComparisonInput(input),busy=phase!==null;
 useEffect(()=>()=>{revision.current++;controller.current?.abort();},[]);
 async function load(includeAnalysis=false){
  if(busy)return;
  const symbols=includeAnalysis&&data?data.symbols:parsed.symbols,selectedRange=includeAnalysis&&data?data.range:range;
  if(!includeAnalysis&&(parsed.error||symbols.length<2)){setError(parsed.error||'Introduce entre dos y cinco activos.');return;}
  const current=++revision.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setPhase(includeAnalysis?'analysis':'load');setError('');
  try{
   const response=await authenticatedFetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'marketComparison',symbols,range:selectedRange,includeAnalysis}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(includeAnalysis?110000:80000)])});
   const result=await response.json();if(current!==revision.current)return;
   if(!response.ok)throw new Error(result.error||'No se ha podido completar la comparación.');
   if(!Array.isArray(result.symbols)||result.symbols.join(',')!==symbols.join(',')||result.range!==selectedRange||!Array.isArray(result.assets)||!Array.isArray(result.chart)||!result.analysis)throw new Error('Los datos recibidos no corresponden a esta comparación. Vuelve a intentarlo.');
   setData(result);
  }catch(e){if(current===revision.current&&!abort.signal.aborted)setError(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'La consulta ha tardado más de lo previsto. Vuelve a intentarlo.':e instanceof Error?e.message:'No se ha podido completar la comparación.');}
  finally{if(current===revision.current)setPhase(null);}
 }
 return <main className="mx-auto max-w-7xl space-y-5 px-4 py-7 font-body text-slate-200"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-medium uppercase tracking-[.2em] text-sky-400">Activos, riesgo y posicionamiento</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">Comparar</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">Una visión conjunta de rentabilidad, correlación, actividad y fortalezas relativas.</p></div><ChartNoAxesCombined aria-hidden="true" className="mt-2 size-7 shrink-0 text-sky-400/70"/></div>
  <form onSubmit={e=>{e.preventDefault();void load();}} className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4 sm:p-5"><div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end"><label className="flex-1 text-xs text-slate-400">Activos para comparar<textarea aria-label="Activos para comparar" aria-describedby={parsed.error?'comparison-input-error':'comparison-input-hint'} aria-invalid={Boolean(parsed.error)} value={input} onChange={e=>setInput(e.target.value.toUpperCase())} placeholder="Escribe de 2 a 5 tickers separados por comas" rows={2} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} className="mt-2 block w-full resize-y rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-400 disabled:opacity-60"/></label><label className="text-xs text-slate-400">Período<select aria-label="Período de comparación" value={range} disabled={busy} onChange={e=>setRange(e.target.value as ComparisonRange)} className="mt-2 block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-200">{RANGES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label><button type="submit" disabled={busy||parsed.symbols.length<2||Boolean(parsed.error)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">{phase==='load'?<Loader2 className="size-4 animate-spin"/>:<ChartNoAxesCombined className="size-4"/>}{phase==='load'?'Comparando…':'Comparar activos'}</button></div>{parsed.error?<p id="comparison-input-error" className="mt-3 text-xs text-rose-300">{parsed.error}</p>:<p id="comparison-input-hint" className="mt-3 text-[10px] text-slate-500">{parsed.symbols.length}/5 activos · S&P 500 y MSCI World se incluyen como referencias.</p>}</form>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-950/20 p-3 text-sm text-rose-200"><AlertCircle className="mt-0.5 size-4 shrink-0"/>{error}</div>}
  {!data?phase==='load'?<div role="status" className="rounded-xl border border-slate-700/50 p-8"><p className="text-sm text-slate-300">Preparando la comparación</p><p className="mt-2 text-xs text-slate-500">Alineando sesiones y referencias de mercado.</p><div aria-hidden="true" className="mt-6 h-44 rounded-lg bg-slate-800/50 motion-safe:animate-pulse"/></div>:<div className="rounded-xl border border-dashed border-slate-700/70 px-6 py-14 text-center"><ChartNoAxesCombined aria-hidden="true" className="mx-auto size-8 text-slate-600"/><h2 className="mt-4 text-base font-medium text-slate-200">Elige tus activos</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500">Compara de dos a cinco acciones, ETF o índices en una misma pantalla.</p></div>:<div className="space-y-5" aria-busy={busy}>
   <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-400"><p>{data.symbols.join(' · ')} <span className="mx-2 text-slate-600">/</span>{RANGES.find(r=>r.value===data.range)?.label}</p><p className="text-[10px] text-slate-500">Actualizado: {new Date(data.fetchedAt).toLocaleString('es-ES')}</p></div>
   {data.missing.length>0&&<p role="status" className="rounded-lg border border-amber-400/20 bg-amber-950/10 px-4 py-3 text-xs leading-relaxed text-amber-200">Sin histórico disponible: {data.missing.join(', ')}. Las demás observaciones se conservan.</p>}
   {!data.window.currencyAligned&&<p role="status" className="rounded-lg border border-sky-400/20 px-4 py-3 text-xs leading-relaxed text-sky-200">La selección contiene monedas distintas o series incompletas. Las relaciones sin una referencia comparable quedan sin calcular.</p>}
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.assets.map((a,i)=><article key={a.symbol} className="rounded-xl border border-slate-700/60 bg-gradient-to-br from-slate-900/70 to-slate-950/20 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2 rounded-full" style={{background:COLORS[i]}}/>{a.symbol}</p><p className="mt-1 truncate text-xs text-slate-500">{a.name}</p></div><div className="shrink-0 text-right"><p className="text-base font-medium tabular-nums">{n(a.price)} <span className="text-[10px] text-slate-500">{a.kind==='index'||a.kind==='future'?'pts':a.currency}</span></p><p className={`mt-1 text-xs tabular-nums ${tone(a.change1d)}`}>{pct(a.change1d)} <span className="text-[9px] text-slate-500">sesión</span></p></div></div><div className="mt-4 flex justify-between gap-3 border-t border-slate-700/40 pt-3"><span className="text-[10px] text-slate-500">{dated(a.asOf)}</span><span className="text-xs tabular-nums text-slate-300">{pct(a.window.totalReturn)} <span className="text-[9px] text-slate-500">período</span></span></div></article>)}</div>
   <Performance data={data}/><CorrelationMatrix data={data}/>
   <div className="grid gap-4 xl:grid-cols-2"><PairExplorer key={data.symbols.join(',')+data.range} pairs={data.pairs}/><Panel title="Correlación móvil frente al S&P 500" note="Ventana de 20 rendimientos diarios comunes; SPY representa al índice."><MarketChart rows={data.rolling} symbols={data.symbols.filter(s=>s!=='SPY')} correlation/></Panel></div>
   <div className="grid gap-4 lg:grid-cols-2"><Panel title="Volatilidad realizada" note={`Anualizada · ${RANGES.find(r=>r.value===data.range)?.label} · Fechas de cada activo en la tabla`}><BarMetric assets={data.assets} field="volatility" unit="%"/></Panel><Panel title="Actividad de la última sesión" note="Volumen frente a la media de 20 sesiones previas · Fechas de cada activo en la tabla"><BarMetric assets={data.assets} field="activity" unit="×"/></Panel></div>
   <Panel title="Riesgo y referencias de mercado" note="Métricas del período seleccionado; el histórico efectivo puede diferir entre activos."><AssetTable assets={data.assets} rows={[
    {label:'Período efectivo',format:a=>`${dated(a.window.start)} — ${dated(a.window.end)}`},
    {label:'Sesiones del período',format:a=>n(a.window.observations,0)},
    {label:'Rentabilidad del período',format:a=>pct(a.window.totalReturn)},
    {label:'Volatilidad anualizada',format:a=>a.window.volatility==null?'—':`${n(a.window.volatility)}%`},
    {label:'Caída máxima del período',format:a=>pct(a.window.maxDrawdown)},
    {label:'Correlación S&P 500',format:a=>n(a.benchmark.correlationSP500)},
    {label:'Correlación MSCI World',format:a=>n(a.benchmark.correlationWorld)},
    {label:'Beta S&P 500',format:a=>n(a.benchmark.betaSP500)},
    {label:'Tracking error S&P 500 · anualizado',format:a=>a.benchmark.trackingErrorSP500==null?'—':`${n(a.benchmark.trackingErrorSP500)}%`},
   ]}/></Panel>
   <Panel title="Liquidez, tendencia y valoración" note="Última sesión completa y ventanas recientes, independientes del período elegido arriba."><AssetTable assets={data.assets} rows={[
    {label:'Última sesión',format:a=>dated(a.asOf)},
    {label:'Rentabilidad · 21 sesiones',format:a=>pct(a.return21)},
    {label:'Volumen de la sesión',format:a=>compact(a.volume)},
    {label:'Volumen medio · 20 sesiones previas',format:a=>compact(a.averageVolume20)},
    {label:'Volumen frente a media',format:a=>a.relativeVolume==null?'—':`${n(a.relativeVolume)}×`},
    {label:'Importe negociado · moneda del activo',format:a=>a.turnover==null?'—':`${compact(a.turnover)} ${a.currency}`},
    {label:'Volumen en sesiones alcistas · 20 s.',format:a=>a.upVolumeShare20==null?'—':`${n(a.upVolumeShare20)}%`},
    {label:'Sobre media de 50 sesiones',format:a=>a.aboveSma50==null?'—':a.aboveSma50?'Sí':'No'},
    {label:'Sobre media de 200 sesiones',format:a=>a.aboveSma200==null?'—':a.aboveSma200?'Sí':'No'},
    {label:'PER',format:a=>n(a.valuation.pe)},
    {label:'Precio / valor contable',format:a=>n(a.valuation.pb)},
   ]}/><p className="mt-3 text-[11px] leading-relaxed text-slate-500">El volumen en sesiones alcistas y el importe negociado miden actividad; no identifican entradas netas de capital.</p></Panel>
   <MonthlyActivity assets={data.assets}/><HoldingsHistory assets={data.assets}/><EvidenceCards assets={data.assets}/><FactorTable data={data}/>
   <Analysis data={data} busy={busy} onAnalyze={()=>void load(true)}/>
  </div>}
 </main>;
}

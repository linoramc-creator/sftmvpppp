import AssetRisk from './AssetRisk';
import {useEffect,useMemo,useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,Legend,CartesianGrid} from 'recharts';
import {authenticatedFetch} from '@/lib/beta-api';
import {assetPerformance} from '@/lib/asset-performance';
import {useProfile} from '@/components/AuthGate';
import {usePanelActive} from './KeepPanel';
import type {AssetContext as Context} from '../../../supabase/functions/analyze-ticker/asset-context';
const sectors:Record<string,string>={XLC:'Comunicación',XLY:'Consumo discrecional',XLP:'Consumo básico',XLE:'Energía',XLF:'Finanzas',XLV:'Salud',XLI:'Industria',XLK:'Tecnología',XLB:'Materiales',XLRE:'Inmobiliario',XLU:'Servicios públicos'};
const colors=['#34d399','#60a5fa','#fbbf24'];
const memory=new Map<string,{data:Context;at:number}>();
const pending=new Map<string,Promise<Context>>();
const CACHE_MS=5*60_000,MAX_ENTRIES=30;
function remembered(key:string){
 const entry=memory.get(key);
 if(!entry||Date.now()-entry.at>=CACHE_MS){memory.delete(key);return null;}
 memory.delete(key);memory.set(key,entry);return entry.data;
}
function loadContext(key:string,symbol:string,benchmark:string,canRemember:boolean){
 const existing=pending.get(key);if(existing)return existing;
 const request=authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'assetContext',subject:symbol,...(benchmark==='auto'?{}:{benchmark})}),signal:AbortSignal.timeout(40_000)})
 .then(async response=>{
  if(!response.ok)throw Error('No se pudo cargar la comparación.');
  const result:Context=await response.json();if(result?.symbol!==symbol)throw Error('La respuesta no corresponde al activo.');
  // Retain public market context per account; never credentials or private reports.
  if(canRemember){if(memory.size>=MAX_ENTRIES&&!memory.has(key))memory.delete(memory.keys().next().value!);memory.set(key,{data:result,at:Date.now()});}
  return result;
 }).finally(()=>{if(pending.get(key)===request)pending.delete(key);});
 pending.set(key,request);return request;
}
export default function AssetContext({symbol}:{symbol:string}){
 const [data,setData]=useState<Context|null>(null),[benchmark,setBenchmark]=useState('auto'),[days,setDays]=useState(90),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const panelActive=usePanelActive(),accountId=useProfile()?.id;
 useEffect(()=>{
  let live=true;if(!panelActive){setBusy(false);return;}
  const key=`${accountId??'preview'}:${symbol}:${benchmark}`,previous=accountId?remembered(key):null;
  setError('');setData(previous);if(previous){setBusy(false);return;}
  setBusy(true);loadContext(key,symbol,benchmark,!!accountId).then(result=>{if(live)setData(result);}).catch(()=>{if(live)setError('No se han podido cargar el riesgo y la comparación. Cambia la referencia o vuelve a abrir la ficha para reintentar.');}).finally(()=>{if(live)setBusy(false);});
  return()=>{live=false;};
 },[symbol,benchmark,panelActive,accountId]);
 const performance=useMemo(()=>assetPerformance(data?.series??[],symbol,days),[data,symbol,days]),last=performance.rows.at(-1),spy=Number(last?.SPY),own=Number(last?.[symbol]);
 return <><AssetRisk data={data?.risk} busy={busy} error={error}/>
 <section aria-label="Comparación de rendimiento" className="rounded-xl border border-slate-700/50 bg-[#0c121b] p-5 sm:p-6 font-body space-y-5">
  <div className="flex flex-wrap gap-3 items-center justify-between"><div><p className="text-[10px] font-medium uppercase tracking-[.14em] text-slate-500 mb-1.5">Comparación</p><h2 className="font-body text-base font-semibold tracking-tight text-slate-200">Rendimiento frente al mercado y sector</h2></div><select aria-label="Referencia sectorial" value={benchmark} onChange={e=>setBenchmark(e.target.value)} className="max-w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-section-heading/20"><option value="auto">Sector automático</option><option value="">Solo S&P 500</option>{Object.entries(sectors).map(([s,n])=><option key={s} value={s}>{n} · {s}</option>)}</select></div>
  {data&&!data.benchmark&&<p className="text-xs text-slate-400">Selecciona un ETF sectorial si quieres añadir una referencia específica.</p>}
  <div className="flex flex-wrap gap-1 rounded-xl bg-slate-950/40 p-1 w-fit border border-slate-800/70">{[30,90,180,365].map(d=><button key={d} aria-pressed={days===d} className={`text-[11px] font-medium rounded-[7px] px-3 py-2 transition-colors ${days===d?'bg-slate-700/70 text-slate-100':'text-slate-400 hover:text-slate-200'}`} onClick={()=>setDays(d)}>{({30:'1 MES',90:'3 MESES',180:'6 MESES',365:'1 AÑO'})[d]}</button>)}</div>
  {last&&<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm tabular-nums">{performance.symbols.map((s,i)=><div className="rounded-xl border border-slate-800/80 bg-slate-950/30 px-4 py-3" key={s}><p className="text-[11px] text-slate-400">{s==='SPY'?'S&P 500 · SPY':s}</p><p className="mt-1.5 text-lg font-semibold" style={{color:colors[i]}}>{Number(last[s]).toFixed(2)}%</p></div>)}{Number.isFinite(spy)&&Number.isFinite(own)&&symbol!=='SPY'&&<div className="rounded-xl border border-slate-800/80 bg-slate-950/30 px-4 py-3"><p className="text-[11px] text-slate-400">Diferencia frente a SPY</p><p className="mt-1.5 text-lg font-semibold text-slate-200">{(own-spy).toFixed(2)} pp</p></div>}</div>}
  {performance.rows.length>1?<div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={performance.rows} margin={{top:10,right:12,left:-14,bottom:0}}><CartesianGrid stroke="#243142" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tick={{fontSize:10,fill:'#94a3b8'}} minTickGap={40} axisLine={false} tickLine={false}/><YAxis unit="%" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#111b29',border:'1px solid #334155',borderRadius:10,boxShadow:'0 12px 30px #0006',fontSize:12}} itemStyle={{color:'#cbd5e1'}} labelStyle={{color:'#94a3b8',marginBottom:6}} cursor={{stroke:'#64748b',strokeWidth:1,strokeDasharray:'3 5'}} formatter={(v:number)=>`${v.toFixed(2)}%`}/><Legend wrapperStyle={{fontSize:11,paddingTop:10}}/>{performance.symbols.map((s,i)=><Line key={s} dataKey={s} stroke={colors[i]} dot={false} activeDot={{r:3,strokeWidth:2,stroke:'#0c121b'}} strokeWidth={2} type="linear"/>)}</LineChart></ResponsiveContainer></div>:busy?<div role="status" className="h-72 rounded-xl bg-slate-800/20 motion-safe:animate-pulse"><span className="sr-only">Cargando comparación…</span></div>:<p className="py-8 text-sm text-slate-400">No hay suficientes sesiones comunes para comparar.</p>}
  {!!data?.missing.length&&<p className="text-xs text-amber-300">Sin histórico: {data.missing.join(', ')}.</p>}{!!performance.excluded.length&&<p className="text-xs text-amber-300">No se comparan monedas distintas: {performance.excluded.join(', ')}.</p>}
  <p className="border-t border-slate-800/80 pt-4 text-[11px] text-slate-400 leading-relaxed">Misma fecha inicial y sesiones comunes; precios ajustados por dividendos y desdoblamientos. SPY representa al S&P 500; los ETF sectoriales son referencias, con comisiones y diferencias frente al índice.{performance.rows.length>0&&` Período efectivo: ${performance.rows[0].date} – ${last?.date}.`}</p>
 </section></>;
}

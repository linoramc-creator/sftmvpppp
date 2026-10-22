import {useEffect,useMemo,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {ResponsiveContainer,LineChart,Line,BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid,Legend} from 'recharts';
import {authenticatedFetch} from '@/lib/beta-api';
import {useProfile} from './AuthGate';
import {usePanelActive} from './KeepPanel';
import type {SectorActivityData,SectorPeer} from '../../../supabase/functions/analyze-ticker/sector-activity';
import {extractSectorActivityPeers} from '@/lib/sector-peers';
export {extractSectorActivityPeers} from '@/lib/sector-peers';
const memory=new Map<string,{at:number;data:SectorActivityData}>(),pending=new Map<string,Promise<SectorActivityData>>();
function load(key:string,sector:string,peers:SectorPeer[]){
 const existing=pending.get(key);if(existing)return existing;
 const task=authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'sectorActivity',subject:sector,peers}),signal:AbortSignal.timeout(75000)})
 .then(async response=>{if(!response.ok)throw Error();const data:SectorActivityData=await response.json();if(data.sector!==sector||!Array.isArray(data.groups))throw Error();if(memory.size>=25)memory.delete(memory.keys().next().value!);memory.set(key,{at:Date.now(),data});return data;})
 .finally(()=>pending.delete(key));pending.set(key,task);return task;
}
const numeric=(n:number|null|undefined,decimals=2)=>n===null||n===undefined?'—':n.toLocaleString('es-ES',{maximumFractionDigits:decimals});
const compact=(n:number|null|undefined)=>n===null||n===undefined?'—':n.toLocaleString('es-ES',{notation:'compact',maximumFractionDigits:2});
const pct=(n:number|null|undefined)=>n===null||n===undefined?'—':`${n>0?'+':''}${numeric(n)} %`;
const hue=(n:number|null)=>n===null?'text-slate-500':n>=0?'text-emerald-400':'text-rose-400';
const tooltip={background:'#101b29',border:'1px solid #334155',borderRadius:10,fontSize:12,color:'#cbd5e1'};
function Panel({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-xl border border-slate-700/50 bg-slate-950/20 p-4 sm:p-5"><h4 className="!mt-0 !mb-4 !border-0 !font-body !text-sm !font-semibold !normal-case !tracking-normal !text-slate-200">{title}</h4>{children}</section>;}

export default function SectorActivity({sector,report,isLoading=false}:{sector:string;report:string;isLoading?:boolean}){
 const peers=useMemo(()=>extractSectorActivityPeers(report),[report]),account=useProfile()?.id??'preview',active=usePanelActive();
 const key=JSON.stringify({account,sector,peers});
 const [data,setData]=useState<SectorActivityData|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[currency,setCurrency]=useState('');
 useEffect(()=>{
  if(!active||isLoading||!peers.length){setBusy(false);return;}let live=true;
  const hit=memory.get(key);setError('');setData(hit&&Date.now()-hit.at<300000?hit.data:null);
  if(hit&&Date.now()-hit.at<300000){setBusy(false);return;}
  setBusy(true);load(key,sector,peers).then(value=>{if(live)setData(value);}).catch(()=>{if(live)setError('No se ha podido actualizar la actividad de estas empresas.');}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};
 },[key,active,isLoading,retry]);
 const group=data?.groups.find(g=>g.currency===currency)??data?.groups[0],known=group?.companies.filter(c=>c.relativeVolume!==null)??[];
 const volumes=known.map(c=>c.relativeVolume!).sort((a,b)=>a-b),middle=Math.floor(volumes.length/2);
 const medianVolume=volumes.length?volumes.length%2?volumes[middle]:(volumes[middle-1]+volumes[middle])/2:null;
 const refresh=()=>{memory.delete(key);setRetry(n=>n+1);};
 if(isLoading||!peers.length)return <p className="!mb-0 !py-3 !text-xs !text-slate-500">{isLoading?'La actividad de mercado se preparará al completar el informe.':'La actividad estará disponible cuando el informe identifique empresas y tickers verificables.'}</p>;
 return <section aria-label="Actividad de empresas del sector" className="my-5 space-y-5 rounded-xl border border-slate-700/50 bg-[#0b121c] p-4 font-body sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="!m-0 !border-0 !p-0 !font-body !text-base !font-semibold !normal-case !tracking-tight !text-slate-100">Actividad de las principales empresas</h3><p className="!mt-2 !mb-0 !text-xs !text-slate-400">{group?`${group.date} · sesión cerrada común · ${data?.verified} de ${data?.requested} empresas verificadas`:'Importe negociado, participación y tendencia de la muestra.'}</p></div><button type="button" aria-label="Actualizar actividad del sector" onClick={refresh} disabled={busy} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-section-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-heading disabled:opacity-50"><RefreshCw size={15} className={busy?'motion-safe:animate-spin':''}/></button></div>
  {error&&<div role="alert" className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">{error}<button type="button" onClick={refresh} className="ml-3 underline">Reintentar</button></div>}
  {busy&&!data&&<div role="status" className="rounded-lg bg-slate-800/30 px-4 py-7 text-xs text-slate-400">Preparando la actividad de las empresas…</div>}
  {data&&!group&&<p className="!mb-0 !text-sm !text-slate-400">No hay suficientes empresas con identidad e histórico confirmados para mostrar la actividad.</p>}
  {group&&<>
   {data!.groups.length>1&&<div role="group" aria-label="Moneda de la muestra" className="flex flex-wrap gap-2">{data!.groups.map(g=><button type="button" aria-pressed={g.currency===group.currency} onClick={()=>setCurrency(g.currency)} key={g.currency} className={`rounded-lg border px-3 py-2 text-xs ${g.currency===group.currency?'border-section-heading/40 bg-section-heading/10 text-section-heading':'border-slate-700 text-slate-400'}`}>{g.currency} · {g.companies.length} empresas</button>)}</div>}
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Panel title="Importe negociado de la muestra"><div className="text-xl font-semibold tabular-nums text-slate-100">{compact(group.knownTurnover)} <span className="text-xs text-slate-400">{group.currency}</span></div><div className="mt-2 text-[11px] text-slate-500">Cobertura {group.volumeObserved}/{group.companies.length}{!group.completeTurnover?' · suma parcial de datos disponibles':''}</div></Panel>
    <Panel title="Amplitud de la sesión"><div className="text-xl font-semibold tabular-nums text-emerald-300">{group.breadth.advancing}<span className="text-sm text-slate-500">/{group.breadth.observed} al alza</span></div><div className="mt-2 text-[11px] text-slate-500">{group.breadth.declining} a la baja · {group.breadth.unchanged} sin cambios</div></Panel>
    <Panel title="Actividad relativa mediana"><div className="text-xl font-semibold tabular-nums text-sky-300">{numeric(medianVolume)}{medianVolume!==null?'×':''}</div><div className="mt-2 text-[11px] text-slate-500">Frente a las 20 sesiones previas · {known.length} empresas con datos</div></Panel>
    <Panel title="Empresas sobre su media de 50"><div className="text-xl font-semibold tabular-nums text-slate-100">{group.breadth.aboveMa50}<span className="text-sm text-slate-500">/{group.breadth.trendObserved}</span></div><div className="mt-2 text-[11px] text-slate-500">Cierres ajustados · muestra en {group.currency}</div></Panel>
   </div>
   <div className="grid gap-4 lg:grid-cols-2"><Panel title={`Importe por empresa · ${group.currency}`}><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={group.companies} layout="vertical" margin={{left:0,right:10}}><CartesianGrid stroke="#243142" horizontal={false} strokeDasharray="3 5"/><XAxis type="number" tickFormatter={v=>compact(v)} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="symbol" width={55} tick={{fill:'#cbd5e1',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltip} cursor={{fill:'#ffffff06'}} formatter={(v:number)=>[`${compact(v)} ${group.currency}`,'Importe aproximado']}/><Bar dataKey="turnover" fill="#38bdf8" radius={[0,3,3,0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div></Panel>
   <Panel title="Evolución de la muestra frente al mercado"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={group.chart} margin={{left:-15,right:10}}><CartesianGrid stroke="#243142" vertical={false} strokeDasharray="3 5"/><XAxis dataKey="date" tickFormatter={d=>String(d).slice(5)} minTickGap={32} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/><YAxis unit="%" tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltip} cursor={{stroke:'#64748b',strokeDasharray:'3 5'}} formatter={(v:number)=>pct(v)}/><Legend wrapperStyle={{fontSize:10,paddingTop:8}}/><Line dataKey="sample" name="Muestra equiponderada" stroke="#34d399" dot={false} strokeWidth={2}/>{group.benchmark&&<Line dataKey="benchmark" name={group.benchmark.name} stroke="#60a5fa" dot={false} strokeWidth={2} connectNulls={false}/>}</LineChart></ResponsiveContainer></div><p className="!mt-3 !mb-0 !text-[11px] !text-slate-500">{group.chart[0]?.date} – {group.chart.at(-1)?.date}{!group.benchmark?' · sin referencia comparable en esta moneda':''}</p></Panel></div>
   <Panel title={`Actividad negociada · últimas sesiones comunes · ${group.currency}`}><div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={group.activity} margin={{left:-10,right:10}}><CartesianGrid stroke="#243142" vertical={false} strokeDasharray="3 5"/><XAxis dataKey="date" tickFormatter={d=>String(d).slice(5)} minTickGap={32} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tickFormatter={v=>compact(v)} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltip} cursor={{fill:'#ffffff06'}} formatter={(v:number)=>[`${compact(v)} ${group.currency}`,'Importe aproximado']}/><Bar dataKey="turnover" fill="#647b95" radius={[3,3,0,0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div><p className="!mt-3 !mb-0 !text-[11px] !text-slate-500">Una sesión sin todos los volúmenes se deja sin total agregado.</p></Panel>
   <div className="overflow-x-auto"><table className="!mb-0 min-w-[800px] text-left text-xs"><thead><tr>{['Empresa','Importe · '+group.currency,'Volumen · títulos','Vol. relativo','Sesión','20 sesiones','Vol. anualizada · 20s'].map(title=><th key={title} className="!px-3 !py-3 !text-[10px] !text-slate-500">{title}</th>)}</tr></thead><tbody>{group.companies.map(c=><tr key={c.symbol}><td className="!px-3 !py-3"><span className="font-semibold text-slate-200">{c.symbol}</span><span className="mt-1 block max-w-48 truncate text-[11px] text-slate-500" title={c.name}>{c.name}</span></td><td className="!px-3 !py-3 tabular-nums text-slate-200">{compact(c.turnover)}</td><td className="!px-3 !py-3 tabular-nums">{compact(c.volume)}</td><td className="!px-3 !py-3 tabular-nums">{c.relativeVolume===null?'—':`${numeric(c.relativeVolume)}×`}</td><td className={`!px-3 !py-3 tabular-nums ${hue(c.change1d)}`}>{pct(c.change1d)}</td><td className={`!px-3 !py-3 tabular-nums ${hue(c.return20)}`}>{pct(c.return20)}</td><td className="!px-3 !py-3 tabular-nums">{c.volatility20===null?'—':`${numeric(c.volatility20)} %`}</td></tr>)}</tbody></table></div>
  </>}
  {!!data?.excluded.length&&<p className="!mb-0 !text-[11px] !text-slate-500">Fuera de la muestra: {data.excluded.map(c=>c.symbol).join(', ')}. Identidad, moneda o histórico insuficientes.</p>}
  {data&&<p className="!mb-0 border-t border-slate-700/50 pt-4 !text-[11px] !leading-5 !text-slate-500">{data.note}</p>}
 </section>;
}

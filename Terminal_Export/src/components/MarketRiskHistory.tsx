import {useState} from 'react';
import {Area,AreaChart,CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import type {RiskData} from '../../../supabase/functions/analyze-ticker/asset-risk';
import {marketRiskSummary} from '@/lib/market-risk';

const number=(value:number|null|undefined,digits=2)=>value==null?'—':value.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const delta=(value:number|null)=>value==null?'—':`${value>0?'+':''}${number(value)} pp`;
const date=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('es-ES',{day:'2-digit',month:'short',timeZone:'UTC'});
const tip={background:'#101b29',border:'1px solid #334155',borderRadius:10,fontSize:11};
const cursor={stroke:'#94a3b8',strokeDasharray:'3 4',strokeWidth:.8};
const tick={fill:'#94a3b8',fontSize:10};
export default function MarketRiskHistory({risk}:{risk:RiskData}){
 const [sessions,setSessions]=useState(63),{points,last,change1,change5,worst}=marketRiskSummary(risk.history,sessions);
 if(points.length<2)return null;
 return <section className="rounded-2xl border border-slate-700/45 bg-[#0b121d] p-5 sm:p-6" aria-label="Evolución del riesgo de mercado">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-200">Volatilidad y distancia a máximos</h2><p className="mt-1 text-[10px] text-slate-500">Sesiones completas · {risk.asOf} · {points.length} observaciones mostradas</p></div><div className="flex flex-wrap gap-1 rounded-xl bg-slate-950/40 p-1" aria-label="Período del histórico de riesgo">{[21,63,126,252].map(n=><button key={n} type="button" onClick={()=>setSessions(n)} aria-pressed={sessions===n} className={`rounded-lg px-3 py-1.5 text-[10px] ${sessions===n?'bg-slate-700/70 text-slate-100':'text-slate-500 hover:text-slate-200'}`}>{n===21?'1 mes':n===63?'3 meses':n===126?'6 meses':'1 año'}</button>)}</div></div>
  <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{[
   {label:'Cambio volatilidad · 1 sesión',value:delta(change1),tone:change1==null?'text-slate-400':change1>0?'text-amber-300':'text-sky-300'},
   {label:'Cambio volatilidad · 5 sesiones',value:delta(change5),tone:change5==null?'text-slate-400':change5>0?'text-amber-300':'text-sky-300'},
   {label:'Mayor caída mostrada',value:`${number(worst)} %`,tone:'text-rose-300'},
   {label:'Sesiones desde máximo móvil',value:number(last?.belowPeak,0),tone:'text-slate-100'},
  ].map(m=><div key={m.label} className="rounded-xl border border-slate-800/70 bg-slate-950/25 p-3.5"><p className="text-[10px] leading-relaxed text-slate-500">{m.label}</p><p className={`mt-2 text-lg font-semibold tabular-nums ${m.tone}`}>{m.value}</p></div>)}</div>
  <div className="mt-6 grid gap-6 lg:grid-cols-2"><div className="min-w-0"><h3 className="text-xs font-medium text-slate-300">Volatilidad realizada</h3><p className="mt-1 text-[10px] text-slate-500">Anualizada · % · variaciones expresadas en puntos porcentuales</p><div className="mt-4 h-56" role="img" aria-label="Histórico de volatilidad anualizada a 20 y 60 sesiones"><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{top:5,right:8,bottom:0,left:0}}><CartesianGrid stroke="#243142" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={date} minTickGap={35} tick={tick} axisLine={false} tickLine={false}/><YAxis width={42} tick={tick} tickFormatter={v=>`${number(v,0)}%`} axisLine={false} tickLine={false}/><Tooltip cursor={cursor} contentStyle={tip} labelFormatter={v=>String(v)} formatter={(v:number)=>`${number(v)} %`}/><Legend wrapperStyle={{fontSize:10,paddingTop:10}}/><Line dataKey="vol20" name="20 sesiones" stroke="#60a5fa" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/><Line dataKey="vol60" name="60 sesiones" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div></div>
  <div className="min-w-0"><h3 className="text-xs font-medium text-slate-300">Drawdown de cierre</h3><p className="mt-1 text-[10px] text-slate-500">Desde el máximo móvil de hasta 252 sesiones · %</p><div className="mt-4 h-56" role="img" aria-label="Histórico de drawdown respecto al máximo de cierre"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{top:5,right:8,bottom:0,left:0}}><CartesianGrid stroke="#243142" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={date} minTickGap={35} tick={tick} axisLine={false} tickLine={false}/><YAxis width={42} tick={tick} domain={['dataMin',0]} tickFormatter={v=>`${number(v,0)}%`} axisLine={false} tickLine={false}/><Tooltip cursor={cursor} contentStyle={tip} labelFormatter={v=>String(v)} formatter={(v:number)=>`${number(v)} %`}/><Area name="Drawdown" dataKey="drawdown" stroke="#fb7185" strokeWidth={1.5} fill="#fb7185" fillOpacity={.09} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div></div></div>
 </section>;
}

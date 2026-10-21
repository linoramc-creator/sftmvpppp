import {useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,ReferenceLine} from 'recharts';
import {bondRateEstimate,bondRateScenario} from '@/lib/bond-rate-scenario';

const fmt=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=(value:number)=>`${value>0?'+':''}${fmt(value)}`;

export default function BondRateScenario(){
 const [duration,setDuration]=useState('5'),[shock,setShock]=useState('50');
 const d=duration.trim()?Number(duration):NaN,bp=shock.trim()?Number(shock):NaN,result=bondRateEstimate(d,bp),points=bondRateScenario(d,bp);
 return <section aria-label="Escenario de sensibilidad a tipos" className="space-y-5">
  <div className="flex flex-wrap items-end justify-between gap-5">
   <div className="flex flex-wrap gap-4"><label className="block text-xs text-slate-400">Duración modificada · años<input aria-label="Duración modificada en años" type="number" min="0" max="30" step="0.25" value={duration} onChange={event=>setDuration(event.target.value)} className="mt-2 block w-36 rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm tabular-nums text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400/50"/></label><label className="block text-xs text-slate-400">Cambio del rendimiento · pb<input aria-label="Cambio del rendimiento en puntos básicos" type="number" min="-200" max="200" step="25" value={shock} onChange={event=>setShock(event.target.value)} className="mt-2 block w-40 rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm tabular-nums text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400/50"/></label></div>
   <div className="sm:text-right"><p className="text-[10px] text-slate-500">Variación aproximada del precio</p><output aria-label="Resultado del escenario de tipos" aria-live="polite" className="mt-2 block text-2xl font-semibold tabular-nums text-slate-100">{result===null?'—':signed(result)+' %'}</output></div>
  </div>
  {result===null?<p role="alert" className="text-xs text-rose-300">Elige una duración entre 0 y 30 años y un movimiento entre −200 y +200 pb.</p>:<div className="h-56 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{top:10,right:20,left:0,bottom:8}}><CartesianGrid stroke="#243142" strokeDasharray="3 5" vertical={false}/><XAxis type="number" dataKey="shock" domain={[-200,200]} ticks={[-200,-100,0,100,200]} tick={{fill:'#94a3b8',fontSize:10}} tickFormatter={value=>`${value>0?'+':''}${value} pb`} tickLine={false} axisLine={false}/><YAxis tick={{fill:'#94a3b8',fontSize:10}} tickFormatter={value=>`${value} %`} width={55} tickLine={false} axisLine={false}/><Tooltip cursor={{stroke:'#60a5fa',strokeDasharray:'3 4'}} contentStyle={{background:'#101b29',border:'1px solid #334155',borderRadius:10,fontSize:11,color:'#cbd5e1'}} labelFormatter={value=>`Movimiento del rendimiento: ${Number(value)>0?'+':''}${value} pb`} formatter={(value:number)=>[signed(value)+' %','Precio aproximado']}/><ReferenceLine y={0} stroke="#64748b"/><ReferenceLine x={bp} stroke="#94a3b8" strokeDasharray="3 5"/><Line name="Precio aproximado" dataKey="change" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>}
  <p className="text-[10px] leading-relaxed text-slate-500">Hipótesis editables. Aproximación lineal ante un desplazamiento paralelo de tipos; excluye cupón, convexidad y cambios del diferencial de crédito.</p>
 </section>;
}

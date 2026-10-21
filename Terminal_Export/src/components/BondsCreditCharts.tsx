import {useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,ReferenceLine} from 'recharts';
import type {CreditFrequency} from '../../../supabase/functions/analyze-ticker/bonds-credit';
import type {Series} from '../../../supabase/functions/analyze-ticker/panels';
import type {YieldCurveSnapshot} from '../../../supabase/functions/analyze-ticker/bonds-credit-analytics';
import {creditPeriodLabel} from '@/lib/bonds-credit-view';
const colors=['#60a5fa','#c4b5fd','#34d399','#fbbf24','#fb7185'];
const fmt=(n:number,digits=2)=>n.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const tip={background:'#101b29',border:'1px solid #334155',borderRadius:10,fontSize:11,color:'#cbd5e1'};
const legendClass='inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[10px] leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60';

export function CreditChart({series,unit='%',frequency='daily',zero=false,label='Evolución histórica',compact=false,bounds}:{series:Series[];unit?:string;frequency?:CreditFrequency;zero?:boolean;label?:string;compact?:boolean;bounds?:[number,number]}){
 const [hidden,setHidden]=useState<string[]>([]);
 const present=series.filter(s=>s.points.length),effectiveHidden=new Set(hidden);
 if(present.length&&present.every(s=>effectiveHidden.has(s.id)))effectiveHidden.delete(present[0].id);
 const visible=present.filter(s=>!effectiveHidden.has(s.id));
 const merged=new Map<string,Record<string,string|number>>();present.forEach(s=>s.points.forEach(p=>{const row=merged.get(p.date)??{date:p.date};row[s.id]=p.value;merged.set(p.date,row);}));
 const rows=[...merged.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 if(!rows.length)return <p className="flex min-h-48 items-center justify-center px-4 text-center text-xs leading-relaxed text-slate-500">Sin observaciones disponibles para este período.</p>;
 return <div aria-label={label}>
  <div className={compact?'h-56 min-w-0':'h-64 min-w-0 sm:h-72'}><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{top:10,right:12,left:0,bottom:6}}><CartesianGrid stroke="#243142" strokeDasharray="2 5" vertical={false}/><XAxis dataKey="date" minTickGap={48} axisLine={false} tickLine={false} tick={{fill:'#8190a6',fontSize:10}} tickFormatter={v=>frequency==='quarterly'?creditPeriodLabel(v,frequency):String(v).slice(0,7)}/><YAxis width={61} axisLine={false} tickLine={false} tick={{fill:'#8190a6',fontSize:10}} domain={bounds??(zero?[(min:number)=>Math.min(0,min),(max:number)=>Math.max(0,max)]:['auto','auto'])} tickFormatter={v=>fmt(Number(v),Math.abs(Number(v))<10?2:0)}/><Tooltip cursor={{stroke:'#60a5fa',strokeDasharray:'3 4',strokeWidth:.8}} contentStyle={tip} labelStyle={{color:'#cbd5e1',marginBottom:6}} labelFormatter={v=>creditPeriodLabel(String(v),frequency)} formatter={(v:number)=>`${fmt(Number(v))} ${unit}`}/>{zero&&<ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={.55} strokeDasharray="4 4"/>}{visible.map(s=><Line key={s.id} dataKey={s.id} name={s.label} stroke={colors[present.indexOf(s)%colors.length]} strokeWidth={2} dot={false} activeDot={{r:3,stroke:'#0b111b',strokeWidth:2}} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>
  <div aria-label={`Series de ${label}`} className="mt-3 flex flex-wrap gap-2">{present.map((s,i)=><button key={s.id} aria-pressed={!effectiveHidden.has(s.id)} onClick={()=>setHidden(current=>current.includes(s.id)?current.filter(id=>id!==s.id):visible.length>1?[...current,s.id]:current)} className={`${legendClass} ${effectiveHidden.has(s.id)?'border-transparent text-slate-600':'border-slate-700/40 bg-slate-900/30 text-slate-300'}`}><span aria-hidden="true" className="h-1.5 w-3 rounded-full" style={{background:colors[i%colors.length]}}/>{s.label}<span className="ml-1 text-slate-500">{creditPeriodLabel(s.points.at(-1)?.date,frequency)}</span></button>)}</div>
 </div>;
}

export function CurveComparison({snapshots}:{snapshots:YieldCurveSnapshot[]}){
 const [hidden,setHidden]=useState<string[]>([]),current=snapshots.find(s=>s.key==='current')??snapshots[0];
 if(!current)return <p className="flex min-h-64 items-center justify-center px-5 text-center text-xs leading-relaxed text-slate-500">No existe una fecha común reciente para comparar los vencimientos.</p>;
 const rows=current.points.map(point=>({years:point.maturityYears,...Object.fromEntries(snapshots.map(s=>[s.key,s.points.find(p=>p.id===point.id)?.value??null]))}));
 const effectiveHidden=new Set(hidden);if(snapshots.every(s=>effectiveHidden.has(s.key)))effectiveHidden.delete(snapshots[0].key);
 const shown=snapshots.filter(s=>!effectiveHidden.has(s.key)),maturity=(v:number)=>v<1?`${Math.round(v*12)}m`:`${v}a`;
 return <div aria-label="Comparación de curvas del Tesoro">
  <div className="h-72 min-w-0 sm:h-80"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{left:0,right:16,top:12,bottom:4}}><CartesianGrid stroke="#243142" strokeDasharray="2 5" vertical={false}/><XAxis type="number" dataKey="years" domain={['dataMin','dataMax']} ticks={[.25,1,2,5,10,20,30].filter(v=>v<=Math.max(...current.points.map(p=>p.maturityYears)))} minTickGap={12} tick={{fill:'#8190a6',fontSize:10}} tickFormatter={maturity} axisLine={false} tickLine={false}/><YAxis domain={['auto','auto']} tick={{fill:'#8190a6',fontSize:10}} tickFormatter={v=>fmt(Number(v))+'%'} width={64} axisLine={false} tickLine={false}/><Tooltip contentStyle={tip} labelStyle={{color:'#cbd5e1'}} labelFormatter={v=>Number(v)<1?`${Math.round(Number(v)*12)} meses`:`${v} años`} formatter={(v:number)=>`${fmt(Number(v))} %`} cursor={{stroke:'#64748b',strokeDasharray:'3 4'}}/>{shown.map(s=><Line key={s.key} dataKey={s.key} name={s.label} stroke={colors[snapshots.indexOf(s)]} strokeWidth={s.key==='current'?2.6:1.6} strokeDasharray={s.key==='current'?undefined:'5 4'} dot={s.key==='current'?{r:3,stroke:'#0b111b',strokeWidth:1.5}:false} activeDot={{r:4}} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>
  <div aria-label="Fechas de las curvas" className="mt-3 flex flex-wrap gap-2">{snapshots.map((s,i)=><button key={s.key} aria-pressed={!effectiveHidden.has(s.key)} onClick={()=>setHidden(current=>current.includes(s.key)?current.filter(key=>key!==s.key):shown.length>1?[...current,s.key]:current)} className={`${legendClass} ${effectiveHidden.has(s.key)?'border-transparent text-slate-600':'border-slate-700/40 bg-slate-900/30 text-slate-300'}`}><span className="h-1.5 w-3 rounded-full" style={{background:colors[i]}} aria-hidden="true"/>{s.label}<span className="ml-1 text-slate-500">{creditPeriodLabel(s.date)}</span></button>)}</div>
 </div>;
}

import {useId,useMemo,useState} from 'react';
import {AreaChart,Area,ResponsiveContainer,YAxis,XAxis,Tooltip,CartesianGrid} from 'recharts';
import {ttStyle} from '@/components/options/theme';
import {chartPriceDigits} from '@/lib/chart-indicators';
import {chartDateLabel,normalizeSparkline,sparklineSummary,visibleSparkline} from '@/lib/financial-chart-data';
interface CandleSeries{t:number[];c:(number|null)[]}
interface IndexSparklineProps{label:string;symbol:string;price:number|null;change1d:number|null;change1m:number|null;candle:CandleSeries|null|undefined;unit?:'points'|'currency';currency?:string|null}
const POS='#60a5fa',NEG='#fb7185';
const pct=(n:number|null)=>n==null||!Number.isFinite(n)?'—':`${n>0?'+':''}${n.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
export function IndexSparkline({label,symbol,price,change1d,change1m,candle,unit,currency}:IndexSparklineProps){
 const[days,setDays]=useState<number|null>(90),id='index-'+useId().replace(/:/g,'');
 const all=useMemo(()=>normalizeSparkline(candle),[candle]),data=useMemo(()=>visibleSparkline(all,days),[all,days]),summary=sparklineSummary(data);
 const color=summary.change!==null&&summary.change<0?NEG:POS,dayColor=change1d===null?'#94a3b8':change1d<0?NEG:POS;
 const digits=chartPriceDigits(symbol,price??summary.last?.v??1),fmt=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'—':n.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
 const tickDate=(value:number)=>(data.at(-1)?.t??0)-(data[0]?.t??0)>365*86400?chartDateLabel(value):new Date(value*1000).toLocaleDateString('es-ES',{timeZone:'UTC',day:'2-digit',month:'short'});
 const bounds=(value:number,direction:number)=>value+direction*Math.max(((summary.high??value)-(summary.low??value))*.12,Math.abs(value)*.00001,.000001);
 return <section aria-label={`Evolución de ${label}`} className="mb-2 overflow-hidden rounded-xl border border-slate-700/45 bg-[#0b131f] px-3 py-3 font-sans">
  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-[10px] font-semibold uppercase tracking-[.1em] text-slate-400">{label}</h3><div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums"><span className="text-base font-semibold tracking-tight text-slate-100">{fmt(price)}</span>{(unit==='points'||currency)&&<span className="text-[9px] text-slate-500">{unit==='points'?'pts':currency}</span>}<span className="text-[10px] font-medium" style={{color:dayColor}}>{pct(change1d)}</span><span className="text-[9px] text-slate-600">sesión</span></div></div>{change1m!==null&&<div className="shrink-0 text-right tabular-nums"><p className="text-[9px] text-slate-500">1 mes</p><p className="mt-1 text-[10px]" style={{color:change1m<0?NEG:POS}}>{pct(change1m)}</p></div>}</div>
  <div className="mt-3 flex items-center justify-between gap-2"><div role="group" aria-label={`Período de ${label}`} className="flex gap-0.5 rounded-md bg-slate-950/50 p-0.5">{[{label:'1M',value:30},{label:'3M',value:90},{label:'Todo',value:null}].map(option=><button key={option.label} aria-pressed={days===option.value} onClick={()=>setDays(option.value)} className={`rounded px-2 py-1 text-[9px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/70 ${days===option.value?'bg-slate-700/60 text-slate-100':'text-slate-500 hover:text-slate-200'}`}>{option.label}</button>)}</div><span className="text-[9px] tabular-nums" style={{color}} title="Variación entre el primer y el último cierre disponibles en el período visible">{pct(summary.change)} <span className="text-slate-500">período</span></span></div>
  {data.filter(p=>p.v!==null).length>1?<>
   <div className="mt-2 h-[126px] min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart accessibilityLayer data={data} margin={{top:8,right:3,left:-4,bottom:0}}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.18}/><stop offset="100%" stopColor={color} stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid stroke="#243142" strokeOpacity={.7} strokeDasharray="2 5" vertical={false}/><XAxis dataKey="t" tickFormatter={value=>tickDate(Number(value))} tick={{fill:'#8190a6',fontSize:9}} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} height={23}/><YAxis domain={[(value:number)=>bounds(value,-1),(value:number)=>bounds(value,1)]} tick={{fill:'#8190a6',fontSize:9}} tickLine={false} axisLine={false} width={digits>3?68:57} tickCount={3} tickFormatter={value=>fmt(Number(value))}/>
    <Tooltip contentStyle={ttStyle} labelStyle={{color:'#cbd5e1',marginBottom:5}} formatter={(value:number)=>[fmt(value),'Cierre']} labelFormatter={value=>chartDateLabel(Number(value),true)} cursor={{stroke:'#7dd3fc',strokeOpacity:.55,strokeWidth:.8,strokeDasharray:'3 4'}} isAnimationActive={false}/>
    <Area type="linear" dataKey="v" stroke={color} strokeWidth={1.7} fill={`url(#${id})`} dot={false} activeDot={{r:3,fill:color,stroke:'#0b131f',strokeWidth:2}} connectNulls={false} isAnimationActive={false}/>
   </AreaChart></ResponsiveContainer></div>
   <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[9px] tabular-nums text-slate-500"><span>Mín <b className="font-normal text-slate-400">{fmt(summary.low)}</b> · Máx <b className="font-normal text-slate-400">{fmt(summary.high)}</b></span><span>{summary.last?chartDateLabel(summary.last.t,true):''}</span></div>
  </>:<p className="flex h-[126px] items-center justify-center text-center text-[10px] text-slate-500">Sin histórico disponible para este período.</p>}
 </section>;
}

import type {AssetSnapshot} from '../../../supabase/functions/analyze-ticker/asset-snapshot';
const value=(n:number|null|undefined,digits=2)=>n==null?'—':n.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const compact=(n:number|null)=>n==null?'—':n.toLocaleString('es-ES',{notation:'compact',maximumFractionDigits:2});
export default function AssetSession({data}:{data:AssetSnapshot}){
 const stats=data.sessionStats;if(!stats)return null;
 const unit=data.instrument?.priceUnit||data.currency;
 const volumeUnit=data.instrument?.volumeUnit;
 const cells=[
  {title:'Apertura',main:value(stats.open),note:unit},
  {title:'Máximo / mínimo',main:`${value(stats.high)} / ${value(stats.low)}`,note:unit},
  {title:'Cierre anterior',main:value(stats.previousClose),note:unit},
  {title:'Rango de sesión',main:`${value(stats.rangePercent)} %`,note:'Respecto al cierre anterior'},
  ...(volumeUnit==='unavailable'?[]:[{title:volumeUnit==='published'?'Volumen publicado':'Volumen negociado',main:compact(stats.volume),note:volumeUnit==='fund-units'?'Participaciones del ETF':volumeUnit==='shares'?'Acciones':'Unidades publicadas · serie continua'},{title:'Actividad / media 20 s.',main:stats.volumeRatio===null?'—':`${value(stats.volumeRatio)}×`,note:stats.partial?'Volumen parcial / sesiones completas':'Frente a 20 sesiones anteriores'}]),
 ];
 return <section aria-label="Actividad de la última sesión" className="overflow-hidden rounded-xl border border-slate-700/45 bg-[#0b1017]">
  <div className="flex flex-wrap justify-between gap-2 border-b border-slate-800/70 px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold text-slate-200">Actividad de sesión</h2><span className="text-[11px] text-slate-400">{stats.date??'Fecha no disponible'}{stats.partial?' · Dato parcial':' · Última sesión disponible'}</span></div>
  <dl className={`grid grid-cols-2 ${cells.length===4?'lg:grid-cols-4':'lg:grid-cols-3'} gap-px bg-slate-800/40`}>{cells.map(cell=><div key={cell.title} className="bg-[#0b1017] px-5 py-4 sm:px-6"><dt className="text-[11px] text-slate-400">{cell.title}</dt><dd className="mt-2 text-base font-semibold tabular-nums text-slate-100">{cell.main}</dd><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{cell.note}</p></div>)}</dl>
  {data.instrument?.kind==='future'&&<p className="border-t border-slate-800/60 px-5 py-3 text-[10px] leading-relaxed text-slate-500">Serie continua de futuros; el volumen no identifica un vencimiento concreto ni el número de operaciones.</p>}
 </section>;
}

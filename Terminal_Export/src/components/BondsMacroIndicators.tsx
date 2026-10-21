import type {ReactNode} from 'react';
import type {BondsMacroIndicators as Indicators} from '../../../supabase/functions/analyze-ticker/macro-indicators';
import type {CreditSeries} from '../../../supabase/functions/analyze-ticker/bonds-credit';
import type {Series} from '../../../supabase/functions/analyze-ticker/panels';
import {CreditChart} from './BondsCreditCharts';
import {creditPeriodLabel} from '@/lib/bonds-credit-view';

const fmt=(value:number,digits=2)=>value.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
function Box({title,detail,children}:{title:string;detail:string;children:ReactNode}){return <section className="min-w-0 rounded-2xl border border-slate-700/40 bg-[#0c131d] p-4 sm:p-5"><div className="mb-5 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-slate-200">{title}</h2><span className="text-[10px] text-slate-500">{detail}</span></div>{children}</section>;}
function IndexCard({series,label}:{series:CreditSeries;label:string}){
 const last=series.points.at(-1),previous=series.points.at(-2),change=last&&previous?last.value-previous.value:null;if(!last)return null;
 return <div className="rounded-xl border border-slate-700/35 bg-[#0c131d] p-4"><p className="text-[10px] text-slate-400">{label}</p><div className="mt-3 flex items-baseline gap-2"><p className="text-2xl font-semibold tabular-nums text-slate-100">{fmt(last.value)}</p><span className="text-[10px] text-slate-500">{series.unit}</span></div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">{creditPeriodLabel(last.date)}{change!==null&&<span className="ml-3 tabular-nums text-slate-400">{change>0?'+':''}{fmt(change)} {series.unit==='%'?'pp':'puntos'}</span>}</p></div>;
}
export default function BondsMacroIndicators({data,clip}:{data:Indicators;clip:(series:Series[])=>Series[]}){
 const stress=data.stressPercentiles.filter(s=>s.points.length),realized=data.yieldVolatility.filter(s=>s.points.length),premium=data.hyIgPremium.points.length?data.hyIgPremium:null;
 return <div className="space-y-4" aria-label="Volatilidad y riesgo de renta fija">
  {(data.move||data.vix)&&<div className="grid gap-3 sm:grid-cols-2">{data.move&&<IndexCard series={data.move} label="MOVE · volatilidad implícita de tipos"/>}{data.vix&&<IndexCard series={data.vix} label="VIX · volatilidad implícita del S&P 500"/>}</div>}
  {(data.move||stress.length>0)&&<div className="grid gap-4 lg:grid-cols-2">{data.move&&<Box title="MOVE · riesgo implícito de tipos" detail="Índice publicado · Cierres diarios"><CreditChart series={clip([data.move])} unit="puntos" label="Histórico del índice MOVE"/><p className="mt-3 text-[10px] leading-relaxed text-slate-500">Volatilidad implícita del mercado de tipos estadounidense. Un nivel más alto refleja mayor incertidumbre, sin indicar la dirección de los rendimientos.</p></Box>}{stress.length>0&&<Box title="Tensión relativa · bonos y bolsa" detail="Percentiles · 252 observaciones comunes"><CreditChart series={clip(stress)} unit="percentil" bounds={[0,100]} label="Percentiles comparables de MOVE y VIX"/><p className="mt-3 text-[10px] leading-relaxed text-slate-500">Cada índice se compara con su propio último año de observaciones coincidentes. 100 corresponde al extremo superior de su ventana; no es una probabilidad ni una señal de compra.</p></Box>}</div>}
  {!!realized.length&&<Box title="Volatilidad realizada · soberanos a 10 años" detail="20 observaciones · Puntos básicos diarios"><CreditChart series={clip(realized)} unit="pb/día" label="Volatilidad realizada de rendimientos soberanos"/><p className="mt-3 text-[10px] leading-relaxed text-slate-500">Dispersión observada de las variaciones diarias del rendimiento a 10 años. Conserva sus propias unidades y no replica el índice MOVE.</p></Box>}
  {premium&&<Box title="Prima de riesgo · high yield frente a investment grade" detail="Diferencia de OAS · Puntos básicos"><CreditChart series={clip([premium])} unit="pb" label="Prima de crédito high yield frente a investment grade"/><p className="mt-3 text-[10px] leading-relaxed text-slate-500">Compensación adicional del crédito de menor calidad, con observaciones de la misma fecha. No mide directamente las condiciones del préstamo privado.</p></Box>}
 </div>;
}

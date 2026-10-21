import type {BriefData} from './data.ts';
import type {ChartRenderer} from './render.ts';
import {commonTreasuryDate,treasuryLabel} from '../analyze-ticker/treasury-curve.ts';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const format=(value:number)=>value.toLocaleString('es-ES',{maximumFractionDigits:2});

/** A reading of observed market indicators, without extrapolated macroeconomic series. */
export function renderMacroSection(data:BriefData,renderer:ChartRenderer):string{
 const cutoff=Date.parse(data.cutoff),date=commonTreasuryDate(data.treasury),dateTime=date?Date.parse(date):NaN;
 const aligned=Number.isFinite(cutoff)&&Number.isFinite(dateTime)&&dateTime<=cutoff&&data.treasury.every(p=>finite(p.years)&&p.years>0&&finite(p.yield));
 const changes=aligned?data.treasury.filter(p=>finite(p.changeBp)).sort((a,b)=>a.years-b.years):[];
 const missing=aligned?data.treasury.filter(p=>!finite(p.changeBp)).map(p=>treasuryLabel(p.years)):[];
 const bonds=changes.length>=2?`${renderer({id:'macro-treasury-change',title:'Tesoro de EE. UU. · variación de rendimientos',points:changes.map(p=>({date:treasuryLabel(p.years),value:p.changeBp!})),x:changes.map(p=>p.years),kind:'bar',unit:'pb',color:'#4389ed',height:210})}<p class="meta">Observaciones del ${esc(date)}. Variación en puntos básicos frente a la observación anterior disponible${missing.length?'; sin cambio comparable: '+esc(missing.join(', ')):''}.</p>`:'<p class="meta">No hay variaciones comparables del Tesoro con una fecha común dentro del cierre de información.</p>';
 const vix=data.assets.find(a=>a.symbol==='^VIX'),volatility=(vix?.points??[]).filter(p=>finite(p.value)&&Number.isFinite(Date.parse(p.date))&&Date.parse(p.date)<=cutoff).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).filter((p,i,rows)=>!i||p.date!==rows[i-1].date);
 const risk=volatility.length>=2?`${renderer({id:'macro-vix',title:'VIX · expectativa de volatilidad del S&P 500',points:volatility,color:'#4389ed',unit:'pts',height:210})}<p class="meta">Última observación: ${esc(volatility.at(-1)!.date)} · ${esc(format(volatility.at(-1)!.value))} puntos. Volatilidad implícita a 30 días; no equivale a volatilidad realizada.</p>`:'<p class="meta">Sin histórico del VIX suficiente dentro del cierre de información.</p>';
 return `<div class="macro-grid"><article class="macro-card"><h3>Movimientos de la curva</h3>${bonds}</article><article class="macro-card"><h3>Riesgo de mercado</h3>${risk}</article></div>`;
}

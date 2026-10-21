import type {CreditFrequency,CreditProxy} from '../../../supabase/functions/analyze-ticker/bonds-credit';
import type {Series} from '../../../supabase/functions/analyze-ticker/panels';
import type {YieldCurveSnapshot} from '../../../supabase/functions/analyze-ticker/bonds-credit-analytics';

export function creditPeriodLabel(date:string|undefined,frequency:CreditFrequency='daily'){
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return 'Sin fecha';
 if(frequency==='quarterly')return `T${Math.floor((Number(date.slice(5,7))-1)/3)+1} ${date.slice(0,4)}`;
 return new Date(date+'T12:00Z').toLocaleDateString('es-ES',{timeZone:'UTC',...(frequency==='monthly'?{month:'short',year:'numeric'}:{day:'2-digit',month:'short',year:'numeric'})});
}

export function proxyBase100(proxies:CreditProxy[]):Series[]{
 const present=proxies.filter(p=>p.points.length),sets=present.map(p=>new Set(p.points.filter(v=>v.value>0).map(v=>v.date)));
 const date=present[0]?.points.map(p=>p.date).sort().find(d=>sets.every(set=>set.has(d)));
 if(!date)return [];
 return present.map(p=>{const base=p.points.find(v=>v.date===date)!.value;return {id:p.symbol,label:p.label+' · '+p.symbol,unit:'base 100',source:'',points:p.points.filter(v=>v.date>=date).map(v=>({date:v.date,value:v.value/base*100}))};});
}

export function fallbackCurveSnapshot(series:Series[]):YieldCurveSnapshot[]{
 const curves=series.filter(s=>/^DGS\d+(MO)?$/.test(s.id)&&s.points.length);
 if(curves.length<3)return [];
 const sets=curves.map(s=>new Set(s.points.map(p=>p.date)));
 const date=curves[0].points.map(p=>p.date).sort().reverse().find(d=>sets.every(s=>s.has(d)));
 if(!date)return [];
 return [{key:'current',label:'Última curva',date,points:curves.map(s=>({id:s.id,label:s.label,maturityYears:s.id.endsWith('MO')?Number(s.id.slice(3,-2))/12:Number(s.id.slice(3)),value:s.points.find(p=>p.date===date)!.value})).sort((a,b)=>a.maturityYears-b.maturityYears)}];
}

import {useEffect,useState} from 'react';
import {authenticatedFetch} from '@/lib/beta-api';
import {usePanelActive} from './KeepPanel';
import type {ExtendedHours as Data} from '../../../supabase/functions/analyze-ticker/extended-hours';
export function ExtendedHoursCards({data}:{data?:Data}){
 if(!data?.quotes.length)return null;
 return <div className="flex flex-wrap gap-3 mt-4">{data.quotes.map(q=><div key={q.session} className="rounded-lg border border-border bg-card/60 px-4 py-3 min-w-44"><p className="text-[10px] tracking-widest text-muted-foreground">{q.session==='pre'?'PREMARKET':'POSTMARKET'}</p><p className="text-lg font-semibold tabular-nums mt-1">{q.price.toLocaleString('es-ES',{maximumFractionDigits:2})} <span className="text-xs text-muted-foreground">{data.currency}</span>{q.change!==null&&<span className={`ml-3 text-xs ${q.change>=0?'text-emerald-400':'text-red-400'}`}>{q.change>0?'+':''}{q.change.toFixed(2)}%</span>}</p><p className="text-[10px] text-muted-foreground mt-1">{q.at?new Date(q.at).toLocaleString('es-ES',{timeZone:'America/New_York'})+' ET':`${q.date} · Último precio de esa sesión`}</p></div>)}</div>;
}
export default function ExtendedHours({symbol}:{symbol:string}){
 const [data,setData]=useState<Data|undefined>(),active=usePanelActive();
 useEffect(()=>{if(!symbol||!active)return;let live=true;authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'extendedHours',subject:symbol}),signal:AbortSignal.timeout(25000)}).then(r=>r.ok?r.json():null).then(d=>{if(live)setData(d??undefined);}).catch(()=>{if(live)setData(undefined);});return()=>{live=false;};},[symbol,active]);
 return <ExtendedHoursCards data={data?.symbol===symbol?data:undefined}/>;
}

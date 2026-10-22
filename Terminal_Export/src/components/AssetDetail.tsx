import AssetContext from './AssetContext';
import {InstrumentPriceChart} from './charts/InstrumentPriceChart';
import AssetOverview from './AssetOverview';
import AssetInsightsPanel from './AssetInsightsPanel';
import AssetSession from './AssetSession';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {authenticatedFetch} from '@/lib/beta-api';
import {NewsCards} from './FeedCards';
import type {AssetSnapshot} from '../../../supabase/functions/analyze-ticker/asset-snapshot';
import type {InstrumentKind} from '../../../supabase/functions/analyze-ticker/asset-instrument';

const memory=new Map<string,AssetSnapshot>();
export default function AssetDetail({symbol,stocks,onSelect,onBack,onAnalyze}:{symbol:string;stocks:string[];onSelect:(s:string)=>void;onBack:()=>void;onAnalyze:(s:string,kind?:InstrumentKind)=>void}){
  const [data,setData]=useState<AssetSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const appliedRevision=useRef(0);
  useEffect(()=>{
    let active=true;
    const previous=memory.get(symbol),force=revision!==appliedRevision.current;
    appliedRevision.current=revision;
    setData(previous??null);setError('');
    if(previous&&Date.now()-Date.parse(previous.fetchedAt)<120000&&!force){setBusy(false);return;}
    setBusy(true);
    authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'assetSnapshot',subject:symbol}),signal:AbortSignal.timeout(60000),
    }).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(value=>{
      if(!active)return;
      if(memory.size>=30)memory.delete(memory.keys().next().value!);
      memory.set(symbol,value);setData(value);
    }).catch(()=>{if(active)setError('No se ha podido actualizar la ficha. Puedes volver a intentarlo.');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[symbol,revision]);
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 font-body text-slate-300 sm:py-6 [&_h1]:font-body [&_h2]:font-body [&_h3]:font-body">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className="inline-flex items-center gap-2 rounded-md py-2 text-xs text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-heading" onClick={onBack}><ArrowLeft size={14}/>Volver al feed</button>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="watch-asset">Activo en seguimiento</label>
        <select id="watch-asset" value={symbol} onChange={e=>onSelect(e.target.value)} className="rounded-md border border-slate-700/60 bg-[#0b1017] px-3 py-2 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-heading">
          {[...new Set([symbol,...stocks])].map(value=><option key={value}>{value}</option>)}
        </select>
        <button type="button" disabled={busy} aria-label="Actualizar ficha" className="rounded-md border border-slate-700/60 bg-[#0b1017] p-2 text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-heading disabled:opacity-40" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15} className={busy?'motion-safe:animate-spin':''}/></button>
      </div>
    </div>
    <AssetOverview symbol={symbol} data={data} busy={busy} onAnalyze={()=>onAnalyze(symbol,data?.instrument?.kind)}/>
    {data&&<AssetSession data={data}/>}
    {error&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-400/5 px-5 py-4 text-sm text-rose-300">{error}<button type="button" disabled={busy} className="text-xs font-medium underline underline-offset-4" onClick={()=>setRevision(n=>n+1)}>Reintentar</button></div>}
    <InstrumentPriceChart key={symbol+'chart'} ticker={symbol}/>
    <AssetContext key={symbol+'context'} symbol={symbol}/>
    <AssetInsightsPanel key={symbol+'insights'} symbol={symbol}/>
    {data&&<><section className="overflow-hidden rounded-xl border border-slate-700/40 bg-[#0b1017] p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-slate-200">Noticias del activo <span className="ml-2 text-xs font-normal text-slate-500">{(data.newsWindowDays??1)===1?'Últimas 24 horas':`Últimos ${data.newsWindowDays} días`}</span></h2><span className="text-[11px] text-slate-500">{data.news.length} {data.news.length===1?'artículo':'artículos'}</span></div>{data.news.length?<NewsCards articles={data.news} compact/>:<p className="py-4 text-xs leading-relaxed text-slate-400">No hay noticias relevantes con hora de publicación verificable {(data.newsWindowDays??1)===1?'en las últimas 24 horas':`en los últimos ${data.newsWindowDays} días`}.</p>}</section><p className="px-1 text-[10px] leading-relaxed text-slate-500">Actualizado: {new Date(data.fetchedAt).toLocaleString('es-ES')} · Las cotizaciones pueden tener retraso.</p></>}
  </main>;
}

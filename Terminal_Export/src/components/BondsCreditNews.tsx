import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {authenticatedFetch} from '@/lib/beta-api';
import {useProfile} from './AuthGate';
import {usePanelActive} from './KeepPanel';
import {NewsCards} from './FeedCards';
import type {Article} from '../../../supabase/functions/analyze-ticker/panels';
export type BondsNewsSubject='US'|'FR'|'DE'|'GB'|'private';
type NewsResult={subject:BondsNewsSubject;fetchedAt:string;articles:Article[]};
const cache=new Map<string,NewsResult>(),TTL=600000;
export default function BondsCreditNews({subject,title}:{subject:BondsNewsSubject;title:string}){
 const profile=useProfile(),active=usePanelActive(),key=`${profile?.id??'session'}:${subject}`;
 const [state,setState]=useState<{key:string;data:NewsResult|null;error:string;busy:boolean}>({key,data:cache.get(key)??null,error:'',busy:false}),[revision,setRevision]=useState(0);
 const attempted=useRef({key:'',revision:0});
 const data=state.key===key?state.data:null,error=state.key===key?state.error:'',busy=state.key===key?state.busy:false;
 useEffect(()=>{
  if(!active)return;
  let live=true,pending=false;const controller=new AbortController();
  const forced=attempted.current.key===key&&attempted.current.revision!==revision;attempted.current={key,revision};
  let force=forced;
  const load=async()=>{
   if(pending||document.visibilityState==='hidden')return;
   const stored=cache.get(key);
   if(!force&&stored&&Date.now()-Date.parse(stored.fetchedAt)<TTL){setState({key,data:stored,error:'',busy:false});return;}
   force=false;pending=true;setState(previous=>({key,data:previous.key===key?previous.data:stored??null,error:'',busy:true}));
   try{
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
    const request:RequestInit={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'bondsCreditNews',subject}),signal};
    const endpoint=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`;
    let response=await authenticatedFetch(endpoint,request);
    if([502,503,504].includes(response.status)&&live&&!signal.aborted){await response.body?.cancel();response=await authenticatedFetch(endpoint,request);}
    if(!response.ok)throw Error();const value:NewsResult=await response.json();
    if(value.subject!==subject||!Array.isArray(value.articles)||!Number.isFinite(Date.parse(value.fetchedAt)))throw Error();
    if(live){cache.delete(key);cache.set(key,value);while(cache.size>30)cache.delete(cache.keys().next().value!);setState({key,data:value,error:'',busy:false});}
   }catch{if(live)setState(previous=>({key,data:previous.key===key?previous.data:null,error:'No se han podido actualizar las noticias.',busy:false}));}finally{pending=false;}
  };
  void load();const timer=window.setInterval(()=>void load(),TTL),visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);
  return()=>{live=false;controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[key,subject,active,revision]);
 return <section aria-label={title} className="min-w-0 rounded-2xl border border-slate-700/40 bg-[#0c131d] p-4 sm:p-5">
  <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-200">{title}</h2>{data&&<p className="mt-1 text-[10px] text-slate-500">{new Date(data.fetchedAt).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</p>}</div><button disabled={busy} aria-label="Actualizar noticias de bonos y crédito" onClick={()=>setRevision(v=>v+1)} className="rounded-lg border border-slate-700/50 p-2 text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 disabled:opacity-40"><RefreshCw size={14} className={busy?'motion-safe:animate-spin':''}/></button></div>
  {error&&<div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"><p role="status">{error}</p><button onClick={()=>setRevision(v=>v+1)} className="text-blue-300 underline underline-offset-4">Reintentar noticias</button></div>}
  {!data&&busy&&<div aria-label="Cargando noticias de renta fija" role="status" className="grid gap-3 lg:grid-cols-2">{[0,1].map(value=><div key={value} className="h-32 rounded-xl border border-slate-800 bg-slate-900/50 motion-safe:animate-pulse"/>)}</div>}
  {data&&(data.articles.length?<NewsCards articles={data.articles} compact/>:<p className="py-6 text-center text-xs text-slate-500">No hay novedades relevantes verificadas en este momento.</p>)}
 </section>;
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {authenticatedFetch} from '@/lib/beta-api';
import type {InstrumentResolution,ResolvedInstrument} from '../../../supabase/functions/analyze-ticker/instrument-resolver';
const cache=new Map<string,{until:number;value:InstrumentResolution}>();
const instrumentTypes=new Set(['stock','etf','fund','index','forex','crypto','bond']);
const isInstrument=(value:unknown):value is ResolvedInstrument=>{
 if(!value||typeof value!=='object')return false;
 const item=value as ResolvedInstrument;
 return typeof item.symbol==='string'&&/^[A-Z0-9][A-Z0-9.^=-]{0,14}$/.test(item.symbol)&&typeof item.name==='string'&&item.name.length<=300&&typeof item.providerSymbol==='string'&&item.providerSymbol.length<=40&&typeof item.exchange==='string'&&item.exchange.length<=20&&instrumentTypes.has(item.type);
};
export function useInstrumentSearch(){
 const[state,setState]=useState<{busy:boolean;query:string;message:string;candidates:ResolvedInstrument[]}>({busy:false,query:'',message:'',candidates:[]}),generation=useRef(0),pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>{generation.current++;pending.current?.abort();},[]);
 const resolve=useCallback(async(query:string):Promise<ResolvedInstrument|null>=>{
  const subject=query.trim(),key=subject.toUpperCase(),version=++generation.current;pending.current?.abort();const controller=new AbortController();pending.current=controller;
  if(!subject||subject.length>100){setState({busy:false,query:subject,message:'Introduce un nombre o símbolo válido.',candidates:[]});return null;}
  setState({busy:true,query:subject,message:'',candidates:[]});
  try{
   const cached=cache.get(key);
   let value=cached&&cached.until>Date.now()?cached.value:null;
   if(!value){const response=await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'instrumentSearch',query:subject}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});if(!response.ok)throw Error();value=await response.json();if(!value||!Array.isArray(value.candidates)||!['resolved','ambiguous','not-found','invalid','unavailable'].includes(value.status)||value.status==='resolved'&&!isInstrument(value.instrument))throw Error();if(value.status!=='unavailable'){cache.set(key,{until:Date.now()+3600000,value});while(cache.size>100)cache.delete(cache.keys().next().value!);}}
   if(version!==generation.current)return null;
   if(value.status==='resolved'&&value.instrument&&['stock','etf','fund'].includes(value.instrument.type)){
    if(!/^[A-Z0-9][A-Z0-9.^=-]{0,14}$/.test(value.instrument.symbol))throw Error();
    setState({busy:false,query:subject,message:'',candidates:[]});return value.instrument;
   }
   // A catalog outage must not disable an explicit existing ticker. A company
   // name is never guessed. The report's original providers still verify it.
   if(value.status==='unavailable'&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(key)){
    setState({busy:false,query:subject,message:'',candidates:[]});return {symbol:key,providerSymbol:'',name:key,exchange:'',currency:null,isin:null,type:'stock',primary:false};
   }
   const candidates=value.status==='ambiguous'?value.candidates.filter(c=>isInstrument(c)&&['stock','etf','fund'].includes(c.type)):[];
   setState({busy:false,query:subject,message:candidates.length?'Selecciona la cotización que quieres analizar.':value.status==='unavailable'?'La búsqueda no está disponible ahora. Puedes introducir el símbolo exacto.':'No se ha identificado un activo con esa consulta. Comprueba el símbolo y el mercado.',candidates});return null;
  }catch{if(version===generation.current)setState({busy:false,query:subject,message:'No se ha podido comprobar el activo. Vuelve a intentarlo.',candidates:[]});return null;}
 },[]);
 return {...state,resolve};
}
export default function InstrumentSearchResults({state,onSelect}:{state:ReturnType<typeof useInstrumentSearch>;onSelect:(symbol:string)=>void}){
 if(!state.message&&!state.candidates.length)return null;
 return <section aria-label="Resultados de búsqueda" className="mb-5 rounded-xl border border-slate-700/50 bg-[#0b131f] p-4 font-sans"><p role="status" className="text-xs leading-relaxed text-slate-300">{state.message}</p>{state.candidates.length>0&&<div className="mt-3 grid gap-2 sm:grid-cols-2">{state.candidates.slice(0,12).map(item=><button key={item.providerSymbol} onClick={()=>onSelect(item.symbol)} className="rounded-lg border border-slate-700/50 p-3 text-left transition-colors hover:border-blue-400/60 focus-visible:outline focus-visible:outline-blue-400"><span className="text-xs font-semibold text-slate-100">{item.symbol}</span><span className="ml-2 text-[10px] text-blue-300">{item.exchange} · {item.currency??'—'}</span><span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{item.name}</span></button>)}</div>}</section>;
}

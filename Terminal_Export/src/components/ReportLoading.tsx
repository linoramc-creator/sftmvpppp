import {useEffect,useState} from 'react';
import {Activity,FileText,Loader2} from 'lucide-react';

export function ReportLoading({subject,streaming=false}:{subject:string;streaming?:boolean}) {
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{const start=Date.now();const timer=window.setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[]);
  return <section aria-busy="true" aria-label="Generando informe" className="relative overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-5 my-4">
    <div className="flex items-center gap-4"><div className="rounded-full border border-primary/30 bg-primary/10 p-3"><Activity className="h-5 w-5 text-primary motion-safe:animate-pulse"/></div><div className="min-w-0 flex-1"><p className="text-[10px] tracking-widest text-primary mb-1">INFORME EN CURSO · {subject}</p><p role="status" className="text-sm">{streaming?'Tu informe está tomando forma':'Preparando el análisis'}</p></div><span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span></div>
    <div className="mt-5 flex items-center gap-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 text-primary motion-safe:animate-spin"/><span>{streaming?'Las secciones se irán completando en pantalla.':seconds>75?'El análisis está tardando más de lo habitual. Puedes esperar mientras termina.':'Estamos reuniendo la información necesaria para tu informe.'}</span></div>
    {!streaming&&<div aria-hidden="true" className="mt-5 space-y-2 motion-safe:animate-pulse"><div className="h-2 w-3/4 bg-primary/10 rounded"/><div className="h-2 w-1/2 bg-primary/10 rounded"/><div className="h-2 w-2/3 bg-primary/10 rounded"/></div>}
    <div className="mt-4 flex gap-2 text-[10px] text-muted-foreground"><FileText className="h-3 w-3"/>No cierres esta pestaña durante la generación.</div>
  </section>;
}

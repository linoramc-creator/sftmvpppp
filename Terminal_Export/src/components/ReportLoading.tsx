import {useEffect,useState} from 'react';

export function ReportLoading({subject,streaming=false}:{subject:string;streaming?:boolean}) {
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{const start=Date.now();const timer=window.setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[]);
  return <section aria-busy="true" aria-label="Generando informe" className="overflow-hidden rounded-lg border border-border bg-card/40 p-6 sm:p-8 my-5">
    <div className="flex items-center justify-between gap-4"><p className="text-sm font-medium">{subject}</p><span aria-hidden="true" className="text-[11px] text-foreground/50 tabular-nums">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span></div>
    <p role="status" className="text-sm text-foreground/70 mt-2">{streaming?'Completando tu informe…':seconds>75?'El análisis necesita un poco más de tiempo.':'Preparando tu informe…'}</p>
    <div aria-hidden="true" className="report-loading-track mt-6 h-px bg-border overflow-hidden"><div className="report-loading-line h-full w-1/3 bg-primary/60"/></div>
    {!streaming&&<div aria-hidden="true" className="mt-7 grid gap-4 sm:grid-cols-3">{[0,1,2].map(i=><div key={i} className="space-y-3"><div className="h-1.5 w-2/5 bg-muted rounded-full"/><div className="h-1.5 w-full bg-muted/50 rounded-full"/><div className="h-1.5 w-3/4 bg-muted/50 rounded-full"/></div>)}</div>}
  </section>;
}

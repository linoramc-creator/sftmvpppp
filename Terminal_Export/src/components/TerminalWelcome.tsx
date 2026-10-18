import {useEffect,useRef} from 'react';
import {ArrowRight,Loader2,RefreshCw} from 'lucide-react';

export default function TerminalWelcome({name,phase,detail,onRetry,onContinue,onSignOut}:{
 name:string;phase:'loading'|'ready'|'error'|'leaving';detail:string;
 onRetry:()=>void;onContinue:()=>void;onSignOut:()=>void;
}){
 const dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.focus({preventScroll:true});return()=>{document.body.style.overflow=overflow;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};},[]);
 return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="terminal-welcome-title" aria-describedby="terminal-welcome-detail"
  className="terminal-welcome-wrap" data-state={phase} onKeyDown={event=>{
   if(event.key!=='Tab')return;const buttons=dialog.current?.querySelectorAll<HTMLButtonElement>('button');if(!buttons?.length)return;
   const first=buttons[0],last=buttons[buttons.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
  }}>
  <div aria-hidden="true" className="terminal-welcome-grid"/>
  <section className="terminal-welcome-panel">
   <p className="mb-8 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.22em] text-slate-300"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-section-heading"/>TERMINAL</p>
   <h1 id="terminal-welcome-title" className="max-w-xl break-words font-body text-[30px] font-medium leading-tight tracking-tight text-slate-100 sm:text-[42px]">Bienvenido{name?`, ${name}`:''}</h1>
   <div className="terminal-welcome-divider" aria-hidden="true"/>
   <div role="status" aria-live="polite" className="max-w-md">
    <p className="text-sm font-medium text-slate-200">{phase==='error'?'No se ha podido completar la carga.':phase==='ready'||phase==='leaving'?'Tu feed está preparado.':'Estamos preparando tu terminal.'}</p>
    <p id="terminal-welcome-detail" className="mt-3 flex items-start gap-2.5 text-sm leading-6 text-slate-400">{phase==='loading'&&<Loader2 size={15} aria-hidden="true" className="mt-1 shrink-0 text-sky-400 motion-safe:animate-spin"/>}{detail}</p>
   </div>
   {phase==='error'&&<div className="mt-7 flex flex-wrap gap-3"><button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg bg-section-heading px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-section-heading/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-heading focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b121d]"><RefreshCw size={14} aria-hidden="true"/>Reintentar</button><button type="button" onClick={onContinue} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Continuar con lo disponible<ArrowRight size={14} aria-hidden="true"/></button></div>}
   <button type="button" onClick={onSignOut} className="mt-9 rounded text-xs text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Cerrar sesión</button>
  </section>
 </div>;
}

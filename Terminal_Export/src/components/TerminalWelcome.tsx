import {useEffect,useRef} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';

export default function TerminalWelcome({name,phase,detail,onRetry,onContinue,onSignOut}:{
 name:string;phase:'loading'|'ready'|'error'|'leaving';detail:string;
 onRetry:()=>void;onContinue?:()=>void;onSignOut?:()=>void;
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
  <section className="terminal-welcome-panel">
   <div className="terminal-welcome-brand"><img src="/mensor-icon.png?v=2" width="40" height="40" alt="" aria-hidden="true"/><span>MensorTerminal</span></div>
   <div className="terminal-welcome-greeting">
    <span className="terminal-welcome-accent" aria-hidden="true"/>
    <h1 id="terminal-welcome-title">Bienvenido{name?`, ${name}`:''}</h1>
   </div>
   <div role="status" aria-live="polite" className="terminal-welcome-status">
    <p className="terminal-welcome-status-title">{phase==='error'?'No se ha podido completar la carga.':phase==='ready'||phase==='leaving'?'Tu feed está preparado.':'Estamos preparando tu terminal.'}</p>
    <p id="terminal-welcome-detail" className="terminal-welcome-detail">{detail}</p>
   </div>
   <div className="terminal-welcome-progress" aria-hidden="true"><span/></div>
   {phase==='error'&&<div className="terminal-welcome-actions"><button type="button" onClick={onRetry} className="terminal-welcome-retry"><RefreshCw size={14} aria-hidden="true"/>Reintentar</button>{onContinue&&<button type="button" onClick={onContinue} className="terminal-welcome-continue">Continuar con lo disponible<ArrowRight size={14} aria-hidden="true"/></button>}</div>}
   <div className="terminal-welcome-footer"><span aria-hidden="true">MENSOR<span className="terminal-welcome-footer-line"/>TERMINAL</span>{onSignOut&&<button type="button" onClick={onSignOut}>Cerrar sesión</button>}</div>
  </section>
 </div>;
}

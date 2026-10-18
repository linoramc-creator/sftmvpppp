import {createContext,useContext} from 'react';

export type FeedReadiness={status:'loading'|'ready'|'error';detail?:string};
export type TerminalEntry={sessionId:string;attempt:number;report:(sessionId:string,attempt:number,state:FeedReadiness)=>void};
const Context=createContext<TerminalEntry|null>(null);
export const TerminalEntryProvider=Context.Provider;
export const useTerminalEntry=()=>useContext(Context);

/** Prepare every feed cover, including those below the initial viewport. */
export async function waitForVisibleFeedImages(root:HTMLElement,signal:AbortSignal,timeoutMs=6000):Promise<boolean>{
 const images=[...root.querySelectorAll('img')];
 const outcomes=await Promise.all(images.map(image=>new Promise<boolean>(resolve=>{
  let finished=false;
  const finish=(ready:boolean)=>{if(finished)return;finished=true;window.clearTimeout(timer);image.removeEventListener('load',loaded);image.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);resolve(ready);};
  const failed=()=>finish(true); // The news card handles a failed cover gracefully.
  const aborted=()=>finish(false);
  const loaded=()=>{if(typeof image.decode==='function')void image.decode().then(()=>finish(true),()=>finish(true));else finish(true);};
  const timer=window.setTimeout(()=>finish(false),timeoutMs);
  if(signal.aborted){finish(false);return;}
  signal.addEventListener('abort',aborted,{once:true});
  image.addEventListener('load',loaded,{once:true});image.addEventListener('error',failed,{once:true});
  image.loading='eager';
  if(image.complete)image.naturalWidth>0?loaded():failed();
 })));
 return !signal.aborted&&outcomes.every(Boolean);
}

/** OpenAI-compatible report streams are complete only after every observed
 * choice explicitly stops and the transport sends [DONE]. A token limit,
 * filtering, tool hand-off or bare EOF is never a complete financial report. */
export type ReportCompletion={done:boolean;failed:boolean;failureReason:string|null;finishReasons:Map<number,string|null>};
export const createReportCompletion=():ReportCompletion=>({done:false,failed:false,failureReason:null,finishReasons:new Map()});
export function observeReportCompletion(state:ReportCompletion,event:unknown):void{
 if(event==='[DONE]'){state.done=true;return;}
 if(!event||typeof event!=='object')return;const raw=event as Record<string,any>;
 if(state.done){state.failed=true;state.failureReason??='event-after-done';return;}
 if(raw.__error||raw.error){state.failed=true;state.failureReason??='provider-error';}
 if(!Array.isArray(raw.choices))return;
 raw.choices.forEach((choice:any,position:number)=>{
  if(!choice||typeof choice!=='object'){state.failed=true;state.failureReason??='invalid-choice';return;}
  const index=choice.index===undefined?position:choice.index;
  if(!Number.isInteger(index)||index<0){state.failed=true;state.failureReason??='invalid-choice';return;}
  if(!state.finishReasons.has(index))state.finishReasons.set(index,null);
  const reason=choice.finish_reason;
  if(reason===undefined||reason===null)return;
  if(typeof reason!=='string'||reason!=='stop'){state.failed=true;state.failureReason??=typeof reason==='string'?reason:'invalid-finish';}
  state.finishReasons.set(index,typeof reason==='string'?reason:null);
 });
}
export const reportCompleted=(state:ReportCompletion)=>state.done&&!state.failed&&state.finishReasons.size>0&&[...state.finishReasons.values()].every(reason=>reason==='stop');
export function reportCompletionError(state:ReportCompletion):string|null{
 if(reportCompleted(state))return null;
 if(state.failureReason==='length')return 'El informe alcanzó el límite de generación antes de completarse. No se ha guardado; vuelve a intentarlo.';
 if(state.failureReason==='content_filter')return 'El informe no pudo completarse por una restricción del modelo. No se ha guardado.';
 return 'La generación se interrumpió antes de completar el informe. No se ha guardado; vuelve a intentarlo.';
}

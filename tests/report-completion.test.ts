import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReportCompletion,observeReportCompletion,reportCompleted,reportCompletionError} from '../supabase/functions/analyze-ticker/report-completion.ts';
const chunk=(index:number,finish_reason:string|null=null)=>({choices:[{index,delta:{content:finish_reason?'':'Contenido verificado.'},finish_reason}]});
test('a financial report requires explicit stop for every choice followed by the true DONE event',()=>{
 const state=createReportCompletion();observeReportCompletion(state,{__reportModel:'gemini-3.1-pro-preview'});observeReportCompletion(state,chunk(0));observeReportCompletion(state,chunk(1));observeReportCompletion(state,chunk(0,'stop'));
 assert.equal(reportCompleted(state),false);observeReportCompletion(state,'[DONE]');assert.equal(reportCompleted(state),false,'one unfinished choice must prevent saving');
 const ready=createReportCompletion();observeReportCompletion(ready,chunk(0));observeReportCompletion(ready,chunk(0,'stop'));assert.equal(reportCompleted(ready),false,'EOF without DONE is not a completed report');observeReportCompletion(ready,'[DONE]');assert.equal(reportCompleted(ready),true);assert.equal(reportCompletionError(ready),null);
});
test('token exhaustion, filtering and any unsupported finish reason cannot be repaired into success by a later DONE',()=>{
 for(const reason of ['length','content_filter','tool_calls','function_call','safety','unknown']){
  const state=createReportCompletion();observeReportCompletion(state,chunk(0));observeReportCompletion(state,chunk(0,reason));observeReportCompletion(state,chunk(0,'stop'));observeReportCompletion(state,'[DONE]');
  assert.equal(reportCompleted(state),false,reason);assert.ok(reportCompletionError(state));if(reason==='length')assert.match(reportCompletionError(state)!,/límite/);
 }
});
test('cached synthetic choice completion is valid while bare DONE, post-DONE events and provider errors never qualify for shared cache',()=>{
 const cached=createReportCompletion();observeReportCompletion(cached,{choices:[{index:0,delta:{content:'Informe completo guardado.'},finish_reason:'stop'}]});observeReportCompletion(cached,'[DONE]');assert.equal(reportCompleted(cached),true);
 for(const event of [{__error:'No se pudo generar'}, {error:{message:'Rejected'}}]){const state=createReportCompletion();observeReportCompletion(state,event);observeReportCompletion(state,chunk(0,'stop'));observeReportCompletion(state,'[DONE]');assert.equal(reportCompleted(state),false);}
 const bare=createReportCompletion();observeReportCompletion(bare,'[DONE]');assert.equal(reportCompleted(bare),false);observeReportCompletion(bare,chunk(0,'stop'));assert.equal(reportCompleted(bare),false);
});

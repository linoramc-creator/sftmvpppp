import test from 'node:test';
import assert from 'node:assert/strict';
import {streamReport,evidenceJson,REPORT_MODELS} from '../supabase/functions/analyze-ticker/report-models.ts';
test('reports use bounded medium reasoning on Pro and never silently downgrade after unavailability',async()=>{
 const models:string[]=[];
 const fetcher=(async(_url,init)=>{models.push(JSON.parse(String(init?.body)).model);return models.length===1?new Response('',{status:429}):new Response('data: [DONE]');}) as typeof fetch;
 const result=await streamReport([],'test',fetcher);
 assert.equal(result.ok,false);assert.deepEqual(models,[REPORT_MODELS[0]]);
 let body:any;const successful=await streamReport([],'test',(async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response('data: [DONE]');}) as typeof fetch);
 assert.equal(successful.ok,true);assert.equal(body.reasoning_effort,'medium');assert.equal(body.max_tokens,14000);assert.equal(body.model,REPORT_MODELS[0]);
 let calls=0;
 const denied=await streamReport([],'test',(async()=>{calls++;return new Response('',{status:403});}) as typeof fetch);
 assert.equal(denied.ok,false);assert.equal(calls,1);
});
test('evidence extraction uses bounded Pro reasoning and a distinct cheap repair model',async()=>{
 const seen:any[]=[];
 const fetcher=(async(url,init)=>{seen.push({url:String(url),body:JSON.parse(String(init?.body))});return Response.json({candidates:[]});}) as typeof fetch;
 await evidenceJson('evidence','test',{},fetcher);await evidenceJson('repair','test',{fast:true},fetcher);
 assert.ok(seen[0].url.includes(REPORT_MODELS[0]));assert.equal(seen[0].body.generationConfig.thinkingConfig.thinkingLevel,'low');assert.equal(seen[0].body.generationConfig.responseMimeType,'application/json');assert.ok(seen[1].url.includes(REPORT_MODELS[1]));
});

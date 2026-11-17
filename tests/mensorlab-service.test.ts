import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleMensorLabAction,mensorLabRequestClass,MensorLabError} from '../supabase/functions/analyze-ticker/mensorlab-service.ts';
import type {LabDefinition,LabRun} from '../supabase/functions/analyze-ticker/mensorlab-types.ts';
import {executeMensorLab} from '../supabase/functions/analyze-ticker/mensorlab-engine.ts';
const uid=randomUUID(),pid=randomUUID(),requestId=randomUUID(),runId=randomUUID(),user={id:uid,email:'user@example.test'};
const definition:LabDefinition={version:1,studies:[{id:'one',name:'Precios',kind:'comparison',query:{version:1,assets:['MSFT','SPY'],metric:'price',operation:'base100',period:{range:'1y'},frequency:'daily',currency:'USD',chart:'line',dataKind:'reported'}}]};
const run:LabRun={runId,definition,generatedAt:'2026-11-16T10:00:00Z',results:[],status:'unavailable',warnings:['Synthetic test']};
test('MensorLab validates allowlists and prices compute as data, not AI',()=>{
 assert.equal(mensorLabRequestClass({accountAction:'profile'}),null);assert.equal(mensorLabRequestClass({accountAction:'labRun',definition}),'data');assert.equal(mensorLabRequestClass({accountAction:'labList'}),'account');assert.equal(mensorLabRequestClass({accountAction:'labRefresh',id:pid,revision:1,requestId}),'data');
 for(const value of [{accountAction:'labSQL',sql:'select 1'},{accountAction:'labRun',definition,uid:randomUUID()},{accountAction:'labSave',name:'x',runId,requestId,result:run},{accountAction:'labSave',name:'x',runId,requestId,definition},{accountAction:'labSave',name:'x',runId,requestId,id:pid},{accountAction:'labRefresh',id:pid,revision:1}])assert.throws(()=>mensorLabRequestClass(value));
});
test('runs only persist server-computed evidence under the authenticated owner',async()=>{
 const calls:any[]=[];let count=0;
 const response=await handleMensorLabAction({accountAction:'labRun',definition},user,{rpc:async(name,body)=>{calls.push({name,body});return {};},execute:async input=>{count++;assert.deepEqual(input,definition);return run;}});
 assert.equal(count,1);assert.deepEqual(await response!.json(),run);assert.equal(calls[0].name,'beta_mensorlab_store');assert.equal(calls[0].body.uid,uid);assert.equal(calls[0].body.operation,'putRun');assert.equal(calls[0].body.payload.run.runId,runId);
});
test('saving and opening never need AI, providers or client-submitted result data',async()=>{
 const calls:any[]=[];const deps={rpc:async(name:string,body:any)=>{calls.push({name,body});return body.operation==='list'?[]:{id:pid,revision:1};},execute:async()=>{throw new Error('No recompute');}};
 await handleMensorLabAction({accountAction:'labSave',name:' Guardado ',runId,requestId},user,deps);
 await handleMensorLabAction({accountAction:'labOpen',id:pid},user,deps);
 assert.equal(calls[0].body.payload.name,'Guardado');assert.ok(calls.every(call=>call.body.uid===uid));assert.equal(calls[0].body.payload.run,undefined);assert.deepEqual(await(await handleMensorLabAction({accountAction:'labList'},user,deps))!.json(),{items:[]});
});
test('refresh reads owned definition and retry receipt skips computation',async()=>{
 let computed=0;const project={id:pid,revision:2,definition,snapshots:[]},calls:string[]=[];
 const response=await handleMensorLabAction({accountAction:'labRefresh',id:pid,revision:2,requestId},user,{rpc:async(_name,body)=>{calls.push(body.operation as string);return body.operation==='receipt'?null:project;},execute:async input=>{assert.deepEqual(input,definition);computed++;return run;}});
 assert.equal((await response!.json()).project.id,pid);assert.equal(computed,1);assert.deepEqual(calls,['receipt','open','refresh']);
 await handleMensorLabAction({accountAction:'labRefresh',id:pid,revision:2,requestId},user,{rpc:async()=>project,execute:async()=>{throw new Error('Duplicate computation');}});
});
test('ownership, revision, missing data and outages preserve safe error distinctions',async()=>{
 for(const [code,status] of [['NOT_FOUND',404],['RUN_EXPIRED',404],['CONFLICT',409],['FORBIDDEN',403],['LIMIT',409],['INVALID',400],['NETWORK',503]] as const){await assert.rejects(handleMensorLabAction({accountAction:'labOpen',id:pid},user,{rpc:async()=>{throw new Error('BETA_LAB_'+code);}}),error=>error instanceof MensorLabError&&error.status===status&&!error.message.includes('BETA_'));}
 await assert.rejects(handleMensorLabAction({accountAction:'labRun',definition},{id:''},{rpc:async()=>{throw new Error('No RPC');}}),error=>error instanceof MensorLabError&&error.status===401);
});
test('organize only renames, reorders or removes owned server studies without fetching or changing evidence dates',async()=>{
 const source=await executeMensorLab({version:1,studies:[definition.studies[0],{...definition.studies[0],id:'two',name:'Segundo'}]},{now:Date.parse(run.generatedAt),prices:async()=>null});
 const original=JSON.stringify(source),calls:any[]=[];
 const result=await(await handleMensorLabAction({accountAction:'labOrganize',runId:source.runId,studies:[{id:'two',name:' Segundo renombrado '},{id:'one',name:'Primero'}]},user,{now:()=>Date.parse('2026-11-17T12:00Z'),execute:async()=>{throw new Error('No provider or AI work allowed');},rpc:async(name,body)=>{calls.push({name,body});if(name==='beta_mensorlab_source'){assert.equal(body.uid,uid);assert.equal(body.run_id,source.runId);return source;}assert.equal(body.operation,'putRun');assert.equal(body.uid,uid);return {};}}))!.json();
 assert.equal(result.generatedAt,source.generatedAt);assert.equal(result.organizedAt,'2026-11-17T12:00:00.000Z');assert.notEqual(result.runId,source.runId);assert.deepEqual(result.definition.studies.map((item:any)=>item.id),['two','one']);assert.equal(result.results[0].name,'Segundo renombrado');assert.deepEqual(result.results[0].analytics,source.results[1].analytics);assert.equal(JSON.stringify(source),original);assert.equal(calls.length,2);
 assert.equal(mensorLabRequestClass({accountAction:'labOrganize',runId:source.runId,studies:[{id:'one',name:'Keep'}]}),'account');
 for(const studies of [[],[{id:'one',name:'A'},{id:'one',name:'B'}],[{id:'one',name:'A',query:definition.studies[0].query}],[{id:'one',name:'<script>'}]])assert.throws(()=>mensorLabRequestClass({accountAction:'labOrganize',runId:source.runId,studies}));
 await assert.rejects(handleMensorLabAction({accountAction:'labOrganize',runId:source.runId,studies:[{id:'foreign',name:'Cannot add'}]},user,{rpc:async()=>source}),error=>error instanceof MensorLabError&&error.status===400);
 await assert.rejects(handleMensorLabAction({accountAction:'labOrganize',runId:source.runId,studies:[{id:'one',name:'Keep'}]},user,{rpc:async()=>{throw new Error('BETA_LAB_NOT_FOUND');}}),error=>error instanceof MensorLabError&&error.status===404);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {analyticsRequestClass,handleAnalyticsAction,analyticsPortfolio,AnalyticsError} from '../supabase/functions/analyze-ticker/analytics-service.ts';
import {createPortfolioState} from '../supabase/functions/analyze-ticker/portfolio-model.ts';
import {classify,secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
import {AnalyticsValidationError} from '../supabase/functions/analyze-ticker/analytics-engine.ts';
import type {AnalyticsQuery,AnalyticsResult} from '../supabase/functions/analyze-ticker/analytics-types.ts';
const uid=randomUUID(),other=randomUUID(),pid=randomUUID(),now=Date.parse('2026-11-11T15:00:00Z');
const query:AnalyticsQuery={version:1,assets:['MSFT','^GSPC'],metric:'price',operation:'base100',period:{range:'2y'},frequency:'daily',currency:'original',chart:'line',dataKind:'reported'};
const user={id:uid,email:'qa@example.test'};
const mockResult={version:1,query,generatedAt:new Date(now).toISOString(),from:'2024-11-11',to:'2026-11-11',title:'Fixture',status:'unavailable',series:[],table:[],sources:[],methodology:[],warnings:['Datos no disponibles'],alternatives:[],export:{chart:false,table:false,reason:'Fixture'}} satisfies AnalyticsResult;

test('Analytics allowlists actions, properties, operations, prompts and budget classes before provider work',()=>{
 assert.equal(analyticsRequestClass({accountAction:'profile'}),null);
 assert.equal(classify({accountAction:'analyticsInterpret',prompt:'Compara Microsoft y S&P 500'}).request_class,'expensive');
 assert.equal(classify({accountAction:'analyticsInterpret',prompt:'Compara Microsoft\ny S&P 500'}).request_class,'expensive');
 assert.equal(classify({accountAction:'analyticsRun',query}).request_class,'data');
 assert.equal(classify({accountAction:'analyticsSave',name:'Comparación',query,requestId:randomUUID()}).request_class,'account');
 for(const body of [{accountAction:'analyticsExecuteSQL',sql:'select 1'},{accountAction:'analyticsRun',query,user_id:other},{accountAction:'analyticsRun',query:{...query,operation:'eval'}},{accountAction:'analyticsRun',query:{...query,sql:'select 1'}},{accountAction:'analyticsSave',name:'x',query},{accountAction:'analyticsInterpret',prompt:'x'.repeat(2001)},{accountAction:'analyticsInterpret',prompt:'<script>'},{accountAction:'analyticsRun',query,marketData:true}])assert.throws(()=>classify(body));
 for(const accountAction of ['monitorSaveAlert','monitorPauseAlert'])assert.throws(()=>classify({accountAction}),error=>(error as AnalyticsError).status===410);
});

test('saved Analytics CRUD always forwards authenticated owner and never accepts result evidence',async()=>{
 const calls:any[]=[],rpc=async(name:string,body:any)=>{calls.push({name,body});if(body.operation==='list')return [];if(body.operation==='delete')return {ok:true};return {id:pid,...body.payload,revision:1};},deps={rpc,env:()=>''};
 const created=await handleAnalyticsAction({accountAction:'analyticsSave',name:'  Base 100  ',query,requestId:randomUUID()},user,deps);
 assert.equal((await created!.json()).name,'Base 100');
 assert.deepEqual(await (await handleAnalyticsAction({accountAction:'analyticsList'},user,deps))!.json(),{items:[]});
 assert.equal((await handleAnalyticsAction({accountAction:'analyticsDelete',id:pid,revision:1},user,deps))!.status,200);
 assert.ok(calls.every(call=>call.name==='beta_analytics_store'&&call.body.uid===uid));
 for(const extra of [{user_id:other},{uid:other},{result:mockResult},{sources:[]}])await assert.rejects(handleAnalyticsAction({accountAction:'analyticsSave',name:'x',query,requestId:randomUUID(),...extra},user,deps));
 assert.equal(calls.length,3);
});

test('query refresh is code only; model interpretation gets the server credential only',async()=>{
 let ai=0,runs=0;const deps={rpc:async()=>null,env:(name:string)=>name==='Gemini'?'server-only-key':'',interpret:async(prompt:string,key:string)=>{ai++;assert.equal(key,'server-only-key');assert.equal(prompt,'Microsoft');return {query,defaults:[],notices:[],interpretedBy:'rules' as const,model:null};},execute:async(q:AnalyticsQuery)=>{runs++;assert.deepEqual(q,query);return mockResult;}};
 await handleAnalyticsAction({accountAction:'analyticsInterpret',prompt:' Microsoft '},user,deps);
 for(let i=0;i<2;i++)assert.deepEqual(await (await handleAnalyticsAction({accountAction:'analyticsRun',query},user,deps))!.json(),mockResult);
 assert.equal(ai,1);assert.equal(runs,2);
});

test('portfolio Analytics is owner scoped, read only, preserves stale and unknown exposure',async()=>{
 const state=createPortfolioState(10000,now-3600000);state.positions=[{symbol:'VRT',name:'Vertiv',quantity:2,averageCost:100,costBasis:200,realizedPnl:0,dividends:0}];const before=JSON.stringify(state),calls:any[]=[];
 const deps={rpc:async(name:string,body:any)=>{calls.push({name,body});assert.equal(name,'beta_analytics_portfolio');assert.equal(body.uid,uid);assert.equal(body.pid,pid);return {id:pid,name:'Cartera existente',state};},env:()=>'',isAdmin:async()=>true,now:()=>now};
 const result=await analyticsPortfolio(uid,'linoramc@gmail.com',pid,deps);
 assert.equal(result?.positions[0].marketValue,null);assert.equal(result?.equity,null);assert.equal(result?.cash,10000);assert.equal(result?.positions[0].quantity,2);assert.ok(result?.notes.some(note=>/parcial/.test(note)));assert.equal(JSON.stringify(state),before);assert.equal(calls.length,1);
 await assert.rejects(analyticsPortfolio(other,'other@example.test',pid,deps),error=>(error as AnalyticsError).status===403);
 assert.equal(calls.length,1);
 await assert.rejects(analyticsPortfolio(uid,'linoramc@gmail.com',pid,{...deps,isAdmin:async()=>false}),error=>(error as AnalyticsError).status===403);
 assert.equal(calls.length,1);
 assert.equal(await analyticsPortfolio(uid,'linoramc@gmail.com',pid,{...deps,rpc:async()=>null}),null);
});

test('anonymous Analytics never reaches model, storage or market data',async()=>{
 let called=false;const response=await secureRequest(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountAction:'analyticsRun',query})}),async()=>{called=true;return Response.json({});});
 assert.equal(response.status,401);assert.equal(called,false);
});

test('access failures and model outages retain their distinct HTTP statuses',async()=>{
 for(const [code,status] of [['forbidden',403],['unavailable',503],['unsupported',400]] as const){
  await assert.rejects(handleAnalyticsAction({accountAction:'analyticsInterpret',prompt:'Interpreta una petición'},user,{rpc:async()=>null,env:()=>'',interpret:async()=>{throw new AnalyticsValidationError('Fixture',code);}}),error=>error instanceof AnalyticsError&&error.status===status);
 }
});

test('storage migration has RLS, no browser table/RPC grants, owner predicates and conflict/idempotency guards',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/202611110002_analytics.sql',import.meta.url),'utf8');
 for(const pattern of [/enable row level security/i,/revoke all on public\.beta_analytics_queries from public,anon,authenticated,service_role/i,/where id=item_id and user_id=uid/i,/unique\(user_id,request_id\)/i,/BETA_ANALYTICS_CONFLICT/,/BETA_ANALYTICS_NOT_FOUND/,/not public.beta_is_admin\(uid\)/,/where user_id=uid and not archived/,/update public.beta_monitor_alerts set enabled=false/])assert.match(sql,pattern);
 assert.doesNotMatch(sql,/\bexecute\s+(?:format|payload|query)\b/i);
 assert.doesNotMatch(sql,/update public\.beta_paper_portfolios|insert into public\.beta_paper_portfolios/i);
 const retention=await readFile(new URL('../supabase/migrations/202611110003_analytics_retention.sql',import.meta.url),'utf8');
 assert.match(retention,/new\.query:='\{"version":1\}'::jsonb/);
 assert.match(retention,/interval '30 days'/);assert.match(retention,/limit 500/);
 assert.match(retention,/where user_id=new\.user_id and deleted_at is not null/);
});

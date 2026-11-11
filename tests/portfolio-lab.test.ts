import test from 'node:test';import assert from 'node:assert/strict';
import {handlePortfolioLab,runPortfolioWorker,StoreError} from '../supabase/functions/analyze-ticker/portfolio-lab.ts';
import {createPortfolioState,applyPortfolioCommand,portfolioRegularEnd,type PortfolioRecord,type PortfolioMarket} from '../supabase/functions/analyze-ticker/portfolio-model.ts';
const uid='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222',cmd='33333333-3333-4333-8333-333333333333',orderId='44444444-4444-4444-8444-444444444444',now=Date.parse('2026-11-10T15:00:00Z');
const base=():PortfolioRecord=>({id:pid,name:'Server test',version:1,archived:false,createdAt:new Date(now-300000).toISOString(),updatedAt:new Date(now-300000).toISOString(),state:createPortfolioState(1000,now-300000)});
const market:PortfolioMarket={quotes:[{symbol:'AAPL',name:'Apple',currency:'USD',kind:'stock',price:100,at:now-60000,session:'regular',delaySeconds:60,tradable:true}],benchmark:null};
function memory(initial=base()){let record=structuredClone(initial);const calls:{operation:string;uid?:string;payload?:any}[]=[];const store=async(operation:string,owner?:string,id?:string,version?:number,payload?:any)=>{calls.push({operation,uid:owner,payload});assert.equal(owner,uid);if(operation==='list')return [{id:pid,name:record.name,version:record.version,archived:record.archived,createdAt:record.createdAt,updatedAt:record.updatedAt}];if(operation==='get')return structuredClone(record);if(version!==record.version)throw new StoreError('CONFLICT','Conflict');if(operation==='save')record={...record,version:record.version+1,state:structuredClone(payload.state)};else if(operation==='archive'||operation==='restore')record={...record,version:record.version+1,archived:operation==='archive'};else throw Error(operation);return structuredClone(record);};return {store,calls,read:()=>record};}
test('retries do not credit cash twice and public snapshots omit execution candles',async()=>{
 const fixture=memory(),deps={store:fixture.store,market:async()=>({market:{...market,quotes:[{...market.quotes[0],bars:[{time:now-120000,open:100,high:101,low:99,close:100,volume:1000,session:'regular' as const,sessionDate:'2026-11-10',regularEnd:portfolioRegularEnd('2026-11-10')}]}]},actions:[]}),now:()=>now};
 const body={panel:'portfolioLab',action:'cash',portfolioId:pid,requestId:cmd,kind:'deposit',amount:100};const first=await handlePortfolioLab(body,uid,deps),retry=await handlePortfolioLab(body,uid,deps);assert.equal(first.portfolio.state.cash,1100);assert.equal(retry.portfolio.state.cash,1100);assert.equal(retry.portfolio.state.events.filter((e:any)=>e.type==='deposit').length,1);assert.equal(retry.metrics.totalReturnPct,0);assert.ok(!('bars'in retry.market.quotes[0]));
});
test('CAS conflicts reread owner state and use a non-regressing clock before applying a command',async()=>{
 const fixture=memory(),stored=fixture.read();let writes=0;const store=async(...args:Parameters<typeof fixture.store>)=>{if(args[0]==='save'&&writes++===0){stored.version++;stored.state.updatedAt=now+10;throw new StoreError('CONFLICT','Concurrent worker');}return fixture.store(...args);};
 const response=await handlePortfolioLab({panel:'portfolioLab',action:'journal',portfolioId:pid,requestId:cmd,note:'Research note'},uid,{store,market:async()=>({market,actions:[]}),now:()=>now});assert.equal(response.portfolio.state.updatedAt,now+10);assert.equal(response.portfolio.state.events.filter((e:any)=>e.type==='note').length,1);assert.equal(writes,2);
});
test('archiving cancels working orders, releases reservations and restores without resurrecting an order',async()=>{
 const initial=base();initial.state=applyPortfolioCommand(initial.state,{id:orderId,type:'order',order:{symbol:'AAPL',side:'buy',type:'limit',quantity:1,limitPrice:50,timeInForce:'gtc',extendedHours:true}},market,now-60000);const fixture=memory(initial),deps={store:fixture.store,market:async()=>({market,actions:[]}),now:()=>now};
 const archived=await handlePortfolioLab({panel:'portfolioLab',action:'archive',portfolioId:pid,requestId:cmd,archived:true},uid,deps);assert.equal(archived.portfolio.archived,true);assert.equal(archived.portfolio.state.orders[0].status,'cancelled');assert.equal(archived.metrics.reservedCash,0);
 const restored=await handlePortfolioLab({panel:'portfolioLab',action:'archive',portfolioId:pid,requestId:cmd,archived:false},uid,deps);assert.equal(restored.portfolio.archived,false);assert.equal(restored.portfolio.state.orders[0].status,'cancelled');assert.equal(restored.portfolio.state.positions.length,0);
});
test('worker CAS retry retains owner even though get returns no userId, and skips idle cash-only portfolios',async()=>{
 const initial=base();initial.state=applyPortfolioCommand(initial.state,{id:orderId,type:'order',order:{symbol:'AAPL',side:'buy',type:'limit',quantity:1,limitPrice:50,timeInForce:'gtc',extendedHours:true}},market,now-60000);const fixture=memory(initial),stored=fixture.read();let writes=0;
 const store=async(op:string,owner?:string,id?:string,version?:number,payload?:any)=>{if(op==='due')return [{...structuredClone(stored),userId:uid}];if(op==='save'&&writes++===0){assert.equal(owner,uid);stored.version++;stored.state.updatedAt=now+20;throw new StoreError('CONFLICT','Concurrent request');}return fixture.store(op,owner,id,version,payload);};
 assert.deepEqual(await runPortfolioWorker({store,market:async()=>({market,actions:[]}),now:()=>now}),{checked:1,updated:1,failed:0});assert.equal(writes,2);assert.ok(fixture.calls.filter(c=>c.operation==='save').every(c=>c.uid===uid));
 let requested=false;const idle={...base(),userId:uid};const none=await runPortfolioWorker({store:async()=>[idle],market:async()=>{requested=true;return {market,actions:[]};},now:()=>now});assert.equal(requested,false);assert.equal(none.checked,0);
});

test('a recently advanced snapshot reads persisted marks without providers or a write; stale state advances normally',async()=>{
 const initial=base();initial.state.lastAdvancedAt=now-299999;const fixture=memory(initial);let reads=0;const deps={store:fixture.store,market:async()=>{reads++;return {market,actions:[]};},now:()=>now};
 const fresh=await handlePortfolioLab({panel:'portfolioLab',action:'snapshot',portfolioId:pid},uid,deps);assert.equal(fresh.portfolio.version,1);assert.equal(reads,0);assert.deepEqual(fixture.calls.map(c=>c.operation),['get']);
 fixture.read().state.lastAdvancedAt=now-300000;await handlePortfolioLab({panel:'portfolioLab',action:'snapshot',portfolioId:pid},uid,deps);assert.equal(reads,1);assert.equal(fixture.read().version,2);
});

test('partial stored coverage recovers before the ordinary five-minute cache, with a thirty-second failure cooldown',async()=>{
 for(const age of [29999,30000,60000]){
  const initial=base();initial.state.positions=[{symbol:'AAPL',name:'Apple',quantity:1,averageCost:100,costBasis:100,realizedPnl:0,dividends:0}];initial.state.lastAdvancedAt=now-age;
  const fixture=memory(initial);let reads=0;const response=await handlePortfolioLab({panel:'portfolioLab',action:'snapshot',portfolioId:pid},uid,{store:fixture.store,market:async()=>{reads++;return {market,actions:[]};},now:()=>now});
  assert.equal(reads,age<30000?0:1);assert.equal(response.metrics.coverage,age<30000?'partial':'complete');assert.equal(fixture.read().version,age<30000?1:2);
 }
});

test('risk reads only the authorized portfolio and freezes archived analytics at the original accounting cutoff',async()=>{
 const initial=base();initial.archived=true;const fixture=memory(initial);let providers=0,analytics=0;
 const result=await handlePortfolioLab({panel:'portfolioLab',action:'risk',portfolioId:pid},uid,{store:fixture.store,market:async()=>{providers++;return {market,actions:[]};},analytics:async(state,cutoff)=>{analytics++;assert.deepEqual(state,initial.state);assert.equal(cutoff,initial.state.updatedAt);return {asOf:new Date(cutoff).toISOString(),currency:'USD',portfolio:{sharpe:null,annualizedVolatilityPct:null,observations:0,from:null,to:null,riskFreeRatePct:0,status:'insufficient'},assets:[],notes:[]};},now:()=>now});
 assert.equal(analytics,1);assert.equal(providers,0);assert.equal(result.analytics.asOf,new Date(initial.state.updatedAt).toISOString());assert.deepEqual(fixture.calls.map(c=>c.operation),['get']);
 await assert.rejects(handlePortfolioLab({panel:'portfolioLab',action:'risk',portfolioId:pid},uid,{store:async()=>{throw new StoreError('FORBIDDEN','No access',403);},analytics:async()=>{throw Error('Must not calculate for a denied owner');}}),/No access/);
});

test('renaming retries a CAS without advancing accounting, downloading prices or adding a journal event',async()=>{
 const initial=base(),fixture=memory(initial),original=structuredClone(initial.state);let attempts=0,providers=0;
 const store=async(operation:string,owner?:string,id?:string,version?:number,payload?:any)=>{
  if(operation==='rename'){assert.equal(owner,uid);assert.equal(payload.name,'Nueva estrategia');assert.equal(payload.requestId,cmd);if(attempts++===0){fixture.read().version++;throw new StoreError('CONFLICT','Concurrent update');}fixture.read().name=payload.name;fixture.read().version++;return structuredClone(fixture.read());}
  return fixture.store(operation,owner,id,version,payload);
 };
 const response=await handlePortfolioLab({panel:'portfolioLab',action:'rename',portfolioId:pid,requestId:cmd,name:' Nueva estrategia '},uid,{store,market:async()=>{providers++;return {market,actions:[]};},now:()=>now});
 assert.equal(response.portfolio.name,'Nueva estrategia');assert.equal(attempts,2);assert.equal(providers,0);assert.deepEqual(response.portfolio.state,original);assert.ok(!fixture.calls.some(c=>c.operation==='save'));
});

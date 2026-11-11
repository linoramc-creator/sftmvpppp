import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateMonitoringRequest,handleMonitoringAction,monitoringContext} from '../supabase/functions/analyze-ticker/monitoring-api.ts';
import {createPortfolioState} from '../supabase/functions/analyze-ticker/portfolio-model.ts';
const now=Date.UTC(2026,10,11,15),uid=randomUUID();
test('monitoring API rejects forged owners, ambiguous currency, unsafe rules and multiple operations',()=>{
 const rule={accountAction:'monitorSaveAlert',requestId:randomUUID(),symbol:'GOOGL',name:'Precio de seguimiento',conditions:[{field:'price',op:'lte',value:200,currency:'USD'}],enabled:true};
 assert.equal(validateMonitoringRequest(rule),true);
 for(const bad of [{...rule,uid:randomUUID()},{...rule,user_id:randomUUID()},{...rule,panel:'portfolioLab'},{...rule,requestId:undefined},{...rule,conditions:[{field:'price',op:'lte',value:200}]},{...rule,conditions:[{field:'price',op:'lte',value:NaN,currency:'USD'}]},{...rule,conditions:[{field:'price',op:'lte',value:200,currency:'EUR',injected:true}]},{...rule,conditions:Array(6).fill(rule.conditions[0])},{...rule,symbol:'AAPL?secret=abc'}])assert.throws(()=>validateMonitoringRequest(bad));
 assert.throws(()=>validateMonitoringRequest({accountAction:'monitorRead',ids:[randomUUID()],uid}));
});
test('every monitoring API operation uses authenticated uid; overview never exposes portfolio state',async()=>{
 const state=createPortfolioState(10000,now),calls:any[]=[],visitId=randomUUID();state.positions=[{symbol:'VRT',name:'Vertiv',quantity:2,costBasis:200,averageCost:100,realizedPnl:0,dividends:0}];
 const store=async(operation:string,owner:string|null,payload:any)=>{calls.push({operation,owner,payload});if(operation==='visit')return {baseline:'2026-11-10T09:00:00Z',visitAt:new Date(now).toISOString()};if(operation==='list')return {unread:0,notices:[],alerts:[],lastCollectedAt:null,hasMore:false};if(operation==='context')return {watchlist:['GOOGL'],symbols:['GOOGL','VRT'],portfolios:[{id:randomUUID(),name:'Cartera existente',state}],snapshots:[],coverage:[]};return {ok:true};};
 const response=await handleMonitoringAction({accountAction:'monitorOpen',visitId},uid,{store,now:()=>now}),data=await response!.json();
 assert.ok(calls.every(c=>c.owner===uid));assert.equal(data.context.positions[0].symbol,'VRT');assert.equal(data.context.positions[0].marketValue,null);assert.equal(data.context.positions[0].equity,null);assert.equal(data.context.portfolios,undefined);assert.equal(data.context.state,undefined);assert.equal(data.baseline,'2026-11-10T09:00:00Z');
 assert.deepEqual(state.marks,undefined);assert.equal(state.positions[0].quantity,2);
});
test('monitor status reads counters without moving last visit or loading portfolio state',async()=>{
 const calls:string[]=[],r=await handleMonitoringAction({accountAction:'monitorStatus'},uid,{store:async(op,owner)=>{calls.push(op);assert.equal(owner,uid);return {unread:4,lastCollectedAt:'2026-11-11T12:00:00Z',notices:[{private:true}]};}});
 assert.deepEqual(await r!.json(),{unread:4,lastCollectedAt:'2026-11-11T12:00:00Z'});assert.deepEqual(calls,['list']);
});

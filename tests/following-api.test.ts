import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleMonitoringAction,validateMonitoringRequest,MonitoringError} from '../supabase/functions/analyze-ticker/monitoring-api.ts';
import {classify,secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';

test('following list and dedicated inbox accept only bounded owned operations',()=>{
 const id=randomUUID(),before={at:new Date().toISOString(),id};
 for(const body of [{accountAction:'monitorWatchlist'},{accountAction:'monitorSaveWatchlist',symbols:[],revision:1},{accountAction:'monitorSaveWatchlist',symbols:['AAPL','MSFT'],revision:1},{accountAction:'monitorInbox',before,alertId:id,unreadOnly:true},{accountAction:'monitorAlertHistory',before,alertId:id}]){assert.equal(validateMonitoringRequest(body),true);assert.equal(classify(body).request_class,'account');}
 for(const extra of [{user_id:id},{uid:id},{symbols:Array(8).fill('AAPL'),revision:1},{symbols:['AAPL','AAPL'],revision:1},{symbols:['AAPL'],revision:0},{symbols:['https://example.com'],revision:1},{symbols:['aapl'],revision:1}])assert.throws(()=>validateMonitoringRequest({accountAction:'monitorSaveWatchlist',symbols:['AAPL'],revision:1,...extra}),MonitoringError);
 for(const extra of [{before:'2026-11-17'},{before:{at:new Date().toISOString(),id:'bad'}},{before:{...before,sql:'select 1'}},{alertId:'someone'},{unreadOnly:1},{limit:100000},{user_id:id}])assert.throws(()=>validateMonitoringRequest({accountAction:'monitorInbox',...extra}),MonitoringError);
 assert.throws(()=>validateMonitoringRequest({accountAction:'monitorAlertHistory',unreadOnly:false}),MonitoringError);
});

test('following dispatch binds all lists, notifications and audit reads to authenticated identity',async()=>{
 const owner=randomUUID(),id=randomUUID(),calls:any[]=[],following=async(operation:string,uid:string|null,payload:any={})=>{calls.push({operation,uid,payload});return operation==='state'?{watchlist:['NVDA'],unread:4}:operation==='watchlist'?{symbols:['NVDA'],revision:2,updatedAt:null}:{items:[],next:null,unread:0};};
 const store=async(operation:string,uid:string|null,payload:any={})=>{calls.push({operation,uid,payload});if(operation==='visit')return {baseline:null,visitAt:new Date().toISOString()};if(operation==='context')return {watchlist:['OLD-FEED'],symbols:['NVDA'],portfolios:[],snapshots:[],coverage:[]};return {unread:99,notices:[],alerts:[],lastCollectedAt:null,hasMore:false};};
 const deps={store,following};
 await handleMonitoringAction({accountAction:'monitorSaveWatchlist',symbols:['NVDA'],revision:1},owner,deps);
 await handleMonitoringAction({accountAction:'monitorInbox',alertId:id},owner,deps);await handleMonitoringAction({accountAction:'monitorAlertHistory',alertId:id},owner,deps);
 assert.deepEqual(calls.map(c=>c.operation),['save_watchlist','inbox','alert_history']);assert.ok(calls.every(c=>c.uid===owner));
 const opened=await(await handleMonitoringAction({accountAction:'monitorOpen',visitId:randomUUID()},owner,deps))!.json();assert.deepEqual(opened.context.watchlist,['NVDA']);assert.equal(opened.unread,4);
 const status=await(await handleMonitoringAction({accountAction:'monitorStatus'},owner,deps))!.json();assert.equal(status.unread,4);
 const offset=calls.length;await handleMonitoringAction({accountAction:'monitorRead',ids:[id]},owner,deps);assert.equal(calls.slice(offset).length,2);assert.ok(calls.slice(offset).every(c=>c.operation==='read'&&c.uid===owner&&c.payload.ids[0]===id));
});

test('missing following storage and anonymous requests fail explicitly before collection',async()=>{
 await assert.rejects(handleMonitoringAction({accountAction:'monitorWatchlist'},randomUUID(),{store:async()=>({})}),e=>e instanceof MonitoringError&&e.status===503);
 let called=0;const response=await secureRequest(new Request('https://example.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountAction:'monitorInbox'})}),async()=>{called++;return Response.json({});});assert.equal(response.status,401);assert.equal(called,0);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
import {defaultFeedPreferences,normalizeFeedPreferences,feedPreferencesKey} from '../supabase/functions/analyze-ticker/feed-preferences.ts';

test('normalizes bounded preferences without mutating default arrays or accepting hidden properties',()=>{
 const defaults=defaultFeedPreferences();assert.equal(defaults.indices[0],'^GSPC');assert.ok(defaults.indices.includes('NQ=F'));assert.ok(defaults.currencies.includes('BTC-USD'));
 const result=normalizeFeedPreferences({...defaults,currencies:[' eurjpy=x ','BTC-USD']});assert.deepEqual(result?.currencies,['EURJPY=X','BTC-USD']);
 assert.deepEqual(normalizeFeedPreferences({...defaults,indices:['FTSEMIB.MI']})?.indices,['FTSEMIB.MI']);
 for(const value of [{...defaults,etfs:[]},{...defaults,etfs:Array.from({length:13},(_,i)=>'X'+i)},{...defaults,etfs:['SPY',' spy ']},{...defaults,indices:['https://bad.test']},{...defaults,currencies:['AAPL']},{...defaults,etfs:['AAPL;DROP']},{...defaults,user_id:'other'}])assert.equal(normalizeFeedPreferences(value),null);
 defaults.indices.pop();assert.notEqual(defaultFeedPreferences().indices.length,defaults.indices.length);
 assert.throws(()=>classify({accountAction:'saveFeedPreferences'}));assert.throws(()=>classify({panel:'feedMarkets',feedGroups:{...defaultFeedPreferences(),currencies:[]}}));
});
test('market cache identifies the ordered public selection in a bounded key',async()=>{
 const defaults=defaultFeedPreferences(),first=await feedPreferencesKey(['AAPL'],defaults);
 assert.match(first,/^feed-markets-v8:[a-f0-9]{64}$/);assert.equal(first,await feedPreferencesKey(['AAPL'],defaultFeedPreferences()));
 assert.notEqual(first,await feedPreferencesKey(['MSFT'],defaults));
 assert.notEqual(first,await feedPreferencesKey(['AAPL'],{...defaults,indices:[...defaults.indices].reverse()}));
});
const uid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
function securityFixture(t:any,type='INDEX'){
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,writes:any[]=[],paths:string[]=[];
 (globalThis as any).Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://project.supabase.co':'test-secret'}};
 globalThis.fetch=async(input:any,init:any={})=>{
  const url=String(input);paths.push(url);
  if(url.includes('/auth/v1/user'))return Response.json({id:uid,email:'test@example.com',email_confirmed_at:'2026-10-01'});
  if(url.includes('/rpc/beta_active_user'))return Response.json(true);
  if(url.includes('/rpc/beta_reserve'))return Response.json('44444444-4444-4444-8444-444444444444');
  if(url.includes('/beta_usage'))return new Response(null,{status:204});
  if(url.includes('/beta_feed_preferences')){if(init.method==='POST'){writes.push(JSON.parse(init.body));return new Response(null,{status:204});}return Response.json([]);}
  if(url.includes('/v8/finance/chart/'))return Response.json({chart:{result:[{meta:{instrumentType:type,regularMarketPrice:100,shortName:'Verified asset'}}]}});
  throw new Error('Unexpected request '+url);
 };
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;});return {writes,paths};
}
const request=(body:any)=>new Request('https://project.supabase.co/functions/v1/analyze-ticker',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'x'.repeat(30)},body:JSON.stringify(body)});
test('a forged save cannot place an equity in ETF group or trigger database writes',async t=>{
 const {writes}=securityFixture(t,'EQUITY');const groups={...defaultFeedPreferences(),etfs:['FAKEETF']};
 const response=await secureRequest(request({accountAction:'saveFeedPreferences',groups}),async()=>Response.json({unexpected:true}));
 assert.equal(response.status,400);assert.equal(writes.length,0);await response.json();
});
test('an index without a caret is accepted only when provider metadata confirms its index type',async t=>{
 const {writes}=securityFixture(t,'INDEX'),groups={...defaultFeedPreferences(),indices:['FTSEMIB.MI']};
 const response=await secureRequest(request({accountAction:'saveFeedPreferences',groups}),async()=>Response.json({unexpected:true}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).groups.indices,['FTSEMIB.MI']);assert.equal(writes[0].user_id,uid);
});
test('an ordinary equity symbol still cannot bypass index-group metadata validation',async t=>{
 const {writes}=securityFixture(t,'EQUITY'),groups={...defaultFeedPreferences(),indices:['NOTANINDEX.MI']};
 const response=await secureRequest(request({accountAction:'saveFeedPreferences',groups}),async()=>Response.json({unexpected:true}));
 assert.equal(response.status,400);assert.equal(writes.length,0);await response.json();
});
test('saving verified additions binds preferences to authenticated identity and never a submitted user ID',async t=>{
 const {writes,paths}=securityFixture(t);const groups={...defaultFeedPreferences(),indices:['^TESTIDX']};
 const response=await secureRequest(request({accountAction:'saveFeedPreferences',groups,user_id:other}),async()=>Response.json({unexpected:true}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).groups.indices,['^TESTIDX']);assert.equal(writes[0].user_id,uid);
 assert.ok(paths.some(path=>path.includes(`user_id=eq.${uid}`)));assert.ok(!paths.some(path=>path.includes(other)));
});
test('market requests cannot bypass saved preferences with a different forged selection',async t=>{
 securityFixture(t);let dispatched=false;const groups={...defaultFeedPreferences(),etfs:['SPY']};
 const response=await secureRequest(request({panel:'feedMarkets',subject:'AAPL',feedGroups:groups}),async()=>{dispatched=true;return Response.json({});});
 assert.equal(response.status,409);assert.equal(dispatched,false);await response.json();
});

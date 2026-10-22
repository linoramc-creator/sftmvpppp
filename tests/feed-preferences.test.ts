import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
import {defaultFeedPreferences,normalizeFeedPreferences,normalizeSavedFeedPreferences,normalizeFeedSymbol,feedSuggestions,feedPreferencesKey,FEED_GROUP_KEYS,FEED_GROUP_LIMITS,FEED_SUGGESTIONS} from '../supabase/functions/analyze-ticker/feed-preferences.ts';
import {validateFeedAsset} from '../supabase/functions/analyze-ticker/feed-quotes.ts';

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
 assert.match(first,/^feed-markets-v10:[a-f0-9]{64}$/);assert.equal(first,await feedPreferencesKey(['AAPL'],defaultFeedPreferences()));
 assert.notEqual(first,await feedPreferencesKey(['MSFT'],defaults));
 assert.notEqual(first,await feedPreferencesKey(['AAPL'],{...defaults,indices:[...defaults.indices].reverse()}));
});
const uid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
function securityFixture(t:any,type:string|((symbol:string)=>string)='INDEX',previous?:unknown){
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,writes:any[]=[],paths:string[]=[];
 (globalThis as any).Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://project.supabase.co':'test-secret'}};
 globalThis.fetch=async(input:any,init:any={})=>{
  const url=String(input);paths.push(url);
  if(url.includes('/auth/v1/user'))return Response.json({id:uid,email:'test@example.com',email_confirmed_at:'2026-10-01'});
  if(url.includes('/rpc/beta_active_user'))return Response.json(true);
  if(url.includes('/rpc/beta_reserve'))return Response.json('44444444-4444-4444-8444-444444444444');
  if(url.includes('/beta_usage'))return new Response(null,{status:204});
  if(url.includes('/beta_feed_preferences')){if(init.method==='POST'){writes.push(JSON.parse(init.body));return new Response(null,{status:204});}return Response.json(previous?[{groups:previous}]:[]);}
  if(url.includes('/v8/finance/chart/')){const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1)!);return Response.json({chart:{result:[{meta:{symbol,instrumentType:typeof type==='function'?type(symbol):type,regularMarketPrice:100,shortName:'Verified asset'}}]}});}
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
test('new selections allow ten ETF and seven in other groups, while legacy custom selections retain their assets without writes',async t=>{
 const defaults=defaultFeedPreferences();for(const key of FEED_GROUP_KEYS)assert.equal(defaults[key].length,FEED_GROUP_LIMITS[key]);
 const legacy={indices:['^FTSE','^N225'],etfs:['VTI','QQQ','SPY','IWM','GLD','TLT','EFA','HYG'],currencies:['EURUSD=X','JPY=X']};
 const expected={...legacy,commodities:defaults.commodities};assert.deepEqual(normalizeSavedFeedPreferences(legacy),expected);assert.equal(normalizeFeedPreferences(legacy),null);
 const {writes}=securityFixture(t,'INDEX',legacy),loaded=await secureRequest(request({accountAction:'getFeedPreferences'}),async()=>Response.json({}));
 assert.equal(loaded.status,200);assert.deepEqual((await loaded.json()).groups,expected);assert.equal(writes.length,0);
 for(const key of FEED_GROUP_KEYS){const tooMany={...defaults,[key]:[...defaults[key],key==='commodities'?'KC=F':key==='indices'?'^FTSE':key==='etfs'?'VTI':'EURJPY=X']};assert.equal(normalizeFeedPreferences(tooMany),null);assert.throws(()=>classify({accountAction:'saveFeedPreferences',groups:tooMany}));}
 const longer={...defaults,etfs:[...defaults.etfs,'VTI','VT']};assert.deepEqual(normalizeSavedFeedPreferences(longer)?.etfs,defaults.etfs);
});

test('ETF defaults and suggestions are unique while future seven-ETF selections stay explicitly personalized',async t=>{
 const defaults=defaultFeedPreferences(),oldDefaults=defaults.etfs.slice(0,7),saved={...defaults,etfs:oldDefaults};
 assert.deepEqual(defaults.etfs,['SPY','QQQ','URTH','IWM','VEA','VWO','TLT','GLD','HYG','LQD']);
 assert.deepEqual(feedSuggestions('etfs','',[],10).map(([symbol])=>symbol),defaults.etfs);
 assert.equal(new Set(FEED_SUGGESTIONS.etfs.map(([symbol])=>symbol)).size,FEED_SUGGESTIONS.etfs.length);
 assert.deepEqual(normalizeSavedFeedPreferences(saved)?.etfs,oldDefaults);
 assert.deepEqual(normalizeSavedFeedPreferences({...saved,etfs:[...oldDefaults].reverse()})?.etfs,[...oldDefaults].reverse());
 const {writes}=securityFixture(t,'ETF',saved),loaded=await secureRequest(request({accountAction:'getFeedPreferences'}),async()=>Response.json({}));
 assert.deepEqual((await loaded.json()).groups.etfs,oldDefaults);assert.equal(writes.length,0);
 const response=await secureRequest(request({accountAction:'saveFeedPreferences',groups:defaults}),async()=>Response.json({}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).groups.etfs,defaults.etfs);assert.equal(writes[0].user_id,uid);
});
test('ticker aliases are explicit, duplicate-aware and preserve the direction of native currency pairs',()=>{
 for(const [group,input,expected]of [['indices','SPX','^GSPC'],['indices','NDX','^NDX'],['etfs','qqq','QQQ'],['currencies','EUR/USD','EURUSD=X'],['currencies','EURUSD','EURUSD=X'],['currencies','USDJPY','JPY=X'],['currencies','USD/JPY','JPY=X'],['currencies','EUR=X','EUR=X'],['currencies','GBP=X','GBP=X'],['currencies','AUD=X','AUD=X'],['currencies','NZD=X','NZD=X'],['currencies','EUR','EURUSD=X'],['currencies','BTC/USD','BTC-USD'],['commodities','GC','GC=F'],['commodities','FEF','SGX-IODEX']] as const)assert.equal(normalizeFeedSymbol(group,input),expected);
 for(const input of ['USD/USD','https://private','EURUSD;DROP','EUR\nUSD'])assert.equal(normalizeFeedSymbol('currencies',input),null);
 assert.equal(normalizeFeedSymbol('commodities','FEF=F'),null);
 const defaults=defaultFeedPreferences();assert.equal(normalizeFeedPreferences({...defaults,currencies:['EURUSD','EUR/USD']}),null);
 assert.deepEqual(normalizeSavedFeedPreferences({...defaults,currencies:['USDJPY','JPY=X','EUR=X']})?.currencies,['JPY=X','EUR=X']);
 assert.deepEqual(feedSuggestions('currencies','usd/jpy',[],6).map(([symbol])=>symbol),['JPY=X']);
 assert.deepEqual(feedSuggestions('commodities','fef',[],6).map(([symbol])=>symbol),['SGX-IODEX']);
 assert.equal(feedSuggestions('etfs','QQQ',['QQQ']).some(([symbol])=>symbol==='QQQ'),false);
});
test('validation endpoints query canonical symbols rather than sending human aliases to market providers',async t=>{
 const {paths}=securityFixture(t,symbol=>symbol.endsWith('=X')?'CURRENCY':symbol.endsWith('=F')?'FUTURE':'INDEX');
 for(const [group,input,canonical]of [['indices','SPX','^GSPC'],['currencies','EUR/USD','EURUSD=X'],['currencies','USDJPY','JPY=X'],['commodities','GC','GC=F']] as const){
  const response=await secureRequest(request({accountAction:'validateFeedAsset',group,symbol:input}),async()=>Response.json({}));assert.equal(response.status,200);assert.equal((await response.json()).symbol,canonical);assert.ok(paths.some(path=>path.includes('/v8/finance/chart/'+encodeURIComponent(canonical))));
 }
});
test('metadata validation cannot add an equity as a future or accept a different asset returned by a provider',async()=>{
 const raw=(symbol:string,type:string)=>({chart:{result:[{meta:{symbol,instrumentType:type,regularMarketPrice:100}}]}});
 assert.equal(await validateFeedAsset('commodities','GC',{read:async()=>raw('GC=F','EQUITY')}),null);
 assert.equal(await validateFeedAsset('commodities','GC',{read:async()=>raw('CL=F','FUTURE')}),null);
 assert.equal((await validateFeedAsset('commodities','GC',{read:async symbol=>raw(symbol,'FUTURE')}))?.symbol,'GC=F');
 assert.equal(await validateFeedAsset('etfs','QQQ',{read:async()=>raw('QQQ','EQUITY')}),null);
});
test('FEF uses the dated SGX settlement path and stays unavailable when no verified iron quote exists',async()=>{
 const now=Date.parse('2026-10-22T12:00:00Z'),base={symbol:'SGX-IODEX',label:'Hierro · IODEX · Nov-26',price:91,date:'2026-10-22',currency:'USD'} as any;let charts=0,iron=0;
 const valid=await validateFeedAsset('commodities','FEF',{now,read:async()=>{charts++;throw Error('Not a Yahoo or NYMEX ticker');},iron:async()=>{iron++;return base;}});
 assert.equal(valid?.symbol,'SGX-IODEX');assert.equal(charts,0);assert.equal(iron,1);
 for(const patch of [{price:null},{date:'2026-10-01'},{date:'2026-10-23'}])assert.equal(await validateFeedAsset('commodities','FEF',{now,iron:async()=>({...base,...patch})}),null);
});
test('a legacy stored selection matches its seven-item view during authenticated market requests',async t=>{
 const legacy={indices:['^FTSE'],etfs:['VTI','QQQ','SPY','IWM','GLD','TLT','EFA','HYG'],currencies:['EURUSD=X']},groups=normalizeSavedFeedPreferences(legacy)!;const {writes}=securityFixture(t,'INDEX',legacy);let dispatched=false;
 const response=await secureRequest(request({panel:'feedMarkets',subject:'',feedGroups:groups}),async body=>{dispatched=true;return Response.json(body.feedGroups);});
 assert.equal(response.status,200);assert.equal(dispatched,true);assert.equal(writes.length,0);assert.deepEqual(await response.json(),groups);
});

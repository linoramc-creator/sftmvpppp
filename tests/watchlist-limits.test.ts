import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BetaError,classify,secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
import {buildBrief} from '../supabase/functions/daily-brief/data.ts';
import {feedSymbols} from '../supabase/functions/analyze-ticker/feed-quotes.ts';

const symbols=['AAPL','MSFT','NVDA','BRK-B','SPY','QQQ','URTH'];
const uid='22222222-2222-4222-8222-222222222222';
const request=(body:unknown)=>new Request('https://project.supabase.co/functions/v1/analyze-ticker',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'x'.repeat(30)},body:JSON.stringify(body)});
function fixture(t:any){
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,writes:any[]=[],paths:string[]=[];
 let saved=[...symbols];
 (globalThis as any).Deno={env:{get:(key:string)=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-secret',SUPABASE_ANON_KEY:'test-public'}[key])}};
 globalThis.fetch=async(input:any,init:any={})=>{
  const url=String(input);paths.push(url);
  if(url.includes('/auth/v1/user'))return Response.json({id:uid,email:'test@example.com',email_confirmed_at:'2026-10-01'});
  if(url.includes('/rpc/beta_active_user'))return Response.json(true);
  if(url.includes('/rpc/beta_reserve'))return Response.json('44444444-4444-4444-8444-444444444444');
  if(url.includes('/beta_usage'))return new Response(null,{status:204});
  if(url.includes('/beta_watchlists')){
   if(init.method==='POST'){const body=JSON.parse(init.body);writes.push(body);saved=[...body.symbols];return new Response(null,{status:204});}
   return Response.json([{symbols:saved}]);
  }
  throw new Error('Unexpected request '+url);
 };
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;});
 return {writes,paths};
}
const unused=async()=>{throw Error('An account request must not dispatch a provider.');};

test('seven maximum-length feed tickers fit the complete request without truncation',()=>{
 const selected=Array.from({length:7},(_,i)=>`ASSET${i}`.padEnd(15,'X'));
 assert.equal(selected.join(',').length,111);
 assert.deepEqual(feedSymbols(selected.join(',')),selected);
 assert.equal(feedSymbols([...selected,'TLT'].join(',')),null);
});

test('seven-asset market watchlists are accepted without changing six-asset comparison limits',()=>{
 assert.equal(classify({marketData:true,symbols}).request_class,'data');
 assert.equal(classify({marketData:true,symbols:[' brk-b ','^GSPC','GC=F']}).request_class,'data');
 for(const bad of [symbols.concat('TLT'),['AAPL','BRK/B'],['AAPL','https://bad.test'],[null]])assert.throws(()=>classify({marketData:true,symbols:bad}),BetaError);
 for(const panel of ['comparison','correlation','marketComparison'])assert.throws(()=>classify({panel,symbols}),BetaError);
});

test('saving seven assets preserves their order and binds the write to the authenticated account',async t=>{
 const {writes,paths}=fixture(t);
 const response=await secureRequest(request({accountAction:'saveWatchlist',symbols:symbols.map(s=>' '+s.toLowerCase()+' '),user_id:'33333333-3333-4333-8333-333333333333'}),unused);
 assert.equal(response.status,200);assert.deepEqual((await response.json()).symbols,symbols);
 assert.equal(writes.length,1);assert.equal(writes[0].user_id,uid);assert.deepEqual(writes[0].symbols,symbols);
 const read=await secureRequest(request({accountAction:'getWatchlist'}),unused);
 assert.equal(read.status,200);assert.deepEqual((await read.json()).symbols,symbols);
 assert.ok(paths.some(path=>path.includes(`user_id=eq.${uid}`)));assert.ok(paths.every(path=>!path.includes('33333333-3333-4333-8333-333333333333')));
});

test('an eighth asset or malformed symbol cannot overwrite the saved selection',async t=>{
 const {writes}=fixture(t);
 for(const bad of [symbols.concat('TLT'),['AAPL','../secret'],['AAPL',null],['AAPL','BRK/B']]){
  const response=await secureRequest(request({accountAction:'saveWatchlist',symbols:bad}),unused);
  assert.equal(response.status,400);await response.json();
 }
 assert.equal(writes.length,0);
 const read=await secureRequest(request({accountAction:'getWatchlist'}),unused);assert.deepEqual((await read.json()).symbols,symbols);
});

test('the daily brief includes the seventh watched asset without another AI call or dropping existing selections',async t=>{
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,paths:string[]=[];
 (globalThis as any).Deno={env:{get:()=>undefined}};
 globalThis.fetch=async(input:any)=>{
  const url=String(input);paths.push(url);
  if(url.includes('/v8/finance/chart/'))return Response.json({chart:{result:[{meta:{currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp:['2026-10-20T13:30Z','2026-10-21T13:30Z'].map(s=>Date.parse(s)/1000),indicators:{quote:[{open:[99,100],high:[102,103],low:[98,99],close:[100,101],volume:[1000,1200]}],adjclose:[{adjclose:[100,101]}]}}]}});
  throw Error('Unexpected request '+url);
 };
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;});
 const selected=['AAPL','MSFT','NVDA','SPY','QQQ','URTH','BRK-B'];
 const data=await buildBrief([...selected,'TLT'],{FRED_KEY:'',FINNHUB_KEY:'',TAVILY_KEY:'',GEMINI_API_KEY:''},true,Date.parse('2026-10-22T05:00Z'));
 assert.deepEqual(data.watchlist.map(asset=>asset.symbol),selected);assert.equal(data.watchlist.at(-1)?.close,101);assert.equal(data.ai,false);
 assert.ok(paths.some(path=>path.includes('/BRK-B?')));assert.ok(paths.every(path=>!path.includes('generativelanguage')&&!path.includes('tavily')));
});

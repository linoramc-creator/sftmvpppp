import {test} from 'node:test';import assert from 'node:assert/strict';
import {createEodhdClient,eodhdSymbol,mergeEodhdPriority} from '../supabase/functions/analyze-ticker/eodhd-client.ts';
test('EODHD symbol mapping preserves listing, index, FX and share class identity and rejects executable input',()=>{
 for(const[a,b]of [['AAPL','AAPL.US'],['SAP.DE','SAP.XETRA'],['VOD.L','VOD.LSE'],['ASML.AS','ASML.AS'],['BRK-B','BRK-B.US'],['^GSPC','GSPC.INDX'],['EURUSD=X','EURUSD.FOREX'],['JPY=X','USDJPY.FOREX'],['BTC-USD','BTC-USD.CC']])assert.equal(eodhdSymbol(a),b);
 for(const s of ['https://evil.test','AAPL?api_token=x','AAPL/../../news','NQ=F','^UNKNOWN','FOO.UNKNOWN'])assert.equal(eodhdSymbol(s),null);
});
test('primary merge retains real zero, negative numbers and false without fabricating missing fields',()=>{
 assert.deepEqual(mergeEodhdPriority({a:0,b:false,c:-1,d:null,e:[],nested:{primary:2}},{a:9,b:true,c:3,d:5,e:[1],nested:{fallback:4}}),{a:0,b:false,c:-1,d:5,e:[1],nested:{primary:2,fallback:4}});
});
test('requests are coalesced and cached; credentials stay in fixed HTTPS transport and redirects are rejected',async()=>{
 const urls:URL[]=[],get=createEodhdClient({apiKey:'test-only',fetcher:async(input,init)=>{urls.push(new URL(String(input)));assert.equal(init?.redirect,'error');return Response.json({price:0});}});
 const[a,b]=await Promise.all([get('real-time/AAPL.US'),get('real-time/AAPL.US')]);assert.deepEqual(a,b);assert.equal(urls.length,1);await get('real-time/AAPL.US');assert.equal(urls.length,1);
 assert.equal(urls[0].origin,'https://eodhd.com');assert.equal(urls[0].searchParams.get('api_token'),'test-only');
 assert.equal(await get('../secret'),null);assert.equal(await get('https://evil.test'),null);assert.equal(await get('news',{api_token:'other'}),null);assert.equal(urls.length,1);
});
test('quota and entitlement failures trip bounded circuits instead of consuming repeated requests',async()=>{
 let now=Date.parse('2026-10-21T15:00Z'),calls=0;const limited=createEodhdClient({apiKey:'test-only',now:()=>now,fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'2'}});}});
 await limited('news');await limited('eod/AAPL.US');assert.equal(calls,1);now+=2001;await limited('eod/AAPL.US');assert.equal(calls,2);
 calls=0;const denied=createEodhdClient({apiKey:'test-only',fetcher:async input=>{calls++;return String(input).includes('fundamentals')?new Response('',{status:403}):Response.json([{close:1}]);}});
 await denied('v1.1/fundamentals/AAPL.US');await denied('v1.1/fundamentals/SPY.US');assert.equal(calls,1);assert.ok(await denied('eod/AAPL.US'));assert.equal(calls,2);
});

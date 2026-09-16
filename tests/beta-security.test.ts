import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BetaError,classify,readBody,secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
const post=(body:unknown)=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('all supported analysis routes are classified without a paid-work bypass',()=>{
 assert.deepEqual(classify({ticker:'AAPL'}),{request_class:'report',report_kind:'ticker',report_subject:'AAPL'});
 assert.equal(classify({etfReport:true,ticker:'SPY'}).report_kind,'etf');
 assert.equal(classify({sector:'Semiconductores'}).report_kind,'sector');
 assert.equal(classify({panel:'business',subject:'AAPL'}).request_class,'expensive');
 assert.equal(classify({panel:'bonds',subject:'',sector:false}).request_class,'data');
 for(const optionsAction of ['expiries','chain','aggregations','skew','surface','term-structure','ivhv'])assert.equal(classify({optionsAction,ticker:'AAPL',expiry:'2027-01-15'}).request_class,'data');
 for(const invalid of [{ticker:'../secrets'},{ticker:'AAPL?apikey=x'},{sector:'<script>'},{optionsAction:'unknown',ticker:'AAPL'},{optionsAction:'ivhv',ticker:'AAPL',window:1000000},{panel:'news',subject:'AAPL'.repeat(30)},{marketData:true,symbols:Array(7).fill('AAPL')}])assert.throws(()=>classify(invalid),BetaError);
});
test('body size, content type and JSON shape are enforced',async()=>{
 await assert.rejects(readBody(post({ticker:'x'.repeat(5000)})),e=>(e as BetaError).status===413);
 await assert.rejects(readBody(post({accountAction:'saveReport',payload:'x'.repeat(530000)})),e=>(e as BetaError).status===413);
 await assert.rejects(readBody(post([])),e=>(e as BetaError).status===400);
 await assert.rejects(readBody(new Request('https://example.test',{method:'POST',body:'{}'})),e=>(e as BetaError).status===415);
});
test('anonymous, foreign origin and non-POST calls never reach provider code',async()=>{
 let calls=0;const dispatch=async()=>{calls++;return new Response('wrong');};
 assert.equal((await secureRequest(post({ticker:'AAPL'}),dispatch)).status,401);
 assert.equal((await secureRequest(new Request('https://example.test',{method:'GET'}),dispatch)).status,405);
 assert.equal((await secureRequest(new Request('https://example.test',{method:'POST',headers:{Origin:'https://evil.example'}}),dispatch)).status,403);
 const cors=await secureRequest(new Request('https://example.test',{method:'OPTIONS',headers:{Origin:'https://sftmvpppp.vercel.app'}}),dispatch);
 assert.equal(cors.status,204);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),'https://sftmvpppp.vercel.app');assert.equal(calls,0);
});

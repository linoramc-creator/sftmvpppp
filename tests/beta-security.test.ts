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
 for(const invalid of [{ticker:'../secrets'},{ticker:'AAPL?apikey=x'},{sector:'<script>'},{optionsAction:'unknown',ticker:'AAPL'},{optionsAction:'ivhv',ticker:'AAPL',window:1000000},{panel:'news',subject:'AAPL'.repeat(30)},{marketData:true,symbols:Array(8).fill('AAPL')}])assert.throws(()=>classify(invalid),BetaError);
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

test('mixed operations cannot bypass expensive request budgets',()=>{
 for(const body of [{macroCalendar:true,etf:true,ticker:'SPY'},{panel:'business',subject:'AAPL',marketData:true},{accountAction:'profile',panel:'feed'},{fundamentals:true,optionsAction:'chain',ticker:'AAPL'},{panel:'correlation',symbols:['SPY','QQQ'],range:'max'}])assert.throws(()=>classify(body),BetaError);
 assert.equal(classify({panel:'institutional',subject:'AAPL'}).request_class,'expensive');
});

test('relative comparisons require exactly two distinct normalized valid assets',()=>{
 assert.deepEqual(classify({panel:'relativeComparison',symbols:['AAPL','SPY']}),{request_class:'data'});
 assert.deepEqual(classify({panel:'relativeComparison',symbols:[' ^GSPC ','qqq']}),{request_class:'data'});
 for(const symbols of [undefined,null,'AAPL,SPY',[],['AAPL'],['AAPL','SPY','QQQ'],['AAPL','AAPL'],[' aapl ','AAPL'],['AAPL',''],['AAPL',12],['AAPL','../secret'],['AAPL','SPY?api_key=x'],['AAPL','<script>']]){
  assert.throws(()=>classify({panel:'relativeComparison',symbols}),e=>e instanceof BetaError&&e.status===400);
 }
});

test('optional relative interpretation is strictly boolean and charged as expensive work',()=>{
 assert.deepEqual(classify({panel:'relativeComparison',symbols:['AAPL','SPY'],includeAi:false}),{request_class:'data'});
 assert.deepEqual(classify({panel:'relativeComparison',symbols:['AAPL','SPY'],includeAi:true}),{request_class:'expensive'});
 for(const includeAi of ['true','false',0,1,null,{},[]])assert.throws(()=>classify({panel:'relativeComparison',symbols:['AAPL','SPY'],includeAi}),e=>e instanceof BetaError&&e.status===400);
});

test('relative comparisons cannot mix account, data or provider operations to bypass budgets',()=>{
 for(const extra of [{accountAction:'profile'},{marketData:true},{macroCalendar:true},{optionsAction:'chain',ticker:'AAPL'},{fundamentals:true,ticker:'AAPL'},{risk:true,ticker:'AAPL'},{etf:true,ticker:'AAPL'},{technicals:true,ticker:'AAPL'}]){
  assert.throws(()=>classify({panel:'relativeComparison',symbols:['AAPL','SPY'],includeAi:true,...extra}),e=>e instanceof BetaError&&e.status===400);
 }
});

test('unified comparisons enforce a maximum of six and strict analysis billing before providers run',()=>{
 assert.equal(classify({panel:'marketComparison',symbols:['AAPL','MSFT','SPY','QQQ','TLT','GLD'],range:'6m'}).request_class,'data');
 assert.equal(classify({panel:'marketComparison',symbols:['AAPL','MSFT'],includeAnalysis:true}).request_class,'expensive');
 for(const body of [{symbols:['AAPL']},{symbols:['AAPL',' AAPL ']},{symbols:['AAPL','MSFT','SPY','QQQ','TLT','GLD','IEF']},{symbols:['AAPL','../secrets']},{symbols:['AAPL','MSFT'],includeAnalysis:'true'},{symbols:['AAPL','MSFT'],includeAi:true},{symbols:['AAPL','MSFT'],range:'max'},{symbols:['AAPL','MSFT'],marketData:true}])assert.throws(()=>classify({panel:'marketComparison',...body}),BetaError);
 for(const panel of ['comparison','correlation']){
  assert.equal(classify({panel,symbols:['AAPL','MSFT','SPY','QQQ','TLT','GLD']}).request_class,'data');
  assert.throws(()=>classify({panel,symbols:['AAPL','MSFT','SPY','QQQ','TLT','GLD','IEF']}),BetaError);
 }
 assert.equal(classify({panel:'marketPulse',subject:'^GSPC'}).request_class,'data');assert.throws(()=>classify({panel:'marketPulse',subject:'https://evil.test/'}),BetaError);
});

test('credit and sector activity routes keep identity and payload limits before any data lookup',()=>{
 assert.equal(classify({panel:'bondsCredit'}).request_class,'data');
 const valid={panel:'sectorActivity',subject:'Semiconductores',peers:[{symbol:'NVDA',name:'NVIDIA Corporation'},{symbol:'ASML',name:'ASML Holding N.V.'}]};
 assert.equal(classify(valid).request_class,'data');
 for(const extra of [{subject:'<script>'},{subject:'a'.repeat(81)},{peers:[]},{peers:Array(11).fill({symbol:'NVDA',name:'NVIDIA'})},{peers:[{symbol:'NVDA',name:'NVIDIA'},{symbol:' nvda ',name:'NVIDIA'}]},{peers:[{symbol:'https://evil.test/',name:'NVIDIA'}]},{peers:[{symbol:'NVDA',name:''}]},{peers:[{symbol:'NVDA',name:'x'.repeat(121)}]},{peers:[null]},{marketData:true}])assert.throws(()=>classify({...valid,...extra}),BetaError);
});

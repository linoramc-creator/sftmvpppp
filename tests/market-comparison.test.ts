import{test}from'node:test';import assert from'node:assert/strict';
import{comparisonSeries,comparisonFindings,marketComparison,type ComparisonAsset,type ComparisonPair}from'../supabase/functions/analyze-ticker/market-comparison.ts';
import{summarizeRelativeAsset,summarizeRelativeOptions,type History}from'../supabase/functions/analyze-ticker/relative-comparison.ts';
const series=(symbol:string,n=140,currency='USD'):History=>({symbol,kind:'stock',currency,dates:Array.from({length:n},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)),closes:Array.from({length:n},(_,i)=>100+i*.3+(i%3)*.2),raw:Array.from({length:n},(_,i)=>100+i*.3+(i%3)*.2),volumes:Array(n).fill(1000)});
const asset=(symbol:string,currency='USD'):ComparisonAsset=>({...summarizeRelativeAsset(symbol,series(symbol,140,currency),null,[],summarizeRelativeOptions(null)),change1d:1,return21:4,volume:1000,averageVolume20:1000,turnover:100000,monthlyActivity:[],institutionalHistory:[],window:{start:'2026-01-01',end:'2026-05-20',observations:139,totalReturn:10,volatility:20,maxDrawdown:-5},benchmark:{correlationSP500:.8,correlationWorld:.7,betaSP500:1,trackingErrorSP500:10}});
const pair=(changes:Partial<ComparisonPair>={}):ComparisonPair=>({a:'AAA',b:'BBB',start:'2026-01-01',end:'2026-05-20',observations:100,currencyAligned:true,correlation:.5,beta:1,trackingError:5,relative20:0,relative63:0,spreadZ:0,ratio:[],...changes});

test('unified chart aligns all selected assets and never starts a late benchmark at another baseline',()=>{
 const a=series('AAA'),b=series('BBB'),spy=series('SPY');b.dates.splice(10,1);b.closes.splice(10,1);b.raw.splice(10,1);b.volumes.splice(10,1);
 spy.dates=spy.dates.slice(20);spy.closes=spy.closes.slice(20);spy.raw=spy.raw.slice(20);spy.volumes=spy.volumes.slice(20);
 const result=comparisonSeries([a,b,spy],['AAA','BBB'],'1y');
 assert.equal(result.chart.length,139);assert.equal(result.window.observations,138);assert.equal(result.chart[0].AAA,0);assert.equal(result.chart[0].BBB,0);
 assert.ok(result.chart.every(r=>r.SPY===null));assert.ok(result.drawdowns.every(r=>r.SPY===null));
 assert.ok(result.matrixSamples[0][1]>=100);assert.ok(result.matrix[0][1]!>.99);
});
test('all cross-currency correlations are missing while local-currency performance remains visible',()=>{
 const result=comparisonSeries([series('AAA'),series('BBB',140,'EUR'),series('SPY')],['AAA','BBB'],'3m');
 assert.equal(result.window.currencyAligned,false);assert.equal(result.matrix[0][1],null);assert.equal(result.matrix[1][2],null);
 assert.ok(result.chart.length>60);assert.equal(typeof result.chart.at(-1)!.BBB,'number');assert.ok(result.rolling.every(r=>r.BBB===null));
});
test('short and absent series do not produce high-confidence correlations or fabricated observations',()=>{
 const result=comparisonSeries([series('AAA',12),series('BBB',12),null],['AAA','BBB'],'1m');
 assert.equal(result.window.observations,11);assert.ok(result.matrix.flat().every(v=>v===null));
 const missing=comparisonSeries([series('AAA'),null],['AAA','BBB'],'1y');assert.equal(missing.window.observations,0);assert.deepEqual(missing.chart,[]);
});
test('metric findings use percentage points, reject tied winners and compare volatility only on matching dates/currency',()=>{
 const a=asset('AAA'),b=asset('BBB');a.volatility20=10;b.volatility20=30;
 let rows=comparisonFindings([a,b],[pair({relative20:2.5})]);assert.ok(rows.some(r=>r.title.startsWith('Fortaleza')&&r.value==='2,5 pp'));assert.ok(rows.some(r=>r.title==='Menor volatilidad reciente'));
 rows=comparisonFindings([a,{...b,currency:'EUR'}],[pair({currencyAligned:false,relative20:null})]);assert.ok(!rows.some(r=>r.kind==='advantage'));
 rows=comparisonFindings([a,{...b,asOf:'2026-05-19'}],[pair()]);assert.ok(!rows.some(r=>r.kind==='advantage'));
 rows=comparisonFindings([a,{...b,volatility20:10}],[pair()]);assert.ok(!rows.some(r=>r.kind==='advantage'));
});
test('volume and options findings preserve their limits instead of inferring signed institutional flows',()=>{
 const a=asset('AAA');a.relativeVolume=2;a.options={...a.options,status:'available',atmIv:40,asOf:a.asOf,expiry:'2026-06-19'};a.volatility20=20;
 const findings=comparisonFindings([a,asset('BBB')],[pair({correlation:.95})]);
 assert.match(findings.find(f=>f.id==='activity:AAA')!.detail,/No identifica compras institucionales/);
 assert.match(findings.find(f=>f.id==='options:AAA')!.detail,/horizontes diferentes/);assert.ok(findings.some(f=>f.title==='Diversificación reducida'));
});
test('five-asset comparisons coalesce market data, keep computed figures immutable and use one optional structured generation',async t=>{
 const clock=Date.parse('2026-10-18T09:00:00Z');t.mock.method(Date,'now',()=>clock);
 const symbols=['UAAA','UBBB','UCCC','UDDD','UEEE'],queries=new Map<string,number>();let modelCalls=0,newsCalls=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.hostname==='query1.finance.yahoo.com'){
   const symbol=decodeURIComponent(url.pathname.split('/').at(-1)!);queries.set(symbol,(queries.get(symbol)??0)+1);
   const p=series(symbol,210),factor=symbols.includes(symbol)?symbols.indexOf(symbol)+1:1;
   const close=p.closes.map((v,i)=>v+factor*i*.1),timestamp=p.dates.map(d=>Date.parse(d+'T13:30:00Z')/1000);
   return Response.json({chart:{result:[{meta:{instrumentType:'EQUITY',currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp,indicators:{quote:[{close,volume:p.volumes}],adjclose:[{adjclose:close}]}}]}});
  }
  if(url.hostname==='generativelanguage.googleapis.com'){
   modelCalls++;const prompt=JSON.parse(String(init?.body)).contents[0].parts[0].text,input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
   return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({notes:input.items.slice(0,2).map((i:any)=>({id:i.id,text:'La diferencia cuantificada permite separar el comportamiento observado de una hipótesis sobre su continuidad.'})),context:[]})}]}}]});
  }
  throw Error('Unexpected external request: '+url.hostname);
 });
 const deps={summary:async(s:string)=>({quoteType:{quoteType:'EQUITY',longName:s}}),options:async()=>null,news:async()=>{newsCalls++;return[];}};
 const env={FMP_KEY:'',GEMINI_API_KEY:'unit-test-not-real'};
 const plain=await marketComparison(symbols,'6m',false,env,deps);assert.equal(plain.assets.length,5);assert.equal(plain.pairs.length,10);assert.equal(plain.matrix.length,7);
 assert.equal(modelCalls,0);assert.equal(newsCalls,0);assert.ok([...queries.values()].every(n=>n===1));
 const enhanced=await marketComparison(symbols,'6m',true,env,deps);assert.equal(enhanced.analysis.status,'ready');assert.equal(enhanced.analysis.enhanced,true);assert.ok(enhanced.analysis.items.length>0);assert.equal(modelCalls,1);assert.equal(newsCalls,1);assert.deepEqual(enhanced.chart,plain.chart);assert.deepEqual(enhanced.assets,plain.assets);assert.ok(enhanced.analysis.items.every(i=>i.value&&i.detail));
 enhanced.assets[0].price=-1;enhanced.analysis.items[0].value='fake';
 const cached=await marketComparison(symbols,'6m',false,env,deps);assert.deepEqual(cached,plain);
 const again=await marketComparison(symbols,'6m',true,env,deps);assert.equal(modelCalls,1);assert.ok(again.analysis.items.every(i=>i.value!=='fake'));assert.ok([...queries.values()].every(n=>n===1));
});

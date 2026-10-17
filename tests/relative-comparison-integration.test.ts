import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relativeComparison} from '../supabase/functions/analyze-ticker/relative-comparison.ts';

const now=Date.parse('2026-10-17T12:00:00Z');
function historyFixture(symbol:string){
 const timestamp:number[]=[];
 for(let at=Date.parse('2026-05-01T13:30:00Z');timestamp.length<80;at+=86400000){
  const weekday=new Date(at).getUTCDay();if(weekday!==0&&weekday!==6)timestamp.push(at/1000);
 }
 const closes=timestamp.map((_,i)=>100+i*(symbol==='TSTA'?1.3:.15)+(i%3)*.1);
 return {chart:{result:[{meta:{currency:'USD',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York'},timestamp,
  indicators:{quote:[{close:closes,volume:closes.map(()=>1000)}],adjclose:[{adjclose:closes}]}}]}};
}

test('default relative comparison uses no news or AI, and optional interpretation preserves shared quantities',async t=>{
 t.mock.method(Date,'now',()=>now);
 let marketCalls=0,aiCalls=0,newsCalls=0,summaryCalls=0,optionsCalls=0;
 const unexpected:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));
  if(url.hostname==='query1.finance.yahoo.com'&&url.pathname.startsWith('/v8/finance/chart/')){
   marketCalls++;return Response.json(historyFixture(decodeURIComponent(url.pathname.split('/').at(-1)!)));
  }
  if(url.hostname==='generativelanguage.googleapis.com'){
   aiCalls++;
   return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({paragraphs:[
    {text:'La fortaleza relativa del primer activo supera la del segundo durante las sesiones comunes, aunque esta ventaja histórica puede cambiar.',evidence:['f0']},
    {text:'La exposición al S&P 500 es un elemento de contexto; el volumen negociado por sí solo no identifica compras institucionales.',evidence:['factor:SPY']},
   ]})}]}}]});
  }
  unexpected.push(url.hostname+url.pathname);throw new Error('Unexpected request blocked by test');
 });
 const deps={
  summary:async(symbol:string)=>{summaryCalls++;return {quoteType:{quoteType:'EQUITY',longName:symbol}};},
  options:async()=>{optionsCalls++;return null;},
  news:async()=>{newsCalls++;return [{title:'La evolución del mercado mantiene el foco en las valoraciones',url:'https://news.example.test/market',source:'test fixture',date:'2026-10-16',excerpt:'Las valoraciones y la actividad negociada presentan diferencias entre los activos.'}];},
 };
 const env={FMP_KEY:'',GEMINI_API_KEY:'unit-test-only-not-a-real-key'};
 const plain=await relativeComparison(['TSTA','TSTB'],false,env,deps);
 assert.equal(plain.ai.status,'not-requested');assert.deepEqual(plain.news,[]);
 assert.equal(aiCalls,0);assert.equal(newsCalls,0);assert.equal(marketCalls,7);assert.equal(summaryCalls,2);assert.equal(optionsCalls,2);
 assert.equal(plain.chart.length,80);assert.equal(plain.window.observations,79);
 const original=structuredClone(plain);
 const interpreted=await relativeComparison(['TSTA','TSTB'],true,env,deps);
 assert.equal(interpreted.ai.status,'ready');assert.equal(interpreted.ai.paragraphs.length,2);
 assert.equal(aiCalls,1);assert.equal(newsCalls,1);assert.equal(marketCalls,7);assert.equal(summaryCalls,2);assert.equal(optionsCalls,2);
 assert.deepEqual(interpreted.chart,original.chart);assert.deepEqual(interpreted.metrics,original.metrics);assert.deepEqual(interpreted.assets,original.assets);
 assert.deepEqual(plain,original);
 // Consumer edits and optional additions must not contaminate the shared cache.
 interpreted.chart[0].a=999;interpreted.assets[0].name='changed by consumer';
 const again=await relativeComparison(['TSTA','TSTB'],false,env,deps);
 assert.deepEqual(again,original);assert.equal(aiCalls,1);assert.equal(newsCalls,1);
 const reused=await relativeComparison(['TSTA','TSTB'],true,env,deps);
 assert.equal(reused.ai.status,'ready');assert.equal(aiCalls,1);assert.equal(newsCalls,2);
 assert.deepEqual(reused.chart,original.chart);assert.deepEqual(reused.assets,original.assets);
 assert.deepEqual(unexpected,[]);
});

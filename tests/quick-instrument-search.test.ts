import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadQuickInstrumentSearch,quickSearchCatalogSymbol} from '../supabase/functions/analyze-ticker/quick-instrument-search.ts';
import type {InstrumentResolution,ResolvedInstrument} from '../supabase/functions/analyze-ticker/instrument-resolver.ts';
const empty=(status:InstrumentResolution['status']='not-found'):InstrumentResolution=>({query:'',status,instrument:null,candidates:[]});
const candidate=(symbol:string,name:string,type:ResolvedInstrument['type']='stock'):ResolvedInstrument=>({symbol,name,type,providerSymbol:symbol,exchange:'NMS',currency:'USD',isin:null,primary:false});
const chart=(symbol:string,instrumentType='INDEX')=>({chart:{result:[{meta:{symbol,instrumentType,longName:'Instrumento verificado',currency:'EUR',exchangeName:'MCE'}}]}});
test('known feed aliases resolve to the actual index, FX or ETF, never a guessed company',async()=>{
 for(const [q,s] of [['IBEX 35','^IBEX'],['SPX','^GSPC'],['Euro Stoxx 50','^STOXX50E'],['EUR/USD','EURUSD=X'],['USDJPY','JPY=X'],['QQQ','QQQ']])assert.equal(quickSearchCatalogSymbol(q),s);
 let reads=0;const result=await loadQuickInstrumentSearch('IBEX 35',{chart:async s=>{reads++;assert.equal(s,'^IBEX');return chart(s);},catalog:async()=>{throw Error('Must not query a report catalog for a known index.');},search:async()=>{throw Error('Must not query broad names.');}});
 assert.equal(result.status,'resolved');assert.equal(result.instrument?.symbol,'^IBEX');assert.equal(result.instrument?.type,'index');assert.equal(reads,1);
});
test('stock names and international ambiguous listings retain their verified venues',async()=>{
 const us=candidate('GOOGL','Alphabet Inc.'),german=candidate('ABEA.DE','Alphabet Inc.','stock');
 const result=await loadQuickInstrumentSearch('Alphabet',{catalog:async()=>({...empty('ambiguous'),candidates:[us,german]}),search:async()=>({quotes:[{symbol:'GOOGL',longname:'Alphabet Inc.',quoteType:'EQUITY'}]})});
 assert.equal(result.status,'ambiguous');assert.equal(result.candidates.length,2);assert.equal(result.candidates[1].symbol,'ABEA.DE');
});
test('a provider-verified literal ticker is resolved while unrelated matches cannot replace an explicit listing',async()=>{
 const us=candidate('GOOGL','Alphabet Inc.');const result=await loadQuickInstrumentSearch('GOOGL',{catalog:async()=>({...empty('resolved'),instrument:us,candidates:[us]}),search:async()=>null});assert.equal(result.instrument?.symbol,'GOOGL');
 const wrong=await loadQuickInstrumentSearch('SAP.WRONG',{catalog:async()=>empty(),search:async()=>({quotes:[{symbol:'SAP',longname:'SAP ADR',quoteType:'EQUITY'}]}),chart:async()=>chart('SAP','EQUITY')});assert.equal(wrong.status,'not-found');assert.equal(wrong.instrument,null);
});
test('uncatalogued literal futures can use real metadata without pretending to be spot oil',async()=>{
 const result=await loadQuickInstrumentSearch('CL=F',{catalog:async()=>empty(),search:async()=>null,chart:async s=>chart(s,'FUTURE')});assert.equal(result.instrument?.symbol,'CL=F');assert.equal(result.instrument?.type,'future');
});
test('an outage or a mismatched response cannot fabricate a quick-search ticker',async()=>{
 const result=await loadQuickInstrumentSearch('NEVER',{catalog:async()=>empty('unavailable'),search:async()=>null,chart:async()=>chart('DIFFERENT','EQUITY')});assert.equal(result.status,'unavailable');assert.equal(result.instrument,null);assert.equal(result.candidates.length,0);
});
test('queries cannot provide a URL, private key or injected transport path',async()=>{
 let reads=0;const catalog=async()=>{reads++;return empty();};for(const query of ['https://example.com','AAPL?key=x','<script>','api_key=abc','x'.repeat(101),'AAPL\u0000'])assert.equal((await loadQuickInstrumentSearch(query,{catalog})).status,'invalid');assert.equal(reads,0);
});

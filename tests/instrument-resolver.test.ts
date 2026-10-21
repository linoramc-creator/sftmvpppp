import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInstrument,normalizeInstrumentSearch,terminalInstrumentSymbol} from '../supabase/functions/analyze-ticker/instrument-resolver.ts';
import {eodhdSymbol,createEodhdClient} from '../supabase/functions/analyze-ticker/eodhd-client.ts';
const row=(Code:string,Exchange:string,Name:string,currency='USD',isPrimary=true)=>({Code,Exchange,Name,Currency:currency,Type:'Common Stock',isPrimary,ISIN:null});
const resolve=(query:string,rows:unknown[],options:any={})=>resolveInstrument(query,{...options,request:async()=>rows as any});

test('safe exact US symbols resolve without changing listing or prompting for foreign names',async()=>{
 for(const ticker of ['VRT','GOOGL']){const result=await resolve(ticker,[row(ticker,'US',ticker),row(ticker,'AS',ticker,'EUR')]);assert.equal(result.status,'resolved');assert.equal(result.instrument?.symbol,ticker);assert.equal(result.instrument?.providerSymbol,ticker+'.US');}
});
test('explicit Amsterdam and US shares of the same issuer never resolve to each other',async()=>{
 const rows=[row('ASML','US','ASML New York Shares'),row('ASML','AS','ASML Holding N.V.','EUR')];
 const foreign=await resolve('ASML.AS',rows),us=await resolve('ASML.US',rows);assert.equal(foreign.instrument?.symbol,'ASML.AS');assert.equal(foreign.instrument?.currency,'EUR');assert.equal(us.instrument?.symbol,'ASML');
 assert.equal((await resolve('ASML.AS',[rows[0]])).status,'not-found');
});
test('company-name ambiguity requires a choice and cannot be hidden behind the first search result',async()=>{
 const result=await resolve('Alphabet',[row('GOOG','US','Alphabet Class C'),row('GOOGL','US','Alphabet Class A')]);assert.equal(result.status,'ambiguous');assert.equal(result.instrument,null);assert.equal(result.candidates.length,2);
 const exact=await resolve('Example Group',[row('EX','US','Example Group'),row('EXTRA','US','Example Group Services')]);assert.equal(exact.status,'resolved');assert.equal(exact.instrument?.symbol,'EX');
});
test('share classes, currency direction and verified international listings are reversible',async()=>{
 assert.equal(eodhdSymbol('BRK.B'),'BRK-B.US');assert.equal(eodhdSymbol('BRK.B.US'),'BRK-B.US');assert.equal((await resolve('BRK.B',[row('BRK-B','US','Berkshire Hathaway')])).instrument?.symbol,'BRK-B');
 for(const [provider,terminal] of [['VOD.LSE','VOD.L'],['SAP.XETRA','SAP.DE'],['005930.KO','005930.KS'],['600519.SHG','600519.SS'],['GSPC.INDX','^GSPC'],['EURUSD.FOREX','EURUSD=X'],['USDJPY.FOREX','JPY=X'],['US10Y.GBOND','US10Y.GBOND']]){assert.equal(terminalInstrumentSymbol(provider),terminal);assert.equal(eodhdSymbol(terminal),provider);}
 const fx=await resolveInstrument('EUR/USD',{request:async(path,args)=>{assert.equal(path,'search/EURUSD');assert.equal(args?.exchange,'FOREX');return [{Code:'EURUSD',Exchange:'FOREX',Name:'Euro US Dollar',Type:'Currency',Currency:'USD'}] as any;}});assert.equal(fx.instrument?.symbol,'EURUSD=X');
});
test('unknown or conflicting explicit listings do not issue a broad homonym search',async()=>{
 let calls=0;for(const value of ['ASML.UNKNOWN','SAP.WRONG']){const result=await resolveInstrument(value,{request:async()=>{calls++;return [] as any;}});assert.equal(result.status,'not-found');}assert.equal(calls,0);
 const conflict=await resolveInstrument('ASML.AS',{exchange:'US',request:async()=>{calls++;return [] as any;}});assert.equal(conflict.status,'invalid');assert.equal(calls,0);
});
test('encoded company names use the pinned transport, while encoded traversal, URLs and credential injection fail closed',async()=>{
 const paths:string[]=[],request=createEodhdClient({apiKey:'test-only',fetcher:async input=>{const url=new URL(String(input));assert.equal(url.origin,'https://eodhd.com');paths.push(url.pathname);return Response.json([row('AAPL','US','Apple Inc.')]);}});
 const result=await resolveInstrument('Apple Inc.',{request});assert.equal(result.status,'resolved');assert.equal(paths[0],'/api/search/Apple%20Inc.');
 for(const invalid of ['https://evil.test','AAPL?api_token=secret','<script>','A'.repeat(101)])assert.equal((await resolveInstrument(invalid,{request})).status,'invalid');
 assert.equal(await request('search/%2e%2e%2fsecret'),null);assert.equal(await request('search/AAPL%3fapi_token=other'),null);assert.equal(paths.length,1);
});
test('type filters and metadata keep stocks, ETFs, bonds, GBX and ADRs distinct',async()=>{
 const rows=[row('VOD','LSE','Vodafone Group','GBX'),row('VOD','US','Vodafone ADR','USD'),{Code:'SPY',Exchange:'US',Name:'SPDR ETF',Type:'ETF',Currency:'USD'},{Code:'UK10Y',Exchange:'GBOND',Name:'UK 10Y',Type:'BOND',Currency:'GBP'}];
 const candidates=normalizeInstrumentSearch(rows);assert.equal(candidates[0].currency,'GBX');assert.equal(candidates[1].currency,'USD');assert.equal(candidates[3].type,'bond');
 const etf=await resolve('SPDR',rows,{type:'etf'});assert.equal(etf.instrument?.symbol,'SPY');assert.equal(etf.candidates.length,1);
});
test('provider errors and malformed rows stay unavailable rather than creating invented tickers',async()=>{
 const no=await resolveInstrument('Vertiv',{request:async()=>null});assert.equal(no.status,'unavailable');
 const broken=await resolve('Vertiv',[{Code:'VRT/../x',Exchange:'US',Name:'Bad'},row('VRT','UNKNOWN','Bad'),{Code:'VRT',Exchange:'US',Name:'<script>'}]);assert.equal(broken.status,'not-found');
});

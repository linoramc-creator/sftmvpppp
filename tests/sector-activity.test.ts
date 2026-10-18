import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSectorActivity,normalizeSectorPeers,sectorIdentityMatches,sectorActivity,type SectorActivityInput} from '../supabase/functions/analyze-ticker/sector-activity.ts';
import type {History} from '../supabase/functions/analyze-ticker/relative-comparison.ts';
const history=(symbol:string,currency='USD',n=80):History=>({symbol,kind:'stock',currency,dates:Array.from({length:n},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)),closes:Array.from({length:n},(_,i)=>50+i),raw:Array.from({length:n},(_,i)=>100+i*2),volumes:Array(n).fill(1000)});
const input=(symbol:string,name:string,currency='USD'):SectorActivityInput=>({peer:{symbol,name},profile:{quoteType:{symbol,quoteType:'EQUITY',longName:name+' Corporation'},price:{currency}},history:history(symbol,currency)});
const near=(actual:number|null,expected:number)=>assert.ok(actual!==null&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('sector candidates are normalized, bounded and deduplicated without accepting executable names',()=>{
 const peers=normalizeSectorPeers([{symbol:' aapl ',name:'Apple Inc.'},{symbol:'AAPL',name:'Duplicate'},{symbol:'../x',name:'Bad'},{symbol:'MSFT',name:'<script>'},{symbol:'005930.KS',name:'Samsung Electronics'},null]);
 assert.deepEqual(peers,[{symbol:'AAPL',name:'Apple Inc.'},{symbol:'005930.KS',name:'Samsung Electronics'}]);
 assert.equal(normalizeSectorPeers(Array.from({length:20},(_,i)=>({symbol:'A'+i,name:'Company '+i}))).length,10);
});

test('company identity supports legal names, aliases in parentheses and reported acronyms without matching unrelated firms',()=>{
 assert.equal(sectorIdentityMatches('NVIDIA (NVDA)','NVIDIA Corporation'),true);
 assert.equal(sectorIdentityMatches('Alphabet (Google)','Alphabet Inc.'),true);
 assert.equal(sectorIdentityMatches('TSMC','Taiwan Semiconductor Manufacturing Company Limited'),true);
 assert.equal(sectorIdentityMatches('AMD','Advanced Micro Devices, Inc.'),true);
 assert.equal(sectorIdentityMatches('Bank of America','Royal Bank of Canada'),false);
 assert.equal(sectorIdentityMatches('NVIDIA','Netflix, Inc.'),false);
});

test('sector activity verifies stock type, exact symbol, issuer name and currency before including data',()=>{
 const good=input('AAA','Alpha Research'),wrong=input('BBB','NVIDIA'),fund=input('CCC','Core Fund'),currency=input('DDD','Delta Mining');
 wrong.profile!.quoteType.longName='Netflix Inc.';fund.history!.kind='etf';currency.profile!.price.currency='EUR';
 const symbol=input('EEE','East Mining');symbol.profile!.quoteType.symbol='DIFFERENT';
 const data=buildSectorActivity('Un sector libre',[good,wrong,fund,currency,symbol]);
 assert.equal(data.requested,5);assert.equal(data.verified,1);assert.equal(data.excluded.length,4);assert.equal(data.groups[0].companies[0].symbol,'AAA');
});

test('traded amount uses raw close times volume, while returns use adjusted closes and prior volume excludes today',()=>{
 const a=input('AAA','Alpha Research');a.history!.volumes[79]=3000;
 const data=buildSectorActivity('Investigación',[a]),company=data.groups[0].companies[0];
 assert.equal(company.price,258);assert.equal(company.turnover,258*3000);assert.equal(company.relativeVolume,3);
 near(company.change1d,(129/128-1)*100);near(company.return20,(129/109-1)*100);
 assert.equal(data.groups[0].completeTurnover,true);assert.match(data.note,/no flujos netos ni compras institucionales/);
});

test('companies are ranked on one closed common session rather than mixing newer dates',()=>{
 const a=input('AAA','Alpha Research'),b=input('BBB','Beta Research');
 b.history!.dates.pop();b.history!.closes.pop();b.history!.raw.pop();b.history!.volumes.pop();
 a.history!.volumes[78]=2000;
 const group=buildSectorActivity('Investigación',[a,b]).groups[0];
 assert.equal(group.date,b.history!.dates.at(-1));assert.ok(group.companies.every(c=>c.date===group.date));assert.equal(group.companies[0].symbol,'AAA');
 assert.equal(group.companies[0].turnover,256*2000);
});

test('missing volume remains missing, reports partial coverage and does not create a complete aggregate',()=>{
 const a=input('AAA','Alpha Research'),b=input('BBB','Beta Research');b.history!.volumes[79]=null;
 const group=buildSectorActivity('Investigación',[a,b]).groups[0];
 assert.equal(group.volumeObserved,1);assert.equal(group.completeTurnover,false);assert.equal(group.knownTurnover,258000);
 assert.equal(group.companies.find(c=>c.symbol==='BBB')!.turnover,null);assert.equal(group.companies.find(c=>c.symbol==='BBB')!.relativeVolume,null);
 assert.equal(group.activity.at(-1)!.turnover,null);assert.equal(group.activity.at(-1)!.observed,1);assert.equal(group.activity.at(-1)!.total,2);
});

test('native currencies remain in separate groups with no invented global money total',()=>{
 const data=buildSectorActivity('Minería',[input('AAA','Alpha Mining','USD'),input('BBB','Beta Mining','EUR')]);
 assert.equal(data.groups.length,2);assert.equal('totalTurnover' in data,false);
 assert.ok(data.groups.every(g=>g.companies.every(c=>c.currency===g.currency)));
 assert.equal(data.groups.find(g=>g.currency==='USD')!.knownTurnover,258000);assert.equal(data.groups.find(g=>g.currency==='EUR')!.knownTurnover,258000);
});

test('sample and benchmark use the same dates and adjusted baseline and never compare an unconverted currency',()=>{
 const a=input('AAA','Alpha Research'),b=input('BBB','Beta Research'),spy=history('SPY');
 const group=buildSectorActivity('Investigación',[a,b],{SPY:spy}).groups[0];
 assert.equal(group.benchmark!.symbol,'SPY');assert.equal(group.chart[0].sample,0);assert.equal(group.chart[0].benchmark,0);assert.equal(group.chart.length,64);
 near(group.chart.at(-1)!.sample,(129/66-1)*100);
 const fx=buildSectorActivity('Investigación',[a],{SPY:{...spy,currency:'EUR'}}).groups[0];assert.equal(fx.benchmark,null);assert.ok(fx.chart.every(p=>p.benchmark===null));
 const late={...spy,dates:spy.dates.slice(40),closes:spy.closes.slice(40),raw:spy.raw.slice(40),volumes:spy.volumes.slice(40)};
 const incomplete=buildSectorActivity('Investigación',[a],{SPY:late}).groups[0];assert.equal(incomplete.benchmark,null);assert.ok(incomplete.chart.every(p=>p.benchmark===null));
});

test('zero volume is a real zero, while short series do not fabricate trend or volatility',()=>{
 const a=input('AAA','Alpha Research');a.history=history('AAA','USD',2);a.history.volumes[1]=0;
 const row=buildSectorActivity('Investigación',[a]).groups[0].companies[0];
 assert.equal(row.volume,0);assert.equal(row.turnover,0);assert.equal(row.relativeVolume,null);assert.equal(row.volatility20,null);assert.equal(row.aboveMa50,null);assert.equal(row.return20,null);
});

test('empty candidates need no data source or AI calls',async()=>{
 let calls=0;const result=await sectorActivity('Sector sin tabla',[],{summary:async()=>{calls++;return null;}});
 assert.equal(result.verified,0);assert.deepEqual(result.groups,[]);assert.equal(calls,0);
});

test('sector workers bound concurrent peer queries, share profile history caches and never call a model',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-18T12:00:00Z'));
 let concurrent=0,max=0,summaryCalls=0,fetchCalls=0;
 t.mock.method(globalThis,'fetch',async request=>{
  const url=new URL(String(request));assert.equal(url.hostname,'query1.finance.yahoo.com');fetchCalls++;
  const symbol=decodeURIComponent(url.pathname.split('/').at(-1)!),p=history(symbol);
  return Response.json({chart:{result:[{meta:{instrumentType:'EQUITY',currency:'USD',exchangeTimezoneName:'UTC'},timestamp:p.dates.map(d=>Date.parse(d+'T12:00:00Z')/1000),indicators:{quote:[{close:p.raw,volume:p.volumes}],adjclose:[{adjclose:p.closes}]}}]}});
 });
 const peers=Array.from({length:7},(_,i)=>({symbol:'SC'+i,name:'Sector Company '+i})),deps={summary:async(symbol:string)=>{summaryCalls++;concurrent++;max=Math.max(max,concurrent);await new Promise(r=>setTimeout(r,2));concurrent--;return {quoteType:{symbol,quoteType:'EQUITY',longName:peers.find(p=>p.symbol===symbol)!.name},price:{currency:'USD'}};}};
 const first=await sectorActivity('Sector libre de prueba',peers,deps);assert.equal(first.verified,7);assert.ok(max<=3);assert.equal(summaryCalls,7);assert.equal(fetchCalls,8);
 first.groups[0].companies[0].price=-1;
 const second=await sectorActivity('Sector libre de prueba',peers,deps);assert.equal(summaryCalls,7);assert.equal(fetchCalls,8);assert.ok(second.groups[0].companies.every(c=>c.price>0));
});

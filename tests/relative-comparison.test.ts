import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRelativeHistory, relativeFindings, relativeQuant,
  summarizeRelativeAsset, summarizeRelativeOptions as calculateOptions,
} from '../supabase/functions/analyze-ticker/relative-comparison.ts';

const epoch=(at:string)=>Date.parse(at)/1000;
const optionNow=Date.parse('2026-10-17T12:00:00Z');
const summarizeRelativeOptions=(raw:Parameters<typeof calculateOptions>[0],applicable=true)=>calculateOptions(raw,applicable,optionNow);
const near=(actual:number|null,expected:number,tolerance=1e-9)=>{
  assert.equal(typeof actual,'number');
  assert.ok(Math.abs(actual!-expected)<tolerance,`${actual} ≠ ${expected}`);
};
const fixture=(overrides:Record<string,unknown>={})=>({chart:{result:[{
  meta:{currency:'USD',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York',
    regularMarketTime:epoch('2026-10-16T19:59:00Z'),
    currentTradingPeriod:{regular:{end:epoch('2026-10-16T20:00:00Z')}}},
  timestamp:['2026-10-14T13:30:00Z','2026-10-15T13:30:00Z','2026-10-16T13:30:00Z'].map(epoch),
  indicators:{quote:[{close:[100,102,105],volume:[1000,1100,1200]}],adjclose:[{adjclose:[50,51,52.5]}]},
  ...overrides,
}]}});
const series=(symbol:string,closes:number[],currency='USD',indices=closes.map((_,i)=>i))=>({
  symbol,currency,kind:'stock' as const,
  dates:indices.map(i=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)),
  closes,raw:[...closes],volumes:closes.map(()=>100),
});
const noOptions=()=>summarizeRelativeOptions(null);

test('relative history includes the completed current session and omits the still trading session',()=>{
  const closed=normalizeRelativeHistory('A',fixture(),Date.parse('2026-10-16T21:00:00Z'))!;
  assert.deepEqual(closed.dates,['2026-10-14','2026-10-15','2026-10-16']);
  assert.deepEqual(closed.closes,[50,51,52.5]);
  assert.deepEqual(closed.raw,[100,102,105]);
  const ongoing=normalizeRelativeHistory('A',fixture(),Date.parse('2026-10-16T17:00:00Z'))!;
  assert.deepEqual(ongoing.dates,['2026-10-14','2026-10-15']);
  const stale=fixture();stale.chart.result[0].meta.regularMarketTime=epoch('2026-10-15T19:59:00Z');
  assert.deepEqual(normalizeRelativeHistory('A',stale,Date.parse('2026-10-16T21:00:00Z'))!.dates,['2026-10-14','2026-10-15']);
});

test('relative history uses the exchange date across Asian local midnight',()=>{
  const raw=fixture({
    meta:{currency:'JPY',instrumentType:'INDEX',exchangeTimezoneName:'Asia/Tokyo',
      regularMarketTime:epoch('2026-10-15T06:30:00Z'),currentTradingPeriod:{regular:{end:epoch('2026-10-16T06:30:00Z')}}},
    timestamp:['2026-10-13T15:05:00Z','2026-10-14T15:05:00Z','2026-10-15T15:05:00Z'].map(epoch),
  });
  const p=normalizeRelativeHistory('^N225',raw,Date.parse('2026-10-15T15:30:00Z'))!;
  assert.deepEqual(p.dates,['2026-10-14','2026-10-15']);
  assert.equal(p.kind,'index');assert.equal(p.currency,'JPY');
});

test('adjusted closes are mandatory and gaps are dropped without raw-price substitution',()=>{
  const missing=fixture({indicators:{quote:[{close:[100,102,105]}]}});
  assert.equal(normalizeRelativeHistory('A',missing,Date.parse('2026-10-17T12:00:00Z')),null);
  const gap=fixture({indicators:{quote:[{close:[100,102,105],volume:[null,-1,1200]}],adjclose:[{adjclose:[50,null,52.5]}]}});
  const p=normalizeRelativeHistory('A',gap,Date.parse('2026-10-17T12:00:00Z'))!;
  assert.deepEqual(p.dates,['2026-10-14','2026-10-16']);
  assert.deepEqual(p.closes,[50,52.5]);assert.deepEqual(p.raw,[100,105]);assert.deepEqual(p.volumes,[null,1200]);
});

test('ETF returns require adjusted closes while index levels may use their actual closing level',()=>{
  const etf=fixture({meta:{instrumentType:'ETF',currency:'USD',exchangeTimezoneName:'UTC'},indicators:{quote:[{close:[100,102,105]}]}});
  assert.equal(normalizeRelativeHistory('ETF',etf,Date.parse('2026-10-17T12:00:00Z')),null);
  const index=fixture({meta:{instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'UTC'},indicators:{quote:[{close:[100,102,105],volume:[9999,8888,7777]}]}});
  const p=normalizeRelativeHistory('INDEX',index,Date.parse('2026-10-17T12:00:00Z'))!;
  assert.deepEqual(p.closes,[100,102,105]);assert.deepEqual(p.volumes,[null,null,null]);
});

test('malformed history timestamps and absent close arrays fail safely',()=>{
  const invalid=fixture({timestamp:[Number.NaN,epoch('2026-10-15T13:30:00Z'),epoch('2026-10-16T13:30:00Z')]});
  assert.doesNotThrow(()=>normalizeRelativeHistory('A',invalid,Date.parse('2026-10-17T12:00:00Z')));
  assert.deepEqual(normalizeRelativeHistory('A',invalid,Date.parse('2026-10-17T12:00:00Z'))!.dates,['2026-10-15','2026-10-16']);
  const absent=fixture({indicators:{quote:[{}],adjclose:[{adjclose:[50,51,52.5]}]}});
  assert.equal(normalizeRelativeHistory('A',absent,Date.parse('2026-10-17T12:00:00Z')),null);
});

test('relative history keeps a single complete daily observation when the provider appends a quote',()=>{
  const duplicate=fixture({
    timestamp:['2026-10-14T13:30:00Z','2026-10-15T13:30:00Z','2026-10-16T13:30:00Z','2026-10-16T19:59:00Z'].map(epoch),
    indicators:{quote:[{close:[100,102,105,106],volume:[1000,1100,1200,10]}],adjclose:[{adjclose:[50,51,52.5,53]}]},
  });
  const p=normalizeRelativeHistory('A',duplicate,Date.parse('2026-10-17T12:00:00Z'))!;
  assert.equal(p.dates.length,3);assert.equal(p.closes.at(-1),52.5);assert.equal(p.volumes.at(-1),1200);
});

test('twenty-session relative strength is computed from the actual common dates',()=>{
  const ia=Array.from({length:30},(_,i)=>i),ib=Array.from({length:31},(_,i)=>i).filter(i=>i!==4&&i!==11);
  const a=series('A',ia.map(i=>100+i*i),'USD',ia),b=series('B',ib.map(i=>50+i),'USD',ib);
  const q=relativeQuant(a,b),ma=new Map(a.dates.map((d,i)=>[d,a.closes[i]])),mb=new Map(b.dates.map((d,i)=>[d,b.closes[i]]));
  const dates=a.dates.filter(d=>mb.has(d)),end=dates.at(-1)!,base=dates.at(-21)!;
  const expected=(ma.get(end)!/ma.get(base)!-mb.get(end)!/mb.get(base)!)*100;
  near(q.metrics.relative20,expected);assert.equal(q.window.end,end);assert.equal(q.window.observations,dates.length-1);
  assert.equal(q.chart[0].ratio,100);assert.equal(q.chart[0].a,0);assert.equal(q.chart[0].b,0);
  const ownA=summarizeRelativeAsset('A',a,null,[],noOptions()),ownB=summarizeRelativeAsset('B',b,null,[],noOptions());
  assert.ok(Math.abs(q.metrics.relative20!-(ownA.return20!-ownB.return20!))>1);
});

test('different currencies disable the price ratio, cross-asset statistics and winner inference',()=>{
  const a=series('A',Array.from({length:65},(_,i)=>100+i+(i%3)*2),'EUR');
  const b=series('B',Array.from({length:65},(_,i)=>50+i*.2),'USD');
  const q=relativeQuant(a,b);
  assert.equal(q.window.currencyAligned,false);assert.ok(q.chart.every(p=>p.ratio===null));
  for(const value of Object.values(q.metrics))assert.equal(value,null);
  const findings=relativeFindings([summarizeRelativeAsset('A',a,null,[],noOptions()),summarizeRelativeAsset('B',b,null,[],noOptions())],q);
  assert.ok(findings.some(f=>f.title==='Monedas diferentes'));
  assert.ok(!findings.some(f=>f.kind==='advantage'));
});

test('flat prices produce zero volatility and tracking error, with undefined ratios left null',()=>{
  const a=series('A',Array(65).fill(100)),b=series('B',Array(65).fill(50));
  const asset=summarizeRelativeAsset('A',a,null,[],noOptions()),q=relativeQuant(a,b);
  assert.equal(asset.volatility20,0);assert.equal(asset.drawdown,0);
  assert.equal(q.metrics.trackingError,0);assert.equal(q.metrics.relative20,0);assert.equal(q.metrics.relative63,0);
  assert.equal(q.metrics.correlation,null);assert.equal(q.metrics.betaAtoB,null);assert.equal(q.metrics.spreadZ,null);
  assert.ok(!relativeFindings([asset,summarizeRelativeAsset('B',b,null,[],noOptions())],q).some(f=>f.kind==='advantage'));
});

test('absent price histories never produce fabricated prices or infinite statistics',()=>{
  const q=relativeQuant(null,null),asset=summarizeRelativeAsset('MISSING',null,null,[],noOptions());
  assert.equal(q.window.observations,0);assert.equal(q.window.start,null);assert.equal(q.window.end,null);assert.deepEqual(q.chart,[]);
  for(const value of Object.values(q.metrics))assert.equal(value,null);
  for(const key of ['price','return20','return63','volatility20','drawdown','avgTurnover20','relativeVolume','upVolumeShare20'] as const)assert.equal(asset[key],null);
});

test('missing volume never becomes a zero or a fabricated institutional/fund flow',()=>{
  const p={...series('FUND',Array.from({length:30},(_,i)=>100+i)),kind:'etf' as const,volumes:Array(30).fill(null)};
  const asset=summarizeRelativeAsset('FUND',p,null,[],noOptions());
  assert.equal(asset.avgTurnover20,null);assert.equal(asset.relativeVolume,null);assert.equal(asset.upVolumeShare20,null);
  assert.equal(asset.fundFlows.status,'unavailable');assert.equal(asset.fundFlows.value,null);assert.equal(asset.fundFlows.period,null);
  assert.equal(asset.institutions.shares,null);assert.equal(asset.institutions.sharesChangePct,null);
  const huge={...p,volumes:p.volumes.map((_,i)=>i===29?1000000:100000)};
  const active=summarizeRelativeAsset('FUND',huge,null,[],noOptions());
  assert.equal(active.relativeVolume,10);assert.equal(active.upVolumeShare20,100);assert.equal(active.fundFlows.value,null);
});

test('index volume proxies do not become traded value and share declarations are not money flows',()=>{
  const p={...series('INDEX',Array.from({length:30},(_,i)=>100+i)),kind:'index' as const};
  const index=summarizeRelativeAsset('INDEX',p,null,[],noOptions());
  assert.equal(index.avgTurnover20,null);assert.equal(index.relativeVolume,null);assert.equal(index.upVolumeShare20,null);
  assert.equal(index.institutions.status,'not-applicable');
  const stock=summarizeRelativeAsset('A',{...p,kind:'stock'},null,[{period:'2026 T2',shares:120,investors:12},{period:'2026 T1',shares:100,investors:10}],noOptions());
  near(stock.institutions.sharesChangePct,20);assert.equal(stock.fundFlows.value,null);
  assert.match(stock.institutions.reason,/no equivale a dinero neto/);
});

test('future contracts are not converted to cash turnover without the actual contract multiplier',()=>{
  const p={...series('FUTURE',Array.from({length:30},(_,i)=>100+i)),kind:'future' as const};
  const asset=summarizeRelativeAsset('FUTURE',p,null,[],noOptions());
  assert.equal(asset.avgTurnover20,null);assert.equal(asset.relativeVolume,1);assert.equal(asset.upVolumeShare20,100);
  assert.equal(asset.fundFlows.value,null);assert.equal(asset.institutions.status,'not-applicable');
});

test('an ownership percentage alone is not evidence for dated quarterly institutional positions',()=>{
  const p=series('A',Array.from({length:30},(_,i)=>100+i));
  const asset=summarizeRelativeAsset('A',p,{majorHoldersBreakdown:{institutionsPercentHeld:.7}},[],noOptions());
  assert.equal(asset.institutions.status,'unavailable');assert.equal(asset.institutions.period,null);
  assert.equal(asset.institutions.previousPeriod,null);assert.equal(asset.institutions.shares,null);
  assert.equal(asset.institutions.sharesChangePct,null);assert.equal(asset.institutions.investors,null);
});

const expiry='2026-11-20',trade=epoch('2026-10-16T15:00:00Z'),expiration=epoch(`${expiry}T00:00:00Z`);
const chain=()=>({expiry,spot:100,rawCalls:[
  {strike:98,lastTradeDate:trade,expiration,volume:10,openInterest:100,impliedVolatility:.2},
  {strike:100,lastTradeDate:trade,expiration,volume:20,openInterest:200,impliedVolatility:.3},
],rawPuts:[
  {strike:102,lastTradeDate:trade,expiration,volume:5,openInterest:150,impliedVolatility:.4},
  {strike:104,lastTradeDate:trade,expiration,volume:10,openInterest:300,impliedVolatility:.5},
]});

test('options totals and ratios describe contracts from a single dated expiry',()=>{
  const result=summarizeRelativeOptions(chain());
  assert.equal(result.status,'available');assert.equal(result.expiry,expiry);assert.equal(result.asOf,'2026-10-16');
  assert.equal(result.contracts,4);assert.equal(result.callVolume,30);assert.equal(result.putVolume,15);
  near(result.putCallVolume,.5);near(result.putCallOi,1.5);near(result.atmIv,35);
  assert.deepEqual(result.volumeSample,{callVolume:30,putVolume:15,callContracts:2,putContracts:2,totalCalls:2,totalPuts:2});
  assert.match(result.reason,/No identifica comprador, vendedor, instituciones ni flujo neto/);
});

test('contracts with another expiry cannot inflate the displayed expiry totals',()=>{
  const raw=chain();raw.rawCalls.push({...raw.rawCalls[0],expiration:epoch('2026-12-18T00:00:00Z'),volume:1000,openInterest:10000});
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.contracts,4);assert.equal(result.callVolume,30);near(result.putCallOi,1.5);
});

test('a missing contract volume is unavailable instead of a partial chain total',()=>{
  const raw=chain();(raw.rawCalls[1] as Record<string,unknown>).volume=undefined;
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.callVolume,null);assert.equal(result.putCallVolume,null);assert.equal(result.putVolume,15);
  assert.equal(result.putCallOi,1.5);
  assert.deepEqual(result.volumeSample,{callVolume:10,putVolume:15,callContracts:1,putContracts:2,totalCalls:2,totalPuts:2});
});

test('undated contracts cannot silently disappear from a reported side total',()=>{
  const raw=chain();(raw.rawCalls[1] as Record<string,unknown>).lastTradeDate=undefined;
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.callVolume,null);assert.equal(result.putCallVolume,null);
  assert.deepEqual(result.volumeSample,{callVolume:10,putVolume:15,callContracts:1,putContracts:2,totalCalls:2,totalPuts:2});
});

test('different trade dates are never added as if they were current session volume',()=>{
  const raw=chain();raw.rawPuts.forEach(r=>r.lastTradeDate=epoch('2026-10-15T15:00:00Z'));
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.asOf,'2026-10-16');assert.equal(result.callVolume,30);
  assert.equal(result.putVolume,null);assert.equal(result.putCallVolume,null);
  assert.deepEqual(result.volumeSample,{callVolume:30,putVolume:null,callContracts:2,putContracts:0,totalCalls:2,totalPuts:2});
});

test('zero call volume or open interest cannot create infinite put/call ratios',()=>{
  const raw=chain();raw.rawCalls.forEach(r=>{r.volume=0;r.openInterest=0;});
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.callVolume,0);assert.equal(result.putCallVolume,null);assert.equal(result.putCallOi,null);
  assert.equal(result.volumeSample?.callVolume,0);assert.equal(result.volumeSample?.callContracts,2);
});

test('option sample distinguishes a verified zero from missing, negative or undated volume',()=>{
  const raw=chain();
  raw.rawCalls[0].volume=0;
  (raw.rawCalls[1] as Record<string,unknown>).volume=undefined;
  raw.rawPuts[0].volume=-10;
  (raw.rawPuts[1] as Record<string,unknown>).lastTradeDate=undefined;
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.callVolume,null);assert.equal(result.putVolume,null);assert.equal(result.putCallVolume,null);
  assert.deepEqual(result.volumeSample,{callVolume:0,putVolume:null,callContracts:1,putContracts:0,totalCalls:2,totalPuts:2});
});

test('option sample coverage excludes duplicate, nonstandard and other-expiry contracts',()=>{
  const raw=chain();
  raw.rawCalls.push({...raw.rawCalls[0]});
  raw.rawCalls.push({...raw.rawCalls[0],expiration:epoch('2026-12-18T00:00:00Z'),volume:10000});
  raw.rawPuts.push({...raw.rawPuts[0],strike:101,contractSize:'MINI'} as typeof raw.rawPuts[number]);
  const result=summarizeRelativeOptions(raw);
  assert.deepEqual(result.volumeSample,{callVolume:30,putVolume:15,callContracts:2,putContracts:2,totalCalls:2,totalPuts:2});
});

test('an option chain with no dated eligible rows leaves sample volumes null',()=>{
  const raw=chain();
  [...raw.rawCalls,...raw.rawPuts].forEach(row=>{(row as Record<string,unknown>).lastTradeDate=undefined;});
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.asOf,null);
  assert.deepEqual(result.volumeSample,{callVolume:null,putVolume:null,callContracts:0,putContracts:0,totalCalls:2,totalPuts:2});
});

test('duplicated or nonstandard option contracts do not double count the regular chain',()=>{
  const raw=chain();
  raw.rawCalls.push({...raw.rawCalls[0]});
  raw.rawCalls.push({...raw.rawCalls[0],strike:101,contractSize:'MINI'} as typeof raw.rawCalls[number]);
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.contracts,4);assert.equal(result.callVolume,30);near(result.putCallVolume,.5);
});

test('expired chains and future trade timestamps cannot be presented as current option activity',()=>{
  const expired=chain();expired.expiry='2026-10-16';assert.equal(summarizeRelativeOptions(expired).status,'unavailable');
  const future=chain();future.rawCalls.forEach(r=>r.lastTradeDate=epoch('2026-10-18T15:00:00Z'));
  const result=summarizeRelativeOptions(future);
  assert.equal(result.asOf,'2026-10-16');assert.equal(result.callVolume,null);assert.equal(result.putCallVolume,null);
});

test('option numeric wrappers are normalized consistently and never throw',()=>{
  const raw=chain();
  for(const row of [...raw.rawCalls,...raw.rawPuts])for(const key of ['strike','lastTradeDate','expiration','volume','openInterest','impliedVolatility']){
    const writable=row as Record<string,unknown>;writable[key]={raw:writable[key]};
  }
  assert.doesNotThrow(()=>summarizeRelativeOptions(raw));
  const result=summarizeRelativeOptions(raw);
  assert.equal(result.callVolume,30);assert.equal(result.putVolume,15);near(result.atmIv,35);
});

test('absent and inapplicable option chains leave every estimate unavailable',()=>{
  const missing=summarizeRelativeOptions(null),index=summarizeRelativeOptions(chain(),false);
  assert.equal(missing.status,'unavailable');assert.equal(index.status,'not-applicable');
  for(const result of [missing,index]){
    assert.equal(result.contracts,0);assert.equal(result.asOf,null);assert.equal(result.expiry,null);
    for(const key of ['callVolume','putVolume','putCallVolume','putCallOi','atmIv'] as const)assert.equal(result[key],null);
    assert.deepEqual(result.volumeSample,{callVolume:null,putVolume:null,callContracts:0,putContracts:0,totalCalls:0,totalPuts:0});
  }
});

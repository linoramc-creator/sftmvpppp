import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonSeries,comparisonFindings,type ComparisonAsset,type ComparisonPair} from '../supabase/functions/analyze-ticker/market-comparison.ts';
import {summarizeRelativeAsset,summarizeRelativeOptions,type History} from '../supabase/functions/analyze-ticker/relative-comparison.ts';
import {pearson} from '../supabase/functions/analyze-ticker/market-analytics.ts';

function history(symbol:string,n=100,currency='USD'):History{
 const dates=Array.from({length:n},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
 const closes=dates.map((_,i)=>100+i*.25+(i%4)*.3);
 return {symbol,currency,kind:'stock',dates,closes,raw:[...closes],volumes:dates.map(()=>1000)};
}
function remove(p:History,index:number){p.dates.splice(index,1);p.closes.splice(index,1);p.raw.splice(index,1);p.volumes.splice(index,1);}
const asset=(p:History):ComparisonAsset=>({...summarizeRelativeAsset(p.symbol,p,null,[],summarizeRelativeOptions(null)),change1d:null,return21:null,volume:null,averageVolume20:null,turnover:null,monthlyActivity:[],institutionalHistory:[],window:{start:p.dates[0],end:p.dates.at(-1)!,observations:p.dates.length-1,totalReturn:0,volatility:0,maxDrawdown:0},benchmark:{correlationSP500:null,correlationWorld:null,betaSP500:null,trackingErrorSP500:null}});
const pair=(extra:Partial<ComparisonPair>={}):ComparisonPair=>({a:'AAA',b:'BBB',start:'2026-01-01',end:'2026-04-10',observations:99,currencyAligned:true,correlation:null,beta:null,trackingError:null,relative20:0,relative63:0,spreadZ:null,ratio:[],...extra});

test('comparison range windows count returns rather than prices and use the actual intersection',()=>{
 const a=history('AAA',150),b=history('BBB',150);remove(b,135);
 const result=comparisonSeries([a,b],['AAA','BBB'],'1m');
 const expected=a.dates.slice(-22).filter(d=>b.dates.slice(-22).includes(d));
 assert.deepEqual(result.chart.map(row=>row.date),expected);
 assert.equal(result.window.observations,expected.length-1);
 assert.ok(result.window.observations<=21);assert.equal(result.chart[0].AAA,0);assert.equal(result.chart[0].BBB,0);
 for(const [range,returns] of [['1m',21],['3m',63],['6m',126],['1y',252]] as const){
  const full=comparisonSeries([history('AAA',300),history('BBB',300)],['AAA','BBB'],range);
  assert.equal(full.chart.length,returns+1);assert.equal(full.window.observations,returns);
 }
});

test('correlation samples are pairwise while the multi-asset chart uses the common intersection',()=>{
 const a=history('AAA',80),b=history('BBB',80),c=history('CCC',80);remove(b,10);remove(c,20);
 const result=comparisonSeries([a,b,c],['AAA','BBB','CCC'],'1y');
 assert.equal(result.window.observations,77);assert.equal(result.matrixSamples[0][1],78);assert.equal(result.matrixSamples[1][2],77);
 assert.equal(result.matrix[0][1],result.matrix[1][0]);assert.equal(result.matrixSamples[0][1],result.matrixSamples[1][0]);
 const ma=new Map(a.dates.map((d,i)=>[d,a.closes[i]])),mb=new Map(b.dates.map((d,i)=>[d,b.closes[i]]));
 const common=a.dates.filter(d=>mb.has(d)),pa=common.map(d=>ma.get(d)!),pb=common.map(d=>mb.get(d)!);
 const expected=pearson(pa.slice(1).map((v,i)=>v/pa[i]-1),pb.slice(1).map((v,i)=>v/pb[i]-1));
 assert.equal(result.matrix[0][1],expected);
});

test('rolling correlations use twenty completed paired returns without future observations',()=>{
 const a=history('AAA',100),b=history('BBB',100),spy=history('SPY',100);
 const before=comparisonSeries([a,b,spy],['AAA','BBB'],'6m');
 assert.ok(before.rolling.slice(0,20).every(r=>r.AAA===null));assert.equal(typeof before.rolling[20].AAA,'number');
 const changed=structuredClone(spy);changed.closes[90]*=3;
 const after=comparisonSeries([a,b,changed],['AAA','BBB'],'6m');
 assert.deepEqual(after.rolling.slice(0,90),before.rolling.slice(0,90));
 assert.notEqual(after.rolling[90].AAA,before.rolling[90].AAA);
});

test('drawdowns and rebasing start at the shared chart baseline, not an earlier unmatched peak',()=>{
 const a=history('AAA',4),b=history('BBB',4);a.closes=[200,100,90,120];a.raw=[...a.closes];
 remove(b,0);b.closes=[100,90,80];b.raw=[...b.closes];
 const result=comparisonSeries([a,b],['AAA','BBB'],'1m');
 assert.equal(result.chart[0].date,a.dates[1]);assert.equal(result.drawdowns[0].AAA,0);
 assert.ok(Math.abs(Number(result.drawdowns[1].AAA)+10)<1e-9);
 assert.equal(result.drawdowns[2].AAA,0);
 assert.ok(Math.abs(Number(result.chart[2].AAA)-20)<1e-9);
});

test('unknown or different currencies never enable cross-asset correlation or rolling inference',()=>{
 for(const currency of ['', 'EUR']){
  const result=comparisonSeries([history('AAA'),history('BBB',100,currency),history('SPY')],['AAA','BBB'],'3m');
  assert.equal(result.window.currencyAligned,false);assert.equal(result.matrix[0][1],null);assert.equal(result.matrix[1][2],null);
  assert.ok(result.rolling.every(row=>row.BBB===null));
  assert.equal(typeof result.chart.at(-1)!.BBB,'number');
 }
});

test('flat prices and insufficient samples stay unavailable rather than implying diversification',()=>{
 const a=history('AAA',100),b=history('BBB',100);a.closes.fill(100);b.closes.fill(50);
 const flat=comparisonSeries([a,b],['AAA','BBB'],'1y');assert.ok(flat.matrix.flat().every(value=>value===null));
 const short=comparisonSeries([history('AAA',20),history('BBB',20)],['AAA','BBB'],'1m');assert.equal(short.window.observations,19);assert.ok(short.matrix.flat().every(value=>value===null));
});

test('dated options and realized volatility are compared only when their observation dates match',()=>{
 const a=asset(history('AAA')),b=asset(history('BBB'));a.volatility20=15;
 a.options={...a.options,status:'available',asOf:'2026-04-09',expiry:'2026-05-15',atmIv:45};
 assert.ok(!comparisonFindings([a,b],[pair()]).some(row=>row.id==='options:AAA'));
 a.options.asOf=a.asOf;
 const finding=comparisonFindings([a,b],[pair()]).find(row=>row.id==='options:AAA');
 assert.ok(finding);assert.match(finding.detail,/horizontes diferentes/);assert.match(finding.detail,/no demuestra una oportunidad de arbitraje/);
});

test('relative-strength findings use percentage points and never rank tied or negligible differences',()=>{
 const a=asset(history('AAA')),b=asset(history('BBB'));a.volatility20=b.volatility20=15;
 for(const relative20 of [0,.001,-.001,.05,-.05])assert.ok(!comparisonFindings([a,b],[pair({relative20})]).some(row=>row.id.startsWith('strength:')));
 const rows=comparisonFindings([a,b],[pair({relative20:-2.5})]);
 const strength=rows.find(row=>row.id.startsWith('strength:'))!;assert.equal(strength.value,'2,5 pp');assert.deepEqual(strength.symbols,['BBB','AAA']);
 assert.match(strength.detail,/no una previsión/);
});

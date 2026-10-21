import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEodhdBondSeries,normalizeEodhdTreasury,normalizeEodhdRates,normalizeEodhdCmdi,dailyYieldChange,buildEodhdBondsData,eodhdBondsData,eodhdTreasury,preferEodhdTreasury,getEodhdBondSeries,treasuryDerivedSeries} from '../supabase/functions/analyze-ticker/eodhd-bonds.ts';
import type {eodhdGet} from '../supabase/functions/analyze-ticker/eodhd-client.ts';
const now=Date.parse('2026-10-21T15:00:00Z');

test('directory outages retain previously verified sovereign endpoints without inventing a French thirty-year benchmark',async()=>{
 const paths:string[]=[];
 const request=(async(path:string)=>{paths.push(path);return path.startsWith('eod/')?[{date:'2026-10-20',close:4}]:null;}) as typeof eodhdGet;
 const result=await eodhdBondsData(request,now);assert.equal(result?.sovereigns.length,4);assert.equal(paths.filter(p=>p.startsWith('eod/')).length,16);assert.ok(!paths.includes('eod/FR30Y.GBOND'));assert.ok(paths.includes('eod/FR1Y.GBOND'));
});

test('available Treasury curves supply coincident-date breakevens and term spreads without redundant legacy requests',()=>{
 const input=normalizeEodhdTreasury({data:[{date:'2026-10-20',tenor:'10Y',rate:5},{date:'2026-10-20',tenor:'2Y',rate:4}]},false,now);
 const real=normalizeEodhdTreasury({data:[{date:'2026-10-20',tenor:'10Y',rate:2.7}]},true,now);
 const rows=treasuryDerivedSeries([...input,...real]);assert.ok(Math.abs(rows.find(s=>s.id==='T10YIE')!.points[0].value-2.3)<1e-10);assert.equal(rows.find(s=>s.id==='T10Y2Y')?.unit,'pp');assert.equal(rows.find(s=>s.id==='T10Y2Y')?.points[0].value,1);
});
test('GBOND uses the actual unadjusted yield close, retains zero and negative yields, and excludes incomplete days and weekend observations',()=>{
 const data=normalizeEodhdBondSeries('DE10Y.GBOND',[{date:'2026-10-15',close:-.1,adjusted_close:99,volume:999},{date:'2026-10-16',close:0},{date:'2026-10-17',close:4},{date:'2026-10-20',close:3.42},{date:'2026-10-21',close:3.43},{date:'2026-02-30',close:5},{date:'2026-10-19',close:null}],now)!;
 assert.equal(data.unit,'%');assert.equal(data.currency,'EUR');assert.equal(data.frequency,'daily');assert.deepEqual(data.points,[{date:'2026-10-15',value:-.1},{date:'2026-10-16',value:0},{date:'2026-10-20',value:3.42}]);assert.equal((data as any).volume,undefined);
 assert.equal(normalizeEodhdBondSeries('USDSB3L1Y.GBOND',[],now),null);assert.equal(normalizeEodhdBondSeries('FR10Y.GBOND',{error:'Denied'},now),null);
});
test('official Treasury par curves preserve tenor definitions and annual percentage units',()=>{
 const payload={data:[{date:'2026-10-20',tenor:'10Y',rate:5.1},{date:'2026-10-20',tenor:'6M',rate:4.3},{date:'2026-10-21',tenor:'10Y',rate:99},{date:'2026-10-20',tenor:'1.5M',rate:9}]};
 const nominal=normalizeEodhdTreasury(payload,false,now);assert.deepEqual(nominal.map(s=>[s.id,s.points[0].value]),[['DGS6MO',4.3],['DGS10',5.1]]);
 const real=normalizeEodhdTreasury({data:[{date:'2026-10-20',tenor:'10Y',rate:2.8},{date:'2026-10-20',tenor:'6M',rate:4.3}]},true,now);assert.equal(real.length,1);assert.equal(real[0].id,'DFII10');assert.equal(real[0].points[0].value,2.8);
 const merged=preferEodhdTreasury([{...nominal[1],points:[{date:'2026-10-19',value:5.15},{date:'2026-10-20',value:5.2}]}],nominal);
 assert.deepEqual(merged.find(s=>s.id==='DGS10')?.points,[{date:'2026-10-19',value:5.15},{date:'2026-10-20',value:5.1}]);
});
test('daily changes use bounded calendar anniversaries instead of substituting sparse old values',()=>{
 const history=[{date:'2025-10-20',value:4},{date:'2026-09-18',value:4.8},{date:'2026-10-20',value:5.1}];
 assert.ok(Math.abs(dailyYieldChange(history,1)!-30)<1e-10);assert.ok(Math.abs(dailyYieldChange(history,12)!-110)<1e-10);assert.equal(dailyYieldChange(history.slice(-1),1),null);
});
test('daily sovereign curves and differentials use one definition and actual coincident dates',()=>{
 const histories=['FR','DE','UK','US'].flatMap((prefix,i)=>['2Y','5Y','10Y'].map((tenor,j)=>normalizeEodhdBondSeries(prefix+tenor+'.GBOND',[{date:'2026-10-19',close:3+i+j},{date:'2026-10-20',close:3.1+i+j}],now)!));
 const data=buildEodhdBondsData(histories);assert.equal(data.sovereigns.length,4);assert.equal(data.commonDate,'2026-10-20');
 const france=data.sovereigns.find(s=>s.code==='FR')!;assert.equal(france.frequency,'daily');assert.equal(france.definition,'benchmark');assert.deepEqual(france.tenors.map(t=>t.years),[2,5,10]);assert.equal(france.curveSnapshots[0].date,'2026-10-20');assert.ok(Math.abs(data.spreads.find(s=>s.code==='FR')!.value!+100)<1e-10);
 assert.equal(data.sovereigns.find(s=>s.code==='GB')?.currency,'GBP');assert.ok(Math.abs(france.slopes[0].points.at(-1)!.value-200)<1e-10);
 const missing=buildEodhdBondsData(histories.filter(s=>!s.id.startsWith('DE')));assert.ok(missing.spreads.every(s=>s.value===null&&s.date===null));
});
test('funding spreads remain basis points, rates remain percent, and weekly CMDI stays a bounded index',()=>{
 const funding=normalizeEodhdRates({data:[{date:'2026-10-20',code:'EFFR_SOFR',value_bps:2,rate:999}]},'funding',now);assert.equal(funding[0].unit,'pb');assert.equal(funding[0].points[0].value,2);
 const rates=normalizeEodhdRates({data:[{date:'2026-10-20',code:'SONIA',rate:3.7},{date:'2026-10-20',code:'SOFRINDEX',rate:99}]},'reference',now);assert.equal(rates.length,1);assert.equal(rates[0].currency,'GBP');assert.equal(rates[0].unit,'%');
 const cmdi=normalizeEodhdCmdi({data:[{as_of_date:'2026-09-25T00:00:00+00:00',market_cmdi:.2,ig_cmdi:0,hy_cmdi:1.2}]},now);assert.equal(cmdi.length,2);assert.equal(cmdi[0].points[0].value,.2);assert.equal(cmdi[0].frequency,'weekly');assert.equal(cmdi[1].points[0].value,0);
});
test('adapter requests only verified country symbols and bounded nonpaginated snapshots',async()=>{
 const requests:{path:string;query:any}[]=[];
 const request=(async(path:string,query:any={})=>{requests.push({path,query});if(path==='exchange-symbol-list/GBOND')return ['US','FR','DE','UK'].flatMap(prefix=>['2Y','5Y','10Y',prefix==='FR'?'1Y':'30Y'].map(tenor=>({Code:prefix+tenor,Country:({US:'USA',FR:'France',DE:'Germany',UK:'UK'} as any)[prefix],Currency:prefix==='US'?'USD':prefix==='UK'?'GBP':'EUR',Exchange:'GBOND',Type:'BOND'})));if(path.startsWith('eod/'))return [{date:'2026-10-20',close:4},{date:'2026-10-21',close:99}];return {data:[]};}) as typeof eodhdGet;
 const data=await eodhdBondsData(request,now);assert.equal(data?.sovereigns.length,4);assert.equal(requests.filter(r=>r.path.startsWith('eod/')).length,16);assert.ok(requests.every(r=>!r.path.includes('api_token')&&!('api_token'in r.query)));assert.ok(requests.filter(r=>r.path.startsWith('eod/')).every(r=>r.query.to==='2026-10-20'));assert.ok(!requests.some(r=>r.path.includes('FR30Y')));
 const count=requests.length;assert.equal(await getEodhdBondSeries('../unknown',undefined,undefined,request,now),null);assert.equal(requests.length,count);
});
test('Treasury year requests are bounded, preserve partial results, and unavailable providers do not erase existing series',async()=>{
 const calls:number[]=[];const request=(async(_path:string,query:any)=>{calls.push(query['filter[year]']);return query['filter[year]']===2026?{data:[{date:'2026-10-20',tenor:'10Y',rate:5.1}]}:null;}) as typeof eodhdGet;
 const result=await eodhdTreasury(1,false,request,now);assert.deepEqual(calls,[2026,2025]);assert.equal(result[0].points[0].value,5.1);assert.deepEqual(preferEodhdTreasury(result,[]),result);
 const unavailable=(async()=>null) as typeof eodhdGet;assert.equal(await eodhdBondsData(unavailable,now),null);
});

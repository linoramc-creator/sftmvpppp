import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildIssuerResearch} from '../supabase/functions/analyze-ticker/issuer-research.ts';import {classify} from '../supabase/functions/analyze-ticker/beta-security.ts';
const now=Date.parse('2026-10-21T15:00Z'),raw={General:{Code:'AAPL',Type:'Common Stock',Name:'Apple',CurrencyCode:'USD',UpdatedAt:'2026-10-20'},AnalystRatings:{Rating:4,TargetPrice:120,StrongBuy:2,Buy:3,Hold:0,Sell:1,StrongSell:0},Earnings:{History:{a:{reportDate:'2026-07-30',date:'2026-06-30',currency:'USD',epsActual:0,epsEstimate:1,surprisePercent:-100},b:{reportDate:'2026-11-03',date:'2026-09-30',epsActual:2,epsEstimate:1,surprisePercent:100}}}};
test('research counts real analyst classifications and excludes future earnings and currency-incompatible target comparisons',()=>{
 const q={close:100,timestamp:now/1000-1200,currency:'USD'},r=buildIssuerResearch(raw,'AAPL',q,now);
 assert.equal(r.analysts.total,6);assert.equal(r.analysts.ratings[2].count,0);assert.ok(Math.abs(r.analysts.targetDistancePct!-20)<1e-10);assert.equal(r.earnings.length,1);assert.equal(r.earnings[0].actual,0);
 assert.equal(buildIssuerResearch(raw,'AAPL',{...q,currency:'EUR'},now).analysts.targetDistancePct,null);
 assert.equal(buildIssuerResearch(raw,'AAPL',{...q,timestamp:now/1000+120},now).analysts.referencePrice,null);
 assert.equal(buildIssuerResearch(null,'AAPL',q,now).found,false);
});
test('issuer research remains authenticated, symbol bounded and charged against provider budgets',()=>{
 assert.equal(classify({panel:'issuerResearch',subject:'AAPL'}).request_class,'expensive');
 for(const subject of ['https://evil.test','AAPL;DROP',null,{},''])assert.throws(()=>classify({panel:'issuerResearch',subject}));
 assert.throws(()=>classify({panel:'issuerResearch',subject:'AAPL',accountAction:'profile'}));
});
test('published zero EPS removes the old quarterly forecast without confusing annual estimates on the same fiscal date',()=>{
 const value=structuredClone(raw) as any;value.Earnings.Trend={Quarterly:{a:{date:'2026-06-30',earningsEstimateAvg:1},b:{date:'2026-09-30',earningsEstimateAvg:2}},Annual:{a:{date:'2026-06-30',earningsEstimateAvg:4}}};
 const r=buildIssuerResearch(value,'AAPL',null,now);assert.equal(r.estimates.length,2);assert.ok(!r.estimates.some((e:any)=>e.type==='quarterly'&&e.period==='2026-06-30'));assert.ok(r.estimates.some((e:any)=>e.type==='annual'));
});

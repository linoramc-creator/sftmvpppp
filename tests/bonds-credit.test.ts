import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreditPoints,periodChange,buildBondsCredit,proxyFromPrices,closedProxyPrice,SOVEREIGN_MARKETS,type CreditSeries} from '../supabase/functions/analyze-ticker/bonds-credit.ts';
import {normalizeRelativeHistory} from '../supabase/functions/analyze-ticker/relative-comparison.ts';
import type {BondsPanel} from '../supabase/functions/analyze-ticker/panels.ts';
const base:BondsPanel={fetchedAt:'2026-10-18T10:00Z',series:[{id:'DGS10',label:'10 años',unit:'%',source:'',points:[{date:'2026-10-16',value:5}]}],etfs:[{symbol:'TLT',label:'Bonos largos',price:90,change:1,date:'2026-10-16',currency:'USD',points:[],distributionYield:null,expenseRatio:null,assets:null}]};
const series=(id:string,points:{date:string;value:number}[],scope:CreditSeries['scope']='private-funds'):CreditSeries=>({id,label:id,unit:scope==='sovereign'?'%':'miles de millones USD',source:'',frequency:scope==='sovereign'?'monthly':'quarterly',currency:'USD',scope,points});
test('official observations preserve zero and negative yields, reject missing or invalid dates, and scale USD millions exactly',()=>{
 const result=normalizeCreditPoints([{date:'2026-04-01',value:'935009'},{date:'2026-05-01',value:'0'},{date:'2026-06-01',value:'-2'},{date:'2026-07-01',value:null},{date:'2026-08-01',value:''},{date:'2026-09-01',value:'.'},{date:'2026-02-30',value:'99'},{date:'2030-01-01',value:'99'}],.001,Date.parse('2026-10-18'));
 assert.deepEqual(result,[{date:'2026-04-01',value:935.009},{date:'2026-05-01',value:0},{date:'2026-06-01',value:-.002}]);
});
test('sovereign comparison remains monthly and only uses one shared actual observation date',()=>{
 const rows=SOVEREIGN_MARKETS.map((m,i)=>series(m.id,[{date:'2026-08-01',value:3+i},...(i===2?[]:[{date:'2026-09-01',value:4+i}])],'sovereign'));
 const result=buildBondsCredit(base,rows);assert.equal(result.sovereignCommonDate,'2026-08-01');assert.equal(result.sovereigns[0].series.points.at(-1)?.date,'2026-09-01');assert.equal(result.sovereigns[3].currency,'GBP');assert.ok(result.sovereigns.every(s=>s.series.frequency==='monthly'));assert.equal(result.sovereignSpreads.find(s=>s.code==='FR')?.value,-100);
 assert.strictEqual(result.base,base);
});
test('monthly yield changes require the exact previous month instead of a previous available observation',()=>{
 assert.equal(periodChange([{date:'2026-07-01',value:3},{date:'2026-09-01',value:4}],1),null);
 assert.equal(periodChange([{date:'2026-08-01',value:3},{date:'2026-09-01',value:4}],1),100);
});
test('private valuation and liabilities ratios use identical quarter and universe, and do not turn levels into flows',()=>{
 const rows=[series('BOGZ1FL444090000Q',[{date:'2026-04-01',value:935.009}]),series('BOGZ1FL443067205Q',[{date:'2025-04-01',value:497.381},{date:'2026-04-01',value:554.107}]),series('BOGZ1LM443067215Q',[{date:'2026-04-01',value:542.617},{date:'2026-07-01',value:550}]),series('BOGZ1FL444190005Q',[{date:'2026-04-01',value:423.654}])];
 const result=buildBondsCredit(base,rows);assert.equal(result.privateValuation.points.length,1);assert.equal(result.privateValuation.points[0].date,'2026-04-01');assert.ok(Math.abs(result.privateValuation.points[0].value-(542.617/554.107-1)*100)<1e-10);assert.ok(Math.abs(result.privateLiabilities.points[0].value-423.654/935.009*100)<1e-10);assert.ok(Math.abs(result.privateGrowth.points[0].value-(554.107/497.381-1)*100)<1e-10);assert.ok(!/default|impago|flujo/i.test(result.privateValuation.label));
});
test('missing quarters and zero denominators never produce invented private ratios or annual growth',()=>{
 const result=buildBondsCredit(base,[series('BOGZ1FL443067205Q',[{date:'2026-01-01',value:0},{date:'2026-04-01',value:10}]),series('BOGZ1LM443067215Q',[{date:'2026-01-01',value:5}])]);
 assert.equal(result.privateValuation.points.length,0);assert.equal(result.privateGrowth.points.length,0);assert.equal(result.privateLiabilities.points.length,0);
});
test('listed private-credit proxies use completed adjusted sessions and retain raw price separately',()=>{
 const start=Date.parse('2026-10-15T13:30Z'),current=start+86400000,raw={chart:{result:[{meta:{instrumentType:'ETF',currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:(current+3600000)/1000,currentTradingPeriod:{regular:{end:(current+6.5*3600000)/1000}}},timestamp:[start/1000,current/1000],indicators:{quote:[{close:[12,15],volume:[100,200]}],adjclose:[{adjclose:[11.5,15]}]}}]}};
 const normalized=normalizeRelativeHistory('BIZD',raw,current+3600000);assert.equal(normalized,null);
 const older=start-86400000;raw.chart.result[0].timestamp.unshift(older/1000);raw.chart.result[0].indicators.quote[0].close.unshift(11);raw.chart.result[0].indicators.quote[0].volume.unshift(100);raw.chart.result[0].indicators.adjclose[0].adjclose.unshift(10.5);
 const price=proxyFromPrices('BIZD','BDCs cotizadas',normalizeRelativeHistory('BIZD',raw,current+3600000));assert.equal(price.returnsDate,'2026-10-15');assert.equal(price.price,12);assert.equal(price.points.at(-1)?.value,11.5);assert.equal(price.return21,null);
});
test('a Massive daily bar cannot replace a price with a still unverified current-session close',()=>{
 const proxy=proxyFromPrices('BIZD','BDCs',null);proxy.date='2026-10-15';proxy.returnsDate='2026-10-15';proxy.price=12;
 const rows=[{t:Date.parse('2026-10-16T04:00Z'),c:99},{t:Date.parse('2026-10-15T04:00Z'),c:12.1}];
 const result=closedProxyPrice(proxy,rows);assert.equal(result.price,12.1);assert.equal(result.date,'2026-10-15');assert.equal(result.returnsDate,'2026-10-15');assert.equal(closedProxyPrice({...proxy,returnsDate:null},rows).price,12);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildStockRadarCandidate,emptyStockResearchRadar,loadStockResearchRadar,normalizeStockRadarHistory,stockRadarScreenEntries,type StockRadarHistory} from '../supabase/functions/analyze-ticker/stock-research-radar.ts';

const now=Date.parse('2026-11-03T15:00:00Z');
const sectors=['Technology','Industrials','Healthcare','Energy','Consumer Defensive','Consumer Cyclical','Communication Services','Basic Materials','Utilities'];
const periods=['2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'];
function fundamentals(symbol='AAA',sector='Technology',currency='USD'):any{
 const quarterly=Object.fromEntries(periods.map((date,i)=>[date,{date,filing_date:new Date(Date.parse(date)+35*86400000).toISOString().slice(0,10),currency_symbol:currency,totalRevenue:String(100e6+i*20e6),netIncome:'20000000',grossProfit:'50000000',ebitda:'40000000'}]));
 const cash=Object.fromEntries(periods.map(date=>[date,{date,currency_symbol:currency,totalCashFromOperatingActivities:'35000000',capitalExpenditures:'-10000000',freeCashFlow:'25000000'}]));
 return {General:{Code:symbol,Type:'Common Stock',Name:'Company '+symbol,CurrencyCode:'USD',UpdatedAt:'2026-11-02',Sector:sector,CIK:String(10000+[...symbol].reduce((sum,c)=>sum+c.charCodeAt(0),0))},Highlights:{MarketCapitalization:5000000000,MostRecentQuarter:'2026-06-30',QuarterlyRevenueGrowthYOY:.5,ProfitMargin:.1},Valuation:{ForwardPE:22},Earnings:{Trend:{Quarterly:{a:{date:'2026-09-30',earningsEstimateAvg:1.1,epsTrendCurrent:1.1,epsTrend30daysAgo:1,earningsEstimateNumberOfAnalysts:5}}}},Financials:{Income_Statement:{currency_symbol:currency,quarterly},Cash_Flow:{currency_symbol:currency,quarterly:cash},Balance_Sheet:{currency_symbol:currency,quarterly:{}}}};
}
function history(symbol='AAA',rate=.001):StockRadarHistory{
 const points:StockRadarHistory['points']=[];for(let at=Date.parse('2025-10-01');at<=Date.parse('2026-11-02');at+=86400000){const date=new Date(at);if(![0,6].includes(date.getUTCDay())){const close=100*(1+rate*points.length);points.push({date:date.toISOString().slice(0,10),close,adjustedClose:close,volume:1000000});}}
 return {symbol,currency:'USD',points};
}
const screen=(code:string,sector='Technology')=>({code,sector,exchange:'US',last_day_data_date:'2026-11-02',market_capitalization:5e9,earnings_share:1.5,avgvol_200d:1e6,adjusted_close:100});
const candidate=(raw=fundamentals(),prices:StockRadarHistory|null=history(),benchmark:StockRadarHistory|null=history('XLK',.0002))=>buildStockRadarCandidate('AAA',raw,prices,benchmark,now,true);

test('radar screen accepts only liquid, profitable US stocks with recent dated observations and known nonfinancial sectors',()=>{
 const valid=screen('AAA'),mutations=[{exchange:'PA'},{last_day_data_date:'2026-11-04'},{last_day_data_date:'2026-02-30'},{last_day_data_date:'2026-09-01'},{market_capitalization:0},{market_capitalization:2e9},{earnings_share:0},{earnings_share:null},{avgvol_200d:300000},{adjusted_close:-1},{sector:'Financial Services'},{sector:'Real Estate'},{code:'../../secrets'}];
 assert.equal(stockRadarScreenEntries({data:[valid]},now).length,1);for(const patch of mutations)assert.equal(stockRadarScreenEntries({data:[{...valid,...patch}]},now).length,0,JSON.stringify(patch));
 assert.equal(stockRadarScreenEntries({data:[screen('BBB','Consumer Cyclicals')]},now)[0].sector,'Consumer Cyclical');
});

test('radar presents actual dated metrics, separates statement currencies and does not invent expected returns or institutional flows',()=>{
 const result=candidate()!;assert.ok(result);assert.equal(result.candidate.category,'Mejora de expectativas');assert.equal(result.candidate.asOf,'2026-11-02');assert.equal(result.candidate.financialDate,'2026-06-30');
 const metrics=result.candidate.metrics;assert.ok(Math.abs(metrics[0].value!-50)<1e-8);assert.ok(Math.abs(metrics[2].value!-10)<1e-8);assert.equal(metrics[2].period,'Estimación · 2026-09-30');
 const profit=metrics.find(m=>m.id.endsWith(':netIncome'))!;assert.equal(profit.value,80);assert.equal(profit.unit,'millions');assert.equal(profit.currency,'USD');assert.match(profit.period!,/2025-09-30 a 2026-06-30/);
 assert.ok(!JSON.stringify(result).includes('probability'));assert.ok(!metrics.some(m=>/institutional|target|expectedReturn/i.test(m.id)));assert.ok(result.candidate.risks.length);assert.ok(result.candidate.watchpoints.length);
 const euro=candidate(fundamentals('AAA','Technology','EUR'))!;assert.ok(euro);assert.equal(euro.candidate.metrics.find(m=>m.id.endsWith(':netIncome'))!.currency,'EUR');assert.ok(!euro.candidate.metrics.some(m=>m.id.endsWith(':fcfYield')));assert.ok(euro.candidate.risks.some(r=>r.includes('EUR')));
});

test('radar rejects wrong identity, stale records, future filings, noncommon stock, gaps, losses and unavailable cash evidence',()=>{
 const changes=[(r:any)=>r.General.Code='OTHER',(r:any)=>r.General.UpdatedAt='2026-11-04',(r:any)=>r.General.UpdatedAt='2026-01-01',(r:any)=>r.General.Type='ETF',(r:any)=>r.General.Sector='Financial Services',(r:any)=>r.Highlights.MarketCapitalization=1e9,(r:any)=>r.Financials.Income_Statement.quarterly['2026-06-30'].filing_date='2027-01-01',(r:any)=>delete r.Financials.Income_Statement.quarterly['2026-03-31'],(r:any)=>{for(const q of Object.values(r.Financials.Income_Statement.quarterly) as any[])q.netIncome='-20000000';},(r:any)=>{for(const q of Object.values(r.Financials.Cash_Flow.quarterly) as any[])q.totalCashFromOperatingActivities=null;},(r:any)=>{for(const q of Object.values(r.Financials.Cash_Flow.quarterly) as any[])q.currency_symbol='EUR';}];
 for(const change of changes){const r=fundamentals();change(r);assert.equal(candidate(r),null,change.toString());}
 const old=history();old.points=old.points.filter(p=>p.date<'2026-10-01');assert.equal(candidate(fundamentals(),old),null);const foreign=history();foreign.currency='EUR';assert.equal(candidate(fundamentals(),foreign),null);assert.equal(candidate(fundamentals(),null),null);
});

test('one weak quarter is not mislabeled as four individually profitable quarters; TTM totals and growth remain explicit',()=>{
 const r=fundamentals();r.Financials.Income_Statement.quarterly['2026-06-30'].netIncome='-1000000';const value=candidate(r)!;assert.ok(value);assert.ok(value.candidate.reasons[0].includes('acumulados'));assert.equal(value.candidate.metrics.find(m=>m.id.endsWith(':netIncome'))!.value,59);
});

test('no growth, missing prior-year quarter and lack of a confirming signal never become a forced recommendation',()=>{
 const r=fundamentals();r.Financials.Income_Statement.quarterly['2026-06-30'].totalRevenue='100000000';assert.equal(candidate(r),null);
 const missing=fundamentals();delete missing.Financials.Income_Statement.quarterly['2025-06-30'];assert.equal(candidate(missing),null);
 const noSignal=fundamentals();delete noSignal.Earnings;assert.equal(candidate(noSignal,history(),history('XLK')),null);
});

test('relative strength uses adjusted prices on six months of common sessions and never compares different final dates',()=>{
 const r=fundamentals();delete r.Earnings;const value=candidate(r)!;assert.ok(value);assert.equal(value.candidate.category,'Fortaleza relativa');const metric=value.candidate.metrics.find(m=>m.id.endsWith(':relative6m'))!;assert.equal(metric.unit,'pp');assert.ok(metric.value!>3);assert.equal(metric.date,'2026-11-02');
 const stale=history('XLK',.0002);stale.points.pop();assert.equal(candidate(r,history(),stale),null);
 const few=history('XLK',.0002);few.points=few.points.slice(-50);assert.equal(candidate(r,history(),few),null);
 const split=history();split.points.forEach((p,i)=>{p.close=i<split.points.length/2?p.adjustedClose*2:p.adjustedClose;});assert.ok(Math.abs(candidate(r,split)!.candidate.metrics.find(m=>m.id.endsWith(':relative6m'))!.value!-metric.value!)<1e-10);
});

test('daily normalization excludes unfinished and impossible bars and requires actual adjusted prices',()=>{
 const rows=['2026-11-02','2026-11-03','2026-11-04'].map(date=>({date,open:99,high:101,low:98,close:100,adjusted_close:100,volume:10}));
 assert.deepEqual(normalizeStockRadarHistory('AAA','USD',rows,now)!.points.map(p=>p.date),['2026-11-02']);
 assert.equal(normalizeStockRadarHistory('AAA','USD',[{...rows[0],adjusted_close:null}],now),null);assert.equal(normalizeStockRadarHistory('AAA','USD',[{...rows[0],high:50}],now),null);
 const afterClose=Date.parse('2026-11-03T22:00Z');assert.equal(normalizeStockRadarHistory('AAA','USD',rows,afterClose)!.points.at(-1)!.date,'2026-11-03');
});

test('fallback without screen permission derives symbols from verified holdings, verifies liquidity and excludes stale holdings',async()=>{
 const reads:string[]=[],calls:string[]=[],holdings=Object.fromEntries(Array.from({length:36},(_,i)=>['D'+i+'.US',{Code:'D'+i,Exchange:'US',Sector:sectors[i%9],Name:'Demonstration '+i,'Assets_%':10-i*.1}]));
 const response=await loadStockResearchRadar({now,request:async(path)=>{calls.push(path);return null;},fundamentals:async symbol=>{reads.push(symbol);if(symbol==='SPY')return {General:{Code:'SPY',Type:'ETF',UpdatedAt:'2026-11-02'},ETF_Data:{Holdings:holdings}};const r=fundamentals(symbol,sectors[Number(symbol.slice(1))%9]);r.General.CIK=String(100000+Number(symbol.slice(1)));return r;},history:async(symbol)=>history(symbol,symbol.startsWith('XL')?.0002:.001)});
 assert.equal(calls.filter(p=>p==='screener').length,1);assert.equal(reads.filter(s=>s==='SPY').length,1);assert.equal(reads.length,19);assert.equal(response.universe.size,36);assert.equal(response.universe.screened,18);assert.equal(response.status,'partial');assert.equal(response.candidates.length,9);assert.ok(response.candidates.every(c=>c.symbol.startsWith('D')));assert.ok(response.universe.coverage.includes('No representa todo el mercado'));
 assert.ok([...new Set(response.candidates.map(c=>c.sector))].length>=5);assert.equal(new Set(reads.filter(s=>s!=='SPY')).size,18);
 const empty=await loadStockResearchRadar({now,request:async()=>null,fundamentals:async symbol=>({General:{Code:symbol,Type:'ETF',UpdatedAt:'2025-01-01'},ETF_Data:{Holdings:holdings}}),history:async()=>{throw Error('Must not load market history without a fresh sample');}});assert.equal(empty.status,'unavailable');assert.equal(empty.candidates.length,0);
});

test('bounded screening verifies each raw payload once, coalesces references and limits fundamental concurrency to two workers',async()=>{
 let active=0,maxActive=0;const reads:string[]=[],histories:string[]=[],screenRows=Array.from({length:80},(_,i)=>screen('S'+i,sectors[i%9]));
 const result=await loadStockResearchRadar({now,request:async(path,query,options)=>{assert.equal(path,'screener');assert.equal(query?.limit,80);assert.equal(options?.cost,5);assert.deepEqual(JSON.parse(String(query?.filters)),[['exchange','=','us'],['market_capitalization','>',2e9],['earnings_share','>',0],['avgvol_200d','>',300000]]);return {data:screenRows} as any;},fundamentals:async symbol=>{reads.push(symbol);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,1));active--;const r=fundamentals(symbol,sectors[Number(symbol.slice(1))%9]);r.General.CIK=String(100000+Number(symbol.slice(1)));return r;},history:async symbol=>{histories.push(symbol);return history(symbol,symbol.startsWith('XL')?.0002:.001);}});
 assert.equal(reads.length,18);assert.equal(maxActive,2);assert.equal(histories.filter(s=>s.startsWith('XL')).length,9);assert.equal(new Set(histories).size,histories.length);assert.equal(result.status,'ready');assert.ok(result.candidates.length<=9);assert.ok(!JSON.stringify(result).includes('api_token'));assert.equal(result.horizonMonths,6);
});

test('multiple share classes cannot occupy several radar places for the same issuer',async()=>{
 const result=await loadStockResearchRadar({now,request:async()=>({data:[screen('ONE'),screen('TWO'),screen('THREE')]} as any),fundamentals:async symbol=>{const r=fundamentals(symbol);r.General.CIK='00001234';return r;},history:async symbol=>history(symbol,symbol==='XLK'?.0002:.001)});assert.equal(result.candidates.length,1);
});

test('issuer-name fallback deduplicates share classes without treating a distinct semiconductor company as the same issuer',async()=>{
 const names:Record<string,string>={GOOG:'Alphabet Inc. Class C',GOOGL:'Alphabet Inc. Class A',AMD:'Advanced Micro Devices, Inc.'};
 const result=await loadStockResearchRadar({now,request:async()=>({data:Object.keys(names).map(s=>screen(s,s==='AMD'?'Technology':'Communication Services'))} as any),fundamentals:async symbol=>{const raw=fundamentals(symbol,symbol==='AMD'?'Technology':'Communication Services');raw.General.Name=names[symbol];delete raw.General.CIK;return raw;},history:async symbol=>history(symbol,symbol.startsWith('XL')?.0002:.001)});
 assert.equal(result.candidates.length,2);assert.ok(result.candidates.some(c=>c.symbol==='AMD'));assert.equal(result.candidates.filter(c=>['GOOG','GOOGL'].includes(c.symbol)).length,1);
});

test('no eligible result is returned honestly and empty helper does not fabricate data or model output',async()=>{
 let paid=0;const value=await loadStockResearchRadar({now,request:async()=>({data:[]} as any),fundamentals:async()=>{paid++;return null;},history:async()=>{paid++;return null;}});assert.equal(value.status,'unavailable');assert.equal(value.candidates.length,0);assert.equal(paid,0);assert.equal(emptyStockResearchRadar(now,'Esperando actualización.').coverageNotes[0],'Esperando actualización.');
});

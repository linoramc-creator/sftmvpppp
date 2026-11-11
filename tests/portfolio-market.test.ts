import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePortfolioMarket,loadPortfolioMarket} from '../supabase/functions/analyze-ticker/portfolio-market.ts';
import {portfolioRegularEnd} from '../supabase/functions/analyze-ticker/portfolio-model.ts';
const now=Date.parse('2026-11-10T15:10:00Z');
function raw(symbol='AAPL',kind='EQUITY',stamps=[now-180000,now-120000,now-60000]){return {chart:{result:[{meta:{symbol,instrumentType:kind,currency:'USD',exchangeName:'NMS',exchangeTimezoneName:'America/New_York',dataGranularity:'1m',shortName:'Test instrument',regularMarketTime:(now-120000)/1000,regularMarketPrice:105},timestamp:stamps.map(t=>t/1000),indicators:{quote:[{open:stamps.map(()=>100),high:stamps.map(()=>106),low:stamps.map(()=>99),close:stamps.map(()=>105),volume:stamps.map(()=>1000)}]},events:{splits:{},dividends:{}}}]}};}
test('one-minute portfolio observations retain actual timestamps and exclude unfinished or too-recent candles',()=>{
 const value=normalizePortfolioMarket('AAPL',raw(),now)!;assert.equal(value.quote.at,now-60000);assert.equal(value.quote.price,105);assert.equal(value.quote.delaySeconds,60);assert.equal(value.quote.tradable,true);assert.equal(value.quote.bars?.length,2);assert.ok(value.quote.bars!.every(b=>b.time+60000<=now-60000&&b.regularEnd===portfolioRegularEnd(b.sessionDate)));assert.ok(!('bid'in value.quote));
});
test('only verified USD stock/ETF identities on the supported US exchanges enter the paper-trading universe',()=>{
 for(const change of [{symbol:'OTHER'},{instrumentType:'INDEX'},{currency:'EUR'},{exchangeTimezoneName:'Europe/London'},{exchangeName:'PNK'},{dataGranularity:'1d'}]){const value=raw();Object.assign(value.chart.result[0].meta,change);assert.equal(normalizePortfolioMarket('AAPL',value,now),null);}
 const missing=raw();delete (missing.chart.result[0].meta as any).symbol;assert.equal(normalizePortfolioMarket('AAPL',missing,now),null);assert.equal(normalizePortfolioMarket('SPY',raw('SPY','ETF'),now)?.quote.kind,'etf');
});

test('exchange date identifiers remain ISO when a runtime formats en-CA dates with slashes',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype,'format')!;
 try{Object.defineProperty(Intl.DateTimeFormat.prototype,'format',{configurable:true,get:()=>()=> '11/10/2026'});
  const value=normalizePortfolioMarket('AAPL',raw(),now)!;assert.equal(value.quote.bars?.length,2);assert.ok(value.quote.bars!.every(bar=>bar.sessionDate==='2026-11-10'&&Number.isFinite(bar.regularEnd)));
 }finally{Object.defineProperty(Intl.DateTimeFormat.prototype,'format',descriptor);}
});
test('pre/post observations are session-dated and cannot pretend to be regular-session executions',()=>{
 for(const [stamp,session]of [['2026-11-10T11:10Z','pre'],['2026-11-10T22:10Z','post']] as const){const clock=Date.parse(stamp),value=normalizePortfolioMarket('AAPL',raw('AAPL','EQUITY',[clock-120000]),clock)!;assert.equal(value.quote.session,session);assert.equal(value.quote.tradable,true);assert.equal(value.quote.bars?.[0].sessionDate,'2026-11-10');}
 const saturday=Date.parse('2026-11-14T15:00Z'),value=normalizePortfolioMarket('AAPL',raw('AAPL','EQUITY',[saturday-120000]),saturday)!;assert.equal(value.quote.tradable,false);assert.equal(value.quote.bars?.length,0);
});
test('bad OHLC and missing volume never become fill-eligible candles or fabricated income',()=>{
 const value=raw();value.chart.result[0].indicators.quote[0].high[0]=90;(value.chart.result[0].indicators.quote[0].volume as any[])[1]=null;(value.chart.result[0].events.dividends as any).a={date:(now-86400000)/1000,amount:1};(value.chart.result[0].events.splits as any).a={date:(now-3600000)/1000,numerator:2,denominator:1};const out=normalizePortfolioMarket('AAPL',value,now)!;assert.equal(out.quote.bars?.length,0);assert.equal(out.quote.at,now-60000);assert.deepEqual(out.actions.map(a=>a.type),['split']);
});
test('market collection coalesces duplicate symbols, always includes benchmark, and drops invalid identifiers before reads',async()=>{
 const calls:string[]=[];const loaded=await loadPortfolioMarket(['AAPL','AAPL','https://bad.test','SPY'],now,{read:async symbol=>{calls.push(symbol);return raw(symbol,symbol==='SPY'?'ETF':'EQUITY');},calendar:async()=>[]});assert.deepEqual(calls.sort(),['AAPL','SPY']);assert.equal(loaded.market.quotes.length,2);assert.equal(loaded.market.benchmark?.symbol,'SPY');
});

test('a nominal one-minute primary chart with invalid identity falls back to the verified original feed',async()=>{
 for(const change of [{currency:'EUR'},{symbol:'OTHER'},{exchangeName:'PNK'},{exchangeTimezoneName:'Europe/London'}]){
  let fallbacks=0;const loaded=await loadPortfolioMarket(['AAPL'],now,{calendar:async()=>[],primary:async url=>{const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1)!);const value=raw(symbol,symbol==='SPY'?'ETF':'EQUITY');if(symbol==='AAPL')Object.assign(value.chart.result[0].meta,change);return value;},fetcher:async input=>{fallbacks++;const symbol=decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1)!);return Response.json(raw(symbol,symbol==='SPY'?'ETF':'EQUITY'));}});
  assert.equal(loaded.market.quotes.find(q=>q.symbol==='AAPL')?.price,105);assert.equal(loaded.market.quotes.find(q=>q.symbol==='AAPL')?.currency,'USD');assert.equal(fallbacks,1);
 }
});

test('stale primary intraday observations do not suppress a newer fallback quote',async()=>{
 let fallbacks=0;const loaded=await loadPortfolioMarket(['AAPL'],now,{calendar:async()=>[],primary:async url=>{const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1)!),value=raw(symbol,symbol==='SPY'?'ETF':'EQUITY',[now-2*3600000]);value.chart.result[0].meta.regularMarketTime=(now-2*3600000)/1000;return value;},fetcher:async input=>{fallbacks++;const symbol=decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1)!);return Response.json(raw(symbol,symbol==='SPY'?'ETF':'EQUITY'));}});
 assert.equal(fallbacks,2);assert.ok(loaded.market.quotes.every(q=>q.at===now-60000&&q.tradable));
});

test('a newer genuine reference values a holding without replacing its old execution history or accepting future quotes',()=>{
 const value=raw('AAPL','EQUITY',[now-2*3600000]);value.chart.result[0].meta.regularMarketTime=(now-30000)/1000;value.chart.result[0].meta.regularMarketPrice=107;
 const out=normalizePortfolioMarket('AAPL',value,now)!;assert.equal(out.quote.at,now-30000);assert.equal(out.quote.price,107);assert.ok(out.quote.bars!.every(bar=>bar.time<=now-2*3600000));
 value.chart.result[0].meta.regularMarketTime=(now+60000)/1000;const future=normalizePortfolioMarket('AAPL',value,now)!;assert.ok(future.quote.at<=now);assert.notEqual(future.quote.price,107);
});

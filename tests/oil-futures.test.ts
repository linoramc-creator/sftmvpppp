import test from 'node:test';
import assert from 'node:assert/strict';
import {oilFutureMetadata,oilContractLabel,oilFutureRaw,OIL_REFRESH_MS} from '../supabase/functions/analyze-ticker/oil-futures.ts';
import {normalizeSavedFeedPreferences,defaultFeedPreferences} from '../supabase/functions/analyze-ticker/feed-preferences.ts';
const now=Date.parse('2026-11-16T14:00Z');
const raw=(symbol='CL=F',at=now-15*60000):any=>({chart:{result:[{meta:{symbol,instrumentType:'FUTURE',currency:'USD',regularMarketPrice:80,regularMarketTime:at/1000,shortName:'Crude Oil Dec 26',exchangeName:'NYM',currentTradingPeriod:{regular:{start:(now-3600000)/1000,end:(now+3600000)/1000}}}}]}});
test('oil is the authorized negotiated reference, with contract identity and actual observation freshness',()=>{
 assert.equal(OIL_REFRESH_MS,300000);assert.equal(oilFutureMetadata('CL=F',raw(),now),true);
 assert.match(oilContractLabel('CL=F',raw()),/CL=F.*NYMEX.*Dec 26/);
 const brent=raw('BZ=F');brent.chart.result[0].meta.shortName='Brent Crude Oil Last Day Financial Futures';assert.match(oilContractLabel('BZ=F',brent),/vencimiento no informado/);
 for(const [key,value] of [['symbol','BZ=F'],['instrumentType','EQUITY'],['currency','EUR'],['regularMarketPrice',null],['regularMarketTime',(now-3*86400000)/1000],['regularMarketTime',(now+120000)/1000]]){const r=raw();r.chart.result[0].meta[key]=value;assert.equal(oilFutureMetadata('CL=F',r,now),false);}
 const closed=raw('CL=F',now-66*3600000);closed.chart.result[0].meta.currentTradingPeriod={};assert.equal(oilFutureMetadata('CL=F',closed,now),true);
 closed.chart.result[0].meta.regularMarketTime=(now-7*86400000)/1000;assert.equal(oilFutureMetadata('CL=F',closed,now),false);
});
test('stale primary data is rejected and aliases migrate existing oil preferences without adding slots',async()=>{
 let reads=0;const result=await oilFutureRaw('CL=F',{now,read:async(symbol,accept)=>{reads++;assert.equal(accept(raw(symbol,now-86400000)),false);assert.equal(accept(raw(symbol)),true);return raw(symbol);}});assert.equal(result.chart.result[0].meta.regularMarketPrice,80);assert.equal(reads,1);
 assert.equal(await oilFutureRaw('CL=F',{now,read:async()=>raw('BZ=F')}),null);
 assert.equal(await oilFutureRaw('CL=F',{now,read:async()=>{throw Error('Provider offline');}}),null);
 const preferences=normalizeSavedFeedPreferences({...defaultFeedPreferences(),commodities:['WTI-SPOT','BRENT-SPOT','HG=F']});assert.deepEqual(preferences?.commodities,['CL=F','BZ=F','HG=F']);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {instrumentInfo,isEquityIndexFuture} from '../supabase/functions/analyze-ticker/asset-instrument.ts';
import {normalizeFeedQuote} from '../supabase/functions/analyze-ticker/feed-quotes.ts';

function quote(symbol:string,instrumentType:string,currency:string){return {chart:{result:[{meta:{symbol,instrumentType,currency,regularMarketPrice:100,regularMarketTime:Date.parse('2026-10-20T12:00:00Z')/1000},timestamp:[],indicators:{quote:[{close:[]}]}}]}};}
test('known equity-index futures and micro contracts use index points, never settlement currency',()=>{
 for(const symbol of ['ES=F','NQ=F','YM=F','RTY=F','MES=F','MNQ=F','MYM=F','M2K=F']){
  assert.equal(isEquityIndexFuture(symbol),true,symbol);assert.equal(instrumentInfo({instrumentType:'FUTURE',currency:'USD'},symbol).priceUnit,'pts',symbol);
  assert.equal(normalizeFeedQuote(symbol,symbol,quote(symbol,'FUTURE','USD')).unit,'pts',symbol);
 }
 assert.equal(isEquityIndexFuture('ES'),false);assert.equal(isEquityIndexFuture('CL=F'),false);assert.equal(isEquityIndexFuture('GC=F'),false);
});
test('metadata-confirmed indices without a caret retain index-point units in feed and detail',()=>{
 for(const type of ['INDEX','INDICES']){
  assert.equal(instrumentInfo({instrumentType:type,currency:'EUR'},'FTSEMIB.MI').priceUnit,'pts');
  assert.equal(normalizeFeedQuote('FTSEMIB.MI','FTSE MIB',quote('FTSEMIB.MI',type,'EUR')).unit,'pts');
 }
 assert.equal(normalizeFeedQuote('VWCE.DE','Vanguard',quote('VWCE.DE','ETF','EUR')).unit,undefined);
});
test('commodity futures keep quoted contract units rather than inheriting index points',()=>{
 for(const [symbol,currency,unit] of [['CL=F','USD','USD/barril'],['GC=F','USD','USD/oz t'],['HG=F','USD','USD/libra'],['ZW=F','USX','¢/bushel']]){
  assert.equal(isEquityIndexFuture(symbol),false);assert.equal(instrumentInfo({instrumentType:'FUTURE',currency},symbol).priceUnit,currency);assert.equal(normalizeFeedQuote(symbol,symbol,quote(symbol,'FUTURE',currency)).unit,unit);
 }
});

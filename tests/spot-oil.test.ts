import test from 'node:test';
import assert from 'node:assert/strict';
import {spotOil} from '../supabase/functions/analyze-ticker/spot-oil.ts';
import {createSpotOilQuotes,parseSpotOilCsv,spotOilDailyQuote} from '../supabase/functions/analyze-ticker/spot-oil-quotes.ts';
import {validateFeedAsset,feedSessionQuote} from '../supabase/functions/analyze-ticker/feed-quotes.ts';
import {defaultFeedPreferences,normalizeFeedPreferences,normalizeSavedFeedPreferences,normalizeFeedSymbol,feedSuggestions} from '../supabase/functions/analyze-ticker/feed-preferences.ts';

const now=Date.parse('2026-11-11T14:00Z');
const observations=[{date:'2026-10-30',value:'107.56'},{date:'2026-11-02',value:'100.06'},{date:'2026-11-03',value:'99.64'},{date:'2026-11-04',value:'.'},{date:'2026-11-05',value:''}];
const close=(symbol='WTI-SPOT',rows:unknown=observations,at=now)=>spotOilDailyQuote(symbol,{observations:rows},at)!;

test('official daily spot references retain units and dates instead of creating a live futures quote',()=>{
 const value=close();assert.equal(value.symbol,'WTI-SPOT');assert.equal(value.displaySymbol,'WTI');assert.equal(value.price,99.64);assert.equal(value.date,'2026-11-03');assert.equal(value.referenceDate,'2026-11-02');assert.ok(Math.abs(value.change!-(99.64/100.06-1)*100)<1e-10);
 assert.equal(value.currency,'USD');assert.equal(value.unit,'USD/barril');assert.equal(value.priceKind,'daily-close');assert.equal(value.session,'closed');assert.equal(value.at,null);assert.equal(value.delaySeconds,null);assert.equal(spotOil('CL=F'),null);assert.equal(spotOil('BZ=F'),null);assert.equal(spotOilDailyQuote('CL=F',observations,now),null);
 const brent=close('BRENT-SPOT',[{date:'2026-11-02',value:'107.39'},{date:'2026-11-03',value:'107.03'}]);assert.equal(brent.displaySymbol,'BRENT');assert.equal(brent.price,107.03);assert.ok(Math.abs(brent.change!-(107.03/107.39-1)*100)<1e-10);
});

test('missing days are not interpolated and unavailable or incompatible observations stay absent',()=>{
 const weekend=close('WTI-SPOT',[{date:'2026-11-06',value:'100'},{date:'2026-11-09',value:'.'},{date:'2026-11-10',value:'102'}]);assert.equal(weekend.referenceDate,'2026-11-06');assert.ok(Math.abs(weekend.change!-2)<1e-10);
 const single=close('WTI-SPOT',[{date:'2026-11-03',value:'99.64'}]);assert.equal(single.price,99.64);assert.equal(single.change,null);assert.equal(single.referenceDate,null);
 const historicalNegative=close('WTI-SPOT',[{date:'2026-11-02',value:'-2'},{date:'2026-11-03',value:'-1'}]);assert.equal(historicalNegative.price,-1);assert.equal(historicalNegative.change,null);
 for(const rows of [[],[{date:'2026-10-20',value:'99'}],[{date:'2026-11-12',value:'99'}],[{date:'2026-02-30',value:'99'}],[{date:'2026-11-03',value:NaN}],[{date:'2026-11-03',value:Infinity}],[{date:'2026-11-03',value:'99abc'}],[{date:'2026-11-03',value:'1e9'}],[{date:'2026-11-03',value:1e9}],[{date:'2026-11-03',value:'99'},{date:'2026-11-03',value:'100'}]])assert.equal(close('WTI-SPOT',rows).price,null);
 for(const patch of [{series_id:'DCOILBRENTEU'},{units:'pch'}])assert.equal(spotOilDailyQuote('WTI-SPOT',{observations,...patch},now)?.price,null);
 assert.equal(spotOilDailyQuote('WTI-SPOT',{chart:{result:[{meta:{regularMarketPrice:99}}]}},now)?.price,null);
 assert.equal(close('WTI-SPOT',[...observations].reverse()).price,99.64);
});

test('public official CSV requires the correct series header, bounded size and exact columns',()=>{
 const csv='observation_date,DCOILWTICO\n2026-11-02,100.06\n2026-11-03,99.64\n2026-11-04,.\n';
 assert.equal(spotOilDailyQuote('WTI-SPOT',parseSpotOilCsv('WTI-SPOT',csv),now)?.price,99.64);
 assert.ok(parseSpotOilCsv('WTI-SPOT',csv.replace('observation_date','DATE')));assert.ok(parseSpotOilCsv('WTI-SPOT','\uFEFF'+csv.replace(/\n/g,'\r\n')));
 for(const bad of [csv.replace('DCOILWTICO','DCOILBRENTEU'),csv.replace('DCOILWTICO','CL=F'),csv+'2026-11-05,99,USD',csv+'x'.repeat(50000),'<!doctype html><h1>Unavailable</h1>'])assert.equal(parseSpotOilCsv('WTI-SPOT',bad),null);
 assert.equal(parseSpotOilCsv('CL=F',csv),null);
});

test('official JSON API is preferred, concurrent reads coalesce and valid daily references cache for one hour',async()=>{
 let at=now,calls=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),urls:URL[]=[];
 const read=createSpotOilQuotes({now:()=>at,fredKey:()=> 'server-only-test-token',fetcher:async(input,init)=>{calls++;const url=new URL(String(input));urls.push(url);assert.equal(init?.redirect,'error');await gate;return Response.json({units:'lin',observations});}});
 const first=read('WTI-SPOT'),second=read('WTI-SPOT','Custom WTI');assert.equal(calls,1);release();const values=await Promise.all([first,second]);assert.equal(values[0]?.price,99.64);assert.equal(values[1]?.label,'Custom WTI');assert.equal(calls,1);
 const url=urls[0];assert.equal(url.origin,'https://api.stlouisfed.org');assert.equal(url.searchParams.get('series_id'),'DCOILWTICO');assert.equal(url.searchParams.get('units'),'lin');assert.equal(url.searchParams.get('limit'),'60');assert.equal(url.searchParams.get('observation_end'),'2026-11-11');assert.ok(!JSON.stringify(values).includes('server-only-test-token'));
 at+=3599000;assert.equal((await read('WTI-SPOT'))?.price,99.64);assert.equal(calls,1);at+=2000;await read('WTI-SPOT');assert.equal(calls,2);await read('BRENT-SPOT');assert.equal(calls,3);assert.equal(urls[2].searchParams.get('series_id'),'DCOILBRENTEU');assert.equal(await read('CL=F'),null);assert.equal(calls,3);
});

test('API failures or missing keys use only the matching official CSV and never a futures fallback',async()=>{
 for(const api of ['missing','forbidden','invalid','wrong-series','oversized']){
  const urls:URL[]=[];const read=createSpotOilQuotes({now:()=>now,fredKey:()=>api==='missing'?'':'test',fetcher:async(input)=>{
   const url=new URL(String(input));urls.push(url);
   if(url.hostname==='api.stlouisfed.org')return api==='forbidden'?new Response('denied',{status:403}):api==='oversized'?new Response('x'.repeat(50001)):api==='wrong-series'?Response.json({series_id:'DCOILBRENTEU',observations}):Response.json({observations:[]});
   assert.equal(url.hostname,'fred.stlouisfed.org');assert.equal(url.pathname,'/graph/fredgraph.csv');assert.equal(url.searchParams.get('id'),'DCOILWTICO');assert.ok(!url.searchParams.has('api_key'));return new Response('observation_date,DCOILWTICO\n2026-11-02,100.06\n2026-11-03,99.64\n');
  }});
  assert.equal((await read('WTI-SPOT'))?.price,99.64);assert.equal(urls.length,api==='missing'?1:2);
 }
});

test('unavailable spot stays empty with a short negative cache and no provider or model substitution',async()=>{
 let at=now,calls=0;const read=createSpotOilQuotes({now:()=>at,fredKey:()=>'',fetcher:async(input)=>{calls++;assert.equal(new URL(String(input)).hostname,'fred.stlouisfed.org');throw new Error('Official source unavailable');}});
 const value=await read('BRENT-SPOT');assert.equal(value?.price,null);assert.equal(value?.date,null);assert.equal(value?.symbol,'BRENT-SPOT');await read('BRENT-SPOT');assert.equal(calls,1);at+=120001;await read('BRENT-SPOT');assert.equal(calls,2);
});

test('only commodity feed selections migrate old oil future identifiers and preserve saved order without a storage rewrite',()=>{
 const defaults=defaultFeedPreferences();assert.ok(defaults.commodities.includes('WTI-SPOT'));assert.ok(defaults.commodities.includes('BRENT-SPOT'));assert.ok(!defaults.commodities.includes('CL=F'));assert.equal(defaults.commodities.length,7);
 for(const alias of ['WTI','CL','CL=F','DCOILWTICO','wti-spot'])assert.equal(normalizeFeedSymbol('commodities',alias),'WTI-SPOT');
 for(const alias of ['BRENT','BZ','BZ=F','DCOILBRENTEU','brent-spot'])assert.equal(normalizeFeedSymbol('commodities',alias),'BRENT-SPOT');
 assert.equal(normalizeFeedSymbol('indices','CL=F'),'CL=F');assert.equal(normalizeFeedSymbol('indices','BZ=F'),'BZ=F');assert.equal(normalizeFeedSymbol('etfs','WTI-SPOT'),null);assert.equal(normalizeFeedSymbol('currencies','BRENT-SPOT'),null);
 const stored={...defaults,commodities:['BZ=F','XAUUSD=X','CL=F','HG=F']},original=structuredClone(stored),expected=['BRENT-SPOT','XAUUSD=X','WTI-SPOT','HG=F'];
 assert.deepEqual(normalizeSavedFeedPreferences(stored)?.commodities,expected);assert.deepEqual(normalizeFeedPreferences(stored)?.commodities,expected);assert.deepEqual(stored,original);
 assert.deepEqual(normalizeSavedFeedPreferences({...defaults,commodities:['WTI','CL=F','BZ=F']})?.commodities,['WTI-SPOT','BRENT-SPOT']);assert.equal(normalizeFeedPreferences({...defaults,commodities:['WTI','CL=F']}),null);
 assert.deepEqual(feedSuggestions('commodities','WTI',[],7).map(([symbol])=>symbol),['WTI-SPOT']);assert.deepEqual(feedSuggestions('commodities','BZ=F',[],7).map(([symbol])=>symbol),['BRENT-SPOT']);
});

test('spot oil validation uses actual dated USD per barrel references, never chart metadata for futures',async()=>{
 let charts=0;const value=close();const deps={now,read:async()=>{charts++;throw new Error('No future chart allowed');},oil:async()=>value};
 assert.deepEqual(await validateFeedAsset('commodities','CL=F',deps),{symbol:'WTI-SPOT',label:'Petróleo WTI · Contado'});assert.equal(charts,0);
 for(const patch of [{symbol:'CL=F'},{symbol:'BRENT-SPOT'},{currency:'EUR'},{unit:'USD/galón'},{price:null},{date:'2026-11-12'},{date:'2026-10-20'}])assert.equal(await validateFeedAsset('commodities','WTI',{...deps,oil:async()=>({...value,...patch})}),null);
});

test('the feed quote pipeline routes canonical spot oil only to its official daily source',async t=>{
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,paths:string[]=[],date=new Date(Date.now()-86400000).toISOString().slice(0,10);
 (globalThis as any).Deno={env:{get:()=>''}};globalThis.fetch=async input=>{const url=new URL(String(input));paths.push(url.href);assert.equal(url.hostname,'fred.stlouisfed.org');assert.equal(url.pathname,'/graph/fredgraph.csv');return new Response(`observation_date,${url.searchParams.get('id')}\n${date},99.64\n`);};
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;});
 const value=await feedSessionQuote('WTI-SPOT','Petróleo WTI · Contado',true);assert.equal(value.price,99.64);assert.equal(value.symbol,'WTI-SPOT');assert.equal(value.date,date);assert.equal(value.at,null);assert.equal(value.priceKind,'daily-close');assert.equal(paths.length,1);
});

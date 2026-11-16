import test from 'node:test';
import assert from 'node:assert/strict';
import {spotOil} from '../supabase/functions/analyze-ticker/spot-oil.ts';
import {createSpotOilQuotes,isSpotOilDateFresh,parseSpotOilCsv,parseEiaSpotOilHistory,parseEiaSpotOilJson,spotOilDailyQuote} from '../supabase/functions/analyze-ticker/spot-oil-quotes.ts';
import {validateFeedAsset,feedSessionQuote} from '../supabase/functions/analyze-ticker/feed-quotes.ts';
import {defaultFeedPreferences,normalizeFeedPreferences,normalizeSavedFeedPreferences,normalizeFeedSymbol,feedSuggestions} from '../supabase/functions/analyze-ticker/feed-preferences.ts';

const now=Date.parse('2026-11-16T14:00Z');
const observations=[{date:'2026-11-09',value:'90.40'},{date:'2026-11-10',value:'89.62'},{date:'2026-11-11',value:'89.62'},{date:'2026-11-12',value:'.'},{date:'2026-11-13',value:''}];
const close=(symbol='WTI-SPOT',rows:unknown=observations,at=now)=>spotOilDailyQuote(symbol,{observations:rows},at)!;
const csv=(symbol='WTI-SPOT',rows=observations)=>`observation_date,${spotOil(symbol)!.series}\n${rows.map(row=>`${row.date},${row.value}`).join('\n')}\n`;
const html=(symbol='WTI-SPOT',values=['90.40','89.62','89.62','',''],week='2026 Nov- 9 to Nov-13')=>{const title=`${spotOil(symbol)!.title} (Dollars per Barrel)`;return `<html><head><title>${title}</title></head><table SUMMARY='${title}'><tr><th class='G'>Mon&nbsp;</th><th>Tue&nbsp;</th><th>Wed&nbsp;</th><th>Thu&nbsp;</th><th>Fri&nbsp;</th></tr><tr><td class='B6'>&nbsp;&nbsp;${week}</td>${values.map(value=>`<td class='B3'>${value}</td>`).join('')}</tr></table></html>`;};
const eiaJson=(symbol='WTI-SPOT',rows=observations)=>{const oil=spotOil(symbol)!;return {response:{frequency:'daily',dateFormat:'YYYY-MM-DD',data:rows.map(row=>({period:row.date,value:row.value,series:oil.eiaSeries,product:oil.eiaProduct,process:'PF4',units:'$/BBL'}))}};};

test('daily physical references retain actual dates and units rather than creating a live futures quote',()=>{
 const value=close();assert.equal(value.symbol,'WTI-SPOT');assert.equal(value.displaySymbol,'WTI');assert.equal(value.price,89.62);assert.equal(value.date,'2026-11-11');assert.equal(value.referenceDate,'2026-11-10');assert.equal(value.change,0);
 assert.equal(value.currency,'USD');assert.equal(value.unit,'USD/barril');assert.equal(value.priceKind,'daily-close');assert.equal(value.session,'closed');assert.equal(value.at,null);assert.equal(value.delaySeconds,null);assert.equal(spotOil('CL=F'),null);assert.equal(spotOil('BZ=F'),null);assert.equal(spotOilDailyQuote('CL=F',observations,now),null);
 const brent=close('BRENT-SPOT',[{date:'2026-11-10',value:'90.16'},{date:'2026-11-11',value:'92.14'}]);assert.equal(brent.displaySymbol,'BRENT');assert.equal(brent.price,92.14);assert.ok(Math.abs(brent.change!-(92.14/90.16-1)*100)<1e-10);
});

test('freshness rejects week-old prices and allows at most three business days with weekend-aware dates',()=>{
 assert.equal(isSpotOilDateFresh('2026-11-11',now),true);assert.equal(isSpotOilDateFresh('2026-11-10',now),false);assert.equal(isSpotOilDateFresh('2026-11-03',now),false);assert.equal(isSpotOilDateFresh('2026-11-17',now),false);assert.equal(isSpotOilDateFresh('2026-02-30',now),false);
 assert.equal(isSpotOilDateFresh('2026-11-13',Date.parse('2026-11-16T00:01Z')),true);assert.equal(isSpotOilDateFresh('2026-11-11',Date.parse('2026-11-17T00:01Z')),false);
 assert.equal(close('WTI-SPOT',[{date:'2026-11-03',value:'99.64'}]).price,null);
});

test('missing days are not interpolated and unavailable or incompatible observations stay absent',()=>{
 const weekend=close('WTI-SPOT',[{date:'2026-11-09',value:'100'},{date:'2026-11-10',value:'.'},{date:'2026-11-11',value:'102'}]);assert.equal(weekend.referenceDate,'2026-11-09');assert.ok(Math.abs(weekend.change!-2)<1e-10);
 const single=close('WTI-SPOT',[{date:'2026-11-11',value:'99.64'}]);assert.equal(single.price,99.64);assert.equal(single.change,null);assert.equal(single.referenceDate,null);
 const negative=close('WTI-SPOT',[{date:'2026-11-10',value:'-2'},{date:'2026-11-11',value:'-1'}]);assert.equal(negative.price,-1);assert.equal(negative.change,null);
 for(const rows of [[],[{date:'2026-10-20',value:'99'}],[{date:'2026-11-17',value:'99'}],[{date:'2026-02-30',value:'99'}],[{date:'2026-11-11',value:NaN}],[{date:'2026-11-11',value:Infinity}],[{date:'2026-11-11',value:'99abc'}],[{date:'2026-11-11',value:'1e9'}],[{date:'2026-11-11',value:1e9}],[{date:'2026-11-11',value:'99'},{date:'2026-11-11',value:'100'}]])assert.equal(close('WTI-SPOT',rows).price,null);
 for(const patch of [{series_id:'DCOILBRENTEU'},{units:'pch'}])assert.equal(spotOilDailyQuote('WTI-SPOT',{observations,...patch},now)?.price,null);
 assert.equal(spotOilDailyQuote('WTI-SPOT',{chart:{result:[{meta:{regularMarketPrice:99}}]}},now)?.price,null);assert.equal(close('WTI-SPOT',[...observations].reverse()).price,89.62);
});

test('official FRED CSV requires the correct series header, bounded size and exact columns',()=>{
 assert.equal(spotOilDailyQuote('WTI-SPOT',parseSpotOilCsv('WTI-SPOT',csv()),now)?.price,89.62);
 assert.ok(parseSpotOilCsv('WTI-SPOT',csv().replace('observation_date','DATE')));assert.ok(parseSpotOilCsv('WTI-SPOT','\uFEFF'+csv().replace(/\n/g,'\r\n')));
 for(const bad of [csv().replace('DCOILWTICO','DCOILBRENTEU'),csv().replace('DCOILWTICO','CL=F'),csv()+'2026-11-14,99,USD',csv()+'x'.repeat(50000),'<!doctype html><h1>Unavailable</h1>'])assert.equal(parseSpotOilCsv('WTI-SPOT',bad),null);
 assert.equal(parseSpotOilCsv('CL=F',csv()),null);
});

test('EIA JSON rejects other units, monthly observations, oil products and futures series',()=>{
 assert.equal(spotOilDailyQuote('WTI-SPOT',parseEiaSpotOilJson('WTI-SPOT',eiaJson()),now)?.price,89.62);
 for(const field of ['series','product','process','units']){const raw=eiaJson();(raw.response.data[0] as any)[field]='incompatible';assert.equal(parseEiaSpotOilJson('WTI-SPOT',raw),null);}
 for(const patch of [{frequency:'monthly'},{dateFormat:'YYYY-MM'},{data:Array(61).fill(eiaJson().response.data[0])}])assert.equal(parseEiaSpotOilJson('WTI-SPOT',{response:{...eiaJson().response,...patch}}),null);
 assert.equal(parseEiaSpotOilJson('BRENT-SPOT',eiaJson()),null);
});

test('official EIA public history reads weekday dates explicitly including a year boundary',()=>{
 const value=spotOilDailyQuote('WTI-SPOT',parseEiaSpotOilHistory('WTI-SPOT',html(),now),now);assert.equal(value?.price,89.62);assert.equal(value?.date,'2026-11-11');assert.equal(value?.referenceDate,'2026-11-10');
 const at=Date.parse('2027-01-04T14:00Z'),rows=parseEiaSpotOilHistory('WTI-SPOT',html('WTI-SPOT',['100','101','102','103',''],'2026 Dec-28 to Jan- 1'),at);
 assert.equal(spotOilDailyQuote('WTI-SPOT',rows,at)?.date,'2026-12-31');
 for(const bad of [html('BRENT-SPOT'),html().replace('Dollars per Barrel','Cents per Gallon'),html().replace('Nov- 9','Nov-10'),html().replace('Nov-13','Nov-14'),html().replace("<td class='B3'></td>",''),html().replace('90.40','<script>alert(1)</script>'),html()+'x'.repeat(600000)])assert.equal(parseEiaSpotOilHistory('WTI-SPOT',bad,now),null);
});

test('direct EIA and FRED public route are compared; newest date wins even when API returns an older valid quote',async()=>{
 const paths:URL[]=[];const read=createSpotOilQuotes({now:()=>now,eiaKey:()=>'',fredKey:()=> 'server-only-test-token',fetcher:async(input,init)=>{
  const url=new URL(String(input));paths.push(url);assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-cache');
  if(url.hostname==='www.eia.gov')return new Response(html());
  if(url.hostname==='api.stlouisfed.org')return Response.json({observations:[{date:'2026-11-11',value:'89.62'}]});
  assert.equal(url.hostname,'fred.stlouisfed.org');return new Response(csv('WTI-SPOT',[{date:'2026-11-11',value:'89.62'},{date:'2026-11-13',value:'91'}]));
 }});
 const value=await read('WTI-SPOT');assert.equal(value?.price,91);assert.equal(value?.date,'2026-11-13');assert.equal(value?.referenceDate,'2026-11-11');assert.equal(paths.length,3);assert.ok(!JSON.stringify(value).includes('server-only-test-token'));
 assert.equal(paths[0].pathname,'/dnav/pet/hist/RWTCD.htm');assert.equal(paths[1].searchParams.get('series_id'),'DCOILWTICO');assert.ok(paths.every(path=>!path.href.includes('DEMO_KEY')));
});

test('EIA is preferred on matching dates and stale FRED cannot prevent a newer direct observation',async()=>{
 const read=createSpotOilQuotes({now:()=>now,eiaKey:()=>'',fredKey:()=> 'test',fetcher:async input=>{const url=new URL(String(input));return url.hostname==='www.eia.gov'?new Response(html()):url.hostname==='api.stlouisfed.org'?Response.json({observations:[{date:'2026-11-03',value:'99.64'}]}):new Response(csv());}});
 assert.equal((await read('WTI-SPOT'))?.price,89.62);
});

test('EIA API uses an optional server credential and falls back to the public official page if rejected',async()=>{
 for(const success of [true,false]){
  const paths:URL[]=[];const read=createSpotOilQuotes({now:()=>now,eiaKey:()=> 'server-eia-token',fredKey:()=>'',fetcher:async input=>{
   const url=new URL(String(input));paths.push(url);
   if(url.hostname==='api.eia.gov'){assert.equal(url.searchParams.get('facets[series][]'),'RWTC');assert.equal(url.searchParams.get('frequency'),'daily');assert.equal(url.searchParams.get('length'),'60');return success?Response.json(eiaJson()):new Response('denied',{status:403});}
   if(url.hostname==='www.eia.gov')return new Response(html());return new Response(csv('WTI-SPOT',[{date:'2026-11-03',value:'99.64'}]));
  }});
  const value=await read('WTI-SPOT');assert.equal(value?.price,89.62);assert.ok(!JSON.stringify(value).includes('server-eia-token'));assert.equal(paths.some(path=>path.hostname==='www.eia.gov'),!success);
 }
});

test('concurrent requests coalesce and daily references revalidate every fifteen minutes without rollover stale cache',async()=>{
 let at=now,calls=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const read=createSpotOilQuotes({now:()=>at,eiaKey:()=>'',fredKey:()=>'',fetcher:async input=>{calls++;await gate;return new URL(String(input)).hostname==='www.eia.gov'?new Response(html()):new Response(csv());}});
 const first=read('WTI-SPOT'),second=read('WTI-SPOT','Custom WTI');assert.equal(calls,2);release();const values=await Promise.all([first,second]);assert.equal(values[0]?.price,89.62);assert.equal(values[1]?.label,'Custom WTI');assert.equal(calls,2);
 at+=899000;await read('WTI-SPOT');assert.equal(calls,2);at+=2000;await read('WTI-SPOT');assert.equal(calls,4);assert.equal(await read('CL=F'),null);assert.equal(calls,4);
});

test('unavailable or oversized official publications stay absent with a short negative cache',async()=>{
 let at=now,calls=0;const read=createSpotOilQuotes({now:()=>at,eiaKey:()=>'',fredKey:()=>'',fetcher:async input=>{calls++;const host=new URL(String(input)).hostname;assert.ok(['www.eia.gov','fred.stlouisfed.org'].includes(host));return new Response('x'.repeat(host==='www.eia.gov'?600001:50001));}});
 const value=await read('BRENT-SPOT');assert.equal(value?.price,null);assert.equal(value?.date,null);assert.equal(value?.symbol,'BRENT-SPOT');await read('BRENT-SPOT');assert.equal(calls,2);at+=120001;await read('BRENT-SPOT');assert.equal(calls,4);
});

test('crossing the business-day freshness boundary invalidates an otherwise unexpired cache',async()=>{
 let at=Date.parse('2026-11-16T23:55Z'),calls=0;
 const read=createSpotOilQuotes({now:()=>at,eiaKey:()=>'',fredKey:()=>'',fetcher:async input=>{calls++;return new URL(String(input)).hostname==='www.eia.gov'?new Response(html()):new Response(csv());}});
 assert.equal((await read('WTI-SPOT'))?.price,89.62);assert.equal(calls,2);
 at+=10*60000;assert.equal((await read('WTI-SPOT'))?.price,null);assert.equal(calls,4);
});

test('oil commodity slots migrate saved physical references to authorized traded futures without rewriting storage',()=>{
 const defaults=defaultFeedPreferences();assert.ok(defaults.commodities.includes('CL=F'));assert.ok(defaults.commodities.includes('BZ=F'));assert.equal(defaults.commodities.length,7);
 for(const alias of ['WTI','CL','CL=F','DCOILWTICO','wti-spot'])assert.equal(normalizeFeedSymbol('commodities',alias),'CL=F');
 for(const alias of ['BRENT','BZ','BZ=F','DCOILBRENTEU','brent-spot'])assert.equal(normalizeFeedSymbol('commodities',alias),'BZ=F');
 assert.equal(normalizeFeedSymbol('etfs','WTI-SPOT'),null);assert.equal(normalizeFeedSymbol('currencies','BRENT-SPOT'),null);
 const stored={...defaults,commodities:['BRENT-SPOT','XAUUSD=X','WTI-SPOT','HG=F']},original=structuredClone(stored),expected=['BZ=F','XAUUSD=X','CL=F','HG=F'];
 assert.deepEqual(normalizeSavedFeedPreferences(stored)?.commodities,expected);assert.deepEqual(stored,original);
 assert.deepEqual(normalizeSavedFeedPreferences({...defaults,commodities:['WTI','CL=F','BZ=F']})?.commodities,['CL=F','BZ=F']);assert.equal(normalizeFeedPreferences({...defaults,commodities:['WTI','CL=F']}),null);
 assert.deepEqual(feedSuggestions('commodities','WTI',[],7).map(([symbol])=>symbol),['CL=F']);
});

test('feed routes canonical oil only to official spot publications and retains their actual observation date',async t=>{
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,paths:string[]=[],date=new Date(Date.now()-86400000).toISOString().slice(0,10);
 (globalThis as any).Deno={env:{get:()=>''}};globalThis.fetch=async input=>{const url=new URL(String(input));paths.push(url.href);assert.ok(['www.eia.gov','fred.stlouisfed.org'].includes(url.hostname));return url.hostname==='www.eia.gov'?new Response('not available',{status:503}):new Response(`observation_date,${url.searchParams.get('id')}\n${date},99.64\n`);};
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;});
 const value=await feedSessionQuote('WTI-SPOT','Petróleo WTI · Contado',true);assert.equal(value.price,99.64);assert.equal(value.symbol,'WTI-SPOT');assert.equal(value.date,date);assert.equal(value.at,null);assert.equal(value.priceKind,'daily-close');assert.equal(paths.length,2);
});

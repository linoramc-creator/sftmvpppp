import {test} from 'node:test';
import assert from 'node:assert/strict';
import {massiveNews,normalizeMassiveNews,sectorMassiveNews} from '../supabase/functions/analyze-ticker/massive-news.ts';
import {feedMarketsPanel} from '../supabase/functions/analyze-ticker/panels.ts';
const row={title:'Chip company increases revenue',article_url:'https://example.com/news',published_utc:'2026-01-01T12:00:00Z',image_url:'https://example.com/photo.jpg',publisher:{name:'Publisher',logo_url:'https://example.com/logo.png'},keywords:['semiconductor'],tickers:['TEST']};
test('news preserves article photo, dates, filters unsafe and future links, deduplicates',()=>{
 const rows=normalizeMassiveNews({results:[row,row,{...row,article_url:'javascript:alert(1)'},{...row,article_url:'https://example.com/future',published_utc:'2099-01-01'}]});
 assert.equal(rows.length,1);assert.equal(rows[0].image,row.image_url);assert.equal(rows[0].date,'2026-01-01');
 assert.equal(sectorMassiveNews(rows,'semiconductores').length,1);assert.equal(sectorMassiveNews(rows,'salud').length,0);
});
test('news coalesces requests, keeps key out of URL and handles denied plans',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,init)=>{calls++;const url=new URL(String(input));assert.equal(url.pathname,'/v2/reference/news');assert.equal(url.searchParams.get('apiKey'),null);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-only');return Response.json({results:[row]});};
 try{const [a,b]=await Promise.all([massiveNews('test-only','TEST'),massiveNews('test-only','TEST')]);assert.equal(calls,1);assert.deepEqual(a,b);
 globalThis.fetch=async()=>new Response('',{status:403});assert.deepEqual(await massiveNews('test-only','DENIED'),[]);
 }finally{globalThis.fetch=original;}
});
test('market cards do not wait for news or photo providers',async()=>{
 const original=globalThis.fetch;const hosts:string[]=[];
 globalThis.fetch=async input=>{hosts.push(new URL(String(input)).hostname);return Response.json({});};
 try{const result=await feedMarketsPanel({FMP_KEY:'',FRED_KEY:'',FINNHUB_KEY:'',TAVILY_KEY:'test',MASSIVE_API_KEY:'test'});assert.equal(result.groups.length,4);assert.ok(hosts.every(host=>host.includes('yahoo.com')));assert.deepEqual(result.headlines,[]);}finally{globalThis.fetch=original;}
});

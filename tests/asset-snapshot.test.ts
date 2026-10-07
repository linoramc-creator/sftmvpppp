import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hourlyToFourHours,lastDayNews} from '../supabase/functions/analyze-ticker/asset-snapshot.ts';
import {balanceAccess,newsAccess} from '../supabase/functions/analyze-ticker/news-access.ts';
import {photoUrl,extractCover} from '../supabase/functions/analyze-ticker/news-covers.ts';
test('four-hour candles preserve OHLC and volume without crossing sessions',()=>{
 const times=['2026-09-28T13:30Z','2026-09-28T14:30Z','2026-09-28T15:30Z','2026-09-28T16:30Z','2026-09-28T17:30Z','2026-09-29T13:30Z'];
 const chart={meta:{exchangeTimezoneName:'America/New_York',instrumentType:'EQUITY'},timestamp:times.map(t=>Date.parse(t)/1000),indicators:{quote:[{open:[10,11,12,13,14,15],high:[12,13,14,15,16,17],low:[9,10,11,12,13,14],close:[11,12,13,14,15,16],volume:[1,2,3,4,5,6]}]}};
 const rows=hourlyToFourHours(chart);assert.equal(rows.length,3);assert.deepEqual(rows[0],{time:Date.parse(times[0]),open:10,high:15,low:9,close:14,volume:10,partial:false});assert.equal(rows[1].partial,true);assert.equal(rows[2].open,15);
 chart.indicators.quote[0].close[2]=99;assert.equal(hourlyToFourHours(chart)[0].partial,true);
});
test('24-hour news uses timestamps and never pads with old or undated news',()=>{
 const now=Date.parse('2026-10-07T10:00Z');const article={title:'Apple revenue growth accelerates',url:'https://www.cnbc.com/a',date:'2026-10-06',source:'CNBC',publishedAt:'2026-10-06T11:00Z'};
 const selected=lastDayNews([article,{...article,title:'Apple (AAPL): Buy, Sell, or Hold Post Q2 Earnings?',url:'https://www.cnbc.com/promo'},{...article,url:'https://www.cnbc.com/b',publishedAt:'2026-10-06T09:00Z'},{...article,url:'https://www.cnbc.com/c',publishedAt:undefined}], 'AAPL Apple',now);assert.equal(selected.length,1);
});
test('open access target preserves top paid story without inventing access guarantees',()=>{
 const articles=['https://www.ft.com/a','https://www.wsj.com/b','https://www.bloomberg.com/c','https://www.reuters.com/d','https://apnews.com/e','https://www.bbc.com/f','https://www.cnbc.com/g'].map((url,i)=>({title:`News ${i}`,url,source:'',date:'2026-10-07'}));
 const balanced=balanceAccess(articles,4);assert.equal(balanced[0].url,articles[0].url);assert.equal(balanced.filter(a=>a.access==='likely-open').length,2);assert.equal(newsAccess('https://www.cnbc.com/pro/a'),'subscription');assert.equal(newsAccess('https://unknown.example/a'),'unknown');
});
test('wrapped logos and generic article thumbnails are rejected',()=>{
 for(const url of ['https://example.com/default53.jpg','https://example.com/images/logos/company.png','https://example.com/photo?url=https%3A%2F%2Fcdn.test%2Fcompany-logo.jpg','https://example.com/avatar123.jpg'])assert.equal(photoUrl(url),undefined);
 assert.ok(photoUrl('https://www.reuters.com/resizer/markets-photo.jpg'));
 assert.equal(extractCover('<meta property="og:image:alt" content="Company logo"><meta property="og:image" content="https://example.com/photo.jpg">','https://example.com'),undefined);
});

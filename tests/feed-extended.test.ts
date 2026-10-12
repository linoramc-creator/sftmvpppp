import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geopoliticalNews} from '../supabase/functions/analyze-ticker/geopolitical-news.ts';
import {normalizeExtended} from '../supabase/functions/analyze-ticker/extended-hours.ts';
const now=Date.parse('2026-10-12T17:00Z');
test('geopolitical feed requires recent conflict or policy decisions with market impact',()=>{
 const base={date:'2026-10-12',publishedAt:'2026-10-12T16:00Z',source:'test',url:'https://apnews.com/a'};
 const rows=[{...base,title:'Oil rises after missile attacks disrupt shipping in the Red Sea'},{...base,title:'President announces new chip export restrictions to China'},{...base,title:'Stock market rallies after earnings beat'},{...base,title:'War anniversary: history of oil markets'},{...base,title:'Ukraine ceasefire eases gas supply fears',publishedAt:'2026-10-10T16:00Z'},{...base,title:'Local president opens school',excerpt:'Government congratulates students'},{...base,title:'Russia oil company stocks rise after earnings'},{...base,title:'Streaming war sends entertainment stocks lower'}];
 assert.equal(geopoliticalNews(rows,now).length,2);
});
test('extended quotes preserve their session date and reject invalid or stale data',()=>{
 const data=normalizeExtended('AAPL',null,{symbol:'AAPL',from:'2026-10-09',close:100,preMarket:99,afterHours:102},now);
 assert.equal(data.quotes.length,2);assert.equal(data.quotes[0].at,null);assert.equal(data.quotes[0].change,null);assert.ok(Math.abs(data.quotes[1].change!-2)<1e-8);
 assert.equal(normalizeExtended('AAPL',null,{symbol:'MSFT',from:'2026-10-09',preMarket:99},now).quotes.length,0);
 assert.equal(normalizeExtended('AAPL',{preMarketPrice:100,preMarketTime:Date.parse('2026-10-12T16:00Z')/1000},null,now).quotes.length,0);
 assert.equal(normalizeExtended('AAPL',null,{symbol:'AAPL',from:'2026-09-09',afterHours:100},now).quotes.length,0);
});

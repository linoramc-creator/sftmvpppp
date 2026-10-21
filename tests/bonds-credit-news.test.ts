import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bondsNewsRelevance,curateBondsCreditNews,bondsCreditNews,canonicalBondsNewsLink,parseBondsNewsDiscovery} from '../supabase/functions/analyze-ticker/bonds-credit-news.ts';
import type {Article} from '../supabase/functions/analyze-ticker/panels.ts';
const now=Date.parse('2026-10-21T09:00Z');
const story=(title:string,excerpt='',days=0,host='www.cnbc.com'):Article=>({title,excerpt,url:`https://${host}/2026/10/21/${encodeURIComponent(title)}.html`,source:host,date:new Date(now-days*86400000).toISOString().slice(0,10),publishedAt:new Date(now-days*86400000).toISOString()});

test('sovereign stories require explicit bond-market relevance and a connection to the selected country',()=>{
 const accepted:[any,Article][]=[
  ['US',story('Treasury yields climb after a weak auction','US government borrowing costs increase ahead of the Federal Reserve meeting.')],
  ['US',story('U.S. government bond yields increase amid inflation concerns')],
  ['FR',story('French bond yields rise as deficit concerns grow','The government budget raises sovereign financing risks.')],
  ['FR',story('La prima de riesgo de Francia sube tras el debate presupuestario')],
  ['DE',story('German Bund yields fall ahead of ECB rate decision')],
  ['DE',story('Los bonos alemanes repuntan ante la inflación')],
  ['GB',story('UK gilt yields jump after government borrowing figures')],
 ];
 for(const [subject,article] of accepted)assert.ok(bondsNewsRelevance(article,subject)>0,article.title);
 const rejected:[any,Article][]=[
  ['US',story('Federal Reserve meeting boosts technology shares','Equity investors welcome the outlook for earnings.')],
  ['FR',story('France wins a football championship')],
  ['FR',story('French president announces a state visit')],
  ['DE',story('German stocks rise as US Treasury yields fall')],
  ['DE',story('UK gilt yields jump after government borrowing figures')],
  ['GB',story('Best UK credit card rewards this month')],
  ['FR',story('French families build stronger emotional bonds')],
  ['FR',story('French oat yields increase after the harvest','Food inflation eases as crops improve.')],
 ];
 for(const [subject,article] of rejected)assert.equal(bondsNewsRelevance(article,subject),0,article.title);
});
test('private credit selection excludes generic private equity, consumer borrowing and insurance headlines',()=>{
 for(const article of [
  story('Private credit funds face rising loan defaults','Direct lenders report additional non-accrual loans and lower recoveries.'),
  story('El crédito privado afronta más reembolsos y problemas de liquidez'),
  story('Direct lending spreads tighten as new borrowers return'),
 ])assert.ok(bondsNewsRelevance(article,'private')>0,article.title);
 for(const article of [
  story('Private equity group buys a software company'),
  story('Best personal loans from private lenders'),
  story('Insurance group expands its business','Its parent also owns private credit funds and provides corporate loans.'),
  story('What is private credit? A beginners guide to direct lending'),
  story('Global Private Credit Market Strategic Report, 2026-2031','Private credit funds expand their assets under management.'),
  story('Moody’s: Can private credit create a durable subscription business?','The firm discusses new software subscription services.'),
 ])assert.equal(bondsNewsRelevance(article,'private'),0,article.title);
});
test('free discovery accepts only explicit original publisher URLs and preserves RSS dates',()=>{
 const original='https://www.reuters.com/markets/europe/german-bund-yields-2026-10-20/';
 const wrapper='http://www.bing.com/news/apiclick.aspx?ref=FexRss&url='+encodeURIComponent(original);
 assert.equal(canonicalBondsNewsLink(wrapper),original);
 for(const link of ['https://www.bing.com/news/apiclick.aspx?url=http://127.0.0.1/','https://www.bing.com/news/apiclick.aspx?url=https://cnbc.com@evil.test/news','https://evil.test/news?url='+encodeURIComponent(original),'https://www.bing.com/opaque-token','https://www.bing.com/news/apiclick.aspx?url='+encodeURIComponent('https://untrusted.invalid/news')])assert.equal(canonicalBondsNewsLink(link),null,link);
 const xml=`<rss><channel><item><title>German Bund yields fall ahead of the ECB meeting</title><link>${wrapper.replace(/&/g,'&amp;')}</link><pubDate>Tue, 20 Oct 2026 08:00:00 GMT</pubDate><description>Government bond investors respond to the inflation outlook.</description></item></channel></rss>`;
 const rows=parseBondsNewsDiscovery(xml,now);assert.equal(rows.length,1);assert.equal(rows[0].url,original);assert.equal(rows[0].publishedAt,'2026-10-20T08:00:00.000Z');assert.equal(curateBondsCreditNews(rows,'DE',now).length,1);
 const older=xml.replace('Tue, 20 Oct 2026','Sun, 11 Oct 2026').replace('German Bund yields fall ahead of the ECB meeting','Private credit lenders report loan defaults');
 assert.equal(parseBondsNewsDiscovery(older,now).length,0);assert.equal(parseBondsNewsDiscovery(older,now,true).length,1);
});
test('private credit syndicated investigation reports collapse to one event rather than filling the panel',()=>{
 const rows=[story('Barclays private credit loans trigger Bank of England complaint'),story('BoE scrutinises Barclays over private credit risk classifications'),story('Bank of England examines Barclays private credit exposure'),story('Direct lending spreads tighten as new borrowers return')];
 const selected=curateBondsCreditNews(rows,'private',now);assert.equal(selected.length,2);assert.equal(selected.filter(row=>/Barclays/.test(row.title)).length,1);
});
test('selection enforces real timestamps, seven-day country and fourteen-day private-credit windows',()=>{
 const fresh=story('Treasury yields rise after US auction'),old=story('Treasury yields fall after US budget debate','',8);
 const future={...fresh,url:fresh.url+'/future',publishedAt:new Date(now+120000).toISOString()},undated={...fresh,url:fresh.url+'/undated',date:'',publishedAt:undefined};
 assert.deepEqual(curateBondsCreditNews([fresh,old,future,undated],'US',now).map(a=>a.title),[fresh.title]);
 const privateOld=story('Private credit lenders report loan defaults','Direct lending losses rise.',10);
 assert.equal(curateBondsCreditNews([privateOld],'private',now).length,1);
 assert.equal(curateBondsCreditNews([{...privateOld,publishedAt:new Date(now-15*86400000).toISOString()}],'private',now).length,0);
});
test('selection removes duplicate articles, promotional sources and logos while preserving evidence summaries',()=>{
 const original=story('Treasury yields climb following weak US government debt auction','The auction drew weaker demand. The yield increased by 7 basis points.');
 const articles=curateBondsCreditNews([original,{...original,url:original.url+'?tracking=1'},{...original,url:'https://finance.yahoo.com/news/syndicated',title:original.title+' - Reuters'},story('Treasury yields offer value for investors','',0,'www.fool.com')],'US',now);
 assert.equal(articles.length,1);assert.equal(articles[0].keyPoints?.[0],'The auction drew weaker demand.');
 const logo={...original,image:'https://images.cnbc.com/company-logo.png'};
 assert.equal(curateBondsCreditNews([logo],'US',now)[0].image,undefined);
});
test('rejects named promotional syndication hidden behind Yahoo URLs without banning news commentary',()=>{
 const title='Treasury yields rise after US government debt auction';
 for(const excerpt of ['American News Group News Commentary - China sells US Treasury bonds.','Stock Preachers News Commentary - U.S. government bond yields rise.']){
  assert.equal(bondsNewsRelevance(story(title,excerpt,0,'finance.yahoo.com'),'US'),0);
 }
 assert.ok(bondsNewsRelevance(story(title,'News commentary: Treasury yields increased following the debt auction.',0,'finance.yahoo.com'),'US')>0);
});
test('local key points retain complete sentences containing US and UK abbreviations',()=>{
 const article=story('Treasury yields react to UK fiscal plans','U.S. Treasury yields rose after the inflation release. U.K. gilt yields also increased as investors assessed the budget.');
 const [selected]=curateBondsCreditNews([article],'US',now);
 assert.deepEqual(selected.keyPoints,['United States Treasury yields rose after the inflation release.','United Kingdom gilt yields also increased as investors assessed the budget.']);
 assert.equal(selected.excerpt,article.excerpt);
});
test('bounded results preserve important restricted headlines while choosing accessible alternatives',()=>{
 const titles=['Treasury yields jump as US auction fails','Federal Reserve decision steepens Treasury yield curve','US government bond yields ease on inflation','Treasury auction draws stronger demand','US sovereign debt issuance expands','US Treasury market faces fiscal pressures','Treasury yields retreat after weak US payroll report','US bond yields climb ahead of inflation figures'];
 const rows=titles.map((title,i)=>story(title,'Bond investors adjust positions following fiscal and inflation developments.',0,i===0?'www.reuters.com':i<4?'www.ft.com':'www.cnbc.com'));
 const selected=curateBondsCreditNews(rows,'US',now);assert.equal(selected.length,6);assert.ok(selected.filter(row=>row.access==='likely-open').length>=4);assert.ok(selected.every(row=>row.keyPoints?.length));
});
test('pipeline reuses concurrent loads and paid discovery, enriches real covers and never invokes an AI model',async t=>{
 const previous=globalThis.fetch,at=new Date().toISOString(),calls:string[]=[];
 globalThis.fetch=async(input:any,init:any={})=>{
  const url=String(input);calls.push(url);
  if(url.includes('/v1/finance/search'))return Response.json({news:[]});
  if(url==='https://api.tavily.com/search'){
   const body=JSON.parse(init.body);assert.equal(body.search_depth,'basic');assert.equal(body.max_results,12);assert.equal(body.days,7);assert.equal(body.include_answer,false);
   return Response.json({results:[{title:'French government bond yields rise after debt auction',url:'https://www.cnbc.com/2026/10/21/french-bond-auction.html',published_date:at,content:'French government borrowing costs increased. Demand at the auction was weaker.'}]});
  }
  if(url.includes('/french-bond-auction.html'))return new Response('<head><meta property="og:image" content="https://images.cnbc.com/news/french-bonds.jpg"></head>',{headers:{'Content-Type':'text/html'}});
  if(url.includes('rss')||url.includes('/device/')||url.includes('bing.com/news/search'))return new Response('<rss><channel></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});
  throw new Error('Unexpected paid or unrelated provider '+url);
 };
 t.after(()=>globalThis.fetch=previous);
 const [first,second]=await Promise.all([bondsCreditNews('FR',{TAVILY_KEY:'test'}),bondsCreditNews('FR',{TAVILY_KEY:'test'})]);
 assert.deepEqual(first,second);assert.equal(first.articles.length,1);assert.equal(first.articles[0].image,'https://images.cnbc.com/news/french-bonds.jpg');
 assert.equal(calls.filter(url=>url==='https://api.tavily.com/search').length,1);assert.ok(!calls.some(url=>/generativelanguage|openai|gemini/.test(url)));
 await bondsCreditNews('FR',{TAVILY_KEY:'test'});assert.equal(calls.filter(url=>url==='https://api.tavily.com/search').length,1);
});

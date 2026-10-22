import {test} from 'node:test';
import assert from 'node:assert/strict';
import {curateNews,newsPanel,type Article} from '../supabase/functions/analyze-ticker/panels.ts';
import {normalizeEodhdNews,eodhdNewsTopic} from '../supabase/functions/analyze-ticker/eodhd-news.ts';
import {companyNewsPattern,expandNewsSubject} from '../supabase/functions/analyze-ticker/news-topics.ts';
import {assetNewsSelection,lastDayNews} from '../supabase/functions/analyze-ticker/asset-snapshot.ts';
import {tickerPublisherNews} from '../supabase/functions/analyze-ticker/news-sources.ts';
const now=Date.parse('2026-10-22T14:00:00Z');
const titles=['Google expands Cloud capacity with a new enterprise contract','Google secures EU antitrust approval for search remedy','Google introduces Android security features after major data breach','YouTube launches a new subscription price for television customers','Alphabet completes share buybacks after earnings guidance','Waymo receives approval for driverless expansion to another market'];
const row=(title:string,index:number,days=0)=>({title,date:new Date(now-days*86400000-index*60000).toISOString(),link:`https://www.cnbc.com/2026/10/22/verified-article-${index}-${days}.html`,content:title+'. The company announced changes to its operations and business outlook.',image_url:`https://images.cnbc.com/news/cover-${index}-${days}.jpg`});
const article=(title:string,index:number,days=0):Article=>normalizeEodhdNews([row(title,index,days)],now,30)[0];

test('Alphabet news includes Google and directly covered business units without guessing a different company',()=>{
 const pattern=companyNewsPattern('GOOGL','Alphabet Inc Class A');
 assert.ok(pattern.test('Google expands Cloud capacity with a new enterprise contract'));assert.ok(pattern.test('YouTube launches a new subscription product'));
 assert.equal(pattern.test("Netflix has two problems that aren't YouTube"),false);
 assert.equal(pattern.test('Netflix revenue guidance falls'),false);
 assert.match(expandNewsSubject('GOOGL Alphabet Inc Class A'),/Google/);
 assert.equal(curateNews(titles.map((title,index)=>article(title,index)),'GOOGL Alphabet Inc Class A',now,6).length,6);
 assert.equal(eodhdNewsTopic('Communication Services Internet Content & Information industry'),'technology');
 assert.equal(eodhdNewsTopic('Industrials Electrical Equipment & Parts industry'),'industrials');
});

test('wrapped syndication and personal gossip do not become corporate news while material issuer announcements remain verifiable',()=>{
 const normalized=normalizeEodhdNews([row(titles[0],0),{...row('Alphabet earnings preview',1),content:'Zacks Investment Research. Zacks Rank and Zacks.com.'},{...row('Alphabet valuation outlook',2),content:'Analysis by Simply Wall St.'}],now);
 assert.equal(normalized.length,1);
 const wire={...article('Vertiv announces partnership to deploy a new power platform',3),url:'https://www.businesswire.com/news/verified-announcement',companyAnnouncement:true};
 assert.equal(curateNews([wire],'VRT Vertiv Holdings Co',now,6).length,0);
 assert.equal(curateNews([wire],'VRT Vertiv Holdings Co',now,6,false,14,{announcementsFor:companyNewsPattern('VRT','Vertiv Holdings Co')}).length,1);
 assert.equal(curateNews([article('Ex-Google CEO receives a huge investment windfall from his ex',4)],'GOOGL Alphabet Inc',now,6).length,0);
 const netflix=[article("Netflix has 2 problems behind the stock slide and they aren't YouTube, co-CEO Ted Sarandos says",5),article("Netflix co-CEO Ted Sarandos reveals two problems that have nothing to do with YouTube dominance and that don't have easy fixes",6)];
 assert.equal(curateNews(netflix,'Netflix YouTube streaming revenue',now,6,true).length,1);
});
test('free ticker RSS keeps original publisher URLs and dates and rejects unsafe symbols before fetch',async t=>{
 t.mock.method(Date,'now',()=>now);let calls=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{calls++;const url=new URL(String(input));assert.equal(url.hostname,'feeds.finance.yahoo.com');assert.equal(url.searchParams.get('s'),'VRT');return new Response(`<rss><channel><item><title>Vertiv announces new supply contract</title><link>https://www.cnbc.com/2026/10/22/supply-contract.html</link><pubDate>Thu, 22 Oct 2026 12:00:00 GMT</pubDate><description>Vertiv signed a new supply contract.</description></item></channel></rss>`,{headers:{'Content-Type':'application/xml'}});});
 assert.deepEqual(await tickerPublisherNews('../secret'),[]);assert.equal(calls,0);
 const rows=await tickerPublisherNews('VRT');assert.equal(calls,1);assert.equal(rows[0].url,'https://www.cnbc.com/2026/10/22/supply-contract.html');assert.equal(rows[0].publishedAt,'2026-10-22T12:00:00.000Z');
});

function fixture(t:any,key:string,provider:(query:URLSearchParams)=>unknown[]){
 const deno=(globalThis as any).Deno,requests:string[]=[];
 (globalThis as any).Deno={env:{get:(name:string)=>name==='EODHD_API_KEY'?key:undefined}};
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));requests.push(url.hostname+url.pathname);
  if(url.hostname==='eodhd.com')return Response.json(provider(url.searchParams));
  return new Response('',{status:503});
 });
 t.after(()=>{(globalThis as any).Deno=deno;});return requests;
}
const env={FMP_KEY:'',FRED_KEY:'',FINNHUB_KEY:'',TAVILY_KEY:''};
test('ticker and sector recover through separate mapped EODHD scopes without redundant discovery or model calls',async t=>{
 const sectorTitles=['Meta expands advertising contracts following strong revenue results','Netflix raises earnings guidance as subscriptions accelerate','Google search antitrust ruling changes advertising regulation','YouTube launches television subscription pricing in Europe','Facebook investment lifts social media advertising capacity','Warner streaming merger receives approval following competition review'];
 const queries:string[]=[];const requests=fixture(t,'test-news-mapped-scopes',query=>{queries.push(query.get('t')??query.get('s')??'');return (query.get('t')?sectorTitles:titles).map((title,index)=>row(title,index+(query.get('t')?20:0)));});
 const result=await newsPanel('GOOGL',false,env,{summary:async()=>({quoteType:{longName:'Alphabet Inc Class A',quoteType:'EQUITY'},assetProfile:{sector:'Communication Services',industry:'Internet Content & Information'}})});
 assert.equal(result.articles.length,6);assert.equal(result.sectorArticles?.length,6);assert.equal(result.articleWindowDays,14);assert.equal(result.sectorWindowDays,14);
 assert.deepEqual(queries,['GOOGL.US','technology']);assert.ok(requests.every(host=>host==='eodhd.com/api/news'));
});
test('sparse categories explicitly widen to thirty days, keep actual publication dates and never fill gaps with noise',async t=>{
 const requests=fixture(t,'test-news-widen',query=>query.get('from')==='2026-09-22'?titles.slice(0,5).map((title,index)=>row(title,index,index<2?1:20)):titles.slice(0,2).map((title,index)=>row(title,index,1)));
 const result=await newsPanel('GOOG',false,env,{summary:async()=>({quoteType:{longName:'Alphabet Inc',quoteType:'EQUITY'}})});
 assert.equal(result.articles.length,5);assert.equal(result.articleWindowDays,30);assert.ok(result.articles.some(a=>a.date==='2026-10-02'));assert.ok(result.articles.every(a=>Date.parse(a.publishedAt!)<=now));
 assert.equal(requests.filter(host=>host==='eodhd.com/api/news').length,2);assert.ok(!requests.some(host=>/googleapis|tavily|massive/.test(host)));
});
test('an asset detail expands the dated window only when useful older coverage exists and keeps a strict 24h helper',()=>{
 const recent=titles.slice(0,2).map((title,index)=>article(title,index)),weekly=titles.slice(2).map((title,index)=>article(title,index+2,4));
 assert.equal(lastDayNews([...recent,...weekly],'GOOGL Alphabet Inc',now).length,2);
 const seven=assetNewsSelection([...recent,...weekly],'GOOGL Alphabet Inc',now);assert.equal(seven.windowDays,7);assert.equal(seven.articles.length,6);
 const thirty=assetNewsSelection([...recent,article(titles[2],10,20)],'GOOGL Alphabet Inc',now);assert.equal(thirty.windowDays,30);assert.equal(thirty.articles.length,3);
 const current=assetNewsSelection(titles.map((title,index)=>article(title,index)),'GOOGL Alphabet Inc',now);assert.equal(current.windowDays,1);assert.equal(current.articles.length,6);
 assert.deepEqual(assetNewsSelection([],'UNKNOWN',now),{articles:[],windowDays:30});
});

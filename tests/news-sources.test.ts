import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublisherRss,newsOrder,newsKey,reportNewsContext} from '../supabase/functions/analyze-ticker/news-sources.ts';
import {isGeopolitical,geopoliticalNews} from '../supabase/functions/analyze-ticker/geopolitical-news.ts';
import {extractArticleDetails} from '../supabase/functions/analyze-ticker/news-covers.ts';
const now=Date.parse('2026-10-14T18:00Z');
test('publisher RSS preserves actual dates and rejects unsafe, future and old stories',()=>{
 const item=(url:string,date:string)=>`<item><title><![CDATA[Markets &amp; oil &#x1F4C8;]]></title><link>${url}</link><pubDate>${date}</pubDate><description>Energy supply outlook</description></item>`;
 const date='Wed, 14 Oct 2026 17:00:00 GMT';
 const articles=parsePublisherRss('<rss>'+item('https://www.cnbc.com/2026/10/14/markets.html',date)+item('https://private.example/secret',date)+item('https://www.cnbc.com/future','Wed, 14 Oct 2026 19:00:00 GMT')+item('https://www.cnbc.com/old','Wed, 01 Oct 2025 17:00:00 GMT')+'</rss>',now);
 assert.equal(articles.length,1);assert.equal(articles[0].title,'Markets & oil 📈');assert.equal(articles[0].publishedAt,'2026-10-14T17:00:00.000Z');
 assert.equal(reportNewsContext(articles).results[0].published_date,articles[0].publishedAt);
 const spanish=parsePublisherRss(`<rss><item><title>El petróleo y los mercados</title><link>http://www.eleconomista.es/economia/noticias/1/noticia.html</link><pubDate/><![CDATA[Wed, 14 Oct 2026 18:25:29 +0200]]></item></rss>`,now);
 assert.equal(spanish.length,1);assert.equal(spanish[0].publishedAt,'2026-10-14T16:25:29.000Z');assert.ok(spanish[0].url.startsWith('https:'));
});
test('free primary coverage wins ties while a materially newer story keeps priority',()=>{
 const base={title:'Markets news',date:'2026-10-14',source:'test'};
 const paid={...base,url:'https://www.ft.com/content/news',publishedAt:'2026-10-14T17:05Z'};
 const free={...base,url:'https://www.cnbc.com/2026/10/14/markets.html',publishedAt:'2026-10-14T17:02Z'};
 assert.ok(newsOrder(free,paid)<0);assert.ok(newsOrder({...paid,publishedAt:'2026-10-14T17:50Z'},free)<0);
 assert.equal(newsKey('https://www.cnbc.com/story/?utm_source=test#x'),newsKey('https://cnbc.com/story'));
});
test('Spanish war and political market decisions are geopolitics independently of the display limit',()=>{
 const base={date:'2026-10-14',publishedAt:'2026-10-14T17:00Z',source:'elEconomista',url:'https://www.eleconomista.es/mercados/noticia/1'};
 const rows=[{...base,title:'Trump anuncia nuevos aranceles a China y caen las bolsas'},{...base,title:'Los ataques de Irán interrumpen el suministro de petróleo'},{...base,title:'El FMI advierte sobre la deuda pública y la inflación'},{...base,title:'Trump Media sube en bolsa tras presentar resultados'}];
 assert.deepEqual(rows.map(isGeopolitical),[true,true,false,false]);assert.equal(geopoliticalNews(rows,now).length,2);
 assert.ok(isGeopolitical({...base,title:'Container ship sinks in Strait of Hormuz as Iran steps up attacks'}));
 assert.equal(isGeopolitical({...base,title:'ASML esquiva el escepticismo de la IA ante la amenaza de China: sube en bolsa tras elevar su beneficio trimestral un 133%'}),false);
});
test('grounded discovery relies on publisher publication metadata, never the model date',()=>{
 const details=extractArticleDetails('<meta property="og:title" content="Energy &amp; supply"><meta property="article:published_time" content="2026-10-14T17:00:00Z"><meta name="description" content="Markets update">','https://www.cnbc.com/article');
 assert.equal(details.title,'Energy & supply');assert.equal(details.publishedAt,'2026-10-14T17:00:00.000Z');
 assert.equal(extractArticleDetails('<meta property="og:title" content="No date">','https://www.cnbc.com/article').publishedAt,undefined);
 const ld=extractArticleDetails('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-14T16:00:00Z"}</script>','https://www.bbc.com/article');
 assert.equal(ld.publishedAt,'2026-10-14T16:00:00.000Z');
});

import type {Article} from './panels.ts';
import {photoUrl,publisherUrl} from './news-covers.ts';
import {newsAccess} from './news-access.ts';
export const PRIMARY_NEWS_DOMAINS=['cnbc.com','finance.yahoo.com'];
export const NEWS_DOMAINS=[...PRIMARY_NEWS_DOMAINS,'reuters.com','apnews.com','bloomberg.com','ft.com','wsj.com','marketwatch.com','barrons.com','eleconomista.es','eleconomista.com.mx','expansion.com','cincodias.elpais.com','rtve.es','efe.com','bbc.com','bbc.co.uk','theguardian.com','aljazeera.com','euronews.com','dw.com','france24.com','federalreserve.gov','businesswire.com','globenewswire.com','prnewswire.com','utilitydive.com','industryweek.com','investors.com'];
export const SPANISH_NEWS_DOMAINS=['eleconomista.es','eleconomista.com.mx','expansion.com','cincodias.elpais.com','rtve.es','efe.com','dw.com','france24.com'];
export const articleTime=(a:Article)=>Date.parse(a.publishedAt??a.date);
export function fundNewsPattern(symbol:string,holdings:{symbol?:string;holdingName?:string}[],indexTerms:string[]=[]):RegExp{
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const terms=[symbol,...indexTerms,...holdings.slice(0,15).flatMap(h=>{
  const brand=(h.holdingName??'').replace(/^(?:The )/i,'').match(/[\p{L}\p{N}]+/gu)?.[0];
  return [...(brand&&brand.length>=3?[brand]:[]),...(h.symbol&&h.symbol.length>=3?[h.symbol]:[]),...(['GOOG','GOOGL'].includes(h.symbol??'')?['Google']:[])];
 })];
 return new RegExp(terms.filter(Boolean).map(term=>`\\b${escape(term)}\\b`).join('|'),'i');
}
export function newsKey(value:string){try{const u=new URL(value);u.hostname=u.hostname.replace(/^www\./,'');u.search='';u.hash='';return u.href.replace(/\/$/,'');}catch{return value;}}
export function primaryOpen(a:Article){try{const host=new URL(a.url).hostname;return PRIMARY_NEWS_DOMAINS.some(d=>host===d||host.endsWith('.'+d))&&newsAccess(a.url)==='likely-open';}catch{return false;}}
export function newsOrder(a:Article,b:Article){const at=articleTime(a),bt=articleTime(b);return Math.floor(bt/1800000)-Math.floor(at/1800000)||Number(primaryOpen(b))-Number(primaryOpen(a))||bt-at;}
export function decodeNewsText(value:string){return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n:string)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi,(_,n:string)=>(({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '} as Record<string,string>)[n.toLowerCase()]??'')).replace(/\s+/g,' ').trim();}
export function parsePublisherRss(xml:string,now=Date.now()):Article[]{
 const tag=(item:string,name:string)=>decodeNewsText(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]??'');
 return [...xml.slice(0,600000).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,60).flatMap(([,item])=>{
  const title=tag(item,'title');let url=tag(item,'link');
  // elEconomista publishes HTTP links and, in its markets channel, a self-closing
  // pubDate followed by CDATA. Upgrade known publisher links without inventing dates.
  try{const parsed=new URL(url);if(parsed.protocol==='http:'){parsed.protocol='https:';if(publisherUrl(parsed.href))url=parsed.href;}}catch{return [];}
  const date=tag(item,'pubDate')||decodeNewsText(item.match(/<pubDate\s*\/\s*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1]??'');
  const stamp=Date.parse(date);if(!title||!publisherUrl(url)||!Number.isFinite(stamp)||stamp>now+60000||stamp<now-7*86400000)return [];
  const media=item.match(/<media:(?:content|thumbnail)\b[^>]*>/i)?.[0]??'',width=Number(media.match(/\bwidth=["'](\d+)/i)?.[1]),height=Number(media.match(/\bheight=["'](\d+)/i)?.[1]);
  const image=media.match(/\burl=["']([^"']+)/i)?.[1];return [{title,url,source:new URL(url).hostname,date:new Date(stamp).toISOString().slice(0,10),publishedAt:new Date(stamp).toISOString(),excerpt:tag(item,'description').slice(0,650),image:width&&width<400||height&&height<220?undefined:photoUrl(image)}];
 });
}
// Verified official syndication feeds supplement discovery without AI calls.
const RSS_FEEDS=['https://www.cnbc.com/id/100003114/device/rss/rss.html','https://www.cnbc.com/id/100727362/device/rss/rss.html','https://www.cnbc.com/id/19854910/device/rss/rss.html','https://www.cnbc.com/id/15839135/device/rss/rss.html','https://www.cnbc.com/id/10000664/device/rss/rss.html','https://www.eleconomista.es/rss/rss-mercados.php','https://www.eleconomista.es/rss/rss-economia.php','https://feeds.bbci.co.uk/news/world/rss.xml','https://feeds.bbci.co.uk/news/business/rss.xml'];
async function fetchPublisherFeed(initial:string):Promise<Article[]>{
 let url=initial;const signal=AbortSignal.timeout(8000),hosts=new Set([...RSS_FEEDS.map(feed=>new URL(feed).hostname),'feeds.finance.yahoo.com']);
 try{for(let hop=0;hop<3;hop++){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!hosts.has(parsed.hostname))return [];
  const r=await fetch(url,{redirect:'manual',signal,headers:{Accept:'application/rss+xml,application/xml,text/xml'}});
  if(r.status>=300&&r.status<400){const next=r.headers.get('location');await r.body?.cancel();if(!next)return [];url=new URL(next,url).href;continue;}
  if(!r.ok||!/(?:xml|rss)/i.test(r.headers.get('content-type')??'')){await r.body?.cancel();return [];}
  const reader=r.body?.getReader();if(!reader)return [];let xml='',bytes=0;const decoder=new TextDecoder();try{while(bytes<600000){const part=await reader.read();if(part.done)break;bytes+=part.value.length;xml+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel();}
  return parsePublisherRss(xml);
 }}catch{/* Keep all other providers available. */}return [];
}
export async function publisherNews():Promise<Article[]>{return (await Promise.all(RSS_FEEDS.map(fetchPublisherFeed))).flat();}
export async function tickerPublisherNews(symbol:string):Promise<Article[]>{
 if(!/^[A-Z0-9][A-Z0-9.^=-]{0,24}$/.test(symbol))return [];
 return fetchPublisherFeed(`https://feeds.finance.yahoo.com/rss/2.0/headline?${new URLSearchParams({s:symbol,region:'US',lang:'en-US'})}`);
}
export function reportNewsContext(articles:Article[]){return {answer:'',results:articles.map(a=>({title:a.title,url:a.url,content:a.excerpt??'',published_date:a.publishedAt??a.date}))};}

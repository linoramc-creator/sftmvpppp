import type {Article} from './panels.ts';
import {publisherNews,parsePublisherRss,articleTime,newsKey,decodeNewsText} from './news-sources.ts';
import {massiveNews} from './massive-news.ts';
import {tavilyJson,tavilyLimited} from './tavily-client.ts';
import {articleCover,photoUrl,publisherUrl} from './news-covers.ts';
import {balanceAccess} from './news-access.ts';
import {newsKeyPoints} from './news-summary.ts';

export const BONDS_NEWS_SUBJECTS=['US','FR','DE','GB','private'] as const;
export type BondsNewsSubject=typeof BONDS_NEWS_SUBJECTS[number];
export type BondsCreditNews={subject:BondsNewsSubject;fetchedAt:string;articles:Article[]};
type Env={MASSIVE_API_KEY?:string;TAVILY_KEY?:string};
const DAY=86400000,TTL=12*60000;
const cache=new Map<string,{until:number;value:unknown}>(),pending=new Map<string,Promise<unknown>>();
async function remember<T>(key:string,ttl:number,create:()=>Promise<T>):Promise<T>{
 const hit=cache.get(key);if(hit&&hit.until>Date.now())return hit.value as T;
 if(pending.has(key))return pending.get(key)! as Promise<T>;
 const task=create().then(value=>{if(cache.size>=128)cache.delete(cache.keys().next().value!);cache.set(key,{until:Date.now()+ttl,value});return value;}).finally(()=>pending.delete(key));pending.set(key,task);return task;
}
const COUNTRY:Record<Exclude<BondsNewsSubject,'private'>,RegExp>={
 US:/\b(?:treasur(?:y|ies)|federal reserve|fed|fomc|united states|estad[oa]s? unidos|estadounidenses?|norteamerican[oa]s?)\b/i,
 FR:/\b(?:france|french|francia|franc[eé]s(?:es)?|francesas?|banque de france)\b/i,
 DE:/\b(?:germany|german|alemania|alem[aá]n(?:es)?|alemanas?|bunds?|bundesbank)\b/i,
 GB:/\b(?:britain|british|united kingdom|u\.?k\.?|reino unido|brit[aá]nic[oa]s?|gilts?|bank of england|banco de inglaterra|boe)\b/i,
};
const SOVEREIGN=/\b(?:treasur(?:y|ies)|gilts?|bunds?|sovereign (?:debt|bonds?|yields?)|government (?:debt|bonds?|yields?)|bonos? (?:soberanos?|del (?:estado|tesoro))|deuda (?:soberana|p[uú]blica)|prima de riesgo|oat[-–/]bund|bonos? (?:franceses|alemanes|brit[aá]nicos|estadounidenses))\b/i;
const FIXED=/\b(?:bonds?|bondholders?|yields?|fixed[- ]income|bonos?|rendimientos?|rentabilidades?|renta fija|obligaciones|cupones?|subastas?|spreads?|diferenciales|deuda|prima de riesgo|basis points|puntos b[aá]sicos)\b/i;
const MACRO=/\b(?:fed|fomc|ecb|bce|boe|central bank|bancos? centrales?|federal reserve|bank of england|banco de inglaterra|inflation|inflaci[oó]n|interest rates?|tipos de inter[eé]s|rate cuts?|rate hikes?|recortes? de tipos|subidas? de tipos|auctions?|subastas?|deficits?|d[eé]ficit|fiscal|budgets?|presupuestos?|sovereign|soberan[oa]|government debt|deuda p[uú]blica|debt issuance|emisi[oó]n de deuda|yield curve|curva de tipos|borrowing costs?|public finances)\b/i;
const PRIVATE=/\b(?:private (?:credit|debt|lending)|direct lending|cr[eé]dito privado|deuda privada|pr[eé]stamos? directos?|financiaci[oó]n privada|business development compan(?:y|ies)|BDCs?)\b/i;
const PRIVATE_METRIC=/\b(?:default|defaults|impairments?|non[- ]accrual|redemptions?|liquidity|fundrais(?:e|es|ing)|loans?|borrowers?|lenders?|covenants?|payment[- ]in[- ]kind|PIK|leverage|restructur(?:ing|e)|losses?|delinquenc|morosidad|impagos?|liquidez|reembolsos?|captaci[oó]n|pr[eé]stamos?|deudores?|prestamistas?|reestructuraci[oó]n|apalancamiento|valoraci[oó]n|discount|descuentos?|funds?|fondos?|spreads?|rentabilidad)\b/i;
const NOISE=/\b(?:sponsored|advertorial|press release|globe\s?newswire|business\s?wire|researchandmarkets|American News Group|Stock Preachers|investor deadline|class action|best (?:credit cards?|loans?)|credit card rewards?|personal loans?|student loans?|pr[eé]stamos? personales?|tarjetas? de cr[eé]dito|James Bond|family bonds?|emotional bonds?)\b|stocks? to buy|should you buy|motley fool|investing radar|passive income|investment story|dividend portfolio|is it worth investing|market strategic report|strategic report,? 20\d{2}/i;
const DOMAINS=['cnbc.com','finance.yahoo.com','eleconomista.es','eleconomista.com.mx','reuters.com','ft.com','bloomberg.com','marketwatch.com','expansion.com','cincodias.elpais.com','apnews.com'];
const QUERIES:Record<BondsNewsSubject,string>={
 US:'US Treasury government bonds yields auctions Federal Reserve inflation fixed income',
 FR:'France French OAT government bond yields sovereign debt spread budget auction',
 DE:'Germany German Bund government bond yields auction ECB inflation debt issuance',
 GB:'UK British gilt bond yields Bank of England government borrowing budget auction',
 private:'global private credit direct lending defaults liquidity redemptions payment in kind loans funds',
};
const FREE_QUERY:Record<BondsNewsSubject,string>={US:'Treasury bond yields',FR:'France OAT bond yields',DE:'Germany bond yields Bund',GB:'UK gilt yields budget',private:'private credit'};
// Verified public XML syndication channels. These expose publisher metadata and
// short summaries; this never bypasses an article subscription barrier.
const SPECIALIST_FEEDS:Record<'shared'|'private',string[]>={
 shared:['https://www.cnbc.com/id/20910258/device/rss/rss.html','https://www.cnbc.com/id/19794221/device/rss/rss.html','https://www.ft.com/bonds?format=rss','https://www.ft.com/eurozone-economy?format=rss','https://feeds.finance.yahoo.com/rss/2.0/headline?s=TLT&region=US&lang=en-US'],
 private:['https://www.ft.com/private-credit?format=rss'],
};
function text(article:Article){return decodeNewsText(`${article.title} ${article.excerpt??''}`).slice(0,1600);}
function countryMention(body:string,subject:Exclude<BondsNewsSubject,'private'>){return COUNTRY[subject].test(body)||subject==='US'&&/\b(?:US|U\.S\.?|USA)\b/.test(body)||subject==='FR'&&/\bOATs?\b/.test(body);}
const sovereignContext=(body:string)=>SOVEREIGN.test(body)||/\bOATs?\b/.test(body);
function countryBondContext(body:string,subject:Exclude<BondsNewsSubject,'private'>):boolean{
 const signature={US:/\btreasur(?:y|ies)\b/i,FR:/\bOATs?\b/,DE:/\bbunds?\b/i,GB:/\bgilts?\b/i}[subject];
 if(signature.test(body))return true;
 // Avoid borrowing another country's bond story from a stock-market roundup:
 // country and fixed-income impact must occur in the same factual clause.
 return body.replace(/\bU\.S\.?/g,'US').split(/[.!?;]|\b(?:while|whereas|mientras|after|as)\b/i).some(clause=>countryMention(clause,subject)&&FIXED.test(clause));
}
export function bondsNewsRelevance(article:Article,subject:BondsNewsSubject):number{
 const title=decodeNewsText(article.title),body=text(article);
 if(NOISE.test(body)||/^(?:what is|what are|how to|beginners?\b|guide to|qu[eé] es|c[oó]mo invertir|gu[ií]a)/i.test(title)||!publisherUrl(article.url)||/businesswire\.com|globenewswire\.com|prnewswire\.com|\/video\//i.test(article.url))return 0;
 let score=0;
 if(subject==='private'){
  if(!PRIVATE.test(body)||!PRIVATE_METRIC.test(body)&&!/\b(?:risks?|exposure|stress|classification|probe|scrutini\w*|regulat\w*|AUM|assets under management)\b/i.test(body))return 0;
  // A generic insurance/private-equity headline is not private-credit research
  // just because a lender or a credit fund appears in its related-story footer.
  if(!PRIVATE.test(title)&&/\b(?:insurance|insurer|seguros?|private equity|capital riesgo)\b/i.test(title))return 0;
  score=5+Number(PRIVATE.test(title))*4+Number(PRIVATE_METRIC.test(title))*3;
 }else{
  // Crop yields are not bond yields; in particular lowercase oats must not be
  // mistaken for the French sovereign OAT acronym.
  if(/\b(?:harvest|crops?|cosecha|oats?|wheat|barley|trigo|cebada|avena)\b/i.test(title)&&!sovereignContext(body)&&!/\b(?:bonds?|bonos?|deuda|renta fija)\b/i.test(body))return 0;
  if(!countryMention(body,subject)||!FIXED.test(body)||!sovereignContext(body)&&!MACRO.test(body)||!countryBondContext(body,subject))return 0;
  score=4+Number(countryMention(title,subject))*3+Number(sovereignContext(title))*4+Number(FIXED.test(title)&&MACRO.test(title))*2;
 }
 if(/\b(?:auction|subasta|yields?|rendimientos?|default|impago|redemption|reembolso|spread|diferencial|fiscal|inflation|inflaci[oó]n)\b/i.test(title))score+=2;
 try{const host=new URL(article.url).hostname;if(['cnbc.com','finance.yahoo.com','eleconomista.es'].some(domain=>host===domain||host.endsWith('.'+domain)))score+=1;}catch{return 0;}
 return score;
}
export function curateBondsCreditNews(rows:Article[],subject:BondsNewsSubject,now=Date.now()):Article[]{
 const oldest=now-(subject==='private'?14:7)*DAY;
 const candidates=rows.map(article=>({article,score:bondsNewsRelevance(article,subject),at:articleTime(article)})).filter(row=>row.score>0&&Number.isFinite(row.at)&&row.at>=oldest&&row.at<=now+60000).sort((a,b)=>b.score-a.score||b.at-a.at);
 const urls=new Set<string>(),titles:Set<string>[]=[],events=new Set<string>(),unique:Article[]=[];
 for(const {article} of candidates){
  const key=newsKey(article.url),words=new Set(decodeNewsText(article.title).toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
  if(urls.has(key)||titles.some(previous=>{const common=[...words].filter(word=>previous.has(word)).length;return common>=5&&common/Math.max(1,Math.min(words.size,previous.size))>=.72;}))continue;
  const lender=subject==='private'?article.title.match(/\b(Barclays|JPMorgan|Blackstone|Blue Owl|Ares|Apollo|KKR|Oaktree)\b/i)?.[1]?.toLowerCase():null;
  const investigation=lender&&/\b(?:probe\w*|scrutini\w*|investigat\w*|examin\w*|complaint|classification|misrepresent\w*)\b/i.test(text(article));
  const event=investigation?lender+':private-credit-investigation':null;
  if(event&&events.has(event))continue;if(event)events.add(event);
  urls.add(key);titles.push(words);unique.push({...article,title:decodeNewsText(article.title).slice(0,500),excerpt:decodeNewsText(article.excerpt??'').slice(0,900),image:photoUrl(article.image)});
 }
 return balanceAccess(unique,6).map(article=>({...article,keyPoints:newsKeyPoints({...article,excerpt:(article.excerpt??'').replace(/\bU\.S\./g,'United States').replace(/\bU\.K\./g,'United Kingdom')})}));
}
function resultArticle(row:any):Article|null{
 if(typeof row?.title!=='string'||typeof row?.url!=='string'||!publisherUrl(row.url))return null;
 const at=typeof row.published_date==='string'?Date.parse(row.published_date):NaN;
 if(!Number.isFinite(at))return null;
 return {title:row.title.slice(0,500),url:row.url,source:new URL(row.url).hostname,date:new Date(at).toISOString().slice(0,10),publishedAt:new Date(at).toISOString(),excerpt:String(row.content??'').slice(0,900)};
}
export function canonicalBondsNewsLink(value:string):string|null{
 try{
  const link=new URL(decodeNewsText(value));
  if(publisherUrl(link.href))return link.href;
  if(!['http:','https:'].includes(link.protocol)||link.hostname!=='www.bing.com'||link.pathname!=='/news/apiclick.aspx'||link.username||link.password||link.port)return null;
  const target=link.searchParams.get('url');return target&&publisherUrl(target)?new URL(target).href:null;
 }catch{return null;}
}
export function parseBondsNewsDiscovery(xml:string,now=Date.now(),privateCredit=false):Article[]{
 const safe=xml.slice(0,600000).replace(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/gi,(_tag,raw:string)=>{
  const target=canonicalBondsNewsLink(raw);return `<link>${target?.replace(/&/g,'&amp;')??''}</link>`;
 });
 // The shared parser admits a seven-day window. Two non-overlapping views
 // preserve original timestamps for the explicitly longer private-credit window.
 const rows=[...parsePublisherRss(safe,now),...(privateCredit?parsePublisherRss(safe,now-7*DAY):[])];
 return rows.map(article=>({...article,image:undefined}));
}
async function feedXml(initial:string):Promise<string>{
 const signal=AbortSignal.timeout(6500);let url=initial;
 try{for(let hop=0;hop<3;hop++){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!==new URL(initial).hostname||parsed.username||parsed.password||parsed.port)return '';
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/rss+xml,application/xml,text/xml'},redirect:'manual',signal});
  if(response.status>=300&&response.status<400){const next=response.headers.get('location');await response.body?.cancel();if(!next)return '';url=new URL(next,url).href;continue;}
  if(!response.ok||!/(?:xml|rss)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();return '';}
  const reader=response.body?.getReader();if(!reader)return '';let xml='',bytes=0;const decoder=new TextDecoder();
  try{while(bytes<600000){const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;xml+=decoder.decode(result.value,{stream:true});}}finally{await reader.cancel();}return xml;
 }}catch{}return '';
}
async function specialistNews(privateCredit:boolean):Promise<Article[]>{
 const collect=(kind:'shared'|'private')=>remember('specialist:'+kind,TTL,async()=>(await Promise.all(SPECIALIST_FEEDS[kind].map(async url=>{const xml=await feedXml(url);return [...parsePublisherRss(xml),...(kind==='private'?parsePublisherRss(xml,Date.now()-7*DAY):[])];}))).flat());
 return (await Promise.all([collect('shared'),privateCredit?collect('private'):Promise.resolve([])])).flat();
}
async function freeDiscovery(subject:BondsNewsSubject):Promise<Article[]>{
 return remember('free:'+subject,TTL,async()=>{
  const preferred='(site:cnbc.com OR site:finance.yahoo.com OR site:reuters.com OR site:ft.com OR site:eleconomista.es OR site:theguardian.com)';
  const url='https://www.bing.com/news/search?'+new URLSearchParams({q:`${FREE_QUERY[subject]} ${preferred}`,format:'rss',count:'30',sortbydate:'1'});
  return parseBondsNewsDiscovery(await feedXml(url),Date.now(),subject==='private');
 });
}
async function yahooBondNews(subject:BondsNewsSubject):Promise<Article[]>{
 return remember('yahoo:'+subject,10*60000,async()=>{
  try{
   const response=await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(QUERIES[subject])}&newsCount=20&quotesCount=0`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(5000),redirect:'error'});
   if(!response.ok)return [];const raw=await response.json();
   return (Array.isArray(raw.news)?raw.news:[]).flatMap((row:any)=>{
    const at=Number(row.providerPublishTime)*1000;if(!Number.isFinite(at)||typeof row.title!=='string'||!publisherUrl(row.link))return [];
    const image=(Array.isArray(row.thumbnail?.resolutions)?row.thumbnail.resolutions:[]).filter((item:any)=>Number(item.width)>=400&&Number(item.height)>=220).sort((a:any,b:any)=>Number(b.width)-Number(a.width)).map((item:any)=>photoUrl(item.url)).find(Boolean);
    return [{title:row.title.slice(0,500),url:row.link,source:String(row.publisher??new URL(row.link).hostname).slice(0,100),date:new Date(at).toISOString().slice(0,10),publishedAt:new Date(at).toISOString(),excerpt:String(row.summary??row.description??'').slice(0,900),image}];
   });
  }catch{return [];}
 });
}
export async function bondsCreditNews(subject:BondsNewsSubject,env:Env):Promise<BondsCreditNews>{
 if(!BONDS_NEWS_SUBJECTS.includes(subject))throw new Error('Invalid bond-news subject');
 return remember('panel:'+subject,TTL,async()=>{
  const [rss,massive,yahoo,credit,specialist]=await Promise.all([
   remember('publisher-rss',10*60000,publisherNews),massiveNews(env.MASSIVE_API_KEY),yahooBondNews(subject),subject==='private'?massiveNews(env.MASSIVE_API_KEY,'BIZD'):subject==='US'?massiveNews(env.MASSIVE_API_KEY,'TLT'):Promise.resolve([]),
   specialistNews(subject==='private'),
  ]);
  let selected=curateBondsCreditNews([...rss,...massive,...yahoo,...credit,...specialist],subject);
  if(selected.length<6)selected=curateBondsCreditNews([...selected,...await freeDiscovery(subject)],subject);
  if(selected.length<6&&env.TAVILY_KEY&&!tavilyLimited()){
   const raw=await tavilyJson({query:QUERIES[subject],topic:'news',days:subject==='private'?14:7,search_depth:'basic',max_results:12,include_answer:false,include_raw_content:false,include_images:false,include_domains:DOMAINS},env.TAVILY_KEY,9000);
   const discoveries=(Array.isArray(raw?.results)?raw.results:[]).flatMap((row:any)=>resultArticle(row)??[]);
   selected=curateBondsCreditNews([...selected,...discoveries],subject);
  }
  // Only the selected publishers are opened, at most six previews in parallel.
  // Missing images stay absent instead of being replaced with a brand/logo.
  const articles=await Promise.all(selected.map(async article=>({...article,image:photoUrl(article.image)??await remember('cover:'+newsKey(article.url),6*3600000,()=>articleCover(article.url))})));
  return {subject,fetchedAt:new Date().toISOString(),articles};
 });
}

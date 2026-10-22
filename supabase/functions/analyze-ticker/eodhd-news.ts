import {eodhdGet,eodhdEnabled,eodhdSymbol} from './eodhd-client.ts';
import {publisherUrl,photoUrl} from './news-covers.ts';
import {decodeNewsText,newsKey} from './news-sources.ts';
import type {Article} from './panels.ts';
import {sectorNewsTag} from './news-topics.ts';
const DAY=86400000;
const aliases:Record<string,string>={semiconductores:'semiconductors','inteligencia artificial':'artificial intelligence','tecnología':'technology',tecnologia:'technology','energía':'energy',energia:'energy',salud:'healthcare',bancos:'banking',defensa:'defense',consumo:'consumer',inmobiliario:'real estate'};
export function eodhdNewsTopic(subject:string):string|null{
 const text=subject.trim().toLowerCase();if(!text||text.length>100||! /^[\p{L}\p{N}\s&/.,-]+$/u.test(text))return null;return aliases[text]??sectorNewsTag(text);
}
export function normalizeEodhdNews(raw:unknown,now=Date.now(),maxAgeDays=14):Article[]{
 const seen=new Set<string>();return (Array.isArray(raw)?raw:[]).flatMap(row=>{
  if(typeof row?.title!=='string'||typeof row.link!=='string'||typeof row.date!=='string'||!publisherUrl(row.link))return [];
  const timestamp=Date.parse(row.date);if(!/T\d\d:\d\d/.test(row.date)||!Number.isFinite(timestamp)||timestamp>now+60000||timestamp<now-maxAgeDays*DAY)return [];
  const content=decodeNewsText(String(row.content??'').slice(0,60000)),title=decodeNewsText(row.title).slice(0,500);
  if(!title||/\/video\//i.test(row.link)||/\b(?:Jim Cramer|stocks? to buy|should you buy|investing radar|sponsored|press release)\b/i.test(title)||/originally published (?:at|on) Insider Monkey|follow Insider Monkey|free report on the best short-term AI stock|Motley Fool Stock Advisor|Zacks (?:Investment Research|Equity Research|Rank)|zacks\.com|Simply Wall St/i.test(content))return [];
  const key=newsKey(row.link);if(seen.has(key))return [];seen.add(key);
  return [{title,url:row.link,source:new URL(row.link).hostname.replace(/^www\./,''),date:new Date(timestamp).toISOString().slice(0,10),publishedAt:new Date(timestamp).toISOString(),excerpt:content.replace(/\bStory Continues\b|\bView Comments\b/g,'').trim().slice(0,900),image:photoUrl(row.image_url??row.image??row.thumbnail?.url),...(/Business Wire|GlobeNewswire|Globe Newswire|PR Newswire|PRNewswire/i.test(content)?{companyAnnouncement:true}:{})}];
 });
}
/** One bounded server-side call; dates and publishers remain attributable to the
 * original article. Missing images are enriched only after editorial selection. */
export async function eodhdNews(subject='',sector=false,request:typeof eodhdGet=eodhdGet,now=Date.now(),windowDays=subject?14:2):Promise<Article[]>{
 if(request===eodhdGet&&!eodhdEnabled())return [];
 const ticker=!sector&&subject?eodhdSymbol(subject):null,topic=sector?eodhdNewsTopic(subject):null;
 if(subject&&(sector?!topic:!ticker))return [];
 const maxAgeDays=Math.max(1,Math.min(30,windowDays)),raw=await request('news',{...(ticker?{s:ticker}:topic?{t:topic}:{}),from:new Date(now-maxAgeDays*DAY).toISOString().slice(0,10),to:new Date(now).toISOString().slice(0,10),limit:subject?60:100,offset:0},{ttlMs:600000,cost:5,timeoutMs:7000});
 return normalizeEodhdNews(raw,now,maxAgeDays);
}

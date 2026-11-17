import type {MonitorNews,MonitorNotice,MonitorOverview} from '../../../supabase/functions/analyze-ticker/monitoring-types';

export type PortfolioNewsItem=MonitorNews&{noticeId:string|null;readAt:string|null};
export type PortfolioNewsGroup={symbol:string;name:string;collectedAt:string|null;items:PortfolioNewsItem[]};
const titleKey=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function urlKey(value:string){try{const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key))url.searchParams.delete(key);url.searchParams.sort();return url.hostname.toLowerCase()+url.pathname.replace(/\/+$/,'')+url.search;}catch{return '';}}
const sameNews=(a:Pick<MonitorNews,'url'|'title'|'analysisKey'>,b:Pick<MonitorNews,'url'|'title'|'analysisKey'>)=>!!a.analysisKey&&a.analysisKey===b.analysisKey||!!urlKey(a.url)&&urlKey(a.url)===urlKey(b.url)||!!titleKey(a.title)&&titleKey(a.title)===titleKey(b.title);
const time=(value:string)=>Number.isFinite(Date.parse(value))?Date.parse(value):0;

/** Read-only view over the existing collector. No new provider or AI requests. */
export function portfolioNewsGroups(data:MonitorOverview,scope:'positions'|'watchlist'):PortfolioNewsGroup[]{
 const symbols=[...new Set(scope==='positions'?data.context.positions.filter(position=>position.quantity!==0).map(position=>position.symbol):data.context.watchlist)];
 return symbols.map(symbol=>{
  const snapshot=data.context.snapshots.find(item=>item.symbol===symbol),notices=data.notices.filter(item=>item.symbol===symbol&&item.kind==='news');
  const candidates:MonitorNews[]=[...(snapshot?.news??[]),...notices.map(item=>({id:item.key,title:item.title,date:item.occurredAt,source:item.source,url:item.url,excerpt:item.detail,...(item.analysisKey?{analysisKey:item.analysisKey}:{})}))];
  const items:PortfolioNewsItem[]=[];
  for(const candidate of candidates.sort((a,b)=>time(b.date)-time(a.date))){
   if(!candidate.title.trim()||items.some(item=>sameNews(item,candidate)))continue;
   const notice=notices.find(item=>sameNews(item,candidate));
   items.push({...candidate,noticeId:notice?.id??null,readAt:notice?.readAt??null});
  }
  return {symbol,name:snapshot?.name??symbol,collectedAt:snapshot?.collectedAt??null,items:items.slice(0,6)};
 });
}

export function visibleMonitoringNotices(notices:MonitorNotice[]){return notices.filter(item=>item.kind!=='alert');}

export type FollowingNewsItem=MonitorNews&{symbols:string[];noticeIds:string[];unread:boolean;collectedAt:string|null;imageUrl?:string|null;keyPoints?:string[]};
/** One chronological feed for the independent following list. Never widens to positions or feed assets. */
export function followingNewsItems(data:MonitorOverview):FollowingNewsItem[]{
 const followed=new Set(data.context.watchlist),candidates:(MonitorNews&{symbol:string;collectedAt:string|null})[]=[];
 for(const snapshot of data.context.snapshots){if(!followed.has(snapshot.symbol))continue;for(const news of snapshot.news)candidates.push({...news,symbol:snapshot.symbol,collectedAt:snapshot.collectedAt});}
 const notices=data.notices.filter(item=>item.kind==='news'&&followed.has(item.symbol));
 for(const notice of notices)candidates.push({id:notice.key,title:notice.title,date:notice.occurredAt,source:notice.source,url:notice.url,excerpt:notice.detail,analysisKey:notice.analysisKey,symbol:notice.symbol,collectedAt:notice.createdAt});
 const items:FollowingNewsItem[]=[];
 for(const news of candidates.sort((a,b)=>time(b.date)-time(a.date))){
  if(!news.title.trim())continue;
  const found=items.find(item=>sameNews(item,news));
  const linked=notices.filter(notice=>sameNews(notice,news));
  if(found){found.symbols=[...new Set([...found.symbols,news.symbol,...linked.map(item=>item.symbol)])];found.noticeIds=[...new Set([...found.noticeIds,...linked.map(item=>item.id)])];found.unread=found.unread||linked.some(item=>!item.readAt);if(!found.summary&&news.summary)found.summary=news.summary;if(!found.imageUrl&&news.imageUrl)found.imageUrl=news.imageUrl;if(!found.keyPoints?.length&&news.keyPoints?.length)found.keyPoints=news.keyPoints;continue;}
  items.push({...news,symbols:[...new Set([news.symbol,...linked.map(item=>item.symbol)])],noticeIds:[...new Set(linked.map(item=>item.id))],unread:linked.some(item=>!item.readAt)});
 }
 return items;
}

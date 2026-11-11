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

import type {Article} from './panels.ts';
export type NewsAccess='likely-open'|'subscription'|'unknown';
// Editorial selection hints, not a guarantee: publishers can change access
// by article, geography or number of visits. Never bypass an access barrier.
export function newsAccess(value:string):NewsAccess{
  try{const u=new URL(value);const host=u.hostname;
    const matches=(domains:string[])=>domains.some(d=>host===d||host.endsWith('.'+d));
    if(matches(['wsj.com','ft.com','bloomberg.com','barrons.com','reuters.com','marketwatch.com'])||/\/pro\/|\/investingclub\/|\/premium\//i.test(u.pathname))return 'subscription';
    if(matches(['apnews.com','bbc.com','bbc.co.uk','npr.org','cnbc.com','theguardian.com','aljazeera.com','finance.yahoo.com','euronews.com','pbs.org','federalreserve.gov','ecb.europa.eu']))return 'likely-open';
  }catch{/* unknown links are not counted as free */}
  return 'unknown';
}
export function balanceAccess(articles:Article[],limit:number):Article[]{
  const rows=articles.map(a=>({...a,access:newsAccess(a.url)}));
  const selected=rows.slice(0,limit);
  const goal=Math.ceil(selected.length/2);
  const alternatives=rows.slice(limit).filter(a=>a.access==='likely-open');
  for(const open of alternatives){
    if(selected.filter(a=>a.access==='likely-open').length>=goal)break;
    // Keep the leading paid headline; replace lower-ranked restricted items.
    let index=-1;for(let i=selected.length-1;i>0;i--)if(selected[i].access!=='likely-open'){index=i;break;}
    if(index<0)break;selected[index]=open;
  }
  return selected;
}

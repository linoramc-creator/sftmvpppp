import type {Point} from './panels.ts';

/** Independent official fallback while FRED is unavailable. The published Z.1
 * table is in USD billions, rounded to one decimal; it is never scaled as if it
 * were FRED's USD millions. Only explicitly quarterly columns are used. */
export const FED_PRIVATE_URL='https://www.federalreserve.gov/releases/z1/current/html/S124_8_s.htm';
const codes=['FL444090000','FL443067205','LM443067215','FL444190005','FL442000093'];
export type FedPrivateData=Record<string,Point[]>;
const plain=(html:string)=>html.replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/g,' ').replace(/\s+/g,' ').trim();
export function parseFedPrivateCredit(html:string,now=Date.now()):FedPrivateData{
 const table=html.match(/<table\b[^>]*\bid=["']s1248s["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
 if(!table||!table.includes('Private debt funds'))return {};
 const columns=new Map<string,string>(),today=new Date(now).toISOString().slice(0,10);
 for(const match of table.matchAll(/<th\b[^>]*\bid=["'](t\d+)["'][^>]*>([\s\S]*?)<\/th>/gi)){
  const quarter=plain(match[2]).match(/^(\d{4}):Q([1-4])$/);if(!quarter)continue;
  const date=`${quarter[1]}-${String((Number(quarter[2])-1)*3+1).padStart(2,'0')}-01`;
  if(date<=today)columns.set(match[1],date);
 }
 const out:FedPrivateData={};
 for(const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=match[1],code=codes.find(id=>new RegExp('>'+id+'<').test(row));if(!code)continue;
  const points:Point[]=[];
  for(const cell of row.matchAll(/<td\b[^>]*\bheaders=["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/gi)){
   const date=cell[1].split(/\s+/).map(id=>columns.get(id)).find(Boolean),raw=plain(cell[2]);
   if(!date||!/^[-+]?\d[\d,]*(?:\.\d+)?$/.test(raw))continue;
   const value=Number(raw.replace(/,/g,''));if(Number.isFinite(value)&&value>=0)points.push({date,value});
  }
  if(points.length)out['BOGZ1'+code+'Q']=points.sort((a,b)=>a.date.localeCompare(b.date));
 }
 return out;
}
let cache:{until:number;data:FedPrivateData}|null=null,pending:Promise<FedPrivateData>|null=null;
export async function fedPrivateCredit(fetcher:typeof fetch=fetch,now=Date.now()):Promise<FedPrivateData>{
 if(fetcher===fetch&&cache&&cache.until>now)return cache.data;
 if(fetcher===fetch&&pending)return pending;
 const request=(async()=>{try{
  const r=await fetcher(FED_PRIVATE_URL,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});
  if(!r.ok)return {};const html=await r.text();if(html.length>500000)return {};
  return parseFedPrivateCredit(html,now);
 }catch{return {};}})();
 if(fetcher!==fetch)return request;
 pending=request.then(data=>{cache={until:now+(Object.keys(data).length?6*3600000:120000),data};return data;}).finally(()=>{pending=null;});
 return pending;
}

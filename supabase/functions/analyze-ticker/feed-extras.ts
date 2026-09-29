import { cached } from './panels.ts';
type Row=Record<string,any>;
export type TreasuryPoint={years:number;yield:number|null;date:string|null;changeBp:number|null};
export type EarningsEvent={symbol:string;date:string;session:string;eps:number|null;revenue:number|null};
async function get(url:string):Promise<any>{try{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});return r.ok?await r.json():null;}catch{return null;}}
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export async function treasury(key:string):Promise<TreasuryPoint[]>{return cached('feed-treasury-v1',3600000,()=>Promise.all([2,5,10,20].map(async years=>{
  const raw=key?await get(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS${years}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=12`):null;
  const values=(raw?.observations??[]).filter((r:Row)=>r.value!=='.'&&r.value!==''&&Number.isFinite(Number(r.value)));
  return {years,yield:values.length?Number(values[0].value):null,date:values[0]?.date??null,changeBp:values.length>1?(Number(values[0].value)-Number(values[1].value))*100:null};
})));}
export async function earnings(fmp:string,finnhub:string):Promise<EarningsEvent[]>{return cached('feed-earnings:'+new Date().toISOString().slice(0,10),3600000,async()=>{
  const start=new Date().toISOString().slice(0,10),end=new Date(Date.now()+6*86400000).toISOString().slice(0,10);
  const [a,b]=await Promise.all([fmp?get(`https://financialmodelingprep.com/stable/earnings-calendar?from=${start}&to=${end}&apikey=${encodeURIComponent(fmp)}`):null,finnhub?get(`https://finnhub.io/api/v1/calendar/earnings?from=${start}&to=${end}&token=${encodeURIComponent(finnhub)}`):null]);
  const map=new Map<string,EarningsEvent>();
  for(const r of [...(Array.isArray(a)?a:[]),...(b?.earningsCalendar??[])]){
    const date=String(r.date??'').slice(0,10),symbol=String(r.symbol??'');if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)||date<start||date>end)continue;
    const id=symbol+date,old=map.get(id);map.set(id,{symbol,date,session:({bmo:'Antes de apertura',amc:'Después del cierre',dmh:'Durante sesión'} as Record<string,string>)[r.hour??r.time]??old?.session??'Hora por confirmar',eps:number(r.epsEstimated??r.epsEstimate)??old?.eps??null,revenue:number(r.revenueEstimated??r.revenueEstimate)??old?.revenue??null});
  }
  // Rank within each day by estimated revenue; never invent market importance.
  const counts=new Map<string,number>();
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||(b.revenue??0)-(a.revenue??0)).filter(event=>{const count=counts.get(event.date)??0;counts.set(event.date,count+1);return count<4;}).slice(0,24);
});}

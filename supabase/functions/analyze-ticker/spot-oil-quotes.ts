import {spotOil} from './spot-oil.ts';
import type {SessionQuote} from './feed-quotes.ts';

const DAY=86400000,CACHE_TTL=15*60000,MAX_BODY=50000,MAX_HISTORY_BODY=600000;
export const SPOT_OIL_MAX_AGE_DAYS=7;
export const SPOT_OIL_MAX_BUSINESS_AGE_DAYS=3;
const day=(at:number)=>new Date(at).toISOString().slice(0,10);
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&day(Date.parse(value))===value?value:null;
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)?Number(value):null;
const envKey=(names:string[])=>{try{const env=(globalThis as any).Deno?.env;return names.map(name=>env?.get(name)).find(Boolean)||'';}catch{return '';}};
type QuoteReader=(symbol:string,label?:string)=>Promise<SessionQuote|null>;

/** Weekends do not age a published daily observation into an invented new one.
 * A separate calendar cap prevents long holiday/outage gaps from passing. */
export function isSpotOilDateFresh(value:unknown,now=Date.now()):boolean{
 const stamp=date(value);if(!stamp||!Number.isFinite(now))return false;
 const today=Date.parse(day(now)),at=Date.parse(stamp);
 if(at>today||today-at>SPOT_OIL_MAX_AGE_DAYS*DAY)return false;
 let businessDays=0;
 for(let next=at+DAY;next<=today;next+=DAY){const weekday=new Date(next).getUTCDay();if(weekday!==0&&weekday!==6)businessDays++;}
 return businessDays<=SPOT_OIL_MAX_BUSINESS_AGE_DAYS;
}

async function boundedText(response:Response,max=MAX_BODY):Promise<string|null>{
 if(!response.body||Number(response.headers.get('Content-Length')??0)>max){await response.body?.cancel();return null;}
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{for(;;){const part=await reader.read();if(part.done)return text+decoder.decode();bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();return null;}text+=decoder.decode(part.value,{stream:true});}}finally{reader.releaseLock();}
}

/** An EIA daily observation has an observation date, never a live trade timestamp. */
export function spotOilDailyQuote(symbol:string,raw:unknown,now=Date.now()):SessionQuote|null{
 const oil=spotOil(symbol);if(!oil)return null;
 const empty:SessionQuote={symbol,displaySymbol:oil.code,label:oil.name,price:null,change:null,date:null,currency:'USD',unit:'USD/barril',session:'closed',at:null,delaySeconds:null,priceKind:'daily-close',reference:null,referenceDate:null,timezone:'UTC'};
 const body=raw as any;
 if(body?.series_id!==undefined&&body.series_id!==oil.series||body?.units!==undefined&&body.units!=='lin')return empty;
 const rows=Array.isArray(raw)?raw:Array.isArray(body?.observations)?body.observations:[];
 if(rows.length>100)return empty;
 const values=new Map<string,number>(),today=day(now);
 for(const row of rows){
  const stamp=date(row?.date),value=number(row?.value);
  if(!stamp||stamp>today||now-Date.parse(stamp)>45*DAY||value===null||!Number.isFinite(value)||Math.abs(value)>1000000)continue;
  if(values.has(stamp)&&values.get(stamp)!==value)return empty;
  values.set(stamp,value);
 }
 const points=[...values].sort(([a],[b])=>a.localeCompare(b)),last=points.at(-1),previous=points.at(-2);
 if(!last||!isSpotOilDateFresh(last[0],now))return empty;
 const comparable=previous&&previous[1]>0;
 return {...empty,price:last[1],date:last[0],change:comparable?(last[1]/previous[1]-1)*100:null,reference:comparable?'previous-close':null,referenceDate:comparable?previous[0]:null};
}

export function parseSpotOilCsv(symbol:string,text:string):{observations:{date:string;value:string}[]}|null{
 const oil=spotOil(symbol);if(!oil||text.length>MAX_BODY)return null;
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines[0]!==`observation_date,${oil.series}`&&lines[0]!==`DATE,${oil.series}`||lines.length>101)return null;
 const observations=[];
 for(const line of lines.slice(1)){
  const cells=line.split(',');if(cells.length!==2)return null;
  observations.push({date:cells[0],value:cells[1]});
 }
 return {observations};
}

/** Read only the exact physical FOB series and USD/barrel units in EIA v2. */
export function parseEiaSpotOilJson(symbol:string,raw:unknown):{observations:{date:string;value:unknown}[]}|null{
 const oil=spotOil(symbol),body=(raw as any)?.response;
 if(!oil||body?.frequency!=='daily'||body?.dateFormat!=='YYYY-MM-DD'||!Array.isArray(body.data)||body.data.length>60)return null;
 const observations=[];
 for(const row of body.data){
  if(row?.series!==oil.eiaSeries||row?.product!==oil.eiaProduct||row?.process!=='PF4'||row?.units!=='$/BBL')return null;
  observations.push({date:row.period,value:row.value});
 }
 return {observations};
}

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** Public EIA daily history, not an executable page or scraped price snippet.
 * Title, summary, five weekday columns and exact week dates must all agree. */
export function parseEiaSpotOilHistory(symbol:string,text:string,now=Date.now()):{observations:{date:string;value:string}[]}|null{
 const oil=spotOil(symbol);if(!oil||text.length>MAX_HISTORY_BODY)return null;
 const title=text.match(/<title>\s*([^<]+)\s*<\/title>/i)?.[1]?.trim().replace(/\s+/g,' ');
 const expected=`${oil.title} (Dollars per Barrel)`;
 if(title!==expected)return null;
 const table=[...text.matchAll(/<table\b[^>]*SUMMARY=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/table>/gi)].find(match=>match[1].trim().replace(/\s+/g,' ')===expected)?.[2];
 if(!table||!/<th[^>]*>Mon&nbsp;<\/th>/.test(table)||!/<th[^>]*>Fri&nbsp;<\/th>/.test(table))return null;
 const observations:{date:string;value:string}[]=[];
 for(const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=match[1],week=row.match(/<td\s+class=['"]B6['"]>\s*(?:&nbsp;)*\s*(\d{4})\s+([A-Z][a-z]{2})-\s*(\d{1,2})\s+to\s+([A-Z][a-z]{2})-\s*(\d{1,2})\s*<\/td>/);
  if(!week)continue;
  const year=Number(week[1]),month=MONTHS.indexOf(week[2]),endMonth=MONTHS.indexOf(week[4]);
  if(month<0||endMonth<0)return null;
  const first=`${year}-${String(month+1).padStart(2,'0')}-${week[3].padStart(2,'0')}`,at=Date.parse(first);
  if(!date(first)||new Date(at).getUTCDay()!==1)return null;
  const friday=new Date(at+4*DAY);
  if(friday.getUTCMonth()!==endMonth||friday.getUTCDate()!==Number(week[5]))return null;
  if(now-at>45*DAY||at>now)continue;
  const cells=[...row.matchAll(/<td\s+class=['"]B3['"]>\s*([^<]*)\s*<\/td>/g)];
  if(cells.length!==5)return null;
  for(let i=0;i<5;i++){
   const value=cells[i][1].trim();if(value&&!['NA','-','--','W'].includes(value)&&number(value)===null)return null;
   observations.push({date:day(at+i*DAY),value});
  }
 }
 return {observations};
}

/** Each fixed official route is bounded. Compare available publications instead
 * of accepting a dated API result that prevents reading a newer public export.
 * Never fall back to a future, CFD, model answer or fabricated current date. */
export function createSpotOilQuotes({fetcher=(input,init)=>fetch(input,init),fredKey=()=>envKey(['Fred','FRED_KEY','FRED_API_KEY']),eiaKey=()=>envKey(['EIA_KEY','EIA_API_KEY']),now=()=>Date.now()}:{fetcher?:typeof fetch;fredKey?:()=>string;eiaKey?:()=>string;now?:()=>number}={}):QuoteReader{
 const cache=new Map<string,{until:number;value:SessionQuote}>(),pending=new Map<string,Promise<SessionQuote>>();
 return async(symbol,label)=>{
  const oil=spotOil(symbol);if(!oil)return null;
  const at=now(),hit=cache.get(symbol),name=label&&label!==symbol?label:oil.name;
  if(hit&&hit.until>at&&(hit.value.price===null||isSpotOilDateFresh(hit.value.date,at)))return {...hit.value,label:name};
  if(pending.has(symbol))return {...await pending.get(symbol)!,label:name};
  const operation=(async()=>{
   const start=day(at-45*DAY),end=day(at);
   const read=async(url:URL,format:'eia-json'|'eia-html'|'fred-json'|'fred-csv')=>{
    try{
     const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(6500),cache:'no-cache'});
     if(!response.ok){await response.body?.cancel();return null;}
     const text=await boundedText(response,format==='eia-html'?MAX_HISTORY_BODY:MAX_BODY);if(text===null)return null;
     const raw=format==='eia-json'?parseEiaSpotOilJson(symbol,JSON.parse(text)):format==='eia-html'?parseEiaSpotOilHistory(symbol,text,at):format==='fred-csv'?parseSpotOilCsv(symbol,text):JSON.parse(text);
     return spotOilDailyQuote(symbol,raw,at);
    }catch{return null;}
   };
   const requests:Promise<SessionQuote|null>[]=[],eia=eiaKey(),fred=fredKey();
   if(eia){
    const url=new URL('https://api.eia.gov/v2/petroleum/pri/spt/data/');
    url.search=new URLSearchParams({api_key:eia,frequency:'daily','data[0]':'value','facets[series][]':oil.eiaSeries,'sort[0][column]':'period','sort[0][direction]':'desc',start,end,length:'60'}).toString();
    requests.push(read(url,'eia-json'));
   }else requests.push(read(new URL(`https://www.eia.gov/dnav/pet/hist/${oil.history}`),'eia-html'));
   if(fred){
    const url=new URL('https://api.stlouisfed.org/fred/series/observations');
    url.search=new URLSearchParams({series_id:oil.series,api_key:fred,file_type:'json',observation_start:start,observation_end:end,units:'lin',output_type:'1',limit:'60',sort_order:'desc'}).toString();
    requests.push(read(url,'fred-json'));
   }
   const csv=new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');csv.search=new URLSearchParams({id:oil.series,cosd:start,coed:end}).toString();
   requests.push(read(csv,'fred-csv'));
   let results=await Promise.all(requests);
   // A configured API key may have expired. Public EIA remains independent.
   if(eia&&results[0]?.price==null)results.push(await read(new URL(`https://www.eia.gov/dnav/pet/hist/${oil.history}`),'eia-html'));
   const value=results.filter((item):item is SessionQuote=>item?.price!=null&&!!item.date).sort((a,b)=>b.date!.localeCompare(a.date!))[0]??spotOilDailyQuote(symbol,null,at)!;
   cache.set(symbol,{until:at+(value.price===null?120000:CACHE_TTL),value});return value;
  })().finally(()=>pending.delete(symbol));
  pending.set(symbol,operation);return {...await operation,label:name};
 };
}
export const spotOilQuote=createSpotOilQuotes();

export type AsiaStatus='open'|'pause'|'closed'|'awaiting-close'|'previous'|'unavailable';
export type AsiaMarket={symbol:string;name:string;country:string;timezone:string;open:number;close:number;pause?:[number,number]};
// Local regular-session hours, verified against JPX, KRX, HKEX and SSE.
// They classify observed sessions, not holidays: a new session requires dated data.
export const ASIA_MARKETS:AsiaMarket[]=[
 {symbol:'^N225',name:'Nikkei 225',country:'Japón',timezone:'Asia/Tokyo',open:540,close:930,pause:[690,750]},
 {symbol:'^KS11',name:'KOSPI',country:'Corea del Sur',timezone:'Asia/Seoul',open:540,close:930},
 {symbol:'^HSI',name:'Hang Seng',country:'Hong Kong',timezone:'Asia/Hong_Kong',open:570,close:970,pause:[720,780]},
 {symbol:'000001.SS',name:'Shanghai Composite',country:'China',timezone:'Asia/Shanghai',open:570,close:900,pause:[690,780]},
];
export type AsiaSession={symbol:string;name:string;country:string;timezone:string;status:AsiaStatus;date:string|null;price:number|null;change:number|null;at:string|null;previousClose:number|null;previousDate:string|null};
export type AsiaOpening={cutoff:string;summary:string;markets:AsiaSession[]};
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
function local(time:number,timezone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time),get=(key:string)=>p.find(v=>v.type===key)?.value??'';return {date:`${get('year')}-${get('month')}-${get('day')}`,minute:Number(get('hour'))*60+Number(get('minute'))};}
export function normalizeAsiaSession(market:AsiaMarket,daily:any,intraday:any,cutoff:number):AsiaSession{
 const c=daily?.chart?.result?.[0],meta=c?.meta??{},quote=c?.indicators?.quote?.[0],today=local(cutoff,market.timezone);
 let opening=market.open,closing=market.close;
 const period=meta.currentTradingPeriod?.regular;
 if(positive(period?.start)&&positive(period?.end)&&local(period.start*1000,market.timezone).date===today.date&&local(period.end*1000,market.timezone).date===today.date){
  opening=local(period.start*1000,market.timezone).minute;
  if(market.symbol==='^KS11')closing=opening+390; // Includes KRX's closing auction; also handles delayed openings.
  else if(market.symbol==='^HSI')closing=local(period.end*1000,market.timezone).minute; // Half-day sessions.
 }
 const rows=(c?.timestamp??[]).flatMap((t:number,i:number)=>positive(t)&&t*1000<=cutoff&&positive(quote?.close?.[i])?[{date:local(t*1000,market.timezone).date,price:quote.close[i]}]:[]).sort((a:any,b:any)=>a.date.localeCompare(b.date));
 const previous=rows.filter((r:any)=>r.date<today.date).at(-1),current=rows.find((r:any)=>r.date===today.date);
 const nativeTime=positive(meta.regularMarketTime)?meta.regularMarketTime*1000:null,nativeToday=nativeTime!==null&&nativeTime<=cutoff&&local(nativeTime,market.timezone).date===today.date&&local(nativeTime,market.timezone).minute>=opening&&positive(meta.regularMarketPrice);
 const base:AsiaSession={symbol:market.symbol,name:market.name,country:market.country,timezone:market.timezone,status:'unavailable',date:null,price:null,change:null,at:null,previousClose:null,previousDate:null};
 let price:number|null=null,at:number|null=null,status:AsiaStatus='unavailable',date:string|null=null;
 // Only a completed five-minute observation may enter a historical cutoff.
 // A native quote is usable only when its own timestamp is no later than cutoff.
 const minute=intraday?.chart?.result?.[0],mq=minute?.indicators?.quote?.[0];
 const bars=minute?.meta?.dataGranularity==='5m'?(minute.timestamp??[]).flatMap((t:number,i:number)=>{
  if(!positive(t)||t*1000+300000>cutoff||t*1000<cutoff-7*86400000)return [];
  const start=t*1000,end=start+300000,p=local(start,market.timezone);
  return positive(t)&&end<=cutoff&&p.date===today.date&&p.minute>=opening&&p.minute<closing&&positive(mq?.close?.[i])?[{at:end,price:mq.close[i]}]:[];
 }).sort((a:any,b:any)=>a.at-b.at):[];
 const last=bars.at(-1);
 const earliestClose=market.symbol==='^HSI'?closing-2:closing; // HKEX's closing auction ends randomly within its final two minutes.
 if(nativeToday&&today.minute>=closing&&local(nativeTime!,market.timezone).minute>=earliestClose){price=current?.price??meta.regularMarketPrice;at=nativeTime;date=today.date;status='closed';}
 else if(last||nativeToday){
  const observed=nativeToday&&(!last||nativeTime!>last.at)?{at:nativeTime!,price:meta.regularMarketPrice}:last!;
  price=observed.price;at=observed.at;date=today.date;
  status=today.minute>=closing?'awaiting-close':market.pause&&today.minute>=market.pause[0]&&today.minute<market.pause[1]?'pause':'open';
 }
 else if(previous){price=previous.price;date=previous.date;status='previous';if(nativeTime!==null&&nativeTime<=cutoff&&local(nativeTime,market.timezone).date===date)at=nativeTime;}
 const reference=date?rows.filter((r:any)=>r.date<date).at(-1):null;
 return {...base,status,date,price,at:at===null?null:new Date(at).toISOString(),previousClose:reference?.price??null,previousDate:reference?.date??null,change:price!==null&&positive(reference?.price)?(price/reference.price-1)*100:null};
}
const pct=(v:number)=>`${v>0?'+':''}${v.toLocaleString('es-ES',{maximumFractionDigits:2,minimumFractionDigits:2})} %`;
export function asiaSummary(markets:AsiaSession[],cutoff:number):string{
 const current=markets.filter(m=>m.price!==null&&m.date===local(cutoff,m.timezone).date),dated=current.filter(m=>m.change!==null);
 if(!current.length)return markets.some(m=>m.price!==null)?'No hay observaciones de una nueva sesión asiática al corte de esta edición. Se muestran las últimas sesiones disponibles, con su fecha.':'No se han podido verificar cotizaciones de las bolsas asiáticas al corte de esta edición.';
 const parts:string[]=[];
 if(dated.length){const up=dated.filter(m=>m.change!>0).length,down=dated.filter(m=>m.change!<0).length;parts.push(up===dated.length?'Los índices asiáticos con datos de esta sesión avanzan frente a sus cierres anteriores.':down===dated.length?'Los índices asiáticos con datos de esta sesión retroceden frente a sus cierres anteriores.':'La sesión asiática presenta un comportamiento mixto entre los índices con datos disponibles.');
  const ranked=[...dated].sort((a,b)=>b.change!-a.change!);parts.push(`${ranked[0].name} registra ${pct(ranked[0].change!)}${ranked.length>1?` y ${ranked.at(-1)!.name}, ${pct(ranked.at(-1)!.change!)}`:''}.`);}
 const partial=current.filter(m=>m.status!=='closed');
 parts.push(partial.length?`${partial.map(m=>m.name).join(', ')} ${partial.length===1?'todavía no tiene':'todavía no tienen'} un cierre confirmado al corte; sus variaciones son provisionales.`:'Los índices mostrados de esta sesión ya cuentan con su cierre.');
 if(current.length<markets.length)parts.push('Los demás mercados conservan su última sesión disponible o figuran sin datos.');
 return parts.join(' ');
}
async function minuteChart(symbol:string){try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m`,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error',signal:AbortSignal.timeout(10000)});return r.ok?await r.json():null;}catch{return null;}}
export async function collectAsia(cutoff:number,daily:(symbol:string)=>Promise<any>):Promise<AsiaOpening>{
 const markets:AsiaSession[]=new Array(ASIA_MARKETS.length);let cursor=0;
 await Promise.all(Array.from({length:2},async()=>{while(cursor<ASIA_MARKETS.length){const i=cursor++,market=ASIA_MARKETS[i],[d,m]=await Promise.all([daily(market.symbol),minuteChart(market.symbol)]);markets[i]=normalizeAsiaSession(market,d,m,cutoff);}}));
 return {cutoff:new Date(cutoff).toISOString(),markets,summary:asiaSummary(markets,cutoff)};
}

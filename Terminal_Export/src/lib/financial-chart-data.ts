export type SparklinePoint={t:number;v:number|null};
export function normalizeSparkline(candle:{t:unknown[];c:unknown[]}|null|undefined):SparklinePoint[]{
 if(!candle||!Array.isArray(candle.t)||!Array.isArray(candle.c))return [];
 const rows=new Map<number,number|null>();
 candle.t.forEach((raw,index)=>{
  if(typeof raw!=='number'||!Number.isFinite(raw)||raw<=0)return;
  const t=raw>100000000000?raw/1000:raw,value=candle.c[index];
  rows.set(t,typeof value==='number'&&Number.isFinite(value)?value:null);
 });
 return [...rows].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));
}
export function visibleSparkline(rows:SparklinePoint[],days:number|null){
 const end=rows.at(-1)?.t;if(end===undefined||days===null)return rows;
 return rows.filter(row=>row.t>=end-days*86400);
}
export function sparklineSummary(rows:SparklinePoint[]){
 const valid=rows.filter((p):p is SparklinePoint&{v:number}=>p.v!==null),values=valid.map(p=>p.v),first=valid[0],last=valid.at(-1);
 return {low:values.length?Math.min(...values):null,high:values.length?Math.max(...values):null,first,last,change:first&&last&&first.v>0?(last.v/first.v-1)*100:null};
}
export function chartDateLabel(value:string|number,full=false):string{
 const date=typeof value==='number'?new Date(value>100000000000?value:value*1000):new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value);
 if(!Number.isFinite(date.getTime()))return String(value);
 return date.toLocaleDateString('es-ES',{timeZone:'UTC',day:full?'2-digit':undefined,month:'short',year:full?'numeric':'2-digit'});
}
export function displayFractionPercent(value:unknown,digits=1):string{
 return typeof value==='number'&&Number.isFinite(value)?`${(value*100).toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits})}%`:'—';
}
export function percentageBarWidth(pct:number,max=100):number{
 return Number.isFinite(pct)&&Number.isFinite(max)&&max>0?Math.max(0,Math.min(100,pct/max*100)):0;
}
export function visibleDatedRows<T extends {date:string}>(rows:T[],days:number|null):T[]{
 if(days===null)return rows;
 const end=rows.map(row=>Date.parse(row.date)).filter(Number.isFinite).sort((a,b)=>a-b).at(-1);
 return end===undefined?[]:rows.filter(row=>Date.parse(row.date)>=end-days*86400000);
}
export function formatChartMoney(value:number|null|undefined,currency?:string,compact=false):string{
 if(value==null||!Number.isFinite(value))return '—';
 const unit=currency&&/^[A-Z]{3}$/.test(currency)?` ${currency}`:'',abs=Math.abs(value);
 const divisor=compact?(abs>=1e12?1e12:abs>=1e9?1e9:abs>=1e6?1e6:abs>=1e3?1e3:1):1;
 const suffix=divisor===1e12?' T':divisor===1e9?' B':divisor===1e6?' M':divisor===1e3?' K':'';
 return (value/divisor).toLocaleString('es-ES',{minimumFractionDigits:compact?0:2,maximumFractionDigits:compact?1:2})+suffix+unit;
}

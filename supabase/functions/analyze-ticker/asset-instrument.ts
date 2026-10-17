import {regularSessionEnd} from './market-session.ts';
export type InstrumentKind='index'|'etf'|'equity'|'future'|'other';
export type InstrumentInfo={kind:InstrumentKind;priceUnit:string;volumeUnit:'shares'|'fund-units'|'published'|'unavailable'};
export type SessionStats={date:string|null;partial:boolean;open:number|null;high:number|null;low:number|null;previousClose:number|null;volume:number|null;averageVolume20:number|null;volumeRatio:number|null;rangePercent:number|null;gapPercent:number|null;vol20:number|null;atr14:number|null;riskDate:string|null};
type Bar={time:number;open:number;high:number;low:number;close:number;volume:number|null};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const positive=(value:unknown)=>finite(value)&&value>0?value:null;
export function instrumentInfo(meta:Record<string,any>,symbol:string):InstrumentInfo{
  const type=String(meta.instrumentType??meta.quoteType??'').toUpperCase();
  const kind:InstrumentKind=type==='INDEX'||type==='INDICES'||symbol.startsWith('^')?'index':type==='FUTURE'||symbol.endsWith('=F')?'future':type==='ETF'?'etf':type==='EQUITY'?'equity':'other';
  return {kind,priceUnit:kind==='index'||symbol==='NQ=F'?'pts':String(meta.currency??''),volumeUnit:kind==='index'?'unavailable':kind==='etf'?'fund-units':kind==='equity'?'shares':'published'};
}
export function sessionStats(meta:Record<string,any>,daily:Bar[],info:InstrumentInfo,now=Date.now(),symbol=String(meta.symbol??'')):SessionStats{
  let zone=String(meta.exchangeTimezoneName??'UTC');try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{zone='UTC';}
  const day=(time:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
  const at=finite(meta.regularMarketTime)?meta.regularMarketTime*1000:null,date=at&&at<=now+60000?day(at):null;
  const ordered=daily.filter(b=>finite(b.time)&&b.time<=now&&positive(b.close)!==null).sort((a,b)=>a.time-b.time);
  const newest=[...ordered].reverse();
  const candle=newest.find(b=>date&&day(b.time)===date)??(info.kind==='future'&&at?newest.find(b=>b.time<=at&&at-b.time<48*3600000):undefined);
  const regularEnd=regularSessionEnd(meta,symbol);
  // Unknown closing time is conservatively treated as partial on the current date.
  const partial=!!date&&date===day(now)&&(!finite(regularEnd)||regularEnd*1000>now);
  const closed=ordered.filter(b=>b!==candle||!partial);
  const riskDate=closed.length?day(closed.at(-1)!.time):null;
  const open=positive(candle?.open)??positive(meta.regularMarketOpen),high=positive(candle?.high)??positive(meta.regularMarketDayHigh),low=positive(candle?.low)??positive(meta.regularMarketDayLow);
  const previous=candle?ordered.filter(b=>b.time<candle.time).at(-1):date?ordered.filter(b=>day(b.time)<date).at(-1):undefined;
  const previousClose=positive(previous?.close)??positive(meta.previousClose);
  const barVolume=positive(meta.regularMarketVolume)??positive(candle?.volume);
  const volume=info.volumeUnit==='unavailable'?null:barVolume;
  const prior=candle?ordered.filter(b=>b.time<candle.time).slice(-20):[];
  const averageVolume20=info.volumeUnit!=='unavailable'&&prior.length===20&&prior.every(b=>positive(b.volume)!==null)?prior.reduce((sum,b)=>sum+b.volume!,0)/20:null;
  const returns=closed.slice(-21).slice(1).map((b,i)=>Math.log(b.close/closed.slice(-21)[i].close));
  const mean=returns.length?returns.reduce((sum,v)=>sum+v,0)/returns.length:0;
  const vol20=returns.length===20?Math.sqrt(returns.reduce((sum,v)=>sum+(v-mean)**2,0)/19)*Math.sqrt(252)*100:null;
  let atr14:number|null=null;
  closed.forEach((b,i)=>{const tr=i?Math.max(b.high-b.low,Math.abs(b.high-closed[i-1].close),Math.abs(b.low-closed[i-1].close)):b.high-b.low;if(i===13){atr14=closed.slice(0,14).reduce((sum,c,j)=>sum+(j?Math.max(c.high-c.low,Math.abs(c.high-closed[j-1].close),Math.abs(c.low-closed[j-1].close)):c.high-c.low),0)/14;}else if(i>13)atr14=(atr14!*13+tr)/14;});
  return {date,partial,open,high,low,previousClose,volume,averageVolume20,volumeRatio:volume!==null&&averageVolume20?volume/averageVolume20:null,rangePercent:high!==null&&low!==null&&previousClose?(high-low)/previousClose*100:null,gapPercent:open!==null&&previousClose?(open/previousClose-1)*100:null,vol20,atr14,riskDate};
}
export const indexDescription=(symbol:string)=>({
  '^GSPC':'Índice de referencia de grandes empresas estadounidenses, ponderado por capitalización bursátil ajustada por capital flotante.',
  '^IXIC':'Índice de las empresas cotizadas en Nasdaq. Su composición tiene una presencia destacada de tecnología y negocios de crecimiento.',
  '^DJI':'Índice de treinta grandes empresas estadounidenses, ponderado por el precio de sus acciones.',
  '^KS11':'Índice de referencia del mercado de acciones de Corea del Sur, ponderado por capitalización bursátil.',
  '^N225':'Índice de 225 grandes empresas de la Bolsa de Tokio, ponderado por el precio de sus acciones.',
  '^VIX':'Índice de volatilidad implícita esperada del S&P 500 a treinta días. Se expresa en puntos de volatilidad; no es una acción ni un ETF.',
  'NQ=F':'Futuro continuo E-mini sobre el Nasdaq 100. El histórico enlaza vencimientos y puede registrar saltos al cambiar de contrato; no representa un vencimiento único.',
} as Record<string,string>)[symbol]??'';

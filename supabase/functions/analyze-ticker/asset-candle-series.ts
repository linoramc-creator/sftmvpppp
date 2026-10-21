import {regularSessionEnd} from './market-session.ts';
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number|null;partial?:boolean};
export type CandleInterval='1h'|'4h'|'1d'|'1w';
export type CandleSeries={candles:Candle[];timezone:string;session:string};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function previousSessionCandle(candles:Candle[],quoteAt:number,timezone='America/New_York'):Candle|undefined{
  if(!finite(quoteAt)||quoteAt<=0)return;
  try{
    const sessionDate=(time:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
    const date=sessionDate(quoteAt);
    return candles.filter(c=>finite(c.time)&&c.time<quoteAt&&finite(c.close)&&c.close>0&&sessionDate(c.time)<date).sort((a,b)=>a.time-b.time).at(-1);
  }catch{return;}
}
export function selectFourHourCandles(extended:Candle[],regular:Candle[]):{candles:Candle[];extended:boolean}{
  // Use a complete provider series, never splice different session anchors.
  // Some plans stop at yesterday; a newer regular-session series takes priority.
  const useExtended=extended.length>0&&(!regular.length||extended.at(-1)!.time>=regular.at(-1)!.time);
  return {candles:useExtended?extended:regular,extended:useExtended};
}

export function validCandle(c:Candle,now=Date.now()){return [c.time,c.open,c.high,c.low,c.close].every(finite)&&c.time>0&&c.time<=now+60000&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.high>=c.low;}
export function chartCandles(chart:any,duration:number,now=Date.now()):Candle[]{
  const q=chart?.indicators?.quote?.[0];if(!q)return [];
  let zone=chart?.meta?.exchangeTimezoneName??'UTC';try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{zone='UTC';}
  const formatDay=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}),today=formatDay.format(now),end=regularSessionEnd(chart.meta??{},String(chart.meta?.symbol??''));
  const rows=new Map<number,Candle>();
  for(let i=0;i<(chart.timestamp??[]).length;i++){
    const time=chart.timestamp[i]*1000;
    if(!finite(time)||time<=0||time>now)continue;
    const c:Candle={time,open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:finite(q.volume?.[i])&&q.volume[i]>=0?q.volume[i]:null,partial:duration===86400000?formatDay.format(time)===today&&(!finite(end)||end*1000>now):time+duration>now};
    if(validCandle(c,now)&&time<=now)rows.set(time,c);
  }
  const sorted=[...rows.values()].sort((a,b)=>a.time-b.time);
  if(duration<86400000&&sorted.length>1){
    const last=sorted.at(-1)!,previous=sorted.at(-2)!;
    // Some chart responses append a timestamped quote inside the current bar.
    // A flat, zero-volume quote at regularMarketTime is not another OHLC bar.
    const quoteMarker=last.time===chart.meta?.regularMarketTime*1000||finite(end)&&last.time===end*1000;
    if(quoteMarker&&last.time-previous.time<duration&&last.open===last.high&&last.high===last.low&&last.low===last.close&&(last.volume===null||last.volume===0))sorted.pop();
  }
  // Yahoo can append a live quote after the current daily/weekly aggregate.
  // It is a snapshot, not an additional candle for that same trading period.
  if(duration>=86400000&&sorted.length>1){
    const last=sorted.at(-1)!,previous=sorted.at(-2)!;
    const period=(time:number)=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:chart.meta?.exchangeTimezoneName??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(time);const value=(type:string)=>Number(parts.find(p=>p.type===type)?.value);const day=new Date(Date.UTC(value('year'),value('month')-1,value('day')));if(duration>=7*86400000)day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.getTime();};
    if(last.time===chart.meta?.regularMarketTime*1000&&period(last.time)===period(previous.time))sorted.pop();
  }
  return sorted;
}
export function hourlyToFourHours(chart:any,now=Date.now()):Candle[]{
  const q=chart?.indicators?.quote?.[0];if(!q)return [];
  let zone=String(chart.meta?.exchangeTimezoneName??'UTC');try{new Intl.DateTimeFormat('en-US',{timeZone:zone});}catch{zone='UTC';}
  const groups=new Map<string,Candle[]>();
  const minuteOfDay=(time:number)=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time);return Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);};
  const sessionStart=chart.meta?.currentTradingPeriod?.regular?.start;
  const anchorMinutes=finite(sessionStart)?minuteOfDay(sessionStart*1000):['EQUITY','ETF'].includes(chart.meta?.instrumentType)?570:0;
  const overnight=chart.meta?.instrumentType==='FUTURE'&&anchorMinutes>=720;
  for(const c of chartCandles(chart,3600000,now)){
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(c.time),minutes=minuteOfDay(c.time);
    // Overnight futures belong to the session that opened the preceding evening.
    // Keep the four-hour anchor across midnight without combining two sessions.
    const sessionDay=overnight&&minutes<anchorMinutes?new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10):date;
    const relative=overnight?(minutes-anchorMinutes+1440)%1440:minutes-anchorMinutes;
    const key=sessionDay+':'+Math.floor(relative/240);const rows=groups.get(key)??[];rows.push(c);groups.set(key,rows);
  }
  return [...groups.values()].map(group=>{const rows=group.sort((a,b)=>a.time-b.time);return {time:rows[0].time,open:rows[0].open,high:Math.max(...rows.map(c=>c.high)),low:Math.min(...rows.map(c=>c.low)),close:rows.at(-1)!.close,volume:rows.every(c=>c.volume!==null)?rows.reduce((v,c)=>v+c.volume!,0):null,partial:rows.length<4||rows.some((c,i)=>i>0&&c.time-rows[i-1].time!==3600000)||rows.at(-1)!.time+3600000>now};}).sort((a,b)=>a.time-b.time);
}

const epoch=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
/** Regular-session end in Unix seconds. Keep the exchange's own session date. */
export function regularSessionEnd(meta:any,symbol:string):number|null{
 const period=meta?.currentTradingPeriod?.regular;
 // The KOSPI cash session lasts 09:00–15:30 KST. Some chart metadata still
 // ends it at 15:00; do not mark the final half-hour as a completed session.
 if(symbol==='^KS11'&&epoch(period?.start))return Math.max(epoch(period?.end)?period.end:0,period.start+6.5*3600);
 return epoch(period?.end)?period.end:null;
}

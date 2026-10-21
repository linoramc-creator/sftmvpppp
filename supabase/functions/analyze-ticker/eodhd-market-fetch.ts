import {eodhdForYahooUrl} from './eodhd-market.ts';

type Options={primary?:(url:string)=>Promise<any>;fetcher?:typeof fetch;acceptPrimary?:(raw:any)=>boolean;timeoutMs?:number};
const chartRoute=(value:string,init:RequestInit)=>{
 if(init.method&&init.method.toUpperCase()!=='GET')return false;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(url.hostname)&&/^\/v8\/finance\/chart\/[^/]+$/.test(url.pathname);}catch{return false;}
};
function hasChart(raw:any){const c=raw?.chart?.result?.[0];return Array.isArray(c?.timestamp)&&c.timestamp.some((t:unknown,i:number)=>typeof t==='number'&&Number.isFinite(t)&&typeof c.indicators?.quote?.[0]?.close?.[i]==='number'&&Number.isFinite(c.indicators.quote[0].close[i])&&c.indicators.quote[0].close[i]>0);}

/** EODHD is primary for eligible market history; the original transport runs
 * only if that source is unavailable or unsuitable for this consumer. External
 * providers, authenticated requests and injected fetchers retain their options.
 */
export async function marketJson(url:string,init:RequestInit={},options:Options={}):Promise<any>{
 if(chartRoute(url,init))try{const raw=await (options.primary??eodhdForYahooUrl)(url);if(hasChart(raw)&&(!options.acceptPrimary||options.acceptPrimary(raw)))return raw;}catch{/* Fall back to the existing market feed without exposing provider errors. */}
 try{const response=await (options.fetcher??fetch)(url,{...init,...(options.timeoutMs?{signal:AbortSignal.timeout(options.timeoutMs)}:{})});return response.ok?await response.json():null;}catch{return null;}
}

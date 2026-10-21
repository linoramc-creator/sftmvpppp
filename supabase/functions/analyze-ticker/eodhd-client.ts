// Server-only EODHD transport. Never return URLs, tokens or provider error bodies.
type Query=Record<string,string|number|undefined>;
export type EodhdOptions={ttlMs?:number;cost?:number;timeoutMs?:number};
const readKey=()=>{try{return (globalThis as any).Deno?.env?.get('EODHD_API_KEY')??'';}catch{return '';}};
export const eodhdEnabled=()=>Boolean(readKey());
export function eodhdSymbol(value:string):string|null{
 const symbol=value.trim().toUpperCase();if(!/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/.test(symbol))return null;
 const index=({'^GSPC':'GSPC','^NDX':'NDX','^IXIC':'IXIC','^DJI':'DJI','^VIX':'VIX','^N225':'N225','^KS11':'KS11','^HSI':'HSI','^STOXX50E':'STOXX50E'} as Record<string,string>)[symbol];if(index)return index+'.INDX';
 if(symbol.endsWith('=X')){const pair=symbol.slice(0,-2);return /^[A-Z]{6}$/.test(pair)?pair+'.FOREX':/^[A-Z]{3}$/.test(pair)?'USD'+pair+'.FOREX':null;}
 if(/^[A-Z0-9]+-USD$/.test(symbol))return symbol+'.CC';
 if(symbol.startsWith('^')||symbol.includes('='))return null;
 const suffix=symbol.match(/\.([A-Z]+)$/)?.[1];
 if(suffix){const exchange=({L:'LSE',DE:'XETRA',PA:'PA',AS:'AS',MI:'MI',MC:'MC',SW:'SW',TO:'TO',V:'V',AX:'AU',HK:'HK',US:'US',LSE:'LSE',XETRA:'XETRA',FOREX:'FOREX',CC:'CC',INDX:'INDX',GBOND:'GBOND'} as Record<string,string>)[suffix];return exchange?symbol.slice(0,-suffix.length)+exchange:null;}
 return symbol+'.US';
}
export function mergeEodhdPriority<T>(primary:T|null|undefined,fallback:T|null|undefined):T|null{
 const absent=(v:any)=>v===null||v===undefined||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&!v.trim()||Array.isArray(v)&&v.length===0;
 if(absent(primary))return fallback??null;if(absent(fallback))return primary!;
 if(typeof primary!=='object'||Array.isArray(primary)||typeof fallback!=='object'||Array.isArray(fallback))return primary!;
 const out:any={};for(const key of new Set([...Object.keys(fallback as object),...Object.keys(primary as object)])){if(['__proto__','prototype','constructor'].includes(key))continue;out[key]=mergeEodhdPriority((primary as any)[key],(fallback as any)[key]);}return out;
}
export function createEodhdClient({apiKey,fetcher=fetch,now=Date.now}:{apiKey:string;fetcher?:typeof fetch;now?:()=>number}){
 const cache=new Map<string,{until:number;value:unknown;bytes:number}>(),pending=new Map<string,Promise<unknown>>(),denied=new Map<string,number>();
 let unavailableUntil=0,active=0,cacheBytes=0;const queue:(()=>void)[]=[];
 const remember=(id:string,value:unknown,ttl:number,bytes=16)=>{const old=cache.get(id);if(old)cacheBytes-=old.bytes;cache.delete(id);while(cache.size&&(cache.size>=150||cacheBytes+bytes>24000000)){const key=cache.keys().next().value!;cacheBytes-=cache.get(key)!.bytes;cache.delete(key);}if(bytes<=8000000){cache.set(id,{until:now()+ttl,value,bytes});cacheBytes+=bytes;}};
 const slot=async()=>{if(active>=6)await new Promise<void>(resolve=>queue.push(resolve));active++;};
 const release=()=>{active--;queue.shift()?.();};
 return async function get<T=unknown>(path:string,query:Query={},options:EodhdOptions={}):Promise<T|null>{
  if(!apiKey||!/^[-A-Za-z0-9_/+.]+$/.test(path)||path.includes('..')||path.startsWith('/')||Object.keys(query).some(k=>/api_token|token|key|fmt/i.test(k)))return null;
  const args=new URLSearchParams();for(const[k,v]of Object.entries(query).sort(([a],[b])=>a.localeCompare(b)))if(v!==undefined)args.set(k,String(v));
  const id=path+'?'+args.toString(),hit=cache.get(id),family=path.split('/')[0];if(hit&&hit.until>now())return hit.value as T;
  if(unavailableUntil>now()||(denied.get(family)??0)>now())return null;
  if(pending.has(id))return pending.get(id) as Promise<T|null>;
  const task=(async()=>{await slot();try{
   if(unavailableUntil>now()||(denied.get(family)??0)>now())return null;
   args.set('api_token',apiKey);args.set('fmt','json');const url=new URL('https://eodhd.com/api/'+path);url.search=args.toString();
   const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(Math.min(15000,options.timeoutMs??8000)),headers:{Accept:'application/json'}});
   if(!response.ok){if(response.status===401)unavailableUntil=now()+1800000;else if(response.status===403)denied.set(family,now()+1800000);else if(response.status===402)unavailableUntil=Date.parse(new Date(now()+86400000).toISOString().slice(0,10)+'T00:00:00Z');else if(response.status===429){const retry=response.headers.get('Retry-After'),seconds=Number(retry),date=Date.parse(retry??'');unavailableUntil=now()+Math.max(1000,Math.min(300000,Number.isFinite(seconds)&&seconds>0?seconds*1000:Number.isFinite(date)?date-now():60000));}await response.body?.cancel();remember(id,null,60000);return null;}
   const raw=await response.json();if(raw===null||typeof raw!=='object'||(!Array.isArray(raw)&&(raw.error||raw.errors)))return null;
   remember(id,raw,Array.isArray(raw)&&!raw.length?60000:options.ttlMs??300000,JSON.stringify(raw).length*2);return raw as T;
  }catch{return null;}finally{release();}})().finally(()=>pending.delete(id));pending.set(id,task);return task as Promise<T|null>;
 };
}
const clients=new Map<string,ReturnType<typeof createEodhdClient>>();
export async function eodhdGet<T=unknown>(path:string,query:Query={},options:EodhdOptions={}):Promise<T|null>{const apiKey=readKey();if(!apiKey)return null;let client=clients.get(apiKey);if(!client){if(clients.size>=2)clients.delete(clients.keys().next().value!);client=createEodhdClient({apiKey});clients.set(apiKey,client);}return client<T>(path,query,options);}

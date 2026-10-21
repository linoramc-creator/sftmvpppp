import {eodhdGet,eodhdSymbol,terminalInstrumentSymbol,EODHD_EXCHANGES} from './eodhd-client.ts';
export {terminalInstrumentSymbol} from './eodhd-client.ts';

type Row=Record<string,any>;
export type InstrumentType='stock'|'etf'|'fund'|'index'|'forex'|'crypto'|'bond';
export type ResolvedInstrument={symbol:string;providerSymbol:string;name:string;exchange:string;type:InstrumentType;currency:string|null;isin:string|null;primary:boolean};
export type InstrumentResolution={query:string;status:'resolved'|'ambiguous'|'not-found'|'invalid'|'unavailable';instrument:ResolvedInstrument|null;candidates:ResolvedInstrument[]};
type SearchRequest=<T=unknown>(path:string,query?:Record<string,string|number|undefined>,options?:{ttlMs?:number;cost?:number;timeoutMs?:number})=>Promise<T|null>;
type ResolveOptions={exchange?:string;type?:InstrumentType;request?:SearchRequest};
const clean=(value:unknown,max=100)=>typeof value==='string'&&value.trim().length<=max&&!/[<>\u0000-\u001f\u007f]/.test(value)?value.trim():null;
const kind=(row:Row):InstrumentType|null=>row.Exchange==='FOREX'?'forex':row.Exchange==='CC'?'crypto':row.Exchange==='GBOND'?'bond':({ETF:'etf',FUND:'fund','MUTUAL FUND':'fund',INDEX:'index','COMMON STOCK':'stock','PREFERRED STOCK':'stock','PREFERRED SHARE':'stock',BOND:'bond'} as Record<string,InstrumentType>)[String(row.Type).toUpperCase()]??null;
const safeCode=(value:unknown)=>typeof value==='string'&&/^[A-Z0-9][A-Z0-9.-]{0,22}$/.test(value)?value:null;

export function normalizeInstrumentSearch(input:unknown):ResolvedInstrument[]{
 if(!Array.isArray(input))return [];
 const found=new Map<string,ResolvedInstrument>();
 for(const row of input.slice(0,100)){
  if(!row||typeof row!=='object')continue;const code=safeCode(row.Code),exchange=typeof row.Exchange==='string'?row.Exchange:'',type=kind(row),name=clean(row.Name,300);
  if(!code||!EODHD_EXCHANGES.has(exchange)||!type||!name)continue;
  const providerSymbol=code+'.'+exchange,symbol=terminalInstrumentSymbol(providerSymbol);if(!symbol||symbol.length>25)continue;
  const currency=typeof row.Currency==='string'&&/^(?:[A-Z]{3}|GBp)$/.test(row.Currency)?row.Currency==='GBp'?'GBX':row.Currency:null;
  const isin=typeof row.ISIN==='string'&&/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(row.ISIN)?row.ISIN:null;
  found.set(providerSymbol,{symbol,providerSymbol,name,exchange,type,currency,isin,primary:row.isPrimary===true});
 }
 return [...found.values()];
}

/** Resolve names and supported symbols without AI, ticker guessing or changing
 * an explicitly requested listing. Plain exact US tickers retain the terminal's
 * existing US convention; an ambiguous company name requires user selection.
 */
export async function resolveInstrument(value:unknown,options:ResolveOptions={}):Promise<InstrumentResolution>{
 const query=clean(value),base:InstrumentResolution={query:query??'',status:'invalid',instrument:null,candidates:[]};
 if(!query||query.length<1||/https?:|:\/\/|api[_-]?(?:token|key)\s*=|[?{}\[\]\\]/i.test(query))return base;
 const type=options.type;if(type&&!['stock','etf','fund','index','forex','crypto','bond'].includes(type))return base;
 const requestedExchange=options.exchange?.trim().toUpperCase();if(requestedExchange&&!EODHD_EXCHANGES.has(requestedExchange))return base;
 const pair=/^([A-Z]{3})\s*\/\s*([A-Z]{3})$/i.exec(query),symbolQuery=pair?pair[1]+pair[2]+'=X':query;
 const ticker=/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/i.test(symbolQuery)?eodhdSymbol(symbolQuery):null;
 const explicit=(!!pair||/[.^=]/.test(query))&&!!ticker,provider=ticker?{code:ticker.slice(0,ticker.lastIndexOf('.')),exchange:ticker.slice(ticker.lastIndexOf('.')+1)}:null;
 if(!ticker&&/^[A-Z0-9-]+\.[A-Z]{1,10}$/i.test(query))return {...base,status:'not-found'};
 if(explicit&&requestedExchange&&provider?.exchange!==requestedExchange)return base;
 const exchange=requestedExchange??(explicit?provider?.exchange:undefined),search=provider&&explicit?provider.code:query;
 const path='search/'+encodeURIComponent(search).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 let raw:unknown;try{raw=await (options.request??eodhdGet)(path,{limit:30,...(exchange?{exchange}:{})},{ttlMs:3600000,cost:1,timeoutMs:8000});}catch{raw=null;}
 if(raw===null)return {...base,status:'unavailable'};
 let candidates=normalizeInstrumentSearch(raw).filter(row=>(!exchange||row.exchange===exchange)&&(!type||row.type===type));
 if(explicit&&provider)candidates=candidates.filter(row=>row.providerSymbol===ticker);
 else if(provider){const exact=candidates.filter(row=>row.providerSymbol===ticker);if(exact.length)candidates=exact;}
 // A typo with an explicit, unsupported suffix must not become a homonymous
 // company in another country through a broad text search.
 if(!ticker&&/^[A-Z0-9-]+\.[A-Z]{1,10}$/i.test(query))return {...base,status:'not-found'};
 const normalized=query.toLowerCase().replace(/\s+/g,' '),names=candidates.filter(row=>row.name.toLowerCase().replace(/\s+/g,' ')===normalized);
 if(names.length)candidates=names;
 candidates=candidates.sort((a,b)=>Number(b.primary)-Number(a.primary)||a.name.localeCompare(b.name)||a.providerSymbol.localeCompare(b.providerSymbol)).slice(0,20);
 if(candidates.length===1)return {...base,status:'resolved',instrument:candidates[0],candidates};
 return {...base,status:candidates.length?'ambiguous':'not-found',candidates};
}

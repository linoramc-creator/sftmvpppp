import {resolveInstrument,type InstrumentResolution,type ResolvedInstrument,type InstrumentType} from './instrument-resolver.ts';
import {eodhdGet,eodhdSymbol,terminalInstrumentSymbol} from './eodhd-client.ts';
import {FEED_SUGGESTIONS,normalizeFeedSymbol} from './feed-preferences.ts';
import {cached} from './panels.ts';
type Row=Record<string,any>;
type Dependencies={catalog?:(query:string)=>Promise<InstrumentResolution>;search?:(query:string)=>Promise<unknown>;chart?:(symbol:string)=>Promise<unknown>};
const symbolOk=(s:unknown):s is string=>typeof s==='string'&&/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(s);
const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,max):'';
const simplify=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const type=(v:unknown):InstrumentType|null=>({EQUITY:'stock',ETF:'etf',MUTUALFUND:'fund',INDEX:'index',CURRENCY:'forex',CRYPTOCURRENCY:'crypto',FUTURE:'future',BOND:'bond'} as Record<string,InstrumentType>)[String(v).toUpperCase()]??null;
const safe=async<T>(p:Promise<T>):Promise<T|null>=>{try{return await p;}catch{return null;}};
async function get(url:string){try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'error',signal:AbortSignal.timeout(4000)});if(!r.ok){await r.body?.cancel();return null;}return r.json();}catch{return null;}}
function item(symbol:string,meta:Row):ResolvedInstrument|null{
 const kind=type(meta.quoteType??meta.instrumentType),name=clean(meta.longname??meta.longName??meta.shortname??meta.shortName,300);
 if(!symbolOk(symbol)||!kind||!name)return null;
 return {symbol,providerSymbol:symbol,name,exchange:clean(meta.exchange??meta.exchangeName,20),type:kind,currency:typeof meta.currency==='string'&&/^(?:[A-Z]{3}|GBp)$/.test(meta.currency)?meta.currency==='GBp'?'GBX':meta.currency:null,isin:null,primary:false};
}
export function quickSearchCatalogSymbol(query:string):string|null{
 for(const group of ['indices','etfs','currencies'] as const){const canonical=normalizeFeedSymbol(group,query),known=FEED_SUGGESTIONS[group].find(([s,label])=>s===canonical||simplify(label)===simplify(query));if(known)return known[0];}
 return null;
}
/** A quick market lookup has its own scope: report ticker resolution and its
 * existing fallback policy remain unchanged. No model or research is invoked. */
export async function loadQuickInstrumentSearch(value:unknown,deps:Dependencies={}):Promise<InstrumentResolution>{
 const query=typeof value==='string'?value.trim():'',base:InstrumentResolution={query,status:'invalid',instrument:null,candidates:[]};
 if(!query||query.length>100||/[<>\p{Cc}\p{Cf}]|https?:|:\/\/|[?{}\[\]\\]|api[_-]?(?:key|token)\s*=/iu.test(query))return base;
 const readChart=deps.chart??(s=>get('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(s)+'?range=5d&interval=1d'));
 const known=quickSearchCatalogSymbol(query);
 if(known){const raw=await safe(readChart(known)),meta=(raw as Row)?.chart?.result?.[0]?.meta;if(meta?.symbol===known){const verified=item(known,meta);if(verified)return {...base,status:'resolved',instrument:verified,candidates:[verified]};}}
 const [primary,raw]=await Promise.all([safe((deps.catalog??(q=>resolveInstrument(q,{request:(path,args,options)=>eodhdGet(path,args,{...options,timeoutMs:4000})})))(query)),safe((deps.search??(q=>get('https://query1.finance.yahoo.com/v1/finance/search?'+new URLSearchParams({q,quotesCount:'12',newsCount:'0',enableFuzzyQuery:'false'}))))(query))]);
 if(primary?.status==='invalid')return primary;
 const found=new Map<string,ResolvedInstrument>();
 for(const row of primary?.candidates??[])if(symbolOk(row.symbol))found.set(row.symbol,row);
 for(const row of Array.isArray((raw as Row)?.quotes)?(raw as Row).quotes:[]){const candidate=item(row.symbol,row);if(candidate&&!found.has(candidate.symbol))found.set(candidate.symbol,candidate);}
 let candidates=[...found.values()].slice(0,12);
 if(/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/i.test(query)&&/[.^=]/.test(query)){const requested=eodhdSymbol(query),canonical=known??(requested?terminalInstrumentSymbol(requested):null)??query.toUpperCase();candidates=candidates.filter(r=>r.symbol===canonical);}
 const exact=candidates.filter(r=>r.symbol.toUpperCase()===query.toUpperCase()||r.symbol===known);if(exact.length)candidates=exact;
 // Explicit international listings and FX pairs never fall through to a
 // homonymous company on a different exchange.
 if(!candidates.length&&!known){const q=query.toUpperCase();if(symbolOk(q)){const chart=await safe(readChart(q)),meta=(chart as Row)?.chart?.result?.[0]?.meta;if(meta?.symbol===q){const verified=item(q,meta);if(verified)candidates=[verified];}}}
 if(candidates.length===1)return {...base,status:'resolved',instrument:candidates[0],candidates};
 return {...base,status:candidates.length?'ambiguous':primary?.status==='unavailable'&&raw===null?'unavailable':'not-found',candidates};
}
export function quickInstrumentSearch(query:string){return cached('quick-instrument-search-v1:'+query.trim().toUpperCase(),120000,()=>loadQuickInstrumentSearch(query));}

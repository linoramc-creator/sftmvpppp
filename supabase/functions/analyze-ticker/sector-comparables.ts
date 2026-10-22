import {cached} from './panels.ts';
import {eodhdGet,eodhdSymbol,terminalInstrumentSymbol} from './eodhd-client.ts';
import {eodhdSummary} from './eodhd-fundamentals.ts';
import {eodhdQuote} from './eodhd-market.ts';
import {sectorReference} from './sector-fundamentals.ts';
type Row=Record<string,any>;
export type ComparableCompany={symbol:string;name:string;country:string|null;sector:string|null;industry:string|null;currency:string|null;capitalCurrency:string|null;financialCurrency:string|null;quoteAt:string|null;recordDate:string|null;issuerId:string;subject:boolean;price:number|null;marketCap:number|null;pe:number|null;forwardPe:number|null;pb:number|null;evEbitda:number|null;roe:number|null;netMargin:number|null;revenueGrowth:number|null;beta:number|null};
export type SectorComparables={subject:string;mode:'ticker'|'sector';fetchedAt:string;basis:'industry'|'related'|'fund-sample'|'unavailable';reference:{symbol:string;name:string;date:string|null}|null;companies:ComparableCompany[];note:string};
type Env={FINNHUB_KEY?:string;MASSIVE_API_KEY?:string};
type Dependencies={summary?:(symbol:string,modules?:string)=>Promise<Row|null>;quote?:typeof eodhdQuote;request?:typeof eodhdGet;related?:(symbol:string)=>Promise<unknown>;hints?:{symbol:string;name:string}[];now?:number};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const num=(v:unknown):number|null=>{if(finite(v))return v;if(v&&typeof v==='object')return num((v as Row).raw);if(typeof v==='string'&&/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v.trim())){const n=Number(v);return Number.isFinite(n)?n:null;}return null;};
const text=(v:unknown,max=200)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):null;
const date=(v:unknown,now:number)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=new Date(now).toISOString().slice(0,10)?v:null;
const symbol=(value:unknown)=>typeof value==='string'&&value.length<=35?terminalInstrumentSymbol(value):null;
const unique=(values:string[])=>[...new Set(values)];
const plainName=(value:string)=>value.toLowerCase().replace(/\b(class\s+[a-z]|adr|sponsored|unsponsored|incorporated|inc|corporation|corp|limited|ltd|plc|sa|nv|ag)\b/g,'').replace(/[^a-z0-9]/g,'');
const modules='quoteType,assetProfile,price,summaryDetail,defaultKeyStatistics,financialData';
async function relatedSymbols(ticker:string,env:Env):Promise<string[]>{
 if(env.FINNHUB_KEY)try{const response=await fetch(`https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(env.FINNHUB_KEY)}`,{redirect:'error',signal:AbortSignal.timeout(5000)});const raw=response.ok?await response.json():null;if(Array.isArray(raw)&&raw.length)return unique(raw.map(symbol).filter((s):s is string=>!!s&&s!==ticker)).slice(0,8);}catch{/* Try another bounded related-company source. */}
 if(env.MASSIVE_API_KEY&&/^[A-Z][A-Z0-9-]{0,12}$/.test(ticker))try{const response=await fetch(`https://api.massive.com/v1/related-companies/${encodeURIComponent(ticker)}`,{headers:{Authorization:'Bearer '+env.MASSIVE_API_KEY},redirect:'error',signal:AbortSignal.timeout(5000)});const raw=response.ok?await response.json():null;return Array.isArray(raw?.results)?unique(raw.results.map((r:Row)=>symbol(r.ticker)).filter((s:string|null):s is string=>!!s&&s!==ticker)).slice(0,8):[];}catch{/* Missing entitlements do not become fabricated comparables. */}
 return [];
}
/** Bounded, cached industry screening. Listing venue and liquidity prevent
 * duplicate illiquid secondary listings from crowding out comparable firms. */
export async function discoverTickerPeers(ticker:string,summary:Row|null,env:Env={},deps:Dependencies={}):Promise<{symbols:string[];basis:SectorComparables['basis']}>{
 ticker=symbol(ticker)??ticker;
 const industry=text(summary?.assetProfile?.industry,150),provider=eodhdSymbol(ticker),exchange=provider?.slice(provider.lastIndexOf('.')+1),request=deps.request??eodhdGet;
 let peers:string[]=[];
 if(industry&&exchange&&exchange!=='INDX'){
  const raw=await request<Row>('screener',{filters:JSON.stringify([['exchange','=',exchange.toLowerCase()],['industry','=',industry],['avgvol_200d','>',100000]]),sort:'market_capitalization.desc',limit:8},{ttlMs:86400000,cost:5,timeoutMs:8000}).catch(()=>null);
  const issuerName=plainName(summary?.quoteType?.longName??summary?.price?.longName??'');
  peers=unique((Array.isArray(raw?.data)?raw.data:[]).flatMap((r:Row)=>{const s=symbol(`${r.code}.${r.exchange}`),name=plainName(String(r.name??''));return s&&s!==ticker&&(!issuerName||!name||name!==issuerName)&&String(r.industry??'').toLowerCase()===industry.toLowerCase()?[s]:[];}));
 }
 if(peers.length>=3)return{symbols:peers.slice(0,8),basis:'industry'};
 const fallback=await (deps.related??((s:string)=>relatedSymbols(s,env)))(ticker);
 const related=Array.isArray(fallback)?fallback.map(symbol).filter((s):s is string=>!!s&&s!==ticker):[];
 return{symbols:unique([...peers,...related]).slice(0,8),basis:related.length?'related':peers.length?'industry':'unavailable'};
}
export function comparableCompany(ticker:string,summary:Row|null,quote:Row|null,subject=false,now=Date.now()):ComparableCompany|null{
 const canonical=symbol(ticker);if(!canonical)return null;ticker=canonical;
 const type=summary?.quoteType?.quoteType??summary?.price?.quoteType,name=text(summary?.quoteType?.longName??summary?.price?.longName,300),actual=summary?.quoteType?.symbol??summary?.price?.symbol;
 if(type!=='EQUITY'||!name||symbol(actual)!==ticker)return null;
 const p=summary?.price??{},s=summary?.summaryDetail??{},k=summary?.defaultKeyStatistics??{},f=summary?.financialData??{};
 const currency=p.currency==='GBp'?'GBX':typeof p.currency==='string'&&/^[A-Z]{3}$/.test(p.currency)?p.currency:null,capitalCurrency=currency==='GBX'?'GBP':currency;
 const candidate=quote?.currency===currency&&num(quote?.close)!==null?{price:num(quote!.close),at:num(quote!.timestamp)}:{price:num(p.regularMarketPrice),at:num(p.regularMarketTime)};
 const dated=candidate.at!==null&&candidate.at>0&&candidate.at*1000<=now+60000;
 const percent=(v:unknown)=>{const n=num(v);return n===null?null:n*100;};
 return{symbol:ticker,name,country:text(summary?.assetProfile?.country,100),sector:text(summary?.assetProfile?.sector,150),industry:text(summary?.assetProfile?.industry,150),currency,capitalCurrency,financialCurrency:text(f.financialCurrency,12),quoteAt:dated?new Date(candidate.at!*1000).toISOString():null,recordDate:date(summary?.eodhd?.updatedAt,now),issuerId:text(summary?.eodhd?.cik,20)??(plainName(name)||ticker),subject,price:currency&&dated&&candidate.price!==null&&candidate.price>0?candidate.price:null,marketCap:currency?num(p.marketCap):null,pe:num(s.trailingPE??k.trailingPE),forwardPe:num(s.forwardPE??k.forwardPE),pb:num(k.priceToBook??s.priceToBook),evEbitda:num(k.enterpriseToEbitda),roe:percent(f.returnOnEquity),netMargin:percent(f.profitMargins),revenueGrowth:percent(f.revenueGrowth),beta:num(k.beta??s.beta)};
}
export async function loadComparableCompanies(symbols:string[],subject:string|null,deps:Dependencies={}):Promise<ComparableCompany[]>{
 const read=deps.summary??eodhdSummary,quote=deps.quote??eodhdQuote,now=deps.now??Date.now(),wanted=unique(symbols.map(symbol).filter((s):s is string=>!!s)).slice(0,8),canonicalSubject=subject?symbol(subject):null,rows:(ComparableCompany|null)[]=new Array(wanted.length);let next=0;
 await Promise.all(Array.from({length:Math.min(3,wanted.length)},async()=>{while(next<wanted.length){const i=next++,ticker=wanted[i];try{
  const [summary,price]=await Promise.allSettled([read(ticker,modules),quote(ticker)]);
  rows[i]=comparableCompany(ticker,summary.status==='fulfilled'?summary.value:null,price.status==='fulfilled'?price.value:null,ticker===canonicalSubject,now);
 }catch{rows[i]=null;}}}));
 const seen=new Set<string>();return rows.filter((row):row is ComparableCompany=>{if(!row||seen.has(row.issuerId))return false;seen.add(row.issuerId);return true;});
}
export async function loadSectorComparables(subject:string,mode:'ticker'|'sector',env:Env={},deps:Dependencies={}):Promise<SectorComparables>{
 const read=deps.summary??eodhdSummary,now=deps.now??Date.now();let candidates:string[]=[],basis:SectorComparables['basis']='unavailable',reference:SectorComparables['reference']=null;
 if(mode==='ticker'){
  const canonical=symbol(subject)??subject,primary=await read(canonical,modules),discovered=await discoverTickerPeers(canonical,primary,env,deps);candidates=[canonical,...discovered.symbols];basis=discovered.basis;
 }else{
  const benchmark=sectorReference(subject),fund=benchmark?await read(benchmark,'quoteType,topHoldings'):null;
  if(benchmark&&fund?.quoteType?.quoteType==='ETF'){
   candidates=unique((fund.topHoldings?.holdings??[]).flatMap((h:Row)=>{const s=symbol(h.symbol);return s&&num(h.holdingPercent)!==null&&h.holdingPercent>0?[s]:[];})).slice(0,8);
   if(candidates.length){basis='fund-sample';reference={symbol:benchmark,name:fund.quoteType.longName??benchmark,date:date(fund.eodhd?.updatedAt,now)};}
  }
 }
 if(mode==='sector'&&candidates.length<3&&deps.hints?.length){candidates=unique([...candidates,...deps.hints.map(h=>symbol(h.symbol)).filter((s):s is string=>!!s)]).slice(0,8);if(basis==='unavailable')basis='related';}
 const companies=await loadComparableCompanies(candidates,mode==='ticker'?subject:null,deps);
 return{subject,mode,fetchedAt:new Date(now).toISOString(),basis,reference,companies:companies.slice(0,mode==='ticker'?7:8),note:basis==='fund-sample'?`Muestra de posiciones de ${reference?.symbol}; no representa todo el sector. Los pesos de una cartera no son flujos de capital.`:basis==='industry'?'Empresas de la misma industria; las actividades y la composición de ingresos pueden diferir.':'Empresas relacionadas; sus negocios pueden pertenecer a industrias distintas.'};
}
export function sectorComparables(subject:string,mode:'ticker'|'sector',env:Env={},deps:Dependencies={}){return cached(`sector-comparables-v1:${mode}:${subject}:${deps.hints?.map(h=>h.symbol).slice(0,8).join(',')??''}`,300000,()=>loadSectorComparables(subject,mode,env,deps));}
export function peerRowsForReport(rows:ComparableCompany[]){
 const show=(n:number|null,suffix='')=>n===null?'—':`${n.toFixed(2)}${suffix}`;
 return rows.map(r=>({ticker:r.symbol,name:r.name,price:r.price===null?'—':`${show(r.price)} ${r.currency}`,marketCap:r.marketCap===null?'—':`${show(r.marketCap/1e9)}B ${r.capitalCurrency}`,pe:show(r.pe),pb:show(r.pb),evEbitda:show(r.evEbitda),roe:show(r.roe,'%'),netMargin:show(r.netMargin,'%'),revenueGrowth:show(r.revenueGrowth,'%'),weekReturn52:'—',beta:show(r.beta),quoteAt:r.quoteAt,recordDate:r.recordDate}));
}

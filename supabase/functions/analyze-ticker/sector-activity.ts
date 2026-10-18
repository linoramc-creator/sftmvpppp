import {cached} from './panels.ts';
import {relativeHistory,type History} from './relative-comparison.ts';
import {stdev} from './market-analytics.ts';
import {readRelativeCache,writeRelativeCache} from './relative-cache.ts';

export type SectorPeer={symbol:string;name:string};
export type SectorCompany={symbol:string;name:string;currency:string;date:string;price:number;volume:number|null;turnover:number|null;relativeVolume:number|null;change1d:number|null;return20:number|null;volatility20:number|null;aboveMa50:boolean|null};
export type SectorActivityGroup={currency:string;date:string;companies:SectorCompany[];knownTurnover:number|null;completeTurnover:boolean;volumeObserved:number;breadth:{advancing:number;declining:number;unchanged:number;observed:number;aboveMa50:number;trendObserved:number};benchmark:{symbol:string;name:string}|null;chart:{date:string;sample:number;benchmark:number|null}[];activity:{date:string;turnover:number|null;observed:number;total:number}[]};
export type SectorActivityData={sector:string;fetchedAt:string;requested:number;verified:number;groups:SectorActivityGroup[];excluded:{symbol:string;reason:string}[];note:string};
type Row=Record<string,any>;
export type SectorActivityInput={peer:SectorPeer;profile:Row|null;history:History|null};
type Dependencies={summary:(symbol:string,modules:string)=>Promise<Row|null>};
const SYMBOL=/^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const number=(v:unknown):number|null=>finite(v)?v:v&&typeof v==='object'&&'raw' in v?number((v as Row).raw):null;
const mean=(n:number[])=>n.reduce((a,b)=>a+b,0)/n.length;
const change=(p:number[],n:number)=>p.length>n?(p.at(-1)!/p[p.length-n-1]-1)*100:null;
const words=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)??[];
const legal=new Set(['inc','incorporated','corp','corporation','co','company','ltd','limited','plc','sa','nv','ag','the','of','and','holdings','holding','group']);
export function sectorIdentityMatches(expected:string,actual:string):boolean{
 const a=words(expected.replace(/\([^)]*\)/g,' ')).filter(w=>w.length>1&&!legal.has(w)),b=words(actual).filter(w=>w.length>1&&!legal.has(w));
 if(!a.length||!b.length)return false;
 const common=a.filter(w=>b.includes(w));
 if(common.length>=Math.min(2,a.length))return true;
 const acronym=words(actual).filter(w=>!['the','of','and'].includes(w)).map(w=>w[0]).join('');
 return a.length===1&&a[0].length>=3&&acronym.startsWith(a[0]);
}
export function normalizeSectorPeers(value:unknown):SectorPeer[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();return value.flatMap((row:any)=>{
  const symbol=typeof row?.symbol==='string'?row.symbol.trim().toUpperCase():'';
  const name=typeof row?.name==='string'?row.name.replace(/\s+/g,' ').trim():'';
  if(!SYMBOL.test(symbol)||!name||name.length>120||/[<>\p{Cc}\p{Cf}]/u.test(name)||seen.has(symbol))return [];
  seen.add(symbol);return [{symbol,name}];
 }).slice(0,10);
}
const benchmarkFor:Record<string,{symbol:string;name:string}>={USD:{symbol:'SPY',name:'S&P 500 · SPY'},EUR:{symbol:'^STOXX50E',name:'Euro Stoxx 50'},JPY:{symbol:'^N225',name:'Nikkei 225'},KRW:{symbol:'^KS11',name:'KOSPI'},GBP:{symbol:'^FTSE',name:'FTSE 100'},CAD:{symbol:'^GSPTSE',name:'S&P/TSX'},AUD:{symbol:'^AXJO',name:'S&P/ASX 200'},HKD:{symbol:'^HSI',name:'Hang Seng'},TWD:{symbol:'^TWII',name:'TAIEX'},INR:{symbol:'^NSEI',name:'Nifty 50'},CHF:{symbol:'^SSMI',name:'SMI'}};

export function buildSectorActivity(sector:string,inputs:SectorActivityInput[],benchmarks:Record<string,History|null>={},now=Date.now()):SectorActivityData{
 const excluded:SectorActivityData['excluded']=[],verified:{peer:SectorPeer;name:string;history:History}[]=[];
 for(const input of inputs){
  const {peer,profile,history:p}=input,name=profile?.quoteType?.longName??profile?.quoteType?.shortName??profile?.price?.longName??profile?.price?.shortName;
  const actual=profile?.quoteType?.symbol??profile?.price?.symbol,type=profile?.quoteType?.quoteType??profile?.price?.quoteType;
  const reject=(reason:string)=>excluded.push({symbol:peer.symbol,reason});
  if(!p||p.dates.length<2){reject('Sin suficientes sesiones cerradas verificables.');continue;}
  if(p.kind!=='stock'||type!=='EQUITY'){reject('El instrumento no es una empresa cotizada verificable.');continue;}
  if(typeof actual!=='string'||actual.toUpperCase()!==peer.symbol||typeof name!=='string'||!sectorIdentityMatches(peer.name,name)){reject('No se ha podido confirmar la identidad de la empresa.');continue;}
  const currency=profile?.price?.currency;
  if(!/^[A-Za-z]{3}$/.test(p.currency)||typeof currency==='string'&&currency!==p.currency){reject('Moneda no confirmada o inconsistente.');continue;}
  verified.push({peer,name,history:p});
 }
 const currencies=[...new Set(verified.map(r=>r.history.currency))];
 const groups:SectorActivityGroup[]=currencies.flatMap(currency=>{
  const rows=verified.filter(r=>r.history.currency===currency),maps=rows.map(r=>new Map(r.history.dates.map((d,i)=>[d,i])));
  const dates=rows[0].history.dates.filter(d=>maps.every(map=>map.has(d)));
  const date=dates.at(-1);if(!date){rows.forEach(r=>excluded.push({symbol:r.peer.symbol,reason:'Sin sesión común para comparar esta moneda.'}));return [];}
  const companies:SectorCompany[]=rows.map((r,k)=>{
   const p=r.history,index=maps[k].get(date)!,close=p.closes.slice(0,index+1),ret=close.slice(1).map((v,i)=>v/close[i]-1),sd=ret.length>=20?stdev(ret.slice(-20)):null;
   const volume=number(p.volumes[index]),previous=p.volumes.slice(Math.max(0,index-20),index),avg=previous.length===20&&previous.every(v=>finite(v)&&v>=0)?mean(previous as number[]):null;
   return {symbol:r.peer.symbol,name:r.name,currency,date,price:p.raw[index],volume:volume!==null&&volume>=0?volume:null,turnover:volume!==null&&volume>=0?volume*p.raw[index]:null,relativeVolume:volume!==null&&volume>=0&&avg!==null&&avg>0?volume/avg:null,change1d:change(close,1),return20:change(close,20),volatility20:sd===null?null:sd*Math.sqrt(252)*100,aboveMa50:close.length>=50?close.at(-1)!>mean(close.slice(-50)):null};
  }).sort((a,b)=>(b.turnover??-1)-(a.turnover??-1));
  const observed=companies.filter(c=>c.turnover!==null),breadthRows=companies.filter(c=>c.change1d!==null),trendRows=companies.filter(c=>c.aboveMa50!==null);
  const configured=benchmarkFor[currency],benchmarkHistory=configured?benchmarks[configured.symbol]:null;
  const benchmark=benchmarkHistory?.currency===currency?configured:null,bm=benchmark&&benchmarkHistory?new Map(benchmarkHistory.dates.map((d,i)=>[d,benchmarkHistory.closes[i]])):null;
  const chartDates=dates.slice(-64),commonBenchmark=bm&&chartDates.every(d=>bm.has(d))?bm:null;
  const chart=chartDates.map(d=>({date:d,sample:mean(rows.map((r,i)=>(r.history.closes[maps[i].get(d)!]/r.history.closes[maps[i].get(chartDates[0])!]-1)*100)),benchmark:commonBenchmark?(commonBenchmark.get(d)!/commonBenchmark.get(chartDates[0])!-1)*100:null}));
  const activity=dates.slice(-20).map(d=>{const amounts=rows.map((r,i)=>{const j=maps[i].get(d)!,v=r.history.volumes[j];return finite(v)&&v>=0?v*r.history.raw[j]:null;});return {date:d,turnover:amounts.every(v=>v!==null)?amounts.reduce<number>((sum,v)=>sum+v!,0):null,observed:amounts.filter(v=>v!==null).length,total:rows.length};});
  return [{currency,date,companies,knownTurnover:observed.length?observed.reduce((sum,c)=>sum+c.turnover!,0):null,completeTurnover:observed.length===companies.length,volumeObserved:observed.length,breadth:{advancing:breadthRows.filter(c=>c.change1d!>0).length,declining:breadthRows.filter(c=>c.change1d!<0).length,unchanged:breadthRows.filter(c=>c.change1d===0).length,observed:breadthRows.length,aboveMa50:trendRows.filter(c=>c.aboveMa50).length,trendObserved:trendRows.length},benchmark:commonBenchmark?benchmark:null,chart,activity}];
 });
 return {sector,fetchedAt:new Date(now).toISOString(),requested:inputs.length,verified:groups.reduce((n,g)=>n+g.companies.length,0),groups,excluded,note:'Muestra de empresas identificadas en el informe; no representa todas las compañías del sector. Importe negociado aproximado = volumen de títulos × precio de cierre, no flujos netos ni compras institucionales. Cada moneda se muestra por separado. Las rentabilidades utilizan cierres ajustados y fechas comunes; la muestra equiponderada es una referencia descriptiva, no un índice oficial del sector.'};
}

export async function sectorActivity(sector:string,rawPeers:unknown,deps:Dependencies):Promise<SectorActivityData>{
 const peers=normalizeSectorPeers(rawPeers),subject=sector.trim().slice(0,80);
 if(!peers.length)return buildSectorActivity(subject,[]);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({sector:subject.toLowerCase(),peers})));
 const key='sector-activity-v1:'+Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,40),saved=await readRelativeCache(key);
 if(saved)return structuredClone(saved) as SectorActivityData;
 const result=await cached(key,300000,async()=>{
  const inputs:SectorActivityInput[]=new Array(peers.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,peers.length)},async()=>{while(cursor<peers.length){const i=cursor++,peer=peers[i];const [profile,history]=await Promise.all([cached('relative-profile-v1:'+peer.symbol,3600000,()=>deps.summary(peer.symbol,'quoteType,assetProfile,summaryDetail,defaultKeyStatistics,majorHoldersBreakdown,price')).catch(()=>null),relativeHistory(peer.symbol)]);inputs[i]={peer,profile,history};}}));
  const needed=[...new Set(inputs.map(i=>i.history?.currency).filter((c):c is string=>!!c).map(c=>benchmarkFor[c]?.symbol).filter((s):s is string=>!!s))];
  const rows:(History|null)[]=new Array(needed.length);let next=0;await Promise.all(Array.from({length:Math.min(3,needed.length)},async()=>{while(next<needed.length){const i=next++;rows[i]=await relativeHistory(needed[i]);}}));return buildSectorActivity(subject,inputs,Object.fromEntries(needed.map((s,i)=>[s,rows[i]])));
 });await writeRelativeCache(key,result,300000);return structuredClone(result);
}

import { photoUrl } from '../../../supabase/functions/analyze-ticker/news-covers';
import {useId,useState} from 'react';
import {ArrowUpRight} from 'lucide-react';

import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip} from 'recharts';
import {cleanNewsPoint,newsKeyPoints} from '../../../supabase/functions/analyze-ticker/news-summary';
import {cleanHeadline,cleanNewsExcerpt} from '@/lib/editorial';
import type {Article,MarketFeed,FeedQuote} from '../../../supabase/functions/analyze-ticker/panels';
import {commonTreasuryDate,treasuryLabel,treasuryIdentifier} from '../../../supabase/functions/analyze-ticker/treasury-curve';
const number=(v:number|null,digits=2)=>v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:digits});
const newsIdentity=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const publishers:Record<string,string>={'reuters.com':'Reuters','apnews.com':'Associated Press','cnbc.com':'CNBC','finance.yahoo.com':'Yahoo Finance','news.yahoo.com':'Yahoo News','bloomberg.com':'Bloomberg','ft.com':'Financial Times','wsj.com':'The Wall Street Journal','marketwatch.com':'MarketWatch','barrons.com':"Barron's",'bbc.com':'BBC','bbc.co.uk':'BBC','theguardian.com':'The Guardian','aljazeera.com':'Al Jazeera','eleconomista.es':'elEconomista','eleconomista.com.mx':'El Economista','expansion.com':'Expansión','cincodias.elpais.com':'Cinco Días','rtve.es':'RTVE','euronews.com':'Euronews','efe.com':'EFE','dw.com':'DW','france24.com':'France 24','businesswire.com':'Business Wire','globenewswire.com':'GlobeNewswire','prnewswire.com':'PR Newswire','seekingalpha.com':'Seeking Alpha','investors.com':"Investor's Business Daily",'axios.com':'Axios','politico.com':'Politico','utilitydive.com':'Utility Dive','industryweek.com':'IndustryWeek'};
const dataHosts=['eodhd.com','massive.com','polygon.io','financialmodelingprep.com','fmpcloud.io','finnhub.io','tavily.com','twelvedata.com','supabase.co','alphavantage.co'];
const dataSource=/\b(?:EODHD|Massive|Polygon|FMP|Financial Modeling Prep|Finnhub|Tavily|Twelve Data|Supabase|Alpha Vantage|(?:private|data) provider|API)\b/i;
export function articleSource(article:Article):{url:string;label:string}|null{
  if(typeof article.url!=='string'||article.url.length>4000||/[\p{Cc}\p{Cf}]/u.test(article.url))return null;
  try{
    const url=new URL(article.url),host=url.hostname.toLowerCase().replace(/^www\./,'');
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&url.port!==(url.protocol==='https:'?'443':'80')||!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+){3}$/.test(host)||/\.(?:local|localhost|internal)$/.test(host)||/(?:^|\.)api\./.test(host)||/^query[12]\.finance\.yahoo\.com$/.test(host)||dataHosts.some(domain=>host===domain||host.endsWith('.'+domain)))return null;
    if(/^\/api(?:\/|$)/i.test(url.pathname)||/\/(?:v\d+\/finance\/(?:chart|quote|quoteSummary)|functions\/v1|rest\/v1)(?:\/|$)/i.test(url.pathname))return null;
    if([...url.searchParams.keys()].some(key=>/^(?:key|api[-_]?key|api[-_]?token|access[-_]?token|token|secret|password|authorization|auth)$/i.test(key))||/[?&#](?:key|api[-_]?key|api[-_]?token|access[-_]?token|token|secret|password|authorization|auth)=/i.test(decodeURIComponent(url.hash)))return null;
    const known=Object.entries(publishers).find(([domain])=>host===domain||host.endsWith('.'+domain))?.[1];
    const source=typeof article.source==='string'?article.source.trim():'';
    const sourceKey=newsIdentity(source.replace(/^the\s+/i,''));
    const labelled=source&&source.length<=100&&!dataSource.test(source)&&!/[/<>=@\p{Cc}\p{Cf}]/u.test(source)&&sourceKey&&newsIdentity(host).includes(sourceKey)?source:null;
    return {url:url.href,label:known??labelled??host};
  }catch{return null;}
}
export function NewsSource({article}:{article:Article}){
  const source=articleSource(article);
  return source?<footer className="mx-4 border-t border-slate-800/80 pb-3.5 pt-3 text-[11px]"><span className="mr-2 text-slate-500">Fuente</span><a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir artículo en ${source.label}`} className="inline-flex items-center gap-1 font-medium text-blue-300 transition-colors hover:text-blue-200 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70">{source.label}<ArrowUpRight aria-hidden="true" size={12}/></a></footer>:null;
}
export function visibleNewsArticles(articles:Article[]):Article[]{
  const seen=new Set<string>();
  return articles.filter(article=>{const key=newsIdentity(cleanHeadline(cleanNewsPoint(typeof article?.title==='string'?article.title:'')));if(!key||seen.has(key))return false;seen.add(key);return true;});
}
export function FeedQuoteStamp({quote}:{quote:FeedQuote}){
 const labels={pre:'PREMARKET',regular:'MARKET',post:'POSTMARKET',closed:'CIERRE'},time=quote.at?Date.parse(quote.at):NaN,age=Number.isFinite(time)?Math.max(0,Math.floor((Date.now()-time)/1000)):null;
 const timezone=quote.timezone??'America/New_York',zoneLabel=({'America/New_York':'ET','Asia/Tokyo':'JST','Asia/Seoul':'KST','America/Chicago':'CT'} as Record<string,string>)[timezone]??timezone;
 const clock=Number.isFinite(time)?new Date(time).toLocaleString('es-ES',{timeZone:timezone,...(quote.session==='closed'?{day:'2-digit',month:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'})+' '+zoneLabel:quote.date??'Sin hora disponible';
 const reference=quote.reference==='regular-close'?'Variación respecto al cierre regular de esa sesión.':'Variación respecto al cierre regular anterior cuando está disponible.';
 return <span className="block text-[10px] text-muted-foreground" title={`Actualización cada 60 segundos. ${age===null?'No hay una hora verificada.':`Último dato hace ${Math.floor(age/60)} min.`} ${reference}`}>{quote.price===null?'Sin cotización':`${labels[quote.session]??''}${quote.session?' · ':''}${clock}${quote.session!=='closed'&&age!==null&&age>180?` · hace ${Math.floor(age/60)} min`:''}`}</span>;
}
export function NewsCover({article,compact=false}:{article:Article;compact?:boolean}){
  const [failed,setFailed]=useState(false);
  const usable=failed?undefined:photoUrl(article.image);
  return usable?<img src={usable} alt="" className={`aspect-[16/9] max-h-44 w-full shrink-0 object-cover bg-slate-900 sm:m-4 sm:mr-0 sm:rounded-lg ${compact?'sm:h-24 sm:w-36':'sm:h-28 sm:w-44'}`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} onLoad={e=>{const img=e.currentTarget;if(img.naturalWidth<400||img.naturalHeight<220||img.naturalWidth/img.naturalHeight<1.25||img.naturalWidth/img.naturalHeight>2.6)setFailed(true);}}/>:null;
}
export function NewsCards({articles,geo=false,compact=false}:{articles:Article[];geo?:boolean;compact?:boolean}){
  const id=useId().replace(/:/g,'');
  const items=visibleNewsArticles(articles).map(article=>{
    const headline=cleanHeadline(cleanNewsPoint(typeof article.title==='string'?article.title:''));
    const key=newsIdentity(headline);
    const pointKeys=new Set<string>();
    const points=newsKeyPoints(article).map(cleanNewsExcerpt).filter(point=>{const value=newsIdentity(point);if(!value||value===key||pointKeys.has(value))return false;pointKeys.add(value);return true;});
    const instant=article.publishedAt&&Number.isFinite(Date.parse(article.publishedAt))?new Date(article.publishedAt):null;
    const date=typeof article.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(article.date)&&Number.isFinite(Date.parse(article.date))&&new Date(article.date).toISOString().slice(0,10)===article.date?article.date:null;
    const published=instant?instant.toLocaleString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):date?new Date(date+'T12:00:00Z').toLocaleDateString('es-ES',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}):'';
    return {article,headline,points,published,dateTime:instant?.toISOString()??date??undefined};
  });
  return items.length?<div aria-label={geo?'Noticias geopolíticas':undefined} className="space-y-3 font-body [&_h3]:font-body">{items.map(({article,headline,points,published,dateTime},index)=>{
    const headingId=`news-${id}-${index}`;
    return <article key={article.url||headingId} aria-labelledby={headingId} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-700/40 bg-[#0b111b] sm:flex-row">
      <NewsCover key={article.image??article.url} article={article} compact={compact}/>
      <div className="min-w-0 flex-1">
      <div className="px-4 pb-4 pt-3.5">
        {published&&<time dateTime={dateTime} className="mb-1.5 block text-[10px] leading-relaxed tabular-nums text-slate-500">{published}</time>}
        <h3 id={headingId} className="!m-0 !border-0 !p-0 font-body !text-sm !font-semibold !normal-case !leading-snug !tracking-normal !text-slate-100">{headline}</h3>
        {points.length>0&&<ul aria-label="Puntos clave" className="!mb-0 mt-3 space-y-2">{points.map((point,i)=><li key={i} className="!mb-0 flex gap-2 font-body !text-xs leading-relaxed text-slate-400"><span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-blue-400/70"/><span>{point}</span></li>)}</ul>}
      </div>
      <NewsSource article={article}/>
      </div>
    </article>;
  })}</div>:<p className="text-sm text-muted-foreground">No se han podido obtener noticias recientes en este momento.</p>;
}
export function TreasuryCard({points}:{points:MarketFeed['treasury']}){
  const common=commonTreasuryDate(points);
  return <><div className="space-y-2">{points.map(p=><div key={p.years} className="flex justify-between border-b border-border/70 pb-2 text-sm"><div><div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs font-semibold text-slate-100" title="Identificador de la serie de rendimiento del Tesoro; no es un bono negociable">{treasuryIdentifier(p.years)??treasuryLabel(p.years)}</span><span className="text-[10px] text-slate-400">{treasuryLabel(p.years)}</span></div><p className="text-[10px] text-muted-foreground">{p.date??'Sin fecha disponible'}</p></div><div className="text-right">{number(p.yield)} %<p className={`text-[10px] ${p.changeBp===null?'text-muted-foreground':p.changeBp>=0?'text-sky-300':'text-slate-400'}`}>{p.changeBp!==null&&p.changeBp>0?'+':''}{number(p.changeBp)} pb diarios</p></div></div>)}</div>{common?<div className="h-24 mt-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="years" tickFormatter={v=>v===.25?'3m':v===.5?'6m':`${v}a`} tick={{fontSize:9}}/><YAxis hide domain={['auto','auto']}/><Tooltip contentStyle={{background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0'}} formatter={(v:number)=>`${number(v)} %`} labelFormatter={v=>`${treasuryLabel(Number(v))} · ${common}`}/><Line dataKey="yield" stroke="#38bdf8" strokeWidth={2} dot type="linear" connectNulls={false}/></LineChart></ResponsiveContainer></div>:<p className="text-xs text-muted-foreground mt-3">Curva pendiente de una fecha común para todos los vencimientos.</p>}</>;
}
export function EarningsList({events,onSelect}:{events:MarketFeed['earnings'];onSelect:(symbol:string)=>void}){
  return events.length?<div className="space-y-2">{events.map(e=><button type="button" key={e.symbol+e.date} aria-label={`Abrir ficha de ${e.symbol} · resultados ${e.date}`} onClick={()=>onSelect(e.symbol)} className="block w-full rounded-md border border-border px-3 py-3 text-left hover:border-section-heading/40 hover:bg-section-heading/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-heading focus-visible:ring-offset-2 focus-visible:ring-offset-card"><div className="flex justify-between gap-3 text-sm"><b className="text-section-heading">{e.symbol}</b><span className="text-xs text-muted-foreground">{e.date}</span></div><p className="text-xs text-muted-foreground mt-1">{e.session}</p><div className="flex items-center justify-between gap-2 mt-2">{e.eps!==null?<span className="text-xs">BPA estimado: {number(e.eps)}</span>:<span/>}<span aria-hidden="true" className="text-section-heading/60">→</span></div></button>)}<p className="text-[10px] text-muted-foreground pt-1">Fechas previstas, sujetas a cambios.</p></div>:<p className="text-sm text-muted-foreground">No se ha podido obtener el calendario de resultados. Vuelve a intentarlo más tarde.</p>;
}

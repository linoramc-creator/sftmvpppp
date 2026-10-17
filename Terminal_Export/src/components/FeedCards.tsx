import { photoUrl } from '../../../supabase/functions/analyze-ticker/news-covers';
import {useState} from 'react';

import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip} from 'recharts';
import {cleanNewsPoint,newsKeyPoints} from '../../../supabase/functions/analyze-ticker/news-summary';
import {cleanHeadline,cleanNewsExcerpt} from '@/lib/editorial';
import type {Article,MarketFeed,FeedQuote} from '../../../supabase/functions/analyze-ticker/panels';
import {commonTreasuryDate,treasuryLabel} from '../../../supabase/functions/analyze-ticker/treasury-curve';
const number=(v:number|null,digits=2)=>v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:digits});
export function FeedQuoteStamp({quote}:{quote:FeedQuote}){
 const labels={pre:'PREMARKET',regular:'MARKET',post:'POSTMARKET',closed:'CIERRE'},time=quote.at?Date.parse(quote.at):NaN,age=Number.isFinite(time)?Math.max(0,Math.floor((Date.now()-time)/1000)):null;
 const timezone=quote.timezone??'America/New_York',zoneLabel=({'America/New_York':'ET','Asia/Tokyo':'JST','Asia/Seoul':'KST','America/Chicago':'CT'} as Record<string,string>)[timezone]??timezone;
 const clock=Number.isFinite(time)?new Date(time).toLocaleString('es-ES',{timeZone:timezone,...(quote.session==='closed'?{day:'2-digit',month:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'})+' '+zoneLabel:quote.date??'Sin hora disponible';
 const reference=quote.reference==='regular-close'?'Variación respecto al cierre regular de esa sesión.':'Variación respecto al cierre regular anterior cuando está disponible.';
 return <span className="block text-[10px] text-muted-foreground" title={`Actualización cada 60 segundos. ${age===null?'No hay una hora verificada.':`Último dato hace ${Math.floor(age/60)} min.`} ${reference}`}>{quote.price===null?'Sin cotización':`${labels[quote.session]??''}${quote.session?' · ':''}${clock}${quote.session!=='closed'&&age!==null&&age>180?` · hace ${Math.floor(age/60)} min`:''}`}</span>;
}
export function NewsCover({article,compact=false}:{article:Article;compact?:boolean}){
  const [failed,setFailed]=useState(false);
  const usable=photoUrl(article.image)&&!failed;
  return usable?<img src={article.image} alt="" className={compact?'w-full h-24 mb-3 sm:w-36 sm:mb-0 shrink-0 rounded object-cover bg-muted':'aspect-[16/9] w-full object-cover bg-muted'} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} onLoad={e=>{const img=e.currentTarget;if(img.naturalWidth<400||img.naturalHeight<220||img.naturalWidth/img.naturalHeight<1.25||img.naturalWidth/img.naturalHeight>2.6)setFailed(true);}}/>:null;
}
export function NewsCards({articles,geo=false,compact=false}:{articles:Article[];geo?:boolean;compact?:boolean}){
  return articles.length?<div className={compact?'grid xl:grid-cols-2 gap-3':'grid md:grid-cols-2 xl:grid-cols-3 gap-4'}>{articles.map(article=>{
    const headline=cleanHeadline(cleanNewsPoint(article.title));
    const normalized=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    const points=newsKeyPoints(article).map(cleanNewsExcerpt).filter(point=>point&&normalized(point)!==normalized(headline));
    const published=article.publishedAt&&Number.isFinite(Date.parse(article.publishedAt))?new Date(article.publishedAt).toLocaleString('es-ES'):article.date;
    return <article key={article.url} className={`border border-border overflow-hidden rounded-md bg-background/30 ${compact?'sm:flex sm:items-start sm:gap-4 p-3 sm:p-4':''}`}>
      <NewsCover key={article.image??article.url} article={article} compact={compact}/>
      <div className={compact?'min-w-0 flex-1':'p-4'}>
        {published&&<p className="text-[10px] text-muted-foreground mb-2">{published}</p>}
        <h3 className="text-sm leading-relaxed font-semibold text-foreground">{headline}</h3>
        {points.length>0&&<ul aria-label="Puntos clave" className="mt-3 space-y-2">{points.map((point,i)=><li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/75"><span aria-hidden="true" className="w-1 h-1 rounded-full shrink-0 bg-primary/70 mt-[7px]"/><span>{point}</span></li>)}</ul>}
      </div>
    </article>;
  })}</div>:<p className="text-sm text-muted-foreground">No se han podido obtener noticias recientes en este momento.</p>;
}
export function TreasuryCard({points}:{points:MarketFeed['treasury']}){
  const common=commonTreasuryDate(points);
  return <><div className="space-y-2">{points.map(p=><div key={p.years} className="flex justify-between border-b border-border/70 pb-2 text-sm"><div>{treasuryLabel(p.years)}<p className="text-[10px] text-muted-foreground">{p.date??'Sin fecha disponible'}</p></div><div className="text-right">{number(p.yield)} %<p className={`text-[10px] ${p.changeBp===null?'text-muted-foreground':p.changeBp>=0?'text-sky-300':'text-slate-400'}`}>{p.changeBp!==null&&p.changeBp>0?'+':''}{number(p.changeBp)} pb diarios</p></div></div>)}</div>{common?<div className="h-24 mt-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="years" tickFormatter={v=>v===.5?'6m':`${v}a`} tick={{fontSize:9}}/><YAxis hide domain={['auto','auto']}/><Tooltip contentStyle={{background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0'}} formatter={(v:number)=>`${number(v)} %`} labelFormatter={v=>`${treasuryLabel(Number(v))} · ${common}`}/><Line dataKey="yield" stroke="#38bdf8" strokeWidth={2} dot type="linear" connectNulls={false}/></LineChart></ResponsiveContainer></div>:<p className="text-xs text-muted-foreground mt-3">Curva pendiente de una fecha común para todos los vencimientos.</p>}</>;
}
export function EarningsList({events,onSelect}:{events:MarketFeed['earnings'];onSelect:(symbol:string)=>void}){
  return events.length?<div className="space-y-2">{events.map(e=><button type="button" key={e.symbol+e.date} aria-label={`Abrir ficha de ${e.symbol} · resultados ${e.date}`} onClick={()=>onSelect(e.symbol)} className="block w-full rounded-md border border-border px-3 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"><div className="flex justify-between gap-3 text-sm"><b className="text-primary">{e.symbol}</b><span className="text-xs text-muted-foreground">{e.date}</span></div><p className="text-xs text-muted-foreground mt-1">{e.session}</p><div className="flex items-center justify-between gap-2 mt-2">{e.eps!==null?<span className="text-xs">BPA estimado: {number(e.eps)}</span>:<span/>}<span aria-hidden="true" className="text-primary/60">→</span></div></button>)}<p className="text-[10px] text-muted-foreground pt-1">Fechas previstas, sujetas a cambios.</p></div>:<p className="text-sm text-muted-foreground">No se ha podido obtener el calendario de resultados. Vuelve a intentarlo más tarde.</p>;
}

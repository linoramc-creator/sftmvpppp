import { photoUrl } from '../../../supabase/functions/analyze-ticker/news-covers';
import {useState} from 'react';

import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip} from 'recharts';
import {safeNewsHref} from '@/lib/navigation';
import {cleanHeadline,cleanNewsExcerpt} from '@/lib/editorial';
import type {Article,MarketFeed} from '../../../supabase/functions/analyze-ticker/panels';
const number=(v:number|null,digits=2)=>v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:digits});
export function NewsCover({article,geo=false}:{article:Article;geo?:boolean}){
  const [failed,setFailed]=useState(false);
  const usable=photoUrl(article.image)&&!failed;
  return usable?<img src={article.image} alt={cleanHeadline(article.title)} className="aspect-[16/9] w-full object-cover bg-muted" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} onLoad={e=>{const img=e.currentTarget;if(img.naturalWidth<400||img.naturalHeight<220||img.naturalWidth/img.naturalHeight<1.25||img.naturalWidth/img.naturalHeight>2.6)setFailed(true);}}/>:null;
}
export function NewsCards({articles,geo=false}:{articles:Article[];geo?:boolean}){
  return articles.length?<div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{articles.map(article=><article key={article.url} className="border border-border overflow-hidden"><a href={safeNewsHref(article.url)} target="_blank" rel="noopener noreferrer" className="block hover:text-primary transition-colors"><NewsCover key={article.image??article.url} article={article} geo={geo}/><div className="p-4"><p className="text-[10px] text-muted-foreground mb-2">{article.date}{article.access==='likely-open'&&<span className="ml-2 text-emerald-400">ACCESO HABITUALMENTE LIBRE</span>}{article.access==='subscription'&&<span className="ml-2 text-amber-400">PUEDE REQUERIR SUSCRIPCIÓN</span>}</p><h2 className="text-sm leading-relaxed font-semibold">{cleanHeadline(article.title)}</h2>{article.excerpt&&<p className="text-xs text-muted-foreground leading-relaxed mt-3">{cleanNewsExcerpt(article.excerpt)}</p>}</div></a></article>)}</div>:<p className="text-sm text-muted-foreground">No se han podido obtener noticias recientes en este momento.</p>;
}
export function TreasuryCard({points}:{points:MarketFeed['treasury']}){
  const dated=points.filter(p=>p.yield!==null);const common=dated.length===4&&new Set(dated.map(p=>p.date)).size===1;
  return <><div className="space-y-2">{points.map(p=><div key={p.years} className="flex justify-between border-b border-border/70 pb-2 text-sm"><div>{p.years} años<p className="text-[10px] text-muted-foreground">{p.date??'Sin fecha disponible'}</p></div><div className="text-right">{number(p.yield)} %<p className="text-[10px] text-muted-foreground">{number(p.changeBp)} pb diarios</p></div></div>)}</div>{common?<div className="h-24 mt-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="years" tickFormatter={v=>`${v}a`} tick={{fontSize:9}}/><YAxis hide domain={['auto','auto']}/><Tooltip formatter={(v:number)=>`${number(v)} %`} labelFormatter={v=>`${v} años · ${dated[0].date}`}/><Line dataKey="yield" stroke="#38bdf8" strokeWidth={2} dot type="linear" connectNulls={false}/></LineChart></ResponsiveContainer></div>:<p className="text-xs text-muted-foreground mt-3">Curva pendiente de una fecha común para los cuatro vencimientos.</p>}</>;
}
export function EarningsList({events}:{events:MarketFeed['earnings']}){
  return events.length?<div className="space-y-3">{events.map(e=><div key={e.symbol+e.date} className="border-b border-border pb-3 last:border-0"><div className="flex justify-between gap-3 text-sm"><b className="text-primary">{e.symbol}</b><span>{e.date}</span></div><p className="text-xs text-muted-foreground mt-1">{e.session}</p>{e.eps!==null&&<p className="text-xs mt-1">BPA estimado: {number(e.eps)}</p>}</div>)}<p className="text-[10px] text-muted-foreground">Fechas previstas, sujetas a cambios.</p></div>:<p className="text-sm text-muted-foreground">No se ha podido obtener el calendario de resultados. Vuelve a intentarlo más tarde.</p>;
}

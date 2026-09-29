import {useState} from 'react';
import {Globe2,TrendingUp} from 'lucide-react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip} from 'recharts';
import {safeNewsHref} from '@/lib/navigation';
import {cleanHeadline,cleanNewsExcerpt} from '@/lib/editorial';
import type {Article,MarketFeed} from '../../../supabase/functions/analyze-ticker/panels';
const number=(v:number|null,digits=2)=>v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:digits});
export function NewsCover({article,geo=false}:{article:Article;geo?:boolean}){
  const [failed,setFailed]=useState(false);
  const usable=article.image&&!/logo|favicon|brand|default|placeholder|reuters/i.test(article.image)&&!failed;
  return usable?<img src={article.image} alt="" className="h-36 w-full object-cover bg-muted" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} onLoad={e=>{const img=e.currentTarget;if(img.naturalWidth<300||img.naturalHeight<140||img.naturalWidth/img.naturalHeight<1.3)setFailed(true);}}/>:
  <div aria-label={geo?'Ilustración editorial de geopolítica':'Ilustración editorial de mercados'} className={`h-36 relative overflow-hidden flex items-center justify-center ${geo?'bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800':'bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-800'}`}>
    <div className="absolute inset-4 border border-white/10 rounded-full scale-150"/>{geo?<Globe2 className="w-24 h-24 text-sky-300/50" strokeWidth={.8}/>:<TrendingUp className="w-32 h-24 text-emerald-300/50" strokeWidth={1}/>}
    <span className="absolute bottom-3 left-4 text-[9px] tracking-[.2em] text-white/65">{geo?'GEOPOLÍTICA':'MERCADOS'} · ILUSTRACIÓN</span>
  </div>;
}
export function NewsCards({articles,geo=false}:{articles:Article[];geo?:boolean}){
  return articles.length?<div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{articles.map(article=><article key={article.url} className="border border-border overflow-hidden"><a href={safeNewsHref(article.url)} target="_blank" rel="noopener noreferrer" className="block hover:text-primary transition-colors"><NewsCover key={article.image??article.url} article={article} geo={geo}/><div className="p-4"><p className="text-[10px] text-muted-foreground mb-2">{article.date}</p><h2 className="text-sm leading-relaxed font-semibold">{cleanHeadline(article.title)}</h2>{article.excerpt&&<p className="text-xs text-muted-foreground leading-relaxed mt-3">{cleanNewsExcerpt(article.excerpt)}</p>}</div></a></article>)}</div>:<p className="text-sm text-muted-foreground">No se han podido obtener noticias recientes en este momento.</p>;
}
export function TreasuryCard({points}:{points:MarketFeed['treasury']}){
  const dated=points.filter(p=>p.yield!==null);const common=dated.length===4&&new Set(dated.map(p=>p.date)).size===1;
  return <><div className="space-y-2">{points.map(p=><div key={p.years} className="flex justify-between border-b border-border/70 pb-2 text-sm"><div>{p.years} años<p className="text-[10px] text-muted-foreground">{p.date??'Sin fecha disponible'}</p></div><div className="text-right">{number(p.yield)} %<p className="text-[10px] text-muted-foreground">{number(p.changeBp)} pb diarios</p></div></div>)}</div>{common?<div className="h-24 mt-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="years" tickFormatter={v=>`${v}a`} tick={{fontSize:9}}/><YAxis hide domain={['auto','auto']}/><Tooltip formatter={(v:number)=>`${number(v)} %`} labelFormatter={v=>`${v} años · ${dated[0].date}`}/><Line dataKey="yield" stroke="#38bdf8" strokeWidth={2} dot type="linear" connectNulls={false}/></LineChart></ResponsiveContainer></div>:<p className="text-xs text-muted-foreground mt-3">Curva pendiente de una fecha común para los cuatro vencimientos.</p>}</>;
}
export function EarningsList({events}:{events:MarketFeed['earnings']}){
  return events.length?<div className="space-y-3">{events.map(e=><div key={e.symbol+e.date} className="border-b border-border pb-3 last:border-0"><div className="flex justify-between gap-3 text-sm"><b className="text-primary">{e.symbol}</b><span>{e.date}</span></div><p className="text-xs text-muted-foreground mt-1">{e.session}</p>{e.eps!==null&&<p className="text-xs mt-1">BPA estimado: {number(e.eps)}</p>}</div>)}<p className="text-[10px] text-muted-foreground">Fechas previstas, sujetas a cambios.</p></div>:<p className="text-sm text-muted-foreground">No se ha podido obtener el calendario de resultados. Vuelve a intentarlo más tarde.</p>;
}

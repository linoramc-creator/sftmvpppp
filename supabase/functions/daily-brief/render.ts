import {geopoliticalFallback,type BriefData,type BriefPoint,type BriefAsset} from './data.ts';
import type {Article} from '../analyze-ticker/panels.ts';
import {newsKeyPoints} from '../analyze-ticker/news-summary.ts';
import {commonTreasuryDate,treasuryLabel} from '../analyze-ticker/treasury-curve.ts';
import {photoUrl} from '../analyze-ticker/news-covers.ts';
import {renderInteractiveChart,BRIEF_INTERACTION_SCRIPT,BRIEF_INTERACTION_CSS} from './interactive-charts.ts';
import {renderMacroSection} from './macro.ts';
import {BRIEF_STYLES} from './styles.ts';
export const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const CHART_COLORS={background:'#0d121a',grid:'#273340',price:'#4389ed',risk:'#a5b8cf'};
const fmt=(value:number|null|undefined,digits=2)=>value==null?'—':value.toLocaleString('es-ES',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const unit=(a:BriefAsset)=>a.group==='Índices'||a.symbol==='^VIX'?'pts':a.currency;
const priceDecimals=(a:BriefAsset)=>a.group==='Divisas'?(a.symbol==='JPY=X'||a.symbol.replace('=X','').endsWith('JPY')?3:5):2;
const price=(a:BriefAsset,value:number|null)=>fmt(value,priceDecimals(a));
const pct=(value:number|null|undefined)=>value==null?'—':`${value>0?'+':''}${fmt(value)} %`;
const pp=(value:number|null|undefined)=>value==null?'—':`${value>0?'+':''}${fmt(value)} pp`;
const tone=(value:number|null|undefined)=>value==null?'neutral':value>=0?'positive':'negative';
const safe=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?escape(u.href):'#';}catch{return '#';}};
const cleanTitle=(text:string)=>text.replace(/\s*[-–|]\s*(Reuters|AP News|Associated Press|CNBC|Bloomberg(?:\.com)?|Euronews(?:\.com)?|Yahoo[^|]*|BBC(?: News)?|elEconomista(?:\.es)?)\s*$/i,'');
export type ChartSpec={id:string;title:string;points:BriefPoint[];color:string;x?:number[];height?:number;unit?:string;kind?:'line'|'bar';decimals?:number};
export type ChartRenderer=(chart:ChartSpec)=>string;
export function chartSvg(chart:ChartSpec):string{
 const {points,color}=chart;if(points.length<2)return '';
 const w=760,h=chart.height??200,pad=12,min=Math.min(...points.map(p=>p.value),...(chart.kind==='bar'?[0]:[])),max=Math.max(...points.map(p=>p.value),...(chart.kind==='bar'?[0]:[])),span=max-min||Math.max(Math.abs(max)*.01,1),left=chart.x?.[0]??0,right=chart.x?.at(-1)??points.length-1;
 const x=(i:number)=>chart.kind==='bar'?pad+(i+.5)/Math.max(points.length,1)*(w-2*pad):pad+((chart.x?.[i]??i)-left)/Math.max(right-left,1)*(w-2*pad),y=(v:number)=>h-pad-(v-min)/span*(h-2*pad),line=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
 const barWidth=Math.min(42,(w-2*pad)/Math.max(points.length,1)*.55),bars=points.map((p,i)=>`<rect x="${Math.max(0,x(i)-barWidth/2).toFixed(2)}" y="${Math.min(y(0),y(p.value)).toFixed(2)}" width="${barWidth}" height="${Math.max(1,Math.abs(y(p.value)-y(0))).toFixed(2)}" fill="${escape(color)}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(chart.title)}" viewBox="0 0 ${w} ${h}" style="display:block;width:100%;height:auto"><title>${escape(chart.title)}</title><rect width="${w}" height="${h}" fill="${CHART_COLORS.background}"/>${[.25,.5,.75].map(v=>`<path d="M${pad} ${h*v}H${w-pad}" stroke="${CHART_COLORS.grid}" stroke-dasharray="3 5"/>`).join('')}${chart.kind==='bar'?`<path d="M0 ${y(0)}H${w}" stroke="${CHART_COLORS.grid}"/>${bars}`:`<path d="${line}" fill="none" stroke="${escape(color)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`}</svg>`;
}
function plot(chart:ChartSpec,renderer:ChartRenderer){if(chart.points.length<2)return '<p class="meta">No hay suficientes observaciones para este gráfico.</p>';const graphic=`<div class="chart">${renderer(chart)}</div>`;return renderer===renderInteractiveChart?graphic:`${graphic}<table role="presentation" width="100%" class="chart-caption"><tr><td>${escape(chart.points[0].date)}</td><td align="right">${escape(chart.points.at(-1)!.date)} · mín. ${fmt(Math.min(...chart.points.map(p=>p.value)))} / máx. ${fmt(Math.max(...chart.points.map(p=>p.value)))}</td></tr></table>`;}
const metric=(label:string,value:string)=>`<td class="metric"><div class="meta">${escape(label)}</div><div class="num metric-value">${escape(value)}</div></td>`;
const metricRow=(values:[string,string][])=>`<table role="presentation" width="100%" class="metrics"><tr>${values.map(([label,value])=>metric(label,value)).join('')}</tr></table>`;
function newsItem(a:Article,cover=true){
 const image=photoUrl(a.image);
 const points=newsKeyPoints(a),at=new Date(a.publishedAt??a.date),date=Number.isFinite(at.getTime())?at.toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' · Madrid':a.date;
 const body=`<div class="meta">${escape(date)}</div><h3 class="news-title">${escape(cleanTitle(a.title))}</h3>${points.length?`<ul class="news-points">${points.map(point=>`<li>${escape(point)}</li>`).join('')}</ul>`:''}`;
 return `<article class="news-item">${cover&&image?`<table role="presentation" width="100%" class="news-row"><tr><td class="news-cover-cell" style="width:162px;vertical-align:top;padding:4px 16px 0 0"><img class="news-cover" src="${safe(image)}" alt="${escape(cleanTitle(a.title))}" width="146" height="98" style="display:block;width:146px;height:98px;object-fit:cover"/></td><td style="vertical-align:top">${body}</td></tr></table>`:body}</article>`;
}
function assetCard(a:BriefAsset,index:number,watched:boolean,renderer:ChartRenderer){
 const context=a.context;
 const main=`<table role="presentation" width="100%" class="asset-header"><tr><td><span class="ticker">${escape(a.symbol)}</span><h3>${escape(a.name)}</h3></td><td align="right" style="vertical-align:top"><div class="num quote">${price(a,a.close)} <small>${escape(unit(a))}</small></div><div class="num ${tone(a.change)}">${pct(a.change)} <small>sesión</small></div></td></tr></table><p class="meta">Cierre: ${escape(a.date??'no disponible')}${a.latest?` · Última cotización: ${price(a,a.latest.price)} ${escape(unit(a))} (${escape(new Date(a.latest.at).toLocaleString('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}))}, Madrid)`:''}</p>`;
 const returns=metricRow([['5 sesiones',pct(a.week)],['21 sesiones',pct(a.month)],[watched?'Frente al S&P 500 · 21 s.':'Volatilidad · 20 s.',watched?pp(context?.relative21):a.vol20==null?'—':`${fmt(a.vol20)} %`]]);
 const priceChart=plot({id:`price-${watched?'watch':'market'}-${index}`,title:`${a.name}: cierres en ${unit(a)}`,points:a.points,color:CHART_COLORS.price,unit:unit(a),decimals:priceDecimals(a)},renderer);
 if(!watched)return `<section id="asset-market-${index}" class="asset market-asset">${main}${priceChart}${returns}<p class="meta">Tendencia: <span class="trend">${escape(a.trend)}</span></p></section>`;
 const risk=metricRow([['Volatilidad · 5 s.',a.vol5==null?'—':`${fmt(a.vol5)} %`],['Volatilidad · 20 s.',a.vol20==null?'—':`${fmt(a.vol20)} %`],['Correlación S&P 500 · 20 s.',fmt(context?.correlation20)]]);
 const activity=metricRow([['Volumen / media 20 s.',a.volumeRatio==null?'—':`${fmt(a.volumeRatio)}×`],['ATR · 14 s.',context?.atrPercent==null?'—':`${fmt(context.atrPercent)} %`],['Desde máximo disponible',pct(a.drawdown)]]);
 const levels=metricRow([['Rango · 20 s.',context?.low20==null||context?.high20==null?'—':`${fmt(context.low20)} – ${fmt(context.high20)}`],['Media · 20 s. ajustada',fmt(context?.ma20)],['Media · 50 s. ajustada',fmt(context?.ma50)]]);
 return `<section id="asset-watch-${index}" class="asset watch-asset">${main}<h4>Rendimiento</h4>${returns}${priceChart}<p class="meta">Tendencia: <span class="trend">${escape(a.trend)}</span>${context?.benchmarkDate?` · Referencia S&P 500: ${escape(context.benchmarkDate)}`:''}</p><h4>Riesgo y actividad</h4>${risk}${activity}${plot({id:`vol-${index}`,title:`${a.name}: volatilidad anualizada de veinte sesiones (%)`,points:a.volatility,color:CHART_COLORS.risk,unit:'%'},renderer)}<h4>Niveles de las últimas sesiones</h4>${levels}<h4>Comentario</h4><p>${escape(a.note)}</p><h4>Noticias relacionadas</h4>${a.news.length?a.news.map(n=>newsItem(n,true)).join(''):'<p class="meta">Sin noticias directamente relacionadas confirmadas en esta edición.</p>'}</section>`;
}
function compactAsset(a:BriefAsset,index:number,renderer:ChartRenderer){
 const chart=plot({id:`price-market-${index}`,title:`${a.name}: cierres en ${unit(a)}`,points:a.points,color:CHART_COLORS.price,height:120,unit:unit(a),decimals:priceDecimals(a)},renderer);
 return `<section id="asset-market-${index}" class="market-card"><table role="presentation" width="100%" class="compact-header"><tr><td><div class="meta">${escape(a.group)}</div><h3>${escape(a.name)}</h3></td><td align="right"><div class="num compact-price">${price(a,a.close)} <small>${escape(unit(a))}</small></div><span class="num ${tone(a.change)}">${pct(a.change)} <small>sesión</small></span></td></tr></table><table role="presentation" width="100%" class="compact-metrics"><tr>${metric('5 s.',pct(a.week))}${metric('21 s.',pct(a.month))}${metric('Vol. 20 s.',a.vol20==null?'—':fmt(a.vol20)+' %')}</tr></table>${chart}<div class="meta compact-foot">Cierre: ${escape(a.date??'no disponible')} · ${escape(a.trend)}</div></section>`;
}
function compactTreasury(data:BriefData,renderer:ChartRenderer){
 const curve=data.treasury.filter(p=>p.yield!==null&&p.date&&Date.parse(p.date)<=Date.parse(data.cutoff)),common=commonTreasuryDate(data.treasury)!==null&&curve.length===data.treasury.length,two=curve.find(p=>p.years===2),ten=curve.find(p=>p.years===10);
 return `<section id="bonos" class="market-card treasury-card"><div class="meta">Renta fija · EE. UU.</div><h3>Curva del Tesoro</h3><table role="presentation" width="100%" class="compact-metrics"><tr>${data.treasury.map(p=>metric(treasuryLabel(p.years),p.yield==null?'—':fmt(p.yield)+' %')).join('')}</tr></table>${common?plot({id:'treasury',title:'Curva del Tesoro: rendimiento por vencimiento',points:curve.map(p=>({date:treasuryLabel(p.years),value:p.yield!})),x:curve.map(p=>p.years),color:CHART_COLORS.price,height:120,unit:'%'},renderer):'<p class="meta">No hay una fecha común para dibujar la curva completa.</p>'}<div class="meta compact-foot">${common?`${escape(curve[0].date)} · ${two?.yield!=null&&ten?.yield!=null?`10–2 años: ${fmt((ten.yield-two.yield)*100)} pb${ten.yield<two.yield?' · Invertida':''}`:''}`:data.treasury.map(p=>treasuryLabel(p.years)+': '+escape(p.date??'sin fecha')).join(' · ')}</div><div class="meta compact-bond-changes">Cambio diario: ${data.treasury.map(p=>treasuryLabel(p.years)+' '+fmt(p.changeBp)+' pb').join(' · ')}</div></section>`;
}
export function renderMarketPages(data:BriefData,renderer:ChartRenderer=chartSvg){
 const first=data.assets.filter(a=>['Índices','Volatilidad','ETF'].includes(a.group)),second=data.assets.filter(a=>!['Índices','Volatilidad','ETF'].includes(a.group));
 const grid=(cards:string[])=>`<table role="presentation" width="100%" class="market-grid" cellspacing="0"><tbody>${Array.from({length:Math.ceil(cards.length/2)},(_,i)=>`<tr><td class="market-cell">${cards[i*2]}</td><td class="market-cell">${cards[i*2+1]??''}</td></tr>`).join('')}</tbody></table>`;
 return [{title:'Índices, ETF y volatilidad',cards:first.map(a=>compactAsset(a,data.assets.indexOf(a),renderer))},{title:'Materias primas, divisas y renta fija',cards:[...second.map(a=>compactAsset(a,data.assets.indexOf(a),renderer)),compactTreasury(data,renderer)]}].map((page,i)=>`<section class="market-page" data-market-page="${i+1}" aria-label="Mercados · página ${i+1}"><div class="market-page-header"><div class="meta">MensorTerminal · ${escape(data.date)} · MERCADOS ${i+1} / 2</div><h2 ${i===0?'id="mercados"':''}>${page.title}</h2></div>${grid(page.cards)}<p class="meta market-page-note">Últimos cierres completos; variaciones ajustadas. Volatilidad anualizada de veinte sesiones. ${i===1?'Materias primas: futuros continuos. Divisas: precio por unidad de la moneda base.':''}</p></section>`).join('');
}
function watchOverview(assets:BriefAsset[]){
 if(!assets.length)return '<p>Añade activos a tu lista de seguimiento para personalizar las próximas ediciones.</p>';
 const ranked=[...assets].filter(a=>a.week!==null).sort((a,b)=>Math.abs(b.week!)-Math.abs(a.week!)),volatile=[...assets].filter(a=>a.vol20!==null).sort((a,b)=>b.vol20!-a.vol20!)[0];
 const summary=[ranked[0]?`Mayor variación en cinco sesiones: ${ranked[0].symbol} (${pct(ranked[0].week)}).`:'',volatile?`Mayor volatilidad de veinte sesiones: ${volatile.symbol} (${fmt(volatile.vol20)} % anualizado).`:''].filter(Boolean).join(' ');
 return `<p>${escape(summary)}</p><div class="table-wrap"><table width="100%" class="data-table watch-summary"><thead><tr><th align="left">Activo</th><th>5 sesiones</th><th>21 sesiones</th><th>Vol. 20 s.</th><th>Frente S&P 500<br/>21 s.</th></tr></thead><tbody>${assets.map(a=>`<tr><td class="ticker">${escape(a.symbol)}</td><td class="num ${tone(a.week)}">${pct(a.week)}</td><td class="num ${tone(a.month)}">${pct(a.month)}</td><td class="num">${a.vol20==null?'—':fmt(a.vol20)+' %'}</td><td class="num ${tone(a.context?.relative21)}">${pp(a.context?.relative21)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function renderAsiaOpening(data:BriefData):string{
 if(!data.asia)return '';
 const labels={open:'En curso',pause:'Pausa de sesión',closed:'Cierre', 'awaiting-close':'Cierre pendiente',previous:'Última sesión',unavailable:'Sin datos'};
 const zones:Record<string,string>={'Asia/Tokyo':'JST','Asia/Seoul':'KST','Asia/Hong_Kong':'HKT','Asia/Shanghai':'CST'};
 return `<section class="asia-opening" aria-labelledby="asia"><h2 id="asia">Sesión asiática</h2><p class="asia-lead">${escape(data.asia.editorial??data.asia.summary)}</p><div class="table-wrap"><table width="100%" class="data-table asia-table"><thead><tr><th>Índice</th><th>Nivel</th><th>Sesión</th><th>Estado</th><th>Último dato local</th></tr></thead><tbody>${data.asia.markets.map(m=>`<tr><td><span class="asia-name">${escape(m.name)}</span><div class="meta">${escape(m.country)}</div></td><td class="num">${fmt(m.price)} <small>pts</small></td><td class="num ${tone(m.change)}">${pct(m.change)}</td><td class="asia-status">${labels[m.status]}</td><td class="meta">${m.at?escape(new Date(m.at).toLocaleString('es-ES',{timeZone:m.timezone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+' '+escape(zones[m.timezone]??''):escape(m.date??'—')}</td></tr>`).join('')}</tbody></table></div><p class="meta asia-note">Variación frente al cierre anterior de cada índice. Los mercados en curso o con cierre pendiente muestran datos provisionales al corte de esta edición.</p></section>`;
}
export function renderMorningFutures(data:BriefData,renderer:ChartRenderer=chartSvg):string{
 if(!data.futures?.length)return '';
 const labels={overnight:'Negociación nocturna',intraday:'Sesión en curso','previous-close':'Último cierre',unavailable:'Sin observación al corte'};
 const cards=data.futures.map((f,i)=>{
  const points=f.points.map(p=>({value:p.value,date:new Date(p.date).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}));
  const observed=f.at?new Date(f.at).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' · Madrid':f.date??'Sin fecha';
  return `<section class="future-card"><div class="future-status">${escape(labels[f.status])}</div><table role="presentation" width="100%"><tr><td><h3>${escape(f.name)}</h3><div class="meta">${escape(f.contract??f.symbol)}</div></td><td align="right"><div class="num future-price">${fmt(f.price)} <small>pts</small></div><div class="num ${tone(f.change)}">${pct(f.change)}</div></td></tr></table><p class="meta future-observed">${escape(observed)}</p>${points.length>=2?plot({id:`future-${i}`,title:`${f.name}: ${f.status==='previous-close'?'última sesión disponible':'negociación al corte'}`,points,color:CHART_COLORS.price,height:96,unit:'pts'},renderer):'<p class="meta">Sin serie intradiaria verificada al corte.</p>'}<p class="meta future-reference">${f.referencePrice!==null&&f.referenceDate?`Referencia: cierre del ${escape(f.referenceDate)} · ${fmt(f.referencePrice)} pts`:'Sin referencia de cierre comparable.'}</p></section>`;
 });
 return `<section class="morning-futures" aria-labelledby="futuros"><h2 id="futuros">Futuros antes de la apertura</h2><p class="section-deck">El pulso de los índices estadounidenses al cierre de información.</p><table role="presentation" width="100%" class="future-grid"><tbody>${[0,2].map(i=>`<tr><td>${cards[i]??''}</td><td>${cards[i+1]??''}</td></tr>`).join('')}</tbody></table><p class="meta">Futuros continuos, expresados en puntos. La negociación nocturna se distingue de los cierres anteriores; los cambios de vencimiento pueden afectar a la comparación. En ausencia de una sesión nueva se conserva la última fecha disponible.</p></section>`;
}
export type BriefRenderOptions={interactive?:boolean};
export function renderBrief(data:BriefData,renderer:ChartRenderer=chartSvg,options:BriefRenderOptions={}):string{
 const interactive=options.interactive!==false;
 const draw=interactive&&renderer===chartSvg?renderInteractiveChart:renderer;
 let order=0;
 // Only trusted section identifiers and headings reach the template; data prose
 // is escaped at its point of use. Native details remains usable without JS.
 const section=(id:string,title:string,body:string,open=false)=>{
  order++;
  const number=String(order).padStart(2,'0');
  const cleanBody=body.replace(`<h2 id="${id}">${title}</h2>`,'');
  return interactive?`<details class="brief-section" data-brief-section${open?' open':''}><summary><span class="section-number" aria-hidden="true">${number}</span><h2 id="${id}">${title}</h2><span class="section-toggle" aria-hidden="true"></span></summary><div class="brief-section-body">${cleanBody}</div></details>`:`<section class="brief-flat"><h2 id="${id}">${title}</h2>${cleanBody}</section>`;
 };
 const closing=data.geopoliticalSummary??geopoliticalFallback(data);
 const date=escape(new Date(data.date+'T12:00Z').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'}));
 const cutoff=escape(new Date(data.cutoff).toLocaleString('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'}));
 const items:[string,string][]=[...(data.asia?[['asia','Asia'] as [string,string]]:[]),...(data.futures?.length?[['futuros','Futuros'] as [string,string]]:[]),['resumen','Resumen'],['watchlist','Watchlist'],['mercados','Mercados'],['macro','Pulso macro'],['noticias','Noticias'],['politica','Geopolítica'],['entorno','Entorno internacional']];
 const nav=`<nav class="contents" aria-label="Secciones del Morning Brief">${items.map(([id,label])=>`<a href="#${id}">${label}</a>`).join('')}</nav>`;
 const controls=interactive?'<div class="brief-tools" role="group" aria-label="Organizar secciones"><button type="button" data-brief-expand="all">Desplegar todo</button><button type="button" data-brief-expand="none">Contraer todo</button></div>':'';
 const asia=data.asia?section('asia','Sesión asiática',renderAsiaOpening(data),true):'';
 const futures=data.futures?.length?section('futuros','Futuros antes de la apertura',renderMorningFutures(data,draw)):'';
 const summary=section('resumen','Resumen',`<p class="lead">${escape(data.lead)}</p>${data.takeaways.map(n=>`<section class="takeaway"><h3>${escape(n.title)}</h3><p>${escape(n.text)}</p></section>`).join('')}`,true);
 const watchlist=section('watchlist','Lista de seguimiento',`${watchOverview(data.watchlist)}${data.watchlist.map((a,i)=>assetCard(a,i,true,draw)).join('')}`);
 const markets=section('mercados','Mercados globales',renderMarketPages(data,draw).replace('id="mercados"',''));
 const macro=section('macro','Pulso macro',renderMacroSection(data,draw));
 const news=section('noticias','Actualidad de los mercados',`<p class="meta">Desde el ${escape(data.previousDay)} a las 00:00 hasta el cierre de información, hora de Madrid.</p>${data.news.length?data.news.map(a=>newsItem(a,true)).join(''):'<p>No hay noticias verificables dentro de esta ventana.</p>'}`);
 const politics=section('politica','Geopolítica y decisiones políticas',data.politics.length?data.politics.map(a=>newsItem(a,true)).join(''):'<p>No se han confirmado novedades políticas relevantes para mercados en esta edición.</p>');
 const international=section('entorno','Entorno geopolítico internacional',`<div class="geopolitical-closing">${closing.paragraphs.map(text=>`<p>${escape(text)}</p>`).join('')}</div>`);
 const content=`<header class="masthead" style="background:#090b0f;color:#ffffff;text-align:center;padding:42px 30px 32px;border-top:3px solid #337cdb"><div class="brand" style="color:#ffffff;font:600 31px/1.3 Arial,sans-serif;letter-spacing:-1.1px">MensorTerminal</div><h1 style="font:500 13px/1.5 Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;margin:11px 0 21px;color:#94bbef">Morning Brief</h1><div class="edition" style="font:11px/1.7 Arial,sans-serif;color:#aeb7c4">${date}<span class="edition-badge">${data.preview?'Edición de prueba':'Edición de premercado'}</span></div></header><div class="paper"><p class="meta cutoff">Información hasta ${cutoff} · Madrid</p>${nav}${controls}${asia}${futures}${summary}${watchlist}${markets}${macro}${news}${politics}${international}<footer class="footer"><p>Volatilidad realizada anualizada: 252 sesiones en activos bursátiles y 365 días en criptoactivos. ATR: rango verdadero medio de catorce sesiones. Referencia S&P 500 mediante SPY; diferencias de rentabilidad en puntos porcentuales y correlación sobre veinte rendimientos diarios coincidentes. Medias de veinte y cincuenta sesiones sobre cierres ajustados. Retroceso respecto al máximo del histórico disponible.</p><p>Información de mercados. No constituye asesoramiento personalizado.</p><a href="https://sftmvpppp.vercel.app/" target="_blank" rel="noopener noreferrer">Abrir terminal</a></footer></div>`;
 const nonce=interactive?Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join(''):'';
 const policy=`default-src 'none'; script-src ${interactive?`'nonce-${nonce}'`:"'none'"}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src https: data: cid:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
 return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MensorTerminal · Morning Brief · ${escape(data.date)}</title><style>${BRIEF_STYLES}${interactive?BRIEF_INTERACTION_CSS:''}</style></head><body><main>${content}</main>${interactive?`<script nonce="${nonce}">${BRIEF_INTERACTION_SCRIPT}</script>`:''}</body></html>`;
}

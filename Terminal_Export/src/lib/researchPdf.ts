import type {ResearchDetail,ResearchMetric,ResearchSeries} from '../../../supabase/functions/analyze-ticker/research-types';

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const text=(value:unknown,limit=900000)=>typeof value==='string'?value.slice(0,limit):'';
const escape=(value:unknown)=>text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const format=(value:number,digits=2)=>value.toLocaleString('es-ES',{maximumFractionDigits:digits});
function date(value:unknown,clock=false):string{
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return 'Sin fecha';
 return new Date(value.length===10?value+'T12:00:00Z':value).toLocaleString('es-ES',{timeZone:clock?'Europe/Madrid':'UTC',day:'2-digit',month:'short',year:'numeric',...(clock?{hour:'2-digit',minute:'2-digit'}:{})});
}
function inline(value:string):string{
 return escape(value.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
}
/** A deliberately small formatter: source HTML is always text, never markup. */
function markdown(value:unknown):string{
 const lines=text(value).split('\n'),out:string[]=[];let list=false;
 const close=()=>{if(list){out.push('</ul>');list=false;}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line){close();continue;}
  if(line.includes('|')&&/^\|?\s*:?-{2,}/.test(lines[i+1]?.trim()??'')){
   close();const cells=(row:string)=>row.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
   const header=cells(line).slice(0,16),rows:string[][]=[];i++;
   while(i+1<lines.length&&lines[i+1].includes('|'))rows.push(cells(lines[++i]));
   out.push(`<div class="table-wrap${rows.length<=8?' keep-table':''}"><table><thead><tr>${header.map(cell=>`<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${header.map((_,j)=>`<td>${inline(row[j]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue;
  }
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){close();const level=Math.min(4,heading[1].length+1);out.push(`<h${level}>${inline(heading[2])}</h${level}>`);continue;}
  const bullet=line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
  if(bullet){if(!list){out.push('<ul>');list=true;}out.push(`<li>${inline(bullet[1])}</li>`);continue;}
  close();if(/^[-_]{3,}$/.test(line))out.push('<hr>');else out.push(`<p>${inline(line)}</p>`);
 }
 close();return out.join('\n');
}
function metricValue(metric:ResearchMetric):string{
 if(!finite(metric.value))return '-';
 const unit=metric.unit==='multiple'&&/(?:correlation|(?:^|:)beta)(?:$|:)/i.test(metric.id)?'':unitText(metric.unit,metric.currency);
 return `${format(metric.value,metric.unit==='count'?0:2)}${unit?' '+unit:''}`;
}
function unitText(unit:string,currency:string|null):string{
 if(unit==='percent'||unit==='%')return '%';
 if(unit==='multiple')return '×';
 if(unit==='count')return '';
 if(unit==='currency')return currency??'';
 if(unit==='millions')return ['M',currency].filter(Boolean).join(' ');
 if(unit==='currency/share')return currency?currency+'/acción':'por acción';
 return [unit,currency!==unit?currency:null].filter(Boolean).join(' ');
}
type Point={date:string;time:number;value:number|null};
function observations(series:ResearchSeries):Point[]{
 const rows=new Map<string,Point>();
 for(const point of (Array.isArray(series.points)?series.points:[]).slice(0,10000)){
  const day=text(point?.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)continue;
  rows.set(day,{date:day,time:Date.parse(day),value:finite(point.value)?point.value:null});
 }
 const ordered=[...rows.values()].sort((a,b)=>a.time-b.time);if(ordered.length<=360)return ordered;
 // Preserve extrema and missing-data boundaries instead of connecting through
 // an unavailable interval. At most six points per bucket, 540 per series.
 const result:Point[]=[],size=Math.ceil(ordered.length/90);
 for(let i=0;i<ordered.length;i+=size){const bucket=ordered.slice(i,i+size),valid=bucket.filter((p):p is Point&{value:number}=>p.value!==null),missing=bucket.filter(p=>p.value===null),selected=[bucket[0],bucket.at(-1)!];if(valid.length)selected.push(valid.reduce((a,b)=>a.value<b.value?a:b),valid.reduce((a,b)=>a.value>b.value?a:b));if(missing.length)selected.push(missing[0],missing.at(-1)!);result.push(...[...new Map(selected.map(p=>[p.date,p])).values()].sort((a,b)=>a.time-b.time));}
 return result;
}
type ChartGroup={unit:string;currency:string|null;family:string;series:ResearchSeries[]};
function chartGroups(series:ResearchSeries[]):ChartGroup[]{
 const groups=new Map<string,ChartGroup>();
 for(const row of series.slice(0,40)){
  if(!row||!Array.isArray(row.points)||observations(row).filter(p=>p.value!==null).length<2)continue;
  const family=row.id.startsWith('comparison:')?row.id.split(':')[1]:'';
  const key=JSON.stringify([row.unit,row.currency,family]),group=groups.get(key)??{unit:row.unit,currency:row.currency,family,series:[]};
  if(group.series.length<8)group.series.push(row);groups.set(key,group);
 }
 return [...groups.values()].slice(0,3);
}
function chart(group:ChartGroup,index:number):string{
 const colors=['#2563eb','#111827','#6b7280','#0891b2','#4f46e5','#64748b','#1d4ed8','#475569'];
 const rows=group.series.map(series=>({series,points:observations(series)})),all=rows.flatMap(row=>row.points.filter((p):p is Point&{value:number}=>p.value!==null));
 if(all.length<2)return '';
 const first=Math.min(...all.map(p=>p.time)),last=Math.max(...all.map(p=>p.time)),min=Math.min(...all.map(p=>p.value)),max=Math.max(...all.map(p=>p.value)),pad=(max-min||Math.abs(max)*.04||1)*.1,low=min-pad,high=max+pad;
 const W=760,H=245,L=65,R=748,T=20,B=202,x=(time:number)=>L+(time-first)/Math.max(1,last-first)*(R-L),y=(value:number)=>B-(value-low)/(high-low)*(B-T);
 const familyTitles:Record<string,string>={return:'Rentabilidad acumulada',indexed:'Rentabilidad acumulada',drawdown:'Caídas desde máximos',correlation:'Correlación móvil con S&P 500'};
 const unit=group.family==='correlation'?'Coeficiente':unitText(group.unit,group.currency),title=familyTitles[group.family]??(group.series.length===1?group.series[0].label:['%','percent'].includes(group.unit)?'Evolución comparada':group.unit==='millions'?'Evolución financiera':'Series guardadas');
 const grid=[0,.25,.5,.75,1].map(fraction=>{const value=low+(high-low)*fraction,at=y(value);return `<line x1="${L}" x2="${R}" y1="${at.toFixed(2)}" y2="${at.toFixed(2)}" stroke="#e2e8f0" stroke-dasharray="3 4"/><text x="${L-9}" y="${(at+3).toFixed(2)}" text-anchor="end">${escape(format(value,Math.abs(value)<1?4:2))}</text>`;}).join('');
 const paths=rows.map(({points},i)=>{let drawing=false;const path=points.map(point=>{if(point.value===null){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return `${command}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`;}).join(' ');const isolated=points.filter((point,j)=>point.value!==null&&(j===0||points[j-1].value===null)&&(j===points.length-1||points[j+1].value===null));return `<path d="${path}" fill="none" stroke="${colors[i]}" stroke-width="1.8" stroke-linejoin="round"/>${isolated.map(point=>`<circle cx="${x(point.time).toFixed(2)}" cy="${y(point.value!).toFixed(2)}" r="2.4" fill="${colors[i]}"/>`).join('')}`;}).join('');
 return `<figure class="research-chart"><div class="chart-title"><h3>${escape(title)}</h3><span>${escape(unit)}</span></div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-${index}-title"><title id="chart-${index}-title">${escape(title)} - ${escape(unit)} - ${escape(date(new Date(first).toISOString()))} a ${escape(date(new Date(last).toISOString()))}</title><g font-family="Arial, sans-serif" font-size="10" fill="#64748b">${grid}<text x="${L}" y="230">${escape(date(new Date(first).toISOString()))}</text><text x="${R}" y="230" text-anchor="end">${escape(date(new Date(last).toISOString()))}</text></g>${paths}</svg><figcaption>${rows.map(({series},i)=>`<span><i style="background:${colors[i]}"></i>${escape(series.label)}</span>`).join('')}</figcaption></figure>`;
}
const section=(title:string,body:string)=>body?`<section class="dossier-section"><h2>${escape(title)}</h2>${body}</section>`:'';

/** Complete offline print document, generated only from the selected version. */
export function renderResearchDossier(detail:ResearchDetail):string{
 const {item,version}=detail,snapshot=version.snapshot,exported=new Date().toISOString(),kind={ticker:'Acción',etf:'ETF',sector:'Sector',comparison:'Comparación'}[item.kind]??'Research';
 const metrics=(snapshot.metrics??[]).slice(0,1200),groups=chartGroups(snapshot.series??[]),assets=(snapshot.assets??[]).slice(0,12);
 const notes=[['Tesis',item.thesis],['Riesgos',item.risks],['Qué invalidaría la tesis',item.invalidation],['Notas',item.notes]].filter(([,body])=>!!body?.trim());
 const evidence=metrics.length?`<div class="table-wrap${metrics.length<=8?' keep-table':''}"><table><thead><tr><th>Métrica</th><th>Dato guardado</th><th>Período / fecha</th></tr></thead><tbody>${metrics.map(metric=>`<tr><td>${escape(metric.symbol?metric.symbol+' · ':'')}${escape(metric.label)}</td><td class="numeric">${escape(metricValue(metric))}</td><td>${escape([metric.period,metric.date?date(metric.date):null].filter(Boolean).join(' · ')||'Sin fecha')}</td></tr>`).join('')}</tbody></table></div>`:'';
 const original=text(version.payload.analysis).trim(),narrative=markdown(original),extraSections=(snapshot.sections??[]).filter(row=>text(row.text).trim()&&text(row.text).trim()!==original).map(row=>`<h3>${escape(row.title)}</h3>${markdown(row.text)}`).join('');
 return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'"><title>${escape(item.subject)} - MensorTerminal - v${escape(String(version.version))}</title><style>
*{box-sizing:border-box}html{background:#eef1f5}body{margin:0 auto;max-width:1000px;padding:42px 48px;background:white;color:#152031;font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.55}h1,h2,h3,p,ul,figure{margin:0}p{margin:5pt 0 8pt}ul{padding-left:16pt;margin:7pt 0 11pt}li{margin:4pt 0}h1{font-family:Georgia,'Times New Roman',serif;font-size:27pt;line-height:1.12;font-weight:normal;overflow-wrap:anywhere}h2{font-family:Georgia,'Times New Roman',serif;font-size:16pt;line-height:1.2;color:#142033;margin:0 0 12pt}h3{font-size:10pt;color:#1d4ed8;margin:13pt 0 6pt}h4{font-size:9.5pt;margin:10pt 0 5pt}.masthead{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:14pt;margin-bottom:23pt}.brand{font-weight:700;font-size:18pt;letter-spacing:-.5pt;color:#111}.masthead span{font-size:8pt;letter-spacing:1.1pt;color:#64748b}.eyebrow{font-size:8pt;letter-spacing:1.2pt;text-transform:uppercase;color:#2563eb;margin-bottom:10pt}.version{display:flex;flex-wrap:wrap;gap:6pt 18pt;font-size:8pt;color:#64748b;margin-top:14pt}.version strong{color:#172033}.identity{display:flex;flex-wrap:wrap;gap:7pt;margin-top:15pt}.identity span{font-size:8pt;padding:5pt 8pt;background:#f1f5f9;color:#334155;border-radius:3pt}.frozen{border-left:2px solid #2563eb;background:#f6f8fc;padding:8pt 12pt;font-size:8pt;color:#475569;margin:20pt 0 24pt}.dossier-section{margin-top:24pt}.dossier-section>h2{border-bottom:1px solid #dbe2ea;padding-bottom:8pt}table{width:100%;border-collapse:collapse;font-size:8pt;table-layout:auto}thead{display:table-header-group}th{text-align:left;background:#111827;color:white;font-size:7.5pt;font-weight:500;padding:7pt 8pt}td{padding:7pt 8pt;vertical-align:top;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere}tr:nth-child(even)td{background:#f8fafc}.numeric{font-variant-numeric:tabular-nums;font-weight:500}.table-wrap{margin:10pt 0 15pt}.keep-table{break-inside:avoid;page-break-inside:avoid}code{font-family:Consolas,monospace;font-size:8.5pt;background:#f1f5f9;padding:1pt 3pt}hr{border:0;border-top:1px solid #dbe2ea;margin:14pt 0}.research-chart{border:1px solid #dce3ed;border-radius:5pt;padding:11pt 12pt;margin:12pt 0 16pt;break-inside:avoid;page-break-inside:avoid}.chart-title{display:flex;justify-content:space-between;align-items:baseline;gap:10pt}.chart-title h3{margin:0;color:#172033;font-size:9.5pt}.chart-title>span{font-size:8pt;color:#64748b}svg{width:100%;height:auto;display:block;margin:7pt 0}figcaption{display:flex;flex-wrap:wrap;gap:6pt 15pt;font-size:7.5pt;color:#475569}figcaption span{display:inline-flex;align-items:center;gap:5pt}figcaption i{display:inline-block;height:2px;width:13pt}.notes-grid{display:grid;grid-template-columns:1fr 1fr;gap:12pt}.note{border:1px solid #e2e8f0;padding:12pt;border-radius:4pt;break-inside:avoid;page-break-inside:avoid}.note h3{margin-top:0}.muted{font-size:8pt;color:#64748b}.coverage{font-size:8pt;color:#64748b}.footer{margin-top:12pt;padding-top:8pt;border-top:1px solid #dbe2ea;font-size:7pt;color:#64748b}.date-line{font-size:8pt;color:#64748b;margin-bottom:11pt}.narrative{overflow-wrap:anywhere}.narrative h2{font-size:13pt;border:0;padding:0;margin:18pt 0 8pt}.narrative h3{color:#172033}.narrative p,.note p{orphans:3;widows:3}@page{size:A4;margin:17mm 15mm 18mm;@bottom-left{content:'MensorTerminal | Research dossier';font-family:Arial,sans-serif;font-size:7pt;color:#64748b}@bottom-right{content:counter(page);font-family:Arial,sans-serif;font-size:7pt;color:#64748b}}@media print{html{background:white}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;max-width:none;padding:0;font-size:9.5pt}.masthead{break-after:avoid}.dossier-section>h2,h3,h4{break-after:avoid;page-break-after:avoid}tr{break-inside:avoid;page-break-inside:avoid}.research-chart{margin:10pt 0 14pt}.table-wrap{overflow:visible}.notes-grid{display:grid;grid-template-columns:1fr 1fr}.note{margin-bottom:0}}
</style></head><body><header class="masthead"><div class="brand">MensorTerminal</div><span>RESEARCH DOSSIER</span></header><div class="eyebrow">${escape(kind)} · Investigación guardada</div><h1>${escape(item.title||item.subject)}</h1><div class="version"><span><strong>Versión ${escape(String(version.version))}</strong> · ${escape(date(version.created_at,true))}</span><span>Captura: ${escape(date(snapshot.capturedAt,true))}</span><span>Exportación: ${escape(date(exported,true))}</span></div>${assets.length?`<div class="identity">${assets.map(asset=>`<span><strong>${escape(asset.symbol)}</strong> · ${escape(asset.name)}${asset.currency?' · '+escape(asset.currency):''}</span>`).join('')}</div>`:''}<p class="frozen">Este dossier conserva la versión seleccionada. Los gráficos y las cifras proceden de los datos guardados; no se actualizan ni se vuelve a generar el análisis al exportar.</p>
${version.summary?.trim()?section('Resumen de la versión',`<div class="narrative">${markdown(version.summary)}</div>`):''}
${section('Análisis guardado',`<div class="narrative">${narrative||'<p class="muted">Esta versión no contiene texto de análisis.</p>'}</div>`)}
${extraSections?section('Información complementaria guardada',`<div class="narrative">${extraSections}</div>`):''}
${section('Cifras de referencia',evidence)}
${section('Gráficos de la versión',groups.length?groups.map(chart).join(''):'<p class="muted">Esta versión no dispone de series suficientes para representar un gráfico. No se completa con datos actuales.</p>')}
${notes.length?section('Tesis y cuaderno personal',`<p class="date-line">Notas personales · edición ${escape(date(item.updated_at,true))}</p><div class="notes-grid">${notes.map(([title,body])=>`<article class="note"><h3>${escape(title)}</h3>${markdown(text(body,20000))}</article>`).join('')}</div>`):''}
${snapshot.coverage?.length?section('Cobertura de la captura',`<ul class="coverage">${snapshot.coverage.slice(0,20).map(value=>`<li>${escape(value)}</li>`).join('')}</ul>`):''}
<footer class="footer">MensorTerminal · ${escape(item.subject)} · Versión ${escape(String(version.version))} · ${escape(version.id)}<br>Información de investigación. Las rentabilidades históricas no anticipan resultados futuros. Monedas y períodos se conservan según la captura.</footer></body></html>`;
}

/** Opened synchronously by the UI when a popup handle is supplied. No fetch/AI. */
export function downloadResearchDossier(detail:ResearchDetail,targetWindow?:Window):void{
 const target=targetWindow??window.open('','_blank');if(!target)throw new Error('Permite ventanas emergentes para exportar el dossier.');
 let printed=false;
 const print=()=>{if(printed||target.closed)return;printed=true;target.focus?.();target.print?.();};
 target.addEventListener?.('load',()=>window.setTimeout(print,150),{once:true});
 try{target.opener=null;}catch{/* The opener is not required by the document. */}
 target.document.open?.();target.document.write(renderResearchDossier(detail));target.document.close();
 if(target.document.readyState==='complete')window.setTimeout(print,150);
}

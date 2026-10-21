import type {ChartSpec} from './render.ts';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type InteractivePoint={date:string;value:number|null;x:number};
type InteractiveChart={title:string;unit:string;decimals:number;kind:'line'|'bar';temporal:boolean;color:string;height:number;points:InteractivePoint[]};
const number=(value:number,decimals=6)=>value.toLocaleString('es-ES',{maximumFractionDigits:decimals});
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

function normalize(chart:ChartSpec):InteractiveChart{
 const temporal=!chart.x,offset=Math.max(0,chart.points.length-2000);
 const entries=chart.points.slice(-2000).map((p,i)=>({date:String(p.date??'').slice(0,120),value:finite(p.value)?p.value:null,x:temporal?i:finite(chart.x?.[i+offset])?chart.x![i+offset]:i}));
 // Localized intraday labels are already ordered by the producer. Parsing
 // dd/MM with Date.parse would reinterpret them as US dates or discard them.
 const localLabel=(value:string)=>/^(?:0[1-9]|[12]\d|3[01])\/(?:0[1-9]|1[0-2]),?\s+(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
 const local=temporal&&entries.some(p=>localLabel(p.date));
 const sequence=local?entries.filter(p=>localLabel(p.date)):entries.filter(p=>/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(p.date)&&Number.isFinite(Date.parse(p.date))).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 const points=temporal?sequence.filter((p,i,rows)=>!i||p.date!==rows[i-1].date).map((p,i)=>({...p,x:i})):entries;
 const unit=String(chart.unit??'').slice(0,24),decimals=finite(chart.decimals)?Math.max(0,Math.min(8,Math.trunc(chart.decimals))):/^(?:pts|pb|%|[A-Z]{3})$/.test(unit)?2:6;
 return {title:String(chart.title).slice(0,240),unit,decimals,kind:chart.kind==='bar'?'bar':'line',temporal,color:/^#[0-9a-f]{6}$/i.test(chart.color)?chart.color:'#4389ed',height:finite(chart.height)?Math.max(150,Math.min(360,chart.height)):220,points};
}

function geometry(data:InteractiveChart){
 const w=760,h=data.height,left=62,right=18,top=22,bottom=32,values=data.points.flatMap(p=>p.value===null?[]:[p.value]);
 let min=Math.min(...values),max=Math.max(...values);if(data.kind==='bar'){min=Math.min(0,min);max=Math.max(0,max);}
 const pad=(max-min||Math.max(Math.abs(max)*.02,1))*.09;min-=pad;max+=pad;
 const first=data.points[0]?.x??0,last=data.points.at(-1)?.x??1,span=last-first||1;
 return {w,h,left,right,top,bottom,min,max,x:(i:number)=>data.kind==='bar'?left+(i+.5)/Math.max(data.points.length,1)*(w-left-right):data.points.length===1?w/2:left+(data.points[i].x-first)/span*(w-left-right),y:(v:number)=>h-bottom-(v-min)/(max-min)*(h-top-bottom)};
}

function initialSvg(data:InteractiveChart,id:string):string{
 const g=geometry(data),{w,h,left,right,top,bottom,x,y}=g;
 const axis=(value:number)=>value.toLocaleString('es-ES',{maximumFractionDigits:g.max-g.min<.1?4:2});
 const ticks=Array.from({length:4},(_,i)=>{const value=g.min+(g.max-g.min)*i/3,at=y(value);return `<path d="M${left} ${at.toFixed(2)}H${w-right}" stroke="#dce3eb" stroke-dasharray="3 5"/><text x="${left-9}" y="${(at+4).toFixed(2)}" text-anchor="end" fill="#697584" font-size="11">${esc(axis(value))}</text>`;}).join('');
 let line='',drawing='';
 if(data.kind==='bar'){
  const width=Math.max(2,Math.min(48,(w-left-right)/Math.max(data.points.length,1)*.55));
  drawing=`<path d="M${left} ${y(0).toFixed(2)}H${w-right}" stroke="#8998aa"/>`+data.points.map((p,i)=>p.value===null?'':`<rect x="${(x(i)-width/2).toFixed(2)}" y="${Math.min(y(0),y(p.value)).toFixed(2)}" width="${width.toFixed(2)}" height="${Math.max(1,Math.abs(y(p.value)-y(0))).toFixed(2)}" rx="2" fill="${p.value<0?'#7b8fa6':data.color}"/>`).join('');
 }else{
  let drawingSegment=false;for(let i=0;i<data.points.length;i++){const p=data.points[i];if(p.value===null){drawingSegment=false;continue;}line+=`${drawingSegment?'L':'M'}${x(i).toFixed(2)},${y(p.value).toFixed(2)} `;drawingSegment=true;}
  drawing=`<path d="${line.trim()}" fill="none" stroke="${data.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
 }
 const first=data.points[0],last=data.points.at(-1),labels=data.kind==='bar'?data.points.map((p,i)=>`<text x="${x(i).toFixed(2)}" y="${h-9}" text-anchor="middle" fill="#697584" font-size="11">${esc(p.date)}</text>`).join(''):first?`<text x="${left}" y="${h-9}" fill="#697584" font-size="11">${esc(first.date)}</text><text x="${w-right}" y="${h-9}" text-anchor="end" fill="#697584" font-size="11">${esc(last?.date)}</text>`:'';
 return `<svg xmlns="http://www.w3.org/2000/svg" class="brief-chart-svg" role="img" tabindex="0" aria-label="${esc(data.title)}" aria-describedby="${id}-help ${id}-readout" viewBox="0 0 ${w} ${h}"><title>${esc(data.title)}</title><rect width="${w}" height="${h}" fill="#fff"/>${ticks}${drawing}${labels}<g data-chart-crosshair="" visibility="hidden"><path data-crosshair-line="" stroke="#7389a2" stroke-dasharray="3 4"/><circle data-crosshair-dot="" r="4" fill="${data.color}" stroke="#fff" stroke-width="2"/></g></svg>`;
}

/** Server-rendered chart remains readable when scripting is unavailable. No data or labels are executed. */
export function renderInteractiveChart(chart:ChartSpec):string{
 const data=normalize(chart),valid=data.points.filter(p=>p.value!==null);if(valid.length<2)return '<p class="meta">No hay suficientes observaciones para este gráfico.</p>';
 const period=data.points.every(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date))?'sesiones':'observaciones';
 const id='brief-chart-'+String(chart.id).replace(/[^a-z0-9_-]/gi,'-').slice(0,100),ranges=data.temporal?`<div class="brief-chart-ranges" role="group" aria-label="Observaciones visibles">${[[5,'5 '+period],[21,'21 '+period],[0,'Todo']].map(([size,label])=>`<button type="button" data-chart-range="${size}" aria-pressed="${size===0?'true':'false'}"${Number(size)>data.points.length?' disabled':''}>${label}</button>`).join('')}</div>`:'';
 return `<figure class="brief-interactive-chart" data-brief-chart="${esc(JSON.stringify(data))}"><div class="brief-chart-toolbar">${ranges}<button type="button" data-chart-reset="" class="brief-chart-reset">Restablecer</button></div>${initialSvg(data,id)}<figcaption><output id="${id}-readout" class="brief-chart-readout" aria-live="polite">${esc(valid.at(-1)!.date)} · ${esc(number(valid.at(-1)!.value!,data.decimals))}${data.unit?' '+esc(data.unit):''}</output><span id="${id}-help" class="brief-chart-help">Pasa el cursor o usa las flechas para consultar cada observación${data.unit?' · '+esc(data.unit):''}.</span></figcaption></figure>`;
}

export const BRIEF_INTERACTION_CSS=`
.brief-interactive-chart{margin:0;background:#fff;color:#182536;border:1px solid #e0e6ed;border-radius:6px;overflow:hidden}.brief-chart-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 10px 0;font:11px/1.4 Arial,Helvetica,sans-serif}.brief-chart-ranges{display:flex;gap:3px;flex-wrap:wrap}.brief-chart-toolbar button{appearance:none;border:1px solid transparent;border-radius:3px;padding:5px 8px;background:#f1f4f8;color:#596b7e;font:inherit;cursor:pointer}.brief-chart-toolbar button[aria-pressed="true"]{background:#e5effc;color:#185ea8;border-color:#bad0ec}.brief-chart-toolbar button:disabled{opacity:.4;cursor:default}.brief-chart-toolbar button:focus-visible,.brief-chart-svg:focus-visible{outline:2px solid #4389ed;outline-offset:-2px}.brief-chart-reset{margin-left:auto}.brief-chart-svg{width:100%;height:auto;display:block;touch-action:pan-y;cursor:crosshair}.brief-interactive-chart figcaption{min-height:38px;padding:0 12px 10px;font:11px/1.5 Arial,Helvetica,sans-serif}.brief-chart-readout{display:block;font-variant-numeric:tabular-nums;color:#203c5a}.brief-chart-help{display:block;color:#788697;font-size:10px}.market-card .brief-chart-toolbar{padding:5px 5px 0;font-size:9px}.market-card .brief-chart-toolbar button{padding:3px 5px}.market-card .brief-interactive-chart figcaption{font-size:9px;padding:0 8px 6px;min-height:26px}.market-card .brief-chart-help{display:none}.macro-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}.macro-card{min-width:0}.macro-card h3{font-size:18px}.macro-card .meta{margin:8px 0 0}@media print{.brief-chart-toolbar,.brief-chart-help{display:none!important}.brief-interactive-chart{break-inside:avoid;page-break-inside:avoid}.brief-chart-svg{max-height:150px}.market-card .brief-chart-svg{max-height:65px}.market-card .brief-interactive-chart figcaption{display:none!important}.brief-interactive-chart figcaption{min-height:0}.macro-grid{display:block}.macro-card{break-inside:avoid;margin-bottom:16px}}`;

/** Standalone, nonce-authorized runtime. Local DOM operations only; no network, remote code or HTML injection. */
export const BRIEF_INTERACTION_SCRIPT=String.raw`(()=>{
'use strict';
const ns='http://www.w3.org/2000/svg';
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const format=(value,decimals)=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:numeric(decimals)?Math.max(0,Math.min(8,Math.trunc(decimals))):6}).format(value);
const element=(tag,attributes,text)=>{const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes||{}))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=String(text);return node;};
document.querySelectorAll('[data-brief-chart]').forEach(container=>{
let data;try{data=JSON.parse(container.getAttribute('data-brief-chart')||'');}catch{return;}
if(!data||!Array.isArray(data.points)||data.points.length>2000||!data.points.every(p=>p&&typeof p.date==='string'&&numeric(p.x)&&(p.value===null||numeric(p.value))))return;
const svg=container.querySelector('svg'),readout=container.querySelector('output');if(!svg||!readout)return;
const source=data.points,initialReadout=readout.textContent;let points=source,selected=-1,geometry=null,crosshair=null,dot=null;
const describe=p=>p.date+' · '+(p.value===null?'Sin observación':format(p.value,data.decimals)+(data.unit?' '+data.unit:''));
const hover=index=>{selected=index;const p=points[index];if(!p||p.value===null){if(crosshair)crosshair.setAttribute('visibility','hidden');if(p)readout.textContent=describe(p);return;}readout.textContent=describe(p);const x=geometry.x(index),y=geometry.y(p.value);crosshair.setAttribute('visibility','visible');crosshair.querySelector('path').setAttribute('d','M'+x+' '+geometry.top+'V'+(geometry.h-geometry.bottom));dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));};
const clear=()=>{selected=-1;if(crosshair)crosshair.setAttribute('visibility','hidden');const p=points.findLast(p=>p.value!==null);readout.textContent=p?describe(p):initialReadout;};
const draw=()=>{
const values=points.filter(p=>p.value!==null).map(p=>p.value);if(!values.length)return;
const w=760,h=numeric(data.height)?Math.max(150,Math.min(360,data.height)):220,left=62,right=18,top=22,bottom=32;
let min=Math.min(...values),max=Math.max(...values);if(data.kind==='bar'){min=Math.min(0,min);max=Math.max(0,max);}const pad=(max-min||Math.max(Math.abs(max)*.02,1))*.09;min-=pad;max+=pad;
const first=points[0].x,last=points[points.length-1].x,span=last-first||1,x=i=>data.kind==='bar'?left+(i+.5)/Math.max(points.length,1)*(w-left-right):points.length===1?w/2:left+(points[i].x-first)/span*(w-left-right),y=v=>h-bottom-(v-min)/(max-min)*(h-top-bottom);
geometry={w,h,left,right,top,bottom,x,y};const nodes=[element('title',{},data.title),element('rect',{width:w,height:h,fill:'#fff'})];
for(let i=0;i<4;i++){const v=min+(max-min)*i/3,at=y(v),label=new Intl.NumberFormat('es-ES',{maximumFractionDigits:max-min<.1?4:2}).format(v);nodes.push(element('path',{d:'M'+left+' '+at+'H'+(w-right),stroke:'#dce3eb','stroke-dasharray':'3 5'}),element('text',{x:left-9,y:at+4,'text-anchor':'end',fill:'#697584','font-size':11},label));}
if(data.kind==='bar'){
nodes.push(element('path',{d:'M'+left+' '+y(0)+'H'+(w-right),stroke:'#8998aa'}));const width=Math.max(2,Math.min(48,(w-left-right)/Math.max(points.length,1)*.55));
points.forEach((p,i)=>{if(p.value!==null)nodes.push(element('rect',{x:x(i)-width/2,y:Math.min(y(0),y(p.value)),width,height:Math.max(1,Math.abs(y(p.value)-y(0))),rx:2,fill:p.value<0?'#7b8fa6':data.color}));});
}else{
let path='',connected=false;points.forEach((p,i)=>{if(p.value===null){connected=false;return;}path+=(connected?'L':'M')+x(i)+','+y(p.value)+' ';connected=true;});
nodes.push(element('path',{d:path.trim(),fill:'none',stroke:data.color,'stroke-width':2.4,'stroke-linejoin':'round','stroke-linecap':'round'}));
}
if(data.kind==='bar')points.forEach((p,i)=>nodes.push(element('text',{x:x(i),y:h-9,'text-anchor':'middle',fill:'#697584','font-size':11},p.date)));else nodes.push(element('text',{x:left,y:h-9,fill:'#697584','font-size':11},points[0].date),element('text',{x:w-right,y:h-9,'text-anchor':'end',fill:'#697584','font-size':11},points[points.length-1].date));
crosshair=element('g',{'data-chart-crosshair':'',visibility:'hidden'});crosshair.append(element('path',{stroke:'#7389a2','stroke-dasharray':'3 4'}));dot=element('circle',{r:4,fill:data.color,stroke:'#fff','stroke-width':2});crosshair.append(dot);nodes.push(crosshair);svg.replaceChildren(...nodes);svg.setAttribute('viewBox','0 0 '+w+' '+h);clear();
};
container.querySelectorAll('[data-chart-range]').forEach(button=>button.addEventListener('click',()=>{const size=Number(button.getAttribute('data-chart-range'));if(![0,5,21].includes(size))return;points=size?source.slice(-size):source;container.querySelectorAll('[data-chart-range]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));draw();}));
const reset=container.querySelector('[data-chart-reset]');if(reset)reset.addEventListener('click',()=>{points=source;container.querySelectorAll('[data-chart-range]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-chart-range')==='0')));draw();});
svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect();if(!rect.width)return;const px=(event.clientX-rect.left)/rect.width*geometry.w;let closest=0,distance=Infinity;points.forEach((p,i)=>{const next=Math.abs(geometry.x(i)-px);if(next<distance){closest=i;distance=next;}});hover(closest);});
svg.addEventListener('pointerleave',clear);svg.addEventListener('blur',clear);
svg.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End','Escape'].includes(event.key))return;event.preventDefault();if(event.key==='Escape'){clear();return;}const next=event.key==='Home'?0:event.key==='End'?points.length-1:selected<0?points.length-1:selected+(event.key==='ArrowRight'?1:-1);hover(Math.max(0,Math.min(points.length-1,next)));});
draw();
});
const sections=()=>Array.from(document.querySelectorAll('details[data-brief-section]'));
document.querySelectorAll('[data-brief-expand]').forEach(button=>button.addEventListener('click',()=>{const open=button.getAttribute('data-brief-expand')==='all';sections().forEach(detail=>{detail.open=open;});}));
const openTarget=hash=>{if(!hash||hash[0]!=='#')return;let id;try{id=decodeURIComponent(hash.slice(1));}catch{return;}const target=document.getElementById(id);if(!target)return;let parent=target;while(parent){if(parent.matches&&parent.matches('details[data-brief-section]'))parent.open=true;parent=parent.parentElement;}return target;};
document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{openTarget(link.getAttribute('href'));}));
openTarget(window.location.hash);
let printState=null;
window.addEventListener('beforeprint',()=>{if(printState)return;printState=sections().map(detail=>[detail,detail.open]);for(const [detail] of printState)detail.open=true;});
window.addEventListener('afterprint',()=>{if(!printState)return;for(const [detail,open] of printState)detail.open=open;printState=null;});
})();`;

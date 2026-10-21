import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {JSDOM} from '../Terminal_Export/node_modules/jsdom/lib/api.js';
import {renderInteractiveChart,BRIEF_INTERACTION_SCRIPT} from '../supabase/functions/daily-brief/interactive-charts.ts';
import {renderMacroSection} from '../supabase/functions/daily-brief/macro.ts';
import type {ChartSpec} from '../supabase/functions/daily-brief/render.ts';
import type {BriefData} from '../supabase/functions/daily-brief/data.ts';

const points=Array.from({length:30},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,value:100+i}));
const chart:ChartSpec={id:'test-price',title:'Cierre observado',points,color:'#4389ed',unit:'USD'};
function documentFor(html=renderInteractiveChart(chart)){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://brief.example/'});
 new Script(BRIEF_INTERACTION_SCRIPT).runInContext(dom.getInternalVMContext());
 return {dom,document:dom.window.document,window:dom.window};
}
function payload(html:string){const dom=new JSDOM(html);try{return JSON.parse(dom.window.document.querySelector('[data-brief-chart]')!.getAttribute('data-brief-chart')!);}finally{dom.window.close();}}

test('interactive charts are usable static SVGs with actual observation labels and units',()=>{
 const html=renderInteractiveChart(chart);
 assert.match(html,/<svg[^>]+tabindex="0"/);assert.match(html,/aria-describedby="brief-chart-test-price-help brief-chart-test-price-readout"/);
 assert.match(html,/2026-09-30 · 129 USD/);assert.match(html,/data-chart-range="5"/);assert.match(html,/data-chart-range="21"/);
 assert.ok(!html.includes('<script'));assert.equal(payload(html).points.length,30);
});

test('payload escapes labels and attributes, validates colors and preserves missing observations as gaps',()=>{
 const html=renderInteractiveChart({...chart,id:'x" onclick="bad',title:'<img src=x onerror=bad>',color:'red" onload="bad',unit:'USD"><script>bad</script>',points:[points[0],{...points[1],value:Infinity},points[2]]});
 const value=payload(html);assert.equal(value.color,'#4389ed');assert.equal(value.points[1].value,null);
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('onload="bad'));
 const dom=new JSDOM(html);assert.equal(dom.window.document.querySelector('svg')!.querySelectorAll('path[fill="none"]')[0].getAttribute('d')!.split('M').length-1,2);dom.window.close();
 assert.equal(renderInteractiveChart({...chart,points:[{date:'invalid',value:1},{date:'2026-10-01',value:NaN}]}),'<p class="meta">No hay suficientes observaciones para este gráfico.</p>');
});

test('time series sort actual dates and reject duplicate labels without extrapolating',()=>{
 const normalized=payload(renderInteractiveChart({...chart,points:[points[3],points[0],points[0],points[1]]}));
 assert.deepEqual(normalized.points.map(p=>p.date),[points[0].date,points[1].date,points[3].date]);
 assert.deepEqual(normalized.points.map(p=>p.value),[100,101,103]);
});

test('maturity bars have a zero baseline, distinct maturity categories and no fake temporal controls',()=>{
 const html=renderInteractiveChart({...chart,id:'maturities',kind:'bar',unit:'pb',x:[.5,2,10],points:[{date:'6 meses',value:0},{date:'2 años',value:-5},{date:'10 años',value:7}]});
 assert.ok(!html.includes('data-chart-range='));assert.equal(payload(html).temporal,false);
 const {dom,document,window}=documentFor(html),svg=document.querySelector('svg')!;
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.match(document.querySelector('output')!.textContent!,/^6 meses · 0 pb$/);
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.match(document.querySelector('output')!.textContent!,/^2 años · -5 pb$/);
 assert.equal(svg.querySelectorAll('rect').length,4);assert.ok(svg.querySelector('rect[fill="#7b8fa6"]'));dom.window.close();
});

test('intraday charts label ranges as observations, and real maturity curves retain numeric horizontal spacing',()=>{
 const intraday=renderInteractiveChart({...chart,points:Array.from({length:6},(_,i)=>({date:`2026-10-21T0${i}:00:00Z`,value:100+i}))});
 assert.match(intraday,/5 observaciones/);assert.ok(!intraday.includes('5 sesiones'));
 const curve=renderInteractiveChart({...chart,x:[.5,1],points:[{date:'6 meses',value:4},{date:'1 año',value:4.2}]});
 assert.ok(!curve.includes('data-chart-range='));assert.match(curve,/L742\.00,/);
});

test('Madrid-localized futures retain the producer chronology without US date parsing',()=>{
 const localized={...chart,unit:'pts',points:[{date:'20/10, 23:00',value:25001.25},{date:'21/10, 06:00',value:25003.5},{date:'21/10, 06:30',value:25007.75}]};
 const html=renderInteractiveChart(localized),value=payload(html);
 assert.deepEqual(value.points.map(p=>p.date),localized.points.map(p=>p.date));assert.equal(value.points.length,3);assert.ok(html.includes('5 observaciones'));
 const {dom,document,window}=documentFor(html),svg=document.querySelector('svg')!;
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(document.querySelector('output')!.textContent,'20/10, 23:00 · 25.001,25 pts');
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(document.querySelector('output')!.textContent,'21/10, 06:00 · 25.003,5 pts');dom.window.close();
});

test('display precision removes provider float noise and keeps explicit FX precision without changing values',()=>{
 for(const [unit,decimals,value,formatted] of [['pts',undefined,18.440001,'18,44'],['pb',undefined,5.000001,'5'],['%',undefined,22.550001,'22,55'],['USD',5,1.123456,'1,12346'],['JPY',3,149.123456,'149,123'],['',undefined,1.123456,'1,123456']] as const){
  const html=renderInteractiveChart({...chart,unit,decimals,points:[{date:'2026-10-19',value:1},{date:'2026-10-20',value}]}),normalized=payload(html);
  assert.equal(normalized.points[1].value,value);
  const {dom,document,window}=documentFor(html);document.querySelector('svg')!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true}));
  assert.equal(document.querySelector('output')!.textContent,'2026-10-20 · '+formatted+(unit?' '+unit:''));dom.window.close();
 }
});

test('local range controls, reset and keyboard crosshair keep exact date/value correspondence',()=>{
 const {dom,document,window}=documentFor(),svg=document.querySelector('svg')!,output=document.querySelector('output')!;
 document.querySelector<HTMLButtonElement>('[data-chart-range="5"]')!.click();
 assert.equal(document.querySelector('[data-chart-range="5"]')!.getAttribute('aria-pressed'),'true');
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(output.textContent,'2026-09-26 · 125 USD');
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(output.textContent,'2026-09-27 · 126 USD');
 assert.equal(svg.querySelector('[data-chart-crosshair]')!.getAttribute('visibility'),'visible');
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(output.textContent,'2026-09-30 · 129 USD');
 svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(svg.querySelector('[data-chart-crosshair]')!.getAttribute('visibility'),'hidden');
 document.querySelector<HTMLButtonElement>('[data-chart-reset]')!.click();svg.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
 assert.equal(output.textContent,'2026-09-01 · 100 USD');assert.equal(document.querySelector('[data-chart-range="0"]')!.getAttribute('aria-pressed'),'true');dom.window.close();
});

test('pointer hover uses the actual SVG coordinate and does not produce misleading data at gaps',()=>{
 const {dom,document,window}=documentFor(renderInteractiveChart({...chart,points:[points[0],{...points[1],value:NaN},points[2]]}));
 const svg=document.querySelector('svg')!,output=document.querySelector('output')!;
 svg.getBoundingClientRect=()=>({width:760,left:0,right:760,top:0,bottom:220,height:220,x:0,y:0,toJSON(){return {};}});
 svg.dispatchEvent(new window.MouseEvent('pointermove',{clientX:402,bubbles:true}));
 assert.equal(output.textContent,'2026-09-02 · Sin observación');assert.equal(svg.querySelector('[data-chart-crosshair]')!.getAttribute('visibility'),'hidden');
 svg.dispatchEvent(new window.MouseEvent('pointermove',{clientX:62,bubbles:true}));assert.equal(output.textContent,'2026-09-01 · 100 USD');dom.window.close();
});

test('section controls and anchor navigation are accessible and print restores reader choices',()=>{
 const {dom,document,window}=documentFor('<button data-brief-expand="all">Todo</button><button data-brief-expand="none">Cerrar</button><a href="#nested">Ir</a><details data-brief-section><summary>Primera</summary><details data-brief-section><summary>Segunda</summary><p id="nested">Contenido</p></details></details>');
 const details=Array.from(document.querySelectorAll('details'));
 document.querySelector<HTMLButtonElement>('[data-brief-expand="all"]')!.click();assert.ok(details.every(d=>d.open));
 document.querySelector<HTMLButtonElement>('[data-brief-expand="none"]')!.click();assert.ok(details.every(d=>!d.open));
 document.querySelector('a')!.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));assert.ok(details.every(d=>d.open));
 details[1].open=false;window.dispatchEvent(new window.Event('beforeprint'));assert.ok(details.every(d=>d.open));
 window.dispatchEvent(new window.Event('beforeprint'));window.dispatchEvent(new window.Event('afterprint'));
 assert.deepEqual(details.map(d=>d.open),[true,false]);dom.window.close();
});

test('runtime is a standalone script with no dynamic code, injected HTML or network calls',()=>{
 assert.doesNotThrow(()=>new Script(BRIEF_INTERACTION_SCRIPT));
 assert.ok(!/\b(?:eval|fetch|XMLHttpRequest|WebSocket|Function)\s*\(|\.innerHTML\s*=|document\.write|import\s*\(/.test(BRIEF_INTERACTION_SCRIPT));
});

function brief():BriefData{return {date:'2026-10-21',previousDay:'2026-10-20',cutoff:'2026-10-21T05:00:00Z',generatedAt:'2026-10-21T05:00:00Z',preview:true,assets:[{symbol:'^VIX',name:'VIX',group:'Volatilidad',currency:'USD',date:'2026-10-20',close:18,change:1,week:2,month:3,vol5:null,vol20:null,volumeRatio:null,drawdown:null,trend:'Mixta',points:[{date:'2026-10-20',value:18},{date:'2026-10-19',value:19},{date:'2026-10-22',value:99},{date:'2026-10-20',value:18}],volatility:[],news:[],note:'',latest:null}],watchlist:[],treasury:[{years:2,yield:4,date:'2026-10-20',changeBp:0},{years:10,yield:4.2,date:'2026-10-20',changeBp:-5},{years:20,yield:4.4,date:'2026-10-20',changeBp:null}],news:[],politics:[],lead:'',takeaways:[],ai:false};}

test('macro charts retain zero Treasury changes, omit unavailable changes and use chronologically valid VIX observations',()=>{
 const data=brief(),specs:ChartSpec[]=[];const html=renderMacroSection(data,spec=>{specs.push(spec);return '<svg></svg>';});
 assert.equal(specs.length,2);assert.equal(specs[0].kind,'bar');assert.equal(specs[0].unit,'pb');
 assert.deepEqual(specs[0].points.map(p=>p.value),[0,-5]);assert.deepEqual(specs[0].x,[2,10]);assert.match(html,/sin cambio comparable: 20 años/);
 assert.deepEqual(specs[1].points.map(p=>p.date),['2026-10-19','2026-10-20']);assert.equal(specs[1].unit,'pts');assert.ok(!html.includes('99'));
});

test('macro yields refuse mixed dates, future observations and missing cutoffs',()=>{
 for(const alter of [(d:BriefData)=>d.treasury[0].date='2026-10-19',(d:BriefData)=>d.treasury.forEach(p=>p.date='2026-10-22'),(d:BriefData)=>d.cutoff='invalid']){
  const data=brief();alter(data);const specs:ChartSpec[]=[];const html=renderMacroSection(data,spec=>{specs.push(spec);return '<svg></svg>';});
  assert.ok(!specs.some(s=>s.id==='macro-treasury-change'));assert.match(html,/No hay variaciones comparables/);
 }
});

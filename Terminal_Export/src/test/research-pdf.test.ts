import {afterEach,expect,it,vi} from 'vitest';
import {downloadResearchDossier,renderResearchDossier} from '../lib/researchPdf';
import {researchPdfFixture} from './research-pdf-fixture';

const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

it('exports only the selected saved version with dated metrics, notes and three offline SVG charts',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
 const request=vi.spyOn(globalThis,'fetch'),detail=researchPdfFixture();
 const doc=parse(renderResearchDossier(detail));
 expect(doc.body.textContent).toContain('Versión 1');expect(doc.body.textContent).not.toContain('Versión 2');
 expect(doc.body.textContent).toContain('15 oct 2026');expect(doc.body.textContent).toContain('14 oct 2026');expect(doc.body.textContent).toContain('26 oct 2026');
 expect(doc.body.textContent).toContain('12.500,5 M USD');expect(doc.body.textContent).toContain('6,3 %');expect(doc.body.textContent).toContain('25,2 ×');
 expect(doc.body.textContent).toContain('Tesis y cuaderno personal');expect(doc.body.textContent).toContain(detail.item.invalidation);
 expect(doc.querySelectorAll('svg')).toHaveLength(3);expect(doc.querySelectorAll('path').length).toBeGreaterThanOrEqual(4);
 expect(doc.querySelectorAll('img,script,iframe,object,link[href],a[href],image,use')).toHaveLength(0);
 expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("connect-src 'none'");
 expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("script-src 'none'");
 expect(request).not.toHaveBeenCalled();
});

it('escapes user text and SVG labels instead of executing source HTML or loading remote assets',()=>{
 const detail=researchPdfFixture(),attack='<img src="https://bad.example/track" onerror="alert(1)"><script>alert(1)</script>';
 detail.item.title=attack;detail.item.notes=attack;detail.version.payload.analysis='## Prueba\n'+attack+'\n[Enlace](https://bad.example/track)';detail.version.snapshot.series[0].label='</title><script>alert(2)</script>';
 const html=renderResearchDossier(detail),doc=parse(html);
 expect(doc.querySelectorAll('img,script,a[href],[onerror],[onload],foreignObject')).toHaveLength(0);
 expect(doc.body.textContent).toContain(attack);expect(html).toContain('&lt;script&gt;');
 expect(doc.querySelector('svg title')?.textContent).toContain('</title><script>alert(2)</script>');
});

it('does not substitute fresh data for an incomplete saved snapshot or generate a summary while exporting',()=>{
 const detail=researchPdfFixture();detail.version.snapshot.series=[];detail.version.summary='Resumen que ya pertenece a la versión guardada.';
 const html=renderResearchDossier(detail),doc=parse(html);
 expect(doc.querySelectorAll('svg')).toHaveLength(0);expect(doc.body.textContent).toContain('No se completa con datos actuales.');expect(doc.body.textContent).toContain(detail.version.summary);
 expect(html).not.toContain('generativelanguage.googleapis.com');
});

it('retains a complete saved narrative beyond 250,000 characters',()=>{
 const detail=researchPdfFixture();detail.version.payload.analysis='Texto conservado. '.repeat(16000)+'\nFIN DEL ANÁLISIS ORIGINAL';
 expect(parse(renderResearchDossier(detail)).body.textContent).toContain('FIN DEL ANÁLISIS ORIGINAL');
});

it('keeps currencies separate and preserves missing-data gaps without nonfinite SVG coordinates',()=>{
 const detail=researchPdfFixture();detail.version.snapshot.series=[{id:'a',label:'Dólares',unit:'currency',currency:'USD',points:[{date:'2026-10-01',value:10},{date:'2026-10-02',value:null},{date:'2026-10-03',value:11}]},{id:'b',label:'Euros',unit:'currency',currency:'EUR',points:[{date:'2026-10-01',value:20},{date:'2026-10-03',value:21}]}];
 const doc=parse(renderResearchDossier(detail));expect(doc.querySelectorAll('svg')).toHaveLength(2);
 const path=doc.querySelector('svg path')!.getAttribute('d')!;expect(path.match(/M/g)).toHaveLength(2);expect(path).not.toContain('L');expect(doc.querySelectorAll('svg')[0].querySelectorAll('circle')).toHaveLength(2);expect(doc.body.innerHTML).not.toMatch(/NaN|Infinity/);
});

it('bounds chart output while keeping the actual first and last dates',()=>{
 const detail=researchPdfFixture();detail.version.snapshot.series=detail.version.snapshot.series.slice(0,1);detail.version.snapshot.series[0].points=Array.from({length:9000},(_,i)=>({date:new Date(Date.UTC(2000,0,1)+i*86400000).toISOString().slice(0,10),value:100+Math.sin(i)}));
 const doc=parse(renderResearchDossier(detail)),path=doc.querySelector('svg path')!.getAttribute('d')!;
 expect((path.match(/[ML]/g)??[]).length).toBeLessThanOrEqual(540);expect(doc.querySelector('svg title')?.textContent).toContain('01 ene 2000');
});

it('separates return, drawdown and correlation and retains supplementary sections without legacy analysis duplication',()=>{
 const detail=researchPdfFixture(),points=[{date:'2026-10-01',value:0},{date:'2026-10-02',value:2}];
 detail.item.kind='comparison';detail.version.snapshot.series=[{id:'comparison:return:AAPL',label:'AAPL · Rentabilidad acumulada',unit:'percent',currency:null,points},{id:'comparison:drawdown:AAPL',label:'AAPL · Caída desde máximos',unit:'percent',currency:null,points:points.map(p=>({...p,value:-p.value}))},{id:'comparison:correlation:AAPL',label:'AAPL · Correlación',unit:'multiple',currency:null,points:points.map(p=>({...p,value:.8+p.value*.01}))}];
 detail.version.snapshot.metrics=[{id:'pair:AAPL:SPY:correlation',label:'AAPL / SPY · correlación',value:.82,unit:'multiple',currency:null,date:'2026-10-02',period:'1m'}];
 detail.version.snapshot.sections=[{title:'Análisis original',text:detail.version.payload.analysis},{title:'Cartera',text:'Posición de ejemplo conservada en la versión.'}];
 const doc=parse(renderResearchDossier(detail));expect(doc.querySelectorAll('svg')).toHaveLength(3);expect(doc.body.textContent).toContain('Caídas desde máximos');expect(doc.body.textContent).toContain('Coeficiente');expect(doc.body.textContent).not.toContain('0,82 ×');expect(doc.body.textContent).toContain('Posición de ejemplo conservada');expect(doc.body.textContent?.split('Síntesis de investigación')).toHaveLength(2);
});

it('writes to the synchronously opened popup and prints once without embedding a script',()=>{
 vi.useFakeTimers();let html='';const listeners:Record<string,()=>void>={};
 const target={closed:false,focus:vi.fn(),print:vi.fn(),addEventListener:(name:string,callback:()=>void)=>{listeners[name]=callback;},document:{readyState:'complete',open:vi.fn(),write:(value:string)=>{html=value;},close:vi.fn()}} as unknown as Window;
 downloadResearchDossier(researchPdfFixture(),target);listeners.load();vi.runAllTimers();
 expect(target.print).toHaveBeenCalledTimes(1);expect(target.focus).toHaveBeenCalledTimes(1);expect(parse(html).querySelector('script')).toBeNull();
});

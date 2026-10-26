import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ResearchLibrary,{researchNeedsReview} from '../components/research/ResearchLibrary';
import ResearchSnapshotView,{researchUnit} from '../components/research/ResearchSnapshotView';
import ResearchOriginalArchive from '../components/research/ResearchOriginalArchive';
import type {ResearchDetail,ResearchReview,ResearchSnapshot} from '../../../supabase/functions/analyze-ticker/research-types';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({accountApi:api}));
vi.mock('@/lib/researchPdf',()=>({downloadResearchDossier:vi.fn()}));
const date='2026-10-26T07:00:00Z';
const snapshot=(price=100):ResearchSnapshot=>({schema:1,kind:'ticker',subject:'AAPL',capturedAt:date,quality:'complete',assets:[{symbol:'AAPL',name:'Apple',currency:'USD',price,quoteAt:date,description:'Descripción conservada.'}],metrics:[{id:'revenue',label:'Ingresos capturados',value:price,unit:'USD',currency:'USD',period:'2026-Q3',date:'2026-09-30'}],series:[],news:[],sections:[],coverage:[],settings:{}});
function fixture():ResearchDetail{return {item:{id:'item-a',kind:'ticker',subject:'AAPL',title:'Tesis Apple',folder:'Tecnología',tags:['calidad'],thesis:'Crecimiento del servicio',risks:'Concentración',invalidation:'Pérdida de margen',notes:'Nota inicial',next_review:'2026-11-01',monitor_enabled:true,email_enabled:false,status:'active',revision:7,created_at:date,updated_at:date,latest_version:2,needs_review:false,last_checked_at:null,deleted_at:null},versions:[{id:'version-2',item_id:'item-a',version:2,created_at:date,legacy_report_id:null},{id:'version-1',item_id:'item-a',version:1,created_at:'2026-10-20T07:00:00Z',legacy_report_id:'old-report'}],version:{id:'version-2',item_id:'item-a',version:2,created_at:date,payload:{analysis:'## Tesis guardada\nTexto del informe original.\n\n| Métrica | Valor |\n| --- | --- |\n| Margen preservado | 25% |',quarterlyData:[]},snapshot:snapshot(),settings:{},summary:null,summary_model:null,legacy_report_id:null},review:null,mailReady:false};}
function review():ResearchReview{return {id:'review-a',item_id:'item-a',version_id:'version-2',created_at:date,current_snapshot:snapshot(110),diff:{fingerprint:'fingerprint',checkedAt:date,baselineAt:'2026-10-20T07:00:00Z',comparable:true,changes:[{id:'price',category:'price',label:'Precio del activo',importance:'medium',before:'100 USD',after:'110 USD',detail:'Variación desde la captura.'}],material:true,performance:[{symbol:'AAPL',returnPct:10,benchmark:'SPY',benchmarkReturnPct:2,currency:'USD',from:'2026-10-20',to:'2026-10-26'}],note:'Precios y períodos comparables.'},explanation:null,explanation_model:null,acknowledged_at:null};}
let detail:ResearchDetail;
beforeEach(()=>{api.mockReset();detail=fixture();api.mockImplementation(async(action:string,body:any)=>{
 if(action==='researchList')return {items:[detail.item],mailReady:false};
 if(action==='researchGet')return body.versionId==='version-1'?{...detail,version:{...detail.version,id:'version-1',version:1,snapshot:{...snapshot(80),quality:'legacy'}}}:detail;
 if(action==='researchCheck')return review();
 if(action==='researchExplain')return {text:'Explicación bajo solicitud.',model:'test',cached:false};
 if(action==='researchSummary')return {summary:'Resumen conservado bajo solicitud.',model:'test',cached:false};
 if(action==='researchMeta')return {...detail.item,...body,revision:8};
 if(action==='researchAcknowledge')return {...detail,review:{...review(),acknowledged_at:date}};
 if(action==='researchDelete'){detail={...detail,item:{...detail.item,deleted_at:date}};return detail.item;}
 if(action==='researchRestore'){detail={...detail,item:{...detail.item,deleted_at:null}};return detail.item;}
 throw new Error('Unexpected call '+action);
 });});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function open(){render(<ResearchLibrary accountId="owner-a"/>);fireEvent.click(await screen.findByRole('button',{name:'Abrir Tesis Apple'}));await screen.findByText('Texto del informe original.');}
it('opens a frozen version with its original analysis and metric table without market or AI requests',async()=>{
 await open();expect(screen.getByText('Margen preservado')).toBeVisible();expect(screen.getByText('25%')).toBeVisible();expect(screen.getByText('Descripción conservada.')).toBeVisible();
 expect(api.mock.calls.map(([action])=>action)).toEqual(['researchList','researchGet']);
 fireEvent.change(screen.getByRole('combobox',{name:'Versión guardada'}),{target:{value:'version-1'}});await screen.findByText(/Informe importado de la biblioteca anterior/);
 expect(api).toHaveBeenLastCalledWith('researchGet',{id:'item-a',versionId:'version-1'},expect.anything());expect(screen.getByRole('button',{name:'Comprobar cambios'})).toBeDisabled();
});
it('checks changes explicitly, keeps saved data separate and generates explanation only when requested',async()=>{
 await open();fireEvent.click(screen.getByRole('tab',{name:'Actual'}));expect(screen.getByText(/La versión original permanece intacta/)).toBeVisible();expect(api.mock.calls.map(([action])=>action)).not.toContain('researchCheck');
 fireEvent.click(screen.getByRole('button',{name:'Comprobar cambios'}));await screen.findByText('Precio del activo');expect(screen.getByText('100 USD')).toBeVisible();expect(screen.getByText('110 USD')).toBeVisible();expect(api.mock.calls.map(([action])=>action)).not.toContain('researchExplain');
 fireEvent.click(screen.getByRole('button',{name:'Explicar cambios'}));await screen.findByText('Explicación bajo solicitud.');expect(api).toHaveBeenCalledWith('researchExplain',{id:'item-a',reviewId:'review-a'});
 fireEvent.click(screen.getByRole('tab',{name:'Guardado'}));expect(screen.getByText('Texto del informe original.')).toBeVisible();expect(screen.queryByText('110 USD')).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Actual'}));expect(screen.getAllByText('110')[0]).toBeVisible();
});
it('locks duplicate check actions while a review is in progress',async()=>{
 let resolve:(value:any)=>void=()=>{};const implementation=api.getMockImplementation()!;api.mockImplementation((action:string,body:any)=>action==='researchCheck'?new Promise(done=>resolve=done):implementation(action,body));
 await open();const button=screen.getByRole('button',{name:'Comprobar cambios'});fireEvent.click(button);fireEvent.click(button);expect(api.mock.calls.filter(([action])=>action==='researchCheck')).toHaveLength(1);
 await act(async()=>resolve(review()));await screen.findByText('Precio del activo');
});
it('edits owner metadata using the current revision and keeps email unavailable without a configured sender',async()=>{
 await open();fireEvent.click(screen.getByRole('tab',{name:'Organización y tesis'}));expect(screen.getByLabelText('Avisos por correo de la cuenta')).toBeDisabled();fireEvent.change(screen.getByLabelText('Notas'),{target:{value:'Nueva decisión de seguimiento'}});fireEvent.click(screen.getByRole('button',{name:'Guardar organización y tesis'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('researchMeta',expect.objectContaining({id:'item-a',expectedRevision:7,notes:'Nueva decisión de seguimiento',email_enabled:false})));expect(screen.getByLabelText('Notas')).toHaveValue('Nueva decisión de seguimiento');
});
it('preserves unsaved notes when a revision conflict prevents an overwrite',async()=>{
 const implementation=api.getMockImplementation()!;api.mockImplementation((action:string,body:any)=>action==='researchMeta'?Promise.reject(new Error('La investigación cambió en otra sesión. Actualiza antes de guardar.')):implementation(action,body));
 await open();fireEvent.click(screen.getByRole('tab',{name:'Organización y tesis'}));fireEvent.change(screen.getByLabelText('Notas'),{target:{value:'No perder esta nota'}});fireEvent.click(screen.getByRole('button',{name:'Guardar organización y tesis'}));
 await screen.findAllByRole('alert');expect(screen.getByLabelText('Notas')).toHaveValue('No perder esta nota');
});
it('searches report content on the server and requests deleted entries only for the trash view',async()=>{
 render(<ResearchLibrary accountId="owner-a"/>);await screen.findByRole('button',{name:'Abrir Tesis Apple'});fireEvent.change(screen.getByRole('textbox',{name:'Buscar en la biblioteca'}),{target:{value:'margen'}});
 await waitFor(()=>expect(api).toHaveBeenCalledWith('researchList',{query:'margen',includeDeleted:false},expect.anything()));fireEvent.change(screen.getByRole('combobox',{name:'Estado de investigación'}),{target:{value:'deleted'}});await waitFor(()=>expect(api).toHaveBeenCalledWith('researchList',{query:'margen',includeDeleted:true},expect.anything()));
});
it('soft-deletes and restores an investigation without a destructive delete endpoint',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Mover investigación a la papelera'}));await screen.findByRole('button',{name:'Restaurar investigación'});expect(api).toHaveBeenCalledWith('researchDelete',{id:'item-a'});
 fireEvent.click(screen.getByRole('button',{name:'Restaurar investigación'}));await screen.findByRole('button',{name:'Mover investigación a la papelera'});expect(api).toHaveBeenCalledWith('researchRestore',{id:'item-a'});
});
it('creates a summary only explicitly and opens the PDF window synchronously',async()=>{
 await open();expect(api.mock.calls.map(([action])=>action)).not.toContain('researchSummary');fireEvent.click(screen.getByRole('button',{name:'Crear resumen'}));await screen.findByText('Resumen de esta versión');expect(api).toHaveBeenCalledWith('researchSummary',{id:'item-a',versionId:'version-2'});
 const popup={close:vi.fn()} as any,opened=vi.spyOn(window,'open').mockReturnValue(popup);fireEvent.click(screen.getByRole('button',{name:'Exportar dossier PDF'}));expect(opened).toHaveBeenCalledWith('','_blank');
 const pdf=await import('@/lib/researchPdf');await waitFor(()=>expect(pdf.downloadResearchDossier).toHaveBeenCalledWith(expect.objectContaining({version:expect.objectContaining({summary:'Resumen conservado bajo solicitud.'})}),popup));
});
it('does not expose an old account detail when its pending request completes after the account changed',async()=>{
 let resolve:(value:any)=>void=()=>{};api.mockImplementation((action:string)=>action==='researchList'?Promise.resolve({items:[detail.item],mailReady:false}):new Promise(done=>resolve=done));
 const view=render(<ResearchLibrary accountId="owner-a"/>);fireEvent.click(await screen.findByRole('button',{name:'Abrir Tesis Apple'}));view.rerender(<ResearchLibrary accountId="owner-b"/>);await act(async()=>resolve(detail));expect(screen.queryByText('Texto del informe original.')).toBeNull();expect(screen.queryByRole('tabpanel')).toBeNull();
});
it('renders an honest legacy coverage note and a partial snapshot without fabricating a baseline',()=>{
 render(<ResearchSnapshotView snapshot={{...snapshot(),quality:'legacy',assets:[],metrics:[],coverage:['Solo se conserva el texto original.']}} analysis="Texto antiguo"/>);expect(screen.getByText(/no dispone necesariamente de una captura histórica comparable/)).toBeVisible();expect(screen.getByText('Texto antiguo')).toBeVisible();expect(api).not.toHaveBeenCalled();
});
it('marks a scheduled manual review as pending even when automatic monitoring is disabled',()=>{
 const item=fixture().item;expect(researchNeedsReview({...item,needs_review:false,monitor_enabled:false,next_review:'2026-10-20'},Date.parse('2026-10-26'))).toBe(true);
 expect(researchNeedsReview({...item,next_review:'2026-11-20'},Date.parse('2026-10-26'))).toBe(false);expect(researchNeedsReview({...item,next_review:null},Date.parse('2026-10-26'))).toBe(false);
});
it('groups large metric sets by asset and displays more data only when expanded',async()=>{
 const metrics=['AAPL','MSFT'].flatMap(symbol=>Array.from({length:10},(_,index)=>({id:symbol+index,symbol,label:`Métrica ${symbol} ${index}`,value:index,unit:'percent',currency:null,period:null,date:null})));
 render(<ResearchSnapshotView snapshot={{...snapshot(),assets:[],metrics}}/>);expect(screen.getByText('Métrica AAPL 0')).toBeVisible();expect(screen.queryByText('Métrica AAPL 9')).toBeNull();expect(screen.queryByText('Métrica MSFT 0')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Ver todas las métricas · 10'}));expect(screen.getByText('Métrica AAPL 9')).toBeVisible();
 fireEvent.click(screen.getByText('MSFT'));expect(await screen.findByText('Métrica MSFT 0')).toBeVisible();
 for(const [unit,currency,expected]of [['currency','USD','USD'],['percent',null,'%'],['multiple',null,'×'],['millions','EUR','M · EUR'],['count',null,'unidades']] as const)expect(researchUnit(unit,currency)).toBe(expected);
 expect(researchUnit('multiple',null,'AAPL:peer:beta')).toBe('');expect(researchUnit('multiple',null,'pair:AAPL:SPY:correlation')).toBe('');
});
it('does not clear an open investigation when its selected list row is clicked again',async()=>{await open();fireEvent.click(screen.getByRole('button',{name:'Abrir Tesis Apple'}));expect(screen.getByText('Texto del informe original.')).toBeVisible();expect(api.mock.calls.filter(([action])=>action==='researchGet')).toHaveLength(1);});
it('does not duplicate original text when legacy import already included it in sections',()=>{render(<ResearchSnapshotView snapshot={{...snapshot(),quality:'legacy',sections:[{title:'Informe archivado',text:'Texto legado único.'}]}} analysis="Texto legado único."/>);expect(screen.getAllByText('Texto legado único.')).toHaveLength(1);});
it('retains original comparison data with its original date in an offline expandable archive',async()=>{
 render(<ResearchOriginalArchive createdAt="26 oct 2026" quarterlyData={[]} comparison={{fetchedAt:'2026-10-19T07:00Z',assets:[{symbol:'AAPL',specificMetric:42}]}}/>);
 fireEvent.click(screen.getByText('Comparación original'));expect(await screen.findByText('2026-10-19T07:00Z')).toBeVisible();fireEvent.click(screen.getByText('Activos'));expect(await screen.findByText('42')).toBeVisible();expect(api).not.toHaveBeenCalled();
});

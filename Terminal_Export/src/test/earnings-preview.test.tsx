import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import EarningsPreview from '../components/EarningsPreview';
import KeepPanel from '../components/KeepPanel';
import {chartDateLabel} from '../lib/financial-chart-data';
import type {EarningsPreview as Preview} from '../../../supabase/functions/analyze-ticker/earnings-preview';

const state=vi.hoisted(()=>({api:vi.fn(),account:''}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:state.api}));
vi.mock('../components/AuthGate',()=>({useProfile:()=>({id:state.account})}));
const future=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
function fixture(symbol='AAA'):Preview{
 const eps={mean:2,low:1.8,high:2.2,analysts:24,currency:'USD'},revenue={mean:1500000000,low:1400000000,high:1600000000,analysts:20,currency:'USD'};
 return {symbol,name:'Empresa de prueba',fetchedAt:new Date().toISOString(),asOf:'2025-10-24',status:'ready',next:{date:future(),session:'Después del cierre',period:'2026-09-30',periodLabel:'Q3 · Cierre 30 sept 2026',provisional:false,currency:'USD',eps,revenue,epsYoY:{current:2,previous:1.5,changePct:100/3,period:'2025-09-30',currency:'USD'},revenueYoY:{current:1500000000,previous:1250000000,changePct:20,period:'2025-09-30',currency:'USD'},revisions:{days30Pct:5,days90Pct:8,up30:4,down30:0}},history:Array.from({length:8},(_,index)=>({reportDate:`2024-${String(index+1).padStart(2,'0')}-20`,period:`2024-${String(index+1).padStart(2,'0')}-01`,epsActual:1.5+index/10,epsEstimate:1.2+index/10,surprisePct:25,currency:'USD',revenueActual:1000000000+index*10000000})),summary:{headline:'Lo que espera el mercado',points:['Crecimiento de beneficio y ventas frente al mismo trimestre anterior.','El consenso ha mejorado durante los últimos 30 días.']},notes:['EPS del consenso; las cifras de ingresos se muestran en su moneda declarada.']};
}
beforeEach(()=>{state.account=crypto.randomUUID();state.api.mockReset();state.api.mockImplementation((_url,init)=>Promise.resolve({ok:true,json:async()=>fixture(JSON.parse(init.body).subject)}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});

it('presents the confirmed date, expected EPS and revenue, ranges, growth and past releases without using the clicked date as fact',async()=>{
 render(<EarningsPreview symbol="aaa" eventDate="2035-05-01"/>);
 await screen.findByRole('heading',{name:'Lo que espera el mercado'});
 expect(JSON.parse(state.api.mock.calls[0][1].body)).toEqual({panel:'earningsPreview',subject:'AAA',eventDate:'2035-05-01'});
 expect(screen.getByText(chartDateLabel(future(),true))).toBeVisible();
 expect(screen.queryByText(chartDateLabel('2035-05-01',true))).toBeNull();
 expect(screen.getByText('Después del cierre')).toBeVisible();expect(screen.getByText('Q3 · Cierre 30 sept 2026')).toBeVisible();
 expect(screen.getByText('2,00 USD')).toBeVisible();expect(screen.getByText('1,5 B USD')).toBeVisible();
 expect(screen.getByText('24 analistas')).toBeVisible();expect(screen.getByText('+33,33%')).toBeVisible();expect(screen.getByText('+20,00%')).toBeVisible();
 expect(screen.getByRole('heading',{name:'Resultados anteriores'})).toBeVisible();
 const table=screen.getByRole('table',{name:/Historial de publicaciones/});expect(within(table).getAllByRole('row')).toHaveLength(5);
 expect(within(table).getByRole('columnheader',{name:'Consenso EPS'})).toBeVisible();expect(within(table).getByRole('columnheader',{name:'Ingresos publicados'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Ver las 8 publicaciones'}));expect(within(table).getAllByRole('row')).toHaveLength(9);
 expect(screen.getByLabelText('EPS histórico publicado y estimado')).toBeVisible();
});

it('retains real zero estimates and zero revisions instead of substituting missing-data markers',async()=>{
 const value=fixture();value.next.eps={mean:0,low:0,high:0,analysts:0,currency:'USD'};value.next.epsYoY=null;value.next.revisions={days30Pct:0,days90Pct:0,up30:0,down30:0};
 state.api.mockResolvedValue({ok:true,json:async()=>value});render(<EarningsPreview symbol="AAA"/>);
 await screen.findByText('EPS esperado · por acción');expect(screen.getByText('0,00 USD')).toBeVisible();expect(screen.getByText('0 analistas')).toBeVisible();expect(screen.getByText('Revisiones del EPS · 30 días')).toBeVisible();
 expect(screen.getAllByText('0,00%').length).toBeGreaterThanOrEqual(1);
});

it('does not fabricate a future date or an EPS consensus when only past published results are available',async()=>{
 const value=fixture(),empty={mean:null,low:null,high:null,analysts:null,currency:null};value.status='partial';value.next={...value.next,date:null,period:null,periodLabel:null,eps:empty,revenue:empty,epsYoY:null,revenueYoY:null,revisions:{days30Pct:null,days90Pct:null,up30:null,down30:null}};value.summary={headline:'Publicaciones anteriores disponibles',points:[]};
 state.api.mockResolvedValue({ok:true,json:async()=>value});render(<EarningsPreview symbol="AAA" eventDate="2035-05-01"/>);
 await screen.findByRole('heading',{name:'Publicaciones anteriores disponibles'});expect(screen.getByText('Fecha pendiente de confirmación')).toBeVisible();
 expect(screen.queryByText('EPS esperado · por acción')).toBeNull();expect(screen.queryByText('Ingresos esperados')).toBeNull();expect(screen.queryByText('Después del cierre')).toBeNull();expect(screen.getByRole('heading',{name:'Resultados anteriores'})).toBeVisible();
});

it('separates historical currencies and does not display future EPS as published',async()=>{
 const value=fixture();value.history=[value.history[0],{...value.history[1],currency:'EUR',epsActual:77},{...value.history[2],reportDate:'2035-01-01',epsActual:99}];
 state.api.mockResolvedValue({ok:true,json:async()=>value});render(<EarningsPreview symbol="AAA"/>);
 const table=await screen.findByRole('table',{name:/Historial de publicaciones/});expect(within(table).queryByText('77,00')).toBeNull();expect(within(table).queryByText('99,00')).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'Moneda de los resultados anteriores'}),{target:{value:'EUR'}});expect(within(table).getByText('77,00')).toBeVisible();expect(within(table).queryByText('1,50')).toBeNull();
});

it('suppresses an expired headline date and its market session',async()=>{
 const value=fixture();value.next.date='2020-01-01';state.api.mockResolvedValue({ok:true,json:async()=>value});render(<EarningsPreview symbol="AAA"/>);
 await screen.findByText('Fecha pendiente de confirmación');expect(screen.queryByText('Después del cierre')).toBeNull();expect(screen.queryByText(chartDateLabel('2020-01-01',true))).toBeNull();
});

it('uses the Madrid calendar day for events and historical publications across midnight UTC',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-26T23:30:00Z'));
 const value=fixture();value.next.date='2026-10-27';value.history=[{...value.history[0],reportDate:'2026-10-27',period:'2026-09-30',epsActual:7.77}];
 state.api.mockResolvedValue({ok:true,json:async()=>value});render(<EarningsPreview symbol="AAA"/>);
 const table=await screen.findByRole('table',{name:/Historial de publicaciones/});expect(within(table).getByText('7,77')).toBeVisible();
 expect(screen.queryByText('Fecha pendiente de confirmación')).toBeNull();expect(screen.getByText('Después del cierre')).toBeVisible();
});

it('shows a concise availability message without rendering empty estimate cards or charts',async()=>{
 const value=fixture(),empty={mean:null,low:null,high:null,analysts:null,currency:null};value.status='unavailable';value.history=[];value.next={...value.next,date:null,eps:empty,revenue:empty,epsYoY:null,revenueYoY:null,revisions:{days30Pct:null,days90Pct:null,up30:null,down30:null}};value.summary={headline:'',points:[]};
 state.api.mockResolvedValue({ok:true,json:async()=>value});render(<EarningsPreview symbol="AAA"/>);
 await screen.findByText('Todavía no hay estimaciones publicadas para el próximo resultado de AAA.');expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByLabelText('EPS histórico publicado y estimado')).toBeNull();expect(screen.queryByText('EPS esperado · por acción')).toBeNull();
});

it('caches each account, ticker and event date and refreshes on a parent revision',async()=>{
 const first=render(<EarningsPreview symbol="AAA" eventDate="2035-05-01"/>);await screen.findByRole('heading',{name:'Lo que espera el mercado'});first.unmount();
 const second=render(<EarningsPreview symbol="AAA" eventDate="2035-05-01"/>);expect(state.api).toHaveBeenCalledTimes(1);
 second.rerender(<EarningsPreview symbol="AAA" eventDate="2035-05-01" revision={1}/>);await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(2));
 second.rerender(<EarningsPreview symbol="AAA" eventDate="2035-05-02" revision={1}/>);await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(3));
 state.account=crypto.randomUUID();second.rerender(<EarningsPreview symbol="AAA" eventDate="2035-05-02" revision={1}/>);await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(4));
});

it('expires cached expectations after ten minutes',async()=>{
 const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);const first=render(<EarningsPreview symbol="AAA"/>);await screen.findByRole('heading',{name:'Lo que espera el mercado'});first.unmount();
 clock.mockReturnValue(now+600001);render(<EarningsPreview symbol="AAA"/>);await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(2));
});

it('aborts and ignores a late response for an asset that is no longer selected',async()=>{
 let finish:(value:unknown)=>void=()=>{};
 state.api.mockImplementation((_url,init)=>JSON.parse(init.body).subject==='AAA'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,json:async()=>fixture('BBB')}));
 const view=render(<EarningsPreview symbol="AAA"/>),signal=state.api.mock.calls[0][1].signal as AbortSignal;
 view.rerender(<EarningsPreview symbol="BBB"/>);await screen.findByRole('region',{name:'Previa de resultados de BBB'});await screen.findByRole('heading',{name:'Lo que espera el mercado'});expect(signal.aborted).toBe(true);
 finish({ok:true,json:async()=>fixture('AAA')});await waitFor(()=>expect(screen.queryByRole('region',{name:'Previa de resultados de AAA'})).toBeNull());
});

it('retries failures and retains verified expectations when a later refresh fails',async()=>{
 state.api.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>fixture()});render(<EarningsPreview symbol="AAA"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Reintentar expectativas'}));await screen.findByRole('heading',{name:'Lo que espera el mercado'});
 state.api.mockResolvedValue({ok:false});fireEvent.click(screen.getByRole('button',{name:'Actualizar previa de resultados'}));await screen.findByText('No se ha podido actualizar. Se conserva la última consulta.');expect(screen.getByText('2,00 USD')).toBeVisible();
});

it('cancels the request when the containing terminal view becomes inactive',()=>{
 state.api.mockImplementation(()=>new Promise(()=>{}));const view=render(<KeepPanel active><EarningsPreview symbol="AAA"/></KeepPanel>),signal=state.api.mock.calls[0][1].signal as AbortSignal;
 view.rerender(<KeepPanel active={false}><EarningsPreview symbol="AAA"/></KeepPanel>);expect(signal.aborted).toBe(true);
});

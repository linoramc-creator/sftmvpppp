import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import EarningsReview from '../components/EarningsReview';
import KeepPanel from '../components/KeepPanel';
import type {EarningsReview as Review,EarningsReviewQuarter} from '../../../supabase/functions/analyze-ticker/earnings-review';

const state=vi.hoisted(()=>({api:vi.fn(),account:''}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:state.api}));
vi.mock('../components/AuthGate',()=>({useProfile:()=>({id:state.account})}));
vi.mock('recharts',async()=>{const actual=await vi.importActual<typeof import('recharts')>('recharts'),react=await vi.importActual<typeof import('react')>('react');return {...actual,ResponsiveContainer:({children}:{children:React.ReactElement})=>react.cloneElement(children,{width:700,height:220})};});
function quarter(period:string,patch:Partial<EarningsReviewQuarter>={}):EarningsReviewQuarter{return {id:period,period,reportDate:'2026-10-29',filingDate:'2026-11-02',currency:'USD',eps:{actual:1.5,estimate:1.2,surprisePct:25,currency:'USD',basis:'analyst',sourceIds:['filing']},revenue:{actual:120000000,estimate:100000000,surprisePct:20,currency:'USD',sourceIds:['filing']},grossProfit:60000000,netIncome:18000000,operatingIncome:30000000,grossMargin:50,operatingMargin:25,netMargin:15,operatingCF:35000000,capex:10000000,freeCashFlow:25000000,fcfMargin:20.83,cash:40000000,debt:45000000,revenueYoY:20,epsYoY:50,operatingMarginYoYPp:5,sourceIds:['filing'],fieldSources:{revenue:['filing'],eps:['filing']},...patch};}
function fixture(symbol='AAA'):Review{const quarters=[quarter('2025-09-30'),quarter('2026-03-31'),quarter('2026-06-30'),quarter('2026-09-30')];return {symbol,name:'Compañía de prueba',fetchedAt:new Date().toISOString(),status:'ready',stale:false,latest:quarters.at(-1)!,quarters,sources:[{id:'filing',name:'Emisor · publicación oficial',url:'https://issuer.example.com/results',asOf:'2026-10-29'}],notes:['Flujos del trimestre; las ausencias no son cero.'],guidance:[],summary:{headline:'Resultados y puntos de seguimiento',points:[{id:'revenue',text:'Ingresos de 120 millones, 20% más interanual.',sourceIds:['filing']},{id:'eps',text:'BPA publicado superior al consenso previo.',sourceIds:['filing']}],mode:'rules',model:null}};}
beforeEach(()=>{state.account=crypto.randomUUID();state.api.mockReset();state.api.mockImplementation((_url,init)=>Promise.resolve({ok:true,json:async()=>fixture(JSON.parse(init.body).subject)}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('loads the authenticated earningsReview panel and distinguishes published, consensus, announcement and filing dates',async()=>{
 render(<EarningsReview symbol="aaa"/>);await screen.findByRole('heading',{name:'Resultados y puntos de seguimiento'});
 expect(JSON.parse(state.api.mock.calls[0][1].body)).toEqual({panel:'earningsReview',subject:'AAA'});
 expect(screen.getAllByText(/Anuncio 29 oct 2026/)[0]).toBeVisible();expect(screen.getByText(/Cierre fiscal 30 sept 2026.*Registro 02 nov 2026/)).toBeVisible();
 expect(screen.getAllByText('Ingresos publicados')[0]).toBeVisible();expect(screen.getByText('BPA publicado · por acción')).toBeVisible();expect(screen.getAllByText('Margen operativo')[0]).toBeVisible();expect(screen.getByText('Flujo de caja libre · trimestre')).toBeVisible();
 expect(screen.getByRole('tab',{name:'Ingresos y rentabilidad'})).toHaveAttribute('aria-selected','true');expect(screen.getByLabelText('Márgenes trimestrales')).toBeVisible();
 fireEvent.click(screen.getByRole('tab',{name:'BPA y consenso'}));expect(screen.getByRole('tabpanel',{name:'BPA y consenso'})).toBeVisible();
 fireEvent.click(screen.getByRole('tab',{name:'Generación de caja'}));expect(screen.getByRole('tabpanel',{name:'Generación de caja'})).toBeVisible();
 fireEvent.click(screen.getByText('Datos publicados y consenso · 4 períodos'));const table=screen.getByRole('table',{name:'Resultados publicados de AAA'});expect(within(table).getAllByRole('row')).toHaveLength(5);
 expect(screen.getAllByRole('link',{name:'Fuente: Emisor · publicación oficial'})[0]).toHaveAttribute('href','https://issuer.example.com/results');expect(state.api).toHaveBeenCalledTimes(1);
});
it('preserves actual and estimated zeros and makes missing operating/cash figures explicit',async()=>{
 const value=fixture();value.latest=quarter('2026-09-30',{operatingMargin:null,freeCashFlow:null,operatingCF:null,capex:null});value.latest.eps={...value.latest.eps,actual:0,estimate:0,surprisePct:null};value.quarters=[value.latest];state.api.mockResolvedValue({ok:true,json:async()=>value});
 render(<EarningsReview symbol="AAA"/>);await screen.findByText('BPA publicado · por acción');expect(screen.getAllByText('0,00 USD').length).toBeGreaterThan(0);expect(screen.getByText(/Sorpresa no calculable/)).toBeVisible();
 expect(screen.queryByRole('tab',{name:'Generación de caja'})).toBeNull();const metric=screen.getByText('Flujo de caja libre · trimestre').parentElement!;expect(within(metric).getByText('—')).toBeVisible();
});
it('separates different currencies and EPS bases instead of drawing an artificial continuous series',async()=>{
 const value=fixture(),eur=quarter('2026-06-30',{id:'eur',currency:'EUR'});eur.eps={...eur.eps,currency:'EUR',basis:'gaap'};eur.revenue={...eur.revenue,currency:'EUR'};value.quarters.push(eur);
 const adjusted=quarter('2026-03-31',{id:'adjusted'});adjusted.eps={...adjusted.eps,basis:'adjusted'};value.quarters.push(adjusted);state.api.mockResolvedValue({ok:true,json:async()=>value});
 render(<EarningsReview symbol="AAA"/>);await screen.findByText('BPA publicado · por acción');fireEvent.click(screen.getByRole('tab',{name:'BPA y consenso'}));
 expect(screen.getByRole('combobox',{name:'Base contable del BPA'})).toBeVisible();fireEvent.change(screen.getByRole('combobox',{name:'Moneda del historial de resultados'}),{target:{value:'EUR'}});expect(screen.getByText(/1 períodos fiscales publicados.*GAAP.*EUR por acción/)).toBeVisible();
 expect(state.api).toHaveBeenCalledTimes(1);
});
it('shows honest unavailable and stale coverage without empty charts, fabricated data or unsafe source links',async()=>{
 const value=fixture();value.latest=null;value.quarters=[];value.sources=[];value.summary.points=[];value.status='unavailable';state.api.mockResolvedValue({ok:true,json:async()=>value});
 const view=render(<EarningsReview symbol="AAA"/>);await screen.findByText(/No hay resultados publicados verificables/);expect(screen.queryByLabelText('Gráficos de resultados publicados')).toBeNull();
 const stale=fixture('BBB');stale.stale=true;stale.status='partial';stale.sources=[{id:'filing',name:'No permitido',url:'https://example.com?api_key=private',asOf:null}];state.api.mockResolvedValue({ok:true,json:async()=>stale});view.rerender(<EarningsReview symbol="BBB"/>);await screen.findByText(/Cobertura antigua/);expect(screen.queryByRole('link',{name:'Fuente: No permitido'})).toBeNull();
});
it('reuses per-account cached results, aborts old account requests and never displays a previous account response',async()=>{
 let resolve!:(value:unknown)=>void;state.api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const view=render(<EarningsReview symbol="AAA"/>);await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(1));const signal=state.api.mock.calls[0][1].signal;
 state.account=crypto.randomUUID();view.rerender(<EarningsReview symbol="AAA"/>);await screen.findByRole('heading',{name:'Resultados y puntos de seguimiento'});expect(signal.aborted).toBe(true);const old=fixture();old.summary.headline='Respuesta anterior prohibida';resolve({ok:true,json:async()=>old});await Promise.resolve();expect(screen.queryByText('Respuesta anterior prohibida')).toBeNull();
 view.unmount();render(<EarningsReview symbol="AAA"/>);await screen.findByRole('heading',{name:'Resultados y puntos de seguimiento'});expect(state.api).toHaveBeenCalledTimes(2);
});
it('retains the last verified data on refresh failure and reports the failure clearly',async()=>{
 render(<EarningsReview symbol="AAA"/>);await screen.findByRole('heading',{name:'Resultados y puntos de seguimiento'});state.api.mockRejectedValueOnce(Error('offline'));fireEvent.click(screen.getByRole('button',{name:'Actualizar últimos resultados'}));await screen.findByText('No se ha podido actualizar. Se conserva la última consulta.');expect(screen.getAllByText('Ingresos publicados')[0]).toBeVisible();
});
it('rejects mismatched payloads and waits to load an inactive panel until it becomes active',async()=>{
 const view=render(<KeepPanel active={true}><EarningsReview symbol="AAA"/></KeepPanel>);await screen.findByRole('heading',{name:'Resultados y puntos de seguimiento'});view.rerender(<KeepPanel active={false}><EarningsReview symbol="BBB"/></KeepPanel>);expect(state.api).toHaveBeenCalledTimes(1);
 state.api.mockResolvedValue({ok:true,json:async()=>fixture('WRONG')});view.rerender(<KeepPanel active={true}><EarningsReview symbol="BBB"/></KeepPanel>);await screen.findByText('No se han podido consultar los resultados. Vuelve a intentarlo.');expect(screen.queryByText('BPA publicado · por acción')).toBeNull();
});

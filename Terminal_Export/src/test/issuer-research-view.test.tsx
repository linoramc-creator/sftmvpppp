import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import IssuerResearchView from '../components/IssuerResearchView';
import KeepPanel from '../components/KeepPanel';
import {alignedResearchTarget,publishedResearchEarnings} from '../lib/issuer-research-view';
import type {IssuerResearch} from '../../../supabase/functions/analyze-ticker/issuer-research';
const api=vi.hoisted(()=>vi.fn());
const account=vi.hoisted(()=>({id:'issuer-test'}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
vi.mock('../components/AuthGate',()=>({useProfile:()=>({id:account.id})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
beforeEach(()=>{account.id=crypto.randomUUID();api.mockReset();api.mockImplementation((_url,init)=>Promise.resolve({ok:true,json:async()=>fixture(JSON.parse(init.body).subject)}));});
function fixture(symbol='AAA'):IssuerResearch{
 return {symbol,found:true,fetchedAt:new Date(Date.now()).toISOString(),asOf:'2026-10-21',name:'Empresa de prueba',kind:'stock',currency:'USD',reportingCurrency:'USD',analysts:{ratings:[{label:'Compra fuerte',count:10},{label:'Comprar',count:20},{label:'Mantener',count:12},{label:'Vender',count:2},{label:'Venta fuerte',count:0}],total:44,rating:4.1,target:130,targetCurrency:'USD',referencePrice:100,referenceAt:'2026-10-21T15:00:00Z',targetDistancePct:30},estimates:[{period:'2027-03-31',type:'quarterly',label:'Q1 2027',currency:'USD',eps:{mean:2.15,low:2,high:2.3,analysts:30},revenue:{mean:1000000,low:900000,high:1100000,analysts:28},epsTrend:{current:2.15,days30:2.1,days90:2},revisions:{up30:3,down30:0}},{period:'2027-12-31',type:'annual',label:'2027',currency:'USD',eps:{mean:9,low:8,high:10,analysts:28},revenue:{mean:4500000,low:4000000,high:5000000,analysts:25},epsTrend:{current:9,days30:8.8,days90:8.5},revisions:{up30:2,down30:1}}],earnings:[{date:'2026-10-18',period:'2026-09-30',actual:1.5,estimate:1.2,surprisePct:25,currency:'USD'}],quarters:['2026-03-31','2026-06-30'].map((period,index)=>({period,currency:'USD',revenue:1000,netIncome:100,operatingCF:120+index*10,fcf:100,ebitda:150,cash:200,totalDebt:100,equity:100,fcfMargin:10,cashConversion:1.2+index*.1})),fund:null};
}
it('shows actual analyst coverage, estimates and published earnings as distinct dated information',async()=>{
 render(<IssuerResearchView ticker="aaa"/>);
 await screen.findByRole('heading',{name:'Consenso · 44 analistas'});
 expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({panel:'issuerResearch',subject:'AAA'});
 expect(screen.getByRole('meter',{name:'Comprar'})).toHaveAttribute('aria-valuenow','20');
 expect(screen.getByText('130,00 USD')).toBeVisible();expect(screen.getByText('+30,00%')).toBeVisible();
 expect(screen.getByRole('heading',{name:'EPS publicados frente al consenso'})).toBeVisible();
 expect(screen.getByText('1,50 USD')).toBeVisible();
 expect(screen.getByRole('heading',{name:'Calidad de caja'})).toBeVisible();
 expect(screen.getByRole('table',{name:/Estimaciones de EPS/})).toHaveTextContent('2,15 USD');
 fireEvent.click(screen.getByRole('button',{name:'Anual'}));
 expect(screen.getByRole('table',{name:/Estimaciones de EPS/})).toHaveTextContent('9,00 USD');
 fireEvent.click(screen.getByRole('button',{name:'Ingresos'}));
 expect(screen.getByRole('table',{name:/Estimaciones de ingresos/})).toHaveTextContent('4,5 M USD');
 expect(screen.queryByText(/Flujos institucionales/i)).toBeNull();
});
it('omits price targets and distances in incompatible currencies, and does not treat future reports as published earnings',async()=>{
 const value=fixture();value.analysts.targetCurrency='EUR';value.earnings.push({...value.earnings[0],date:'2035-01-01',period:'2034-12-31',actual:99});
 api.mockResolvedValue({ok:true,json:async()=>value});
 render(<IssuerResearchView ticker="AAA"/>);await screen.findByRole('heading',{name:'Consenso · 44 analistas'});
 expect(screen.queryByRole('heading',{name:'Precio objetivo · consenso'})).toBeNull();
 expect(screen.queryByText('+30,00%')).toBeNull();
 expect(alignedResearchTarget(value)).toBeNull();
 expect(publishedResearchEarnings(value.earnings,Date.parse('2026-10-22'))).toHaveLength(1);
});
it('preserves ETF total-return, annualized-return and already-percent volatility units',async()=>{
 const value=fixture('FUND');value.kind='etf';value.fund={benchmark:'MSCI World',holdingsCount:1350,domicile:'Irlanda',totalReturn1Year:.12,totalReturn3YearAnnualized:.08,totalReturn5YearAnnualized:.06,volatility1YearPct:15.2,volatility3YearPct:17.4,sharpe3Year:.76};
 api.mockResolvedValue({ok:true,json:async()=>value});
 render(<IssuerResearchView ticker="FUND" mode="etf"/>);await screen.findByRole('heading',{name:'Perfil y métricas del fondo'});
 expect(screen.getByText('MSCI World')).toBeVisible();expect(screen.getByText('12,00%')).toBeVisible();expect(screen.getByText('8,00%')).toBeVisible();expect(screen.getByText('15,20%')).toBeVisible();expect(screen.getByText('0,76')).toBeVisible();
 expect(screen.getAllByText('Anualizada')).toHaveLength(2);expect(screen.queryByText('EPS por acción')).toBeNull();
});
it('caches a ticker for ten minutes and isolates the cache by account',async()=>{
 const first=render(<IssuerResearchView ticker="AAA"/>);await screen.findByRole('heading',{name:'Consenso · 44 analistas'});first.unmount();
 const second=render(<IssuerResearchView ticker="AAA"/>);expect(screen.getByRole('heading',{name:'Consenso · 44 analistas'})).toBeVisible();expect(api).toHaveBeenCalledTimes(1);
 account.id='another-'+crypto.randomUUID();second.rerender(<IssuerResearchView ticker="AAA"/>);
 await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));
});
it('expires cached data after the ten-minute window',async()=>{
 const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
 const first=render(<IssuerResearchView ticker="AAA"/>);await screen.findByRole('heading',{name:'Consenso · 44 analistas'});first.unmount();
 clock.mockReturnValue(now+600001);
 render(<IssuerResearchView ticker="AAA"/>);await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));
});
it('aborts old requests and ignores late responses when the requested ticker changes',async()=>{
 let finish:(value:unknown)=>void=()=>{};const next=fixture('BBB');next.analysts.total=8;
 api.mockImplementation((_url,init)=>JSON.parse(init.body).subject==='AAA'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,json:async()=>next}));
 const {rerender}=render(<IssuerResearchView ticker="AAA"/>);const signal=api.mock.calls[0][1].signal as AbortSignal;
 rerender(<IssuerResearchView ticker="BBB"/>);await screen.findByRole('heading',{name:'Consenso · 8 analistas'});expect(signal.aborted).toBe(true);
 finish({ok:true,json:async()=>fixture('AAA')});
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'Consenso · 44 analistas'})).toBeNull());
});
it('hides unavailable coverage without creating empty report panels',async()=>{
 const value=fixture();value.found=false;api.mockResolvedValue({ok:true,json:async()=>value});
 const {container}=render(<IssuerResearchView ticker="AAA"/>);
 await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());
 expect(container).toBeEmptyDOMElement();
});
it('retries a failed complementary request and keeps verified data visible if a refresh fails',async()=>{
 api.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>fixture()});
 render(<IssuerResearchView ticker="AAA"/>);fireEvent.click(await screen.findByRole('button',{name:'Reintentar datos del emisor'}));await screen.findByRole('heading',{name:'Consenso · 44 analistas'});
 api.mockResolvedValue({ok:false});fireEvent.click(screen.getByRole('button',{name:'Actualizar datos del emisor'}));
 await screen.findByText('No se han podido actualizar los datos. Se conserva la última consulta.');expect(screen.getByRole('heading',{name:'Consenso · 44 analistas'})).toBeVisible();
});
it('cancels the load when its terminal section becomes inactive',()=>{
 api.mockImplementation(()=>new Promise(()=>{}));const {rerender}=render(<KeepPanel active><IssuerResearchView ticker="AAA"/></KeepPanel>);
 const signal=api.mock.calls[0][1].signal as AbortSignal;
 rerender(<KeepPanel active={false}><IssuerResearchView ticker="AAA"/></KeepPanel>);expect(signal.aborted).toBe(true);
});

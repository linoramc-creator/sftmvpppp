import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import RelativeAnalysis,{validRelativePair} from '../pages/RelativeAnalysis';
import type {RelativeAsset,RelativeComparison} from '../../../supabase/functions/analyze-ticker/relative-comparison';

const fetchMock=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:fetchMock}));
vi.mock('recharts',()=>{const Box=({children}:{children?:any})=><div>{children}</div>;return {CartesianGrid:Box,Legend:Box,Line:Box,LineChart:Box,ReferenceLine:Box,ResponsiveContainer:Box,Tooltip:Box,XAxis:Box,YAxis:Box};});
const asset=(symbol:string):RelativeAsset=>({symbol,name:`${symbol} Corporation`,kind:'stock',currency:'USD',asOf:'2026-10-16',price:100,return20:5,return63:8,volatility20:20,drawdown:-10,avgTurnover20:100000000,relativeVolume:1.1,upVolumeShare20:52,aboveSma50:true,aboveSma200:true,valuation:{pe:20,pb:2},institutions:{status:'available',period:'2026 T2',previousPeriod:'2026 T1',shares:100000,sharesChangePct:3,investors:20,ownershipPct:50,reason:'Posiciones trimestrales'},options:{status:'unavailable',expiry:null,asOf:null,contracts:0,callVolume:null,putVolume:null,putCallVolume:null,putCallOi:null,atmIv:null,reason:'Sin opciones verificadas'},fundFlows:{status:'not-applicable',value:null,period:null,reason:'No aplica a acciones'}});
const response:RelativeComparison={fetchedAt:'2026-10-17T12:00:00Z',symbols:['AAPL','MSFT'],assets:[asset('AAPL'),asset('MSFT')],window:{start:'2026-01-01',end:'2026-10-16',observations:200,currencyAligned:true},chart:[{date:'2026-01-01',a:0,b:0,ratio:100,drawdownA:0,drawdownB:0},{date:'2026-10-16',a:10,b:8,ratio:101.85,drawdownA:-2,drawdownB:-3}],metrics:{correlation:.8,betaAtoB:1,trackingError:10,relative20:2,relative63:3,spreadZ:1},findings:[{id:'strength',kind:'advantage',symbol:'AAPL',title:'Fortaleza relativa',text:'AAPL supera a MSFT en dos puntos porcentuales.'}],factors:[{symbol:'SPY',label:'Mercado estadounidense',asOf:'2026-10-16',correlationA:.8,correlationB:.9,change20:4}],news:[{title:'Resultados empresariales mejoran',url:'https://www.cnbc.com/story',source:'CNBC',date:'2026-10-16',keyPoints:['Los ingresos avanzan durante el trimestre.']}],ai:{status:'not-requested',paragraphs:[]}};

beforeEach(()=>fetchMock.mockReset());
it('accepts two full distinct tickers and rejects malformed or duplicate inputs',()=>{
 expect(validRelativePair('BRK-B','SPY')).toBe(true);expect(validRelativePair('AAPL','AAPL')).toBe(false);
 expect(validRelativePair('AAPL,MSFT','SPY')).toBe(false);expect(validRelativePair('AAPL<script>','SPY')).toBe(false);expect(validRelativePair('A'.repeat(16),'SPY')).toBe(false);
});
it('starts without suggested tickers and only enables comparison for a valid pair',()=>{
 render(<RelativeAnalysis/>);expect(screen.getByRole('button',{name:'Comparar'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Primer activo'),{target:{value:'aapl'}});fireEvent.change(screen.getByLabelText('Segundo activo'),{target:{value:'msft'}});
 expect(screen.getByRole('button',{name:'Comparar'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Intercambiar activos'}));
 expect(screen.getByLabelText('Primer activo')).toHaveValue('MSFT');expect(screen.getByLabelText('Segundo activo')).toHaveValue('AAPL');expect(fetchMock).not.toHaveBeenCalled();
});
it('loads quantitative data without AI, keeps news unlinked and requests AI only explicitly',async()=>{
 fetchMock.mockResolvedValueOnce(Response.json(response)).mockResolvedValueOnce(Response.json({...response,ai:{status:'ready',paragraphs:['Las diferencias de riesgo requieren atención.']}}));
 const {container}=render(<RelativeAnalysis/>);
 fireEvent.change(screen.getByLabelText('Primer activo'),{target:{value:'AAPL'}});fireEvent.change(screen.getByLabelText('Segundo activo'),{target:{value:'MSFT'}});fireEvent.click(screen.getByRole('button',{name:'Comparar'}));
 await screen.findByText('Fortaleza relativa');expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({panel:'relativeComparison',symbols:['AAPL','MSFT'],includeAi:false});
 expect(screen.getByText('2 pp')).toBeVisible();expect(container.textContent).not.toContain('Invalid Date');expect(container.querySelector('a')).toBeNull();
 expect(screen.getByText('Resultados empresariales mejoran')).toBeVisible();expect(screen.getAllByText('Sin opciones verificadas')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Fuerza relativa'}));expect(screen.getByRole('button',{name:'Fuerza relativa'})).toHaveAttribute('aria-pressed','true');
 fireEvent.change(screen.getByLabelText('Primer activo'),{target:{value:'NVDA'}});
 fireEvent.click(screen.getByRole('button',{name:'Interpretar contexto con IA'}));await screen.findByText('Las diferencias de riesgo requieren atención.');
 expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({panel:'relativeComparison',symbols:['AAPL','MSFT'],includeAi:true});
 expect(screen.getByRole('button',{name:'Interpretación disponible'})).toBeDisabled();
});
it('preserves the last comparison if a subsequent provider request fails',async()=>{
 fetchMock.mockResolvedValueOnce(Response.json(response)).mockResolvedValueOnce(Response.json({error:'No se pudo consultar el activo.'},{status:503}));
 render(<RelativeAnalysis/>);fireEvent.change(screen.getByLabelText('Primer activo'),{target:{value:'AAPL'}});fireEvent.change(screen.getByLabelText('Segundo activo'),{target:{value:'MSFT'}});fireEvent.click(screen.getByRole('button',{name:'Comparar'}));
 await screen.findByText('Fortaleza relativa');fireEvent.click(screen.getByRole('button',{name:'Comparar'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('No se pudo consultar el activo.'));expect(screen.getByText('Fortaleza relativa')).toBeVisible();
});
it('shows dated option volume coverage without a partial PCR and hides inapplicable blocks',async()=>{
 const first=asset('AAPL'),second=asset('MSFT');
 first.options={...first.options,status:'available',contracts:20,asOf:'2026-10-16',expiry:'2026-11-20',putCallVolume:2,volumeSample:{callVolume:1200,putVolume:2400,callContracts:4,putContracts:6,totalCalls:10,totalPuts:10}};
 second.kind='etf';second.institutions={...second.institutions,status:'not-applicable',reason:'Instituciones no aplican a este fondo.'};second.fundFlows={...second.fundFlows,status:'unavailable',reason:'No hay flujos netos verificados.'};
 fetchMock.mockResolvedValueOnce(Response.json({...response,assets:[first,second]}));render(<RelativeAnalysis/>);
 fireEvent.change(screen.getByLabelText('Primer activo'),{target:{value:'AAPL'}});fireEvent.change(screen.getByLabelText('Segundo activo'),{target:{value:'MSFT'}});fireEvent.click(screen.getByRole('button',{name:'Comparar'}));
 await screen.findByText('Calls: 4/10 contratos con volumen fechado · Puts: 6/10 contratos con volumen fechado.');
 const call=screen.getByText('Volumen call observado').parentElement!;expect(call.textContent).not.toContain('—');
 const pcr=screen.getByText('Put / call · volumen').parentElement!;expect(within(pcr).getByText('—')).toBeVisible();
 expect(screen.getAllByText('Posiciones institucionales')).toHaveLength(1);expect(screen.getAllByText('Flujos netos del fondo')).toHaveLength(1);
 expect(screen.queryByText('No aplica a acciones')).toBeNull();expect(screen.queryByText('Instituciones no aplican a este fondo.')).toBeNull();expect(screen.getByText('No hay flujos netos verificados.')).toBeVisible();
});

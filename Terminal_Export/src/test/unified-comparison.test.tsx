import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import UnifiedComparison,{parseComparisonInput} from '../pages/UnifiedComparison';
import type {ComparisonAsset,MarketComparison} from '../../../supabase/functions/analyze-ticker/market-comparison';
const request=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:request}));
vi.mock('recharts',()=>{const Box=({children}:{children?:any})=><div>{children}</div>;return {Bar:Box,BarChart:Box,Cell:Box,CartesianGrid:Box,Legend:Box,Line:Box,LineChart:Box,ReferenceLine:Box,ResponsiveContainer:Box,Tooltip:Box,XAxis:Box,YAxis:Box};});
function asset(symbol:string):ComparisonAsset{return {symbol,name:symbol+' Fund',kind:'etf',currency:'USD',asOf:'2026-10-16',price:100,return20:5,return63:8,volatility20:20,drawdown:-10,avgTurnover20:100000000,relativeVolume:1.1,upVolumeShare20:52,aboveSma50:true,aboveSma200:true,valuation:{pe:null,pb:null},institutions:{status:'not-applicable',period:null,previousPeriod:null,shares:null,sharesChangePct:null,investors:null,ownershipPct:null,reason:'No aplica'},options:{status:'unavailable',expiry:null,asOf:null,contracts:0,callVolume:null,putVolume:null,putCallVolume:null,putCallOi:null,atmIv:null,reason:'Sin opciones verificadas'},fundFlows:{status:'unavailable',value:null,period:null,reason:'Sin flujos netos verificados'},change1d:1,return21:5,volume:10000,averageVolume20:9000,turnover:1000000,monthlyActivity:[{month:'2026-10',value:10000000,observations:12,complete:true}],institutionalHistory:[],window:{start:'2026-07-17',end:'2026-10-16',observations:63,totalReturn:8,volatility:20,maxDrawdown:-10},benchmark:{correlationSP500:.9,correlationWorld:.8,betaSP500:1.1,trackingErrorSP500:5}};}
const data:MarketComparison={symbols:['SPY','QQQ'],range:'3m',assets:[asset('SPY'),asset('QQQ')],universe:['SPY','QQQ','URTH'],missing:[],window:{start:'2026-07-17',end:'2026-10-16',observations:63,currencyAligned:true},chart:[{date:'2026-07-17',SPY:0,QQQ:0,URTH:0},{date:'2026-10-16',SPY:8,QQQ:10,URTH:7}],drawdowns:[{date:'2026-07-17',SPY:0,QQQ:0,URTH:0},{date:'2026-10-16',SPY:-1,QQQ:-2,URTH:-3}],rolling:[{date:'2026-10-16',QQQ:.8}],matrix:[[1,.8,.7],[.8,1,.6],[.7,.6,1]],matrixSamples:[[63,63,63],[63,63,63],[63,63,63]],pairs:[{a:'SPY',b:'QQQ',start:'2026-07-17',end:'2026-10-16',observations:63,currencyAligned:true,correlation:.8,beta:1,trackingError:10,relative20:2,relative63:3,spreadZ:1,ratio:[{date:'2026-07-17',value:100},{date:'2026-10-16',value:102}]}],factors:[{symbol:'SPY',label:'Bolsa estadounidense',asOf:'2026-10-16',change20:4,correlations:[{symbol:'SPY',value:1},{symbol:'QQQ',value:.8}]}],news:[],analysis:{status:'not-requested',items:[],context:[],enhanced:false},fetchedAt:'2026-10-18T10:00:00Z'};
const withAnalysis:MarketComparison={...data,news:[{title:'El sector tecnológico presenta resultados',source:'CNBC',url:'https://www.cnbc.com/story',date:'2026-10-16',keyPoints:['Se publicaron los resultados del trimestre.']}],analysis:{status:'ready',items:[{id:'strength',kind:'advantage',symbols:['SPY','QQQ'],title:'Fortaleza relativa',value:'2 pp',detail:'Una diferencia de dos puntos en veinte sesiones.',comment:'La diferencia describe un comportamiento ya observado.'}],context:[{title:'Sensibilidad compartida',detail:'Ambos activos mantienen una relación estrecha con la bolsa estadounidense.',evidence:['factor:SPY']}],enhanced:true}};
beforeEach(()=>{request.mockReset();});
function compare(container:HTMLElement){fireEvent.change(screen.getByLabelText('Activos para comparar'),{target:{value:'SPY, QQQ'}});fireEvent.submit(container.querySelector('form')!);}

it('validates the full selection without silently truncating tickers or adding presets',()=>{
 expect(parseComparisonInput('BRK-B, ^GSPC').error).toBe('');expect(parseComparisonInput('AAPL MSFT SPY QQQ TLT GLD').error).toBe('');expect(parseComparisonInput('SPY QQQ URTH IWM VEA VWO GLD').symbols).toHaveLength(7);
 expect(parseComparisonInput('SPY QQQ URTH IWM VEA VWO GLD').error).toContain('máximo de seis');expect(parseComparisonInput('SPY,SPY').error).toContain('una sola vez');expect(parseComparisonInput('AAPL<script>, SPY').error).toContain('válido');
 const {container}=render(<UnifiedComparison/>);expect(container.querySelectorAll('form')).toHaveLength(1);expect(screen.getByLabelText('Activos para comparar')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('Activos para comparar'),{target:{value:'SPY QQQ URTH IWM VEA VWO GLD'}});expect(screen.getByText(/Retira los tickers sobrantes/)).toBeVisible();expect(screen.getByRole('button',{name:'Comparar activos'})).toBeDisabled();expect(request).not.toHaveBeenCalled();
});
it('loads all comparison views with one form and analyzes the displayed pair and period after draft edits',async()=>{
 request.mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(Response.json(withAnalysis));
 const {container}=render(<UnifiedComparison/>);compare(container);await screen.findByRole('heading',{name:'Riesgo y referencias de mercado'});
 expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({panel:'marketComparison',symbols:['SPY','QQQ'],range:'3m',includeAnalysis:false});
 for(const title of ['Correlación entre activos','Fuerza relativa entre dos activos','Correlación móvil frente al S&P 500','Actividad negociada por mes','Sensibilidad al contexto global'])expect(screen.getByRole('heading',{name:title})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Caídas desde máximos'}));expect(screen.getByRole('button',{name:'Caídas desde máximos'})).toHaveAttribute('aria-pressed','true');
 fireEvent.change(screen.getByLabelText('Activos para comparar'),{target:{value:'NVDA, MU, AAPL'}});fireEvent.change(screen.getByLabelText('Período de comparación'),{target:{value:'1y'}});
 fireEvent.click(screen.getByRole('button',{name:'Analizar métricas'}));await screen.findByText('Fortaleza relativa');
 expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({panel:'marketComparison',symbols:['SPY','QQQ'],range:'3m',includeAnalysis:true});
 expect(screen.getByText('La diferencia describe un comportamiento ya observado.')).toBeVisible();expect(screen.getByText('Sensibilidad compartida')).toBeVisible();expect(container.querySelectorAll('a')).toHaveLength(1);expect(screen.getByRole('link',{name:'Abrir artículo en CNBC'})).toHaveAttribute('href','https://www.cnbc.com/story');expect(container.textContent).not.toMatch(/\bIA\b/);expect(container.querySelectorAll('form')).toHaveLength(1);
});
it('keeps the previous data visible when an updated comparison fails',async()=>{
 request.mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(Response.json({error:'Consulta temporalmente no disponible.'},{status:503}));
 const {container}=render(<UnifiedComparison/>);compare(container);await screen.findByRole('heading',{name:'Riesgo y referencias de mercado'});fireEvent.click(screen.getByRole('button',{name:'Comparar activos'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Consulta temporalmente no disponible.'));expect(screen.getByRole('heading',{name:'Correlación entre activos'})).toBeVisible();
});
it('rejects a response for another selection instead of overwriting the comparison',async()=>{
 request.mockResolvedValueOnce(Response.json({...data,symbols:['NVDA','MU']}));const {container}=render(<UnifiedComparison/>);compare(container);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('no corresponden'));expect(screen.queryByRole('heading',{name:'Riesgo y referencias de mercado'})).toBeNull();
});
it('aborts an outstanding request when the comparison unmounts',async()=>{
 let finish!:(value:Response)=>void;request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const {container,unmount}=render(<UnifiedComparison/>);compare(container);const signal=request.mock.calls[0][1].signal as AbortSignal;
 unmount();expect(signal.aborted).toBe(true);finish(Response.json(data));
});
it('accepts six selected assets and reports the complete count without adding a preset',()=>{
 render(<UnifiedComparison/>);fireEvent.change(screen.getByLabelText('Activos para comparar'),{target:{value:'AAPL MSFT SPY QQQ TLT GLD'}});
 expect(screen.getByRole('button',{name:'Comparar activos'})).toBeEnabled();expect(screen.getByText(/6\/6 activos/)).toBeVisible();expect(parseComparisonInput('AAPL MSFT SPY QQQ TLT GLD').symbols).toHaveLength(6);
});
it('groups missing complementary data and omits metrics and sections that have no verified observations',async()=>{
 const incomplete={...data,assets:data.assets.map(a=>({...a,window:{...a.window,volatility:null},benchmark:{...a.benchmark,betaSP500:null,trackingErrorSP500:null}}))};
 request.mockResolvedValueOnce(Response.json(incomplete));const {container}=render(<UnifiedComparison/>);compare(container);await screen.findByRole('heading',{name:'Riesgo y referencias de mercado'});
 expect(screen.queryByRole('heading',{name:'Valoración de las empresas'})).toBeNull();expect(screen.queryByRole('heading',{name:'Histórico de posiciones declaradas'})).toBeNull();expect(screen.queryByText('Beta S&P 500')).toBeNull();expect(screen.queryByText('Tracking error S&P 500 · anualizado')).toBeNull();expect(screen.getByText('Disponibilidad de datos complementarios')).toBeVisible();expect(container.querySelector('details')).not.toHaveAttribute('open');
});

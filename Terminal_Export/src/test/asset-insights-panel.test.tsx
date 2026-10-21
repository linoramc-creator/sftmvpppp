import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {AssetInsights,AssetFinancialPoint} from '../../../supabase/functions/analyze-ticker/asset-insights';
import AssetInsightsPanel from '../components/AssetInsightsPanel';

const state=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:state.api}));
vi.mock('recharts',()=>({
 ResponsiveContainer:({children}:{children:React.ReactNode})=><div>{children}</div>,
 ComposedChart:({children,data}:{children:React.ReactNode;data:unknown})=><div data-testid="insight-chart" data-observations={JSON.stringify(data)}>{children}</div>,
 BarChart:({children,data}:{children:React.ReactNode;data:unknown})=><div data-testid="weight-chart" data-observations={JSON.stringify(data)}>{children}</div>,
 Area:({dataKey}:{dataKey:string})=><div data-testid="area-series" data-key={dataKey}/>,
 Line:({dataKey,connectNulls}:{dataKey:string;connectNulls?:boolean})=><div data-testid="line-series" data-key={dataKey} data-connect-nulls={String(connectNulls)}/>,
 Bar:({dataKey}:{dataKey:string})=><div data-testid="bar-series" data-key={dataKey}/>,
 CartesianGrid:()=>null,Legend:()=>null,ReferenceLine:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null,
}));

function fixture(symbol:string):AssetInsights{return {
 symbol,fetchedAt:'2026-10-21T20:00:00Z',profile:{name:'Example company',kind:'equity',description:'Industrial products and recurring maintenance services.',sector:'Industrials',industry:'Electrical equipment',country:'United States',currency:'USD',financialCurrency:'USD',exchange:'NYSE',employees:12000,updatedAt:'2026-10-20'},
 metrics:[{id:'revenueTtm',label:'Ingresos · doce meses',value:1200000000,unit:'currency',currency:'USD',period:'TTM',periodEnd:'2026-06-30'},{id:'profitMargin',label:'Margen neto',value:-2,unit:'percent',currency:null,period:'TTM',periodEnd:'2026-06-30'}],
 financials:{unit:'millions',scale:1000000,frequency:'quarterly',rows:[]},fund:null,
 priceStudy:{from:'2025-10-01',to:'2026-10-20',observations:265,adjustment:'adjusted-close',annualizationDays:252,monthlyReturns:[{year:2026,month:7,returnPct:2.5,partial:false,from:'2026-06-30',to:'2026-07-31'},{year:2026,month:10,returnPct:-1.2,partial:true,from:'2026-09-30',to:'2026-10-20'}],underwater:[{date:'2026-10-19',drawdownPct:0,sessionsUnderwater:0},{date:'2026-10-20',drawdownPct:-5,sessionsUnderwater:1}],summary:{currentDrawdownPct:-5,maximumDrawdownPct:-20,currentSessionsUnderwater:1,longestSessionsUnderwater:45,trendEfficiency20Pct:30,trendDirection20:'down',sortino:.7,downsideAnnualizedPct:15,upsideAnnualizedPct:18,returnSamples:252}},
};}
const quarter=(period:string,currency:string,revenue:number):AssetFinancialPoint=>({period,filingDate:'2026-10-01',currency,revenue,freeCashFlow:0,fcfMarginPct:0,grossMarginPct:40,operatingCashFlow:10,netIncome:-2,cash:30,totalDebt:15,netDebt:-15});
const response=(data:AssetInsights)=>({ok:true,json:async()=>data});
const observations=()=>JSON.parse(screen.getByTestId('insight-chart').getAttribute('data-observations')!);

beforeEach(()=>{
 state.api.mockReset();state.api.mockImplementation(async(_url:string,init:RequestInit)=>response(fixture(JSON.parse(String(init.body)).subject)));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('requests authenticated assetInsights and presents stock facts without ETF exposure sections',async()=>{
 render(<AssetInsightsPanel symbol="INSIGHT_STOCK"/>);
 await screen.findByRole('button',{name:'Negocio y métricas'});
 const [url,init]=state.api.mock.calls[0];expect(url).toMatch(/\/functions\/v1\/analyze-ticker$/);
 expect(init.method).toBe('POST');expect(JSON.parse(init.body)).toEqual({panel:'assetInsights',subject:'INSIGHT_STOCK'});
 expect(screen.getByText('Industrials')).toBeInTheDocument();expect(screen.getByText('Electrical equipment')).toBeInTheDocument();
 expect(screen.getByText('Ingresos · doce meses')).toBeInTheDocument();expect(screen.getByText('-2,00%')).toBeInTheDocument();
 expect(screen.queryByText('Principales posiciones')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Fondo y exposición'})).not.toBeInTheDocument();
});

it('keeps different statement currencies in separate financial chart series and preserves zero/negative data',async()=>{
 const data=fixture('INSIGHT_CURRENCY');data.financials.rows=[quarter('2025-12-31','EUR',100),quarter('2026-03-31','EUR',110),quarter('2026-06-30','USD',200),quarter('2026-09-30','USD',220)];
 state.api.mockResolvedValue(response(data));render(<AssetInsightsPanel symbol={data.symbol}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Evolución financiera'}));
 expect(screen.getByLabelText('Moneda de los estados financieros')).toHaveValue('USD');
 expect(observations().map((r:AssetFinancialPoint)=>r.currency)).toEqual(['USD','USD']);expect(screen.getByText(/Millones de USD/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Moneda de los estados financieros'),{target:{value:'EUR'}});
 expect(observations().map((r:AssetFinancialPoint)=>r.revenue)).toEqual([100,110]);expect(screen.getByText(/Millones de EUR/)).toBeInTheDocument();
 expect(observations()[0].freeCashFlow).toBe(0);expect(observations()[0].netDebt).toBe(-15);
 expect(screen.getByTestId('line-series')).toHaveAttribute('data-connect-nulls','false');
 fireEvent.change(screen.getByLabelText('Métrica financiera del activo'),{target:{value:'balance'}});
 expect(screen.getByText('Liquidez y deuda')).toBeInTheDocument();expect(screen.getByTestId('line-series')).toHaveAttribute('data-key','netDebt');
 expect(screen.getAllByTestId('bar-series').map(n=>n.getAttribute('data-key'))).toEqual(['cash','totalDebt']);
});

it('uses ETF exposure, manager and holdings while omitting corporate financial chart controls',async()=>{
 const data=fixture('INSIGHT_ETF');data.profile.kind='etf';data.profile.sector=null;data.profile.industry=null;data.profile.financialCurrency=null;data.profile.employees=null;
 data.metrics=[{id:'expenseRatio',label:'Gastos anuales',value:.15,unit:'percent',currency:null,period:'fund',periodEnd:'2026-10-20'}];
 data.fund={benchmark:'Global equity index',manager:'Example asset manager',category:'Global equity',holdingsCount:150,inceptionDate:'2015-01-01',topHoldings:[{symbol:'HOLD',name:'Core holding',weightPct:7.5}],sectorWeights:[{name:'Technology',weightPct:30}],regions:[{name:'Europe',weightPct:40}],topTenWeightPct:null};
 state.api.mockResolvedValue(response(data));render(<AssetInsightsPanel symbol={data.symbol}/>);
 await screen.findByRole('button',{name:'Fondo y exposición'});
 expect(screen.getByText('Global equity index')).toBeInTheDocument();expect(screen.getByText('Example asset manager')).toBeInTheDocument();
 expect(screen.getByText('0,15%')).toBeInTheDocument();expect(screen.getByText('Exposición por sector')).toBeInTheDocument();expect(screen.getByText('Exposición por región')).toBeInTheDocument();
 const table=screen.getByRole('table');expect(within(table).getByText('Core holding')).toBeInTheDocument();expect(within(table).getByText('7,50%')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Evolución financiera'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Métrica financiera del activo')).not.toBeInTheDocument();
});

it('retains access to an available financial history when a newer currency has only one quarter',async()=>{
 const data=fixture('INSIGHT_CURRENCY_CHANGE');data.financials.rows=[quarter('2025-12-31','EUR',100),quarter('2026-03-31','EUR',110),quarter('2026-06-30','USD',200)];
 state.api.mockResolvedValue(response(data));render(<AssetInsightsPanel symbol={data.symbol}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Evolución financiera'}));
 const select=screen.getByLabelText('Moneda de los estados financieros');
 fireEvent.change(select,{target:{value:'EUR'}});
 expect(observations().map((r:AssetFinancialPoint)=>r.currency)).toEqual(['EUR','EUR']);
 expect(screen.getByText(/Millones de EUR/)).toBeInTheDocument();
});

it('calendar marks a partial month and leaves unreported months empty instead of inventing zero returns',async()=>{
 render(<AssetInsightsPanel symbol="INSIGHT_CALENDAR"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Calendario de rentabilidad'}));
 const table=screen.getByRole('table'),row=within(table).getByRole('rowheader',{name:'2026'}).closest('tr')!,cells=within(row).getAllByRole('cell');
 expect(cells).toHaveLength(12);expect(cells[6]).toHaveTextContent('+2,5');expect(cells[6]).not.toHaveTextContent('*');
 expect(cells[9]).toHaveTextContent('-1,2*');expect(cells[9]).toHaveAttribute('title',expect.stringContaining('Mes parcial'));
 expect(cells[5]).toHaveTextContent('—');expect(cells[8]).toHaveTextContent('—');expect(cells.filter(cell=>cell.textContent==='—')).toHaveLength(10);
 expect(screen.queryByText('0,0')).not.toBeInTheDocument();expect(within(table).getByText(/Un asterisco indica el mes parcial/)).toBeInTheDocument();
});

it('switches drawdown into duration without changing the history or treating sessions as calendar days',async()=>{
 render(<AssetInsightsPanel symbol="INSIGHT_DRAWDOWN"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Caídas y recuperación'}));
 const initial=observations();expect(screen.getByRole('button',{name:'Caída'})).toHaveAttribute('aria-pressed','true');expect(screen.getByTestId('area-series')).toHaveAttribute('data-key','drawdownPct');
 expect(screen.getByText('1 sesiones')).toBeInTheDocument();expect(screen.getByLabelText(/no son días naturales/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Duración'}));
 expect(screen.getByRole('button',{name:'Duración'})).toHaveAttribute('aria-pressed','true');expect(screen.getByTestId('area-series')).toHaveAttribute('data-key','sessionsUnderwater');expect(observations()).toEqual(initial);
 expect(screen.getByText('Tiempo bajo el máximo de cierre')).toBeInTheDocument();
});

it('opens an index directly on usable price studies when corporate fundamentals do not apply',async()=>{
 const data=fixture('INSIGHT_INDEX');data.profile.kind='index';data.metrics=[];data.priceStudy.adjustment='price';
 state.api.mockResolvedValue(response(data));render(<AssetInsightsPanel symbol={data.symbol}/>);
 const drawdown=await screen.findByRole('button',{name:'Caídas y recuperación'});
 expect(drawdown).toHaveAttribute('aria-pressed','true');expect(screen.getByTestId('area-series')).toHaveAttribute('data-key','drawdownPct');
 expect(screen.queryByRole('button',{name:'Negocio y métricas'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Evolución financiera'})).not.toBeInTheDocument();
 expect(screen.getByText(/Variaciones de precio; no incluyen rendimientos de una cartera/)).toBeInTheDocument();
});

it('retries a failed authenticated request and does not cache an unauthorized response',async()=>{
 state.api.mockResolvedValueOnce({ok:false,status:403});render(<AssetInsightsPanel symbol="INSIGHT_RETRY"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('No se han podido actualizar');
 fireEvent.click(screen.getByRole('button',{name:'Reintentar datos'}));
 await screen.findByRole('button',{name:'Negocio y métricas'});expect(state.api).toHaveBeenCalledTimes(2);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('retains the last loaded data if a refresh fails and offers another refresh',async()=>{
 render(<AssetInsightsPanel symbol="INSIGHT_STALE"/>);await screen.findByText('Electrical equipment');
 state.api.mockRejectedValueOnce(new Error('temporary outage'));
 fireEvent.click(screen.getByRole('button',{name:'Actualizar datos complementarios'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Se conservan los últimos datos cargados');expect(screen.getByText('Electrical equipment')).toBeInTheDocument();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Actualizar datos complementarios'})).not.toBeDisabled());
});

it('does not overwrite another selected asset with a late response',async()=>{
 let firstResolve!:(value:unknown)=>void;state.api.mockImplementationOnce(()=>new Promise(resolve=>{firstResolve=resolve;}));
 const page=render(<AssetInsightsPanel symbol="INSIGHT_OLD"/>);page.rerender(<AssetInsightsPanel symbol="INSIGHT_NEW"/>);
 await screen.findByText('Electrical equipment');
 const old=fixture('INSIGHT_OLD');old.profile.industry='Obsolete selection';
 await act(async()=>{firstResolve(response(old));});
 expect(screen.queryByText('Obsolete selection')).not.toBeInTheDocument();expect(state.api).toHaveBeenCalledTimes(2);
});

import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import MarketInstrumentDetail from '../components/MarketInstrumentDetail';
import MarketPulseChart from '../components/MarketPulseChart';
import type {MarketPulse} from '../../../supabase/functions/analyze-ticker/market-pulse';
const api=vi.hoisted(()=>vi.fn());vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
vi.mock('../components/charts/InstrumentPriceChart',()=>({InstrumentPriceChart:({ticker}:{ticker:string})=><h2>{ticker} · Velas 4H</h2>}));
vi.mock('../components/AssetInsightsPanel',()=>({default:()=>null}));
function fixture(symbol='^GSPC'):MarketPulse{
 const time=Date.parse('2026-10-16T13:30Z'),candles=Array.from({length:30},(_,i)=>({time:time+i*300000,open:100+i/10,high:102+i/10,low:99+i/10,close:101+i/10,volume:null}));
 return {symbol,name:symbol==='^GSPC'?'S&P 500':'Nasdaq 100 ETF',description:'',instrument:{kind:symbol.startsWith('^')?'index':'etf',priceUnit:symbol.startsWith('^')?'pts':'USD',volumeUnit:symbol.startsWith('^')?'unavailable':'fund-units'},currency:'USD',exchange:'NYSE',timezone:'America/New_York',price:103,change:1,quoteAt:'2026-10-16T20:00Z',fetchedAt:new Date().toISOString(),session:{date:'2026-10-16',partial:false,open:100,high:105,low:99,previousClose:102,volume:symbol.startsWith('^')?null:1000000,averageVolume20:900000,volumeRatio:1.1,rangePercent:5.8,gapPercent:-1.96,vol20:12,atr14:2,riskDate:'2026-10-16'},rangePosition:66.6,vwapApprox:symbol.startsWith('^')?null:102.5,vwapAt:symbol.startsWith('^')?null:'2026-10-16T20:00Z',intraday:{date:'2026-10-16',intervalMinutes:5,candles,volume:[],coverageStart:'2026-10-16T13:30Z'},daily:candles.map((c,i)=>({...c,time:time-(29-i)*86400000})),trend:{date:'2026-10-16',return5:2,return20:5,ma20:100,ma50:98,aboveMa20:3,aboveMa50:5.1},risk:{currency:'pts',history:[{date:'2026-10-16',vol20:12,vol60:14,drawdown:-3,belowPeak:4,atr:2,atrPercent:2,volumeRatio:null}],percentiles:{},asOf:'2026-10-16'},rotation:{date:'2026-10-16',items:[{symbol:'XLK',name:'Tecnología',date:'2026-10-16',day:1,five:2,twenty:3,relative20:1}]}};
}
it('opens a market context endpoint with dated metrics and sector ETF proxies, distinct from a watchlist company report',async()=>{
 const data=fixture(),back=vi.fn(),select=vi.fn();api.mockResolvedValue({ok:true,json:async()=>data});
 const {container}=render(<MarketInstrumentDetail symbol="^GSPC" onBack={back} onSelect={select}/>);
 await screen.findByRole('heading',{name:'S&P 500'});
 expect(JSON.parse(api.mock.calls.at(-1)![1].body)).toEqual({panel:'marketPulse',subject:'^GSPC'});
 expect(screen.getByRole('heading',{name:'^GSPC · Velas 4H'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Histórico · 4H'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Sesión actual'}));
 expect(screen.getByRole('heading',{name:'Pulso de la sesión'})).toBeVisible();
 expect(screen.getByRole('heading',{name:/Rotación sectorial/})).toBeVisible();
 expect(screen.queryByRole('button',{name:/Analizar/})).toBeNull();expect(container.textContent).not.toMatch(/Contratos operados|Yahoo|FMP|Massive/);
 expect(screen.queryByText('VWAP aprox.')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Tecnología XLK/}));expect(select).toHaveBeenLastCalledWith('XLK');
 fireEvent.click(screen.getByRole('button',{name:'Volver al feed'}));expect(back).toHaveBeenCalledOnce();
});
it('keeps ETF fund units and approximate VWAP separate from index metrics',async()=>{
 const data=fixture('QQQ');api.mockResolvedValue({ok:true,json:async()=>data});
 render(<MarketInstrumentDetail symbol="QQQ" onBack={vi.fn()}/>);await screen.findByRole('heading',{name:'Nasdaq 100 ETF'});
 expect(screen.getByText('Participaciones negociadas')).toBeVisible();expect(screen.getByText('VWAP aprox.')).toBeVisible();
 expect(screen.getByText('102,50')).toBeVisible();expect(screen.getByLabelText(/aproximación, no un VWAP/)).toBeInTheDocument();
});
it('provides intraday line/candle views, daily periods and a removable subtle crosshair',()=>{
 const data=fixture(),{container}=render(<MarketPulseChart data={data}/>),chart=screen.getByRole('application',{name:'Gráfico interactivo de ^GSPC'});
 fireEvent.click(screen.getByRole('button',{name:/^Velas$/}));expect(screen.getByRole('button',{name:/^Velas$/})).toHaveAttribute('aria-pressed','true');
 fireEvent.keyDown(chart,{key:'ArrowLeft'});expect(screen.getByTestId('market-pulse-crosshair')).toBeVisible();
 expect([...container.querySelectorAll('rect')].some(r=>['white','#fff','#ffffff'].includes(r.getAttribute('fill')??''))).toBe(false);
 fireEvent.pointerLeave(chart);expect(screen.queryByTestId('market-pulse-crosshair')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^20 sesiones$/}));expect(screen.getByRole('button',{name:/^20 sesiones$/})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Ampliar gráfico de mercado'}));expect(chart).toHaveStyle({height:'550px'});
});
it('shows an explicit empty intraday state and still permits the historical session view',()=>{
 const data=fixture();data.intraday.candles=[];render(<MarketPulseChart data={data}/>);
 expect(screen.getByText('Sin barras intradiarias verificadas para esta sesión.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'3 meses'}));expect(screen.getByRole('application',{name:'Gráfico interactivo de ^GSPC'})).toBeVisible();
});
it('respects a coarser source interval and exposes only real available longer history',()=>{
 const data=fixture();data.intraday.intervalMinutes=15;
 const {container}=render(<MarketPulseChart data={data}/>);
 expect(screen.queryByRole('button',{name:'Intervalo de mercado 5 min'})).toBeNull();
 expect(screen.getByRole('button',{name:'Intervalo de mercado 15 min'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Intervalo de mercado 4H'}));
 expect(screen.getByRole('button',{name:'Intervalo de mercado 4H'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'1 año'}));
 expect(screen.getByRole('heading',{name:'Histórico de precios'})).toBeVisible();
 expect(container.querySelectorAll('[data-candle-time]')).toHaveLength(data.daily.length);
 expect(screen.getByText(/Sesiones diarias · 30 disponibles/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Histórico'}));
 expect(container.querySelectorAll('[data-candle-time]')).toHaveLength(data.daily.length);
});
it('offers retry after a failed market context request without showing invented quotes',async()=>{
 api.mockResolvedValue({ok:false});render(<MarketInstrumentDetail symbol="FAILED" onBack={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('No se ha podido actualizar el contexto de mercado.'));
 expect(screen.getByRole('button',{name:'Reintentar'})).toBeVisible();
});

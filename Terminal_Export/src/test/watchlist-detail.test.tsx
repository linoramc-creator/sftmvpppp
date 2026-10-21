import {cleanup,render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {afterEach,vi,it,expect} from 'vitest';
import {WatchlistCard} from '../components/WatchlistCard';
import AssetDetail from '../components/AssetDetail';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
vi.mock('../components/AssetAlerts',()=>({default:()=>null}));
vi.mock('../components/AssetContext',()=>({default:()=>null}));
vi.mock('../components/AssetInsightsPanel',()=>({default:()=>null}));
afterEach(()=>{cleanup();api.mockReset();});
it('opens the selected ticker without removing it',()=>{
 const select=vi.fn(),change=vi.fn();render(<WatchlistCard stocks={['AAPL']} data={null} onSelect={select} onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'Abrir ficha de AAPL'}));expect(select).toHaveBeenCalledWith('AAPL');expect(change).not.toHaveBeenCalled();
});
it('shows four-hour OHLC candles and a genuine empty latest-news state',async()=>{
 const time=Date.parse('2026-10-06T12:00:00Z');
 const candles=Array.from({length:35},(_,i)=>time-(34-i)*86400000).filter(t=>![0,6].includes(new Date(t).getUTCDay())).flatMap(t=>[0,4].map(hour=>({time:t+hour*3600000,open:100,high:103,low:99,close:101,volume:1000})));
 const daily=[time-86400000,time].map(t=>({time:t,open:200,high:203,low:199,close:201,volume:5000}));
 const payload={symbol:'TEST',name:'Test company',description:'Actividad de prueba.',currency:'USD',exchange:'NASDAQ',timezone:'America/New_York',price:101,change:null,quoteAt:new Date(time).toISOString(),candles,instrument:{kind:'equity',priceUnit:'USD',volumeUnit:'shares',priceDecimals:2},series:{'4h':{candles,timezone:'America/New_York',session:'Sesión regular'},'1d':{candles:daily,timezone:'America/New_York',session:'Sesión regular'}},news:[],session:'Sesión regular',newsSince:new Date(time-86400000).toISOString(),fetchedAt:new Date().toISOString()};
 api.mockImplementation(async(_url,init)=>{const body=JSON.parse(init.body);if(!['assetSnapshot','assetCandles'].includes(body.panel))throw Error(`Unexpected panel ${body.panel}`);return{ok:true,json:async()=>payload};});
 const{container}=render(<AssetDetail symbol="TEST" stocks={['TEST']} onSelect={vi.fn()} onBack={vi.fn()} onAnalyze={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByText('PRECIO · VELAS 4H')).toBeInTheDocument());expect(screen.getByText('Actividad de prueba.')).toBeInTheDocument();expect(screen.getByText(/No hay noticias relevantes con hora/)).toBeInTheDocument();expect(within(screen.getByLabelText('Datos de la vela seleccionada')).getByText('100,00')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Velas 4H'})).toHaveAttribute('aria-pressed','true');expect(screen.getByRole('button',{name:'Período 1 MES'})).toHaveAttribute('aria-pressed','true');
 expect(container.querySelectorAll('[data-candle-time]').length).toBeGreaterThan(40);expect(screen.getByRole('button',{name:'Mostrar volumen'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Velas 1 DÍA'}));expect(within(screen.getByLabelText('Datos de la vela seleccionada')).getByText('200,00')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Ampliar gráfico'}));expect(screen.getByRole('button',{name:'Reducir gráfico'})).toHaveAttribute('aria-expanded','true');
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('button',{name:'Ampliar gráfico'})).toHaveAttribute('aria-expanded','false');
 expect(screen.getByRole('button',{name:'Velas 1H'})).toBeDisabled();expect(screen.getByRole('button',{name:'Velas 1 SEMANA'})).toBeDisabled();
 const bodies=api.mock.calls.map(([,init])=>JSON.parse(init.body));expect(bodies).toEqual(expect.arrayContaining([{panel:'assetSnapshot',subject:'TEST'},{panel:'assetCandles',subject:'TEST'}]));expect(api).toHaveBeenCalledTimes(2);
});
it('passes the detected ETF kind so analysis opens the ETF report flow',async()=>{
 const time=Date.parse('2026-10-16T20:00Z'),analyze=vi.fn();
 api.mockResolvedValue({ok:true,json:async()=>({symbol:'QQQ',name:'Invesco QQQ Trust',description:'Fondo cotizado sobre el Nasdaq 100.',currency:'USD',exchange:'NASDAQ',timezone:'America/New_York',price:100,change:1,quoteAt:new Date(time).toISOString(),candles:[],instrument:{kind:'etf',priceUnit:'USD',volumeUnit:'fund-units'},news:[],session:'Sesión regular',newsSince:new Date(time-86400000).toISOString(),fetchedAt:new Date().toISOString()})});
 render(<AssetDetail symbol="QQQ" stocks={['QQQ']} onSelect={vi.fn()} onBack={vi.fn()} onAnalyze={analyze}/>);
 await screen.findByRole('heading',{name:'Invesco QQQ Trust'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Analizar QQQ'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Analizar QQQ'}));
 expect(analyze).toHaveBeenCalledWith('QQQ','etf');
});

import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {vi,it,expect} from 'vitest';
import {WatchlistCard} from '../components/WatchlistCard';
import AssetDetail from '../components/AssetDetail';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
vi.mock('../components/AssetAlerts',()=>({default:()=>null}));
vi.mock('../components/AssetContext',()=>({default:()=>null}));
it('opens the selected ticker without removing it',()=>{
 const select=vi.fn(),change=vi.fn();render(<WatchlistCard stocks={['AAPL']} data={null} onSelect={select} onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'Abrir ficha de AAPL'}));expect(select).toHaveBeenCalledWith('AAPL');expect(change).not.toHaveBeenCalled();
});
it('shows four-hour OHLC candles and a genuine empty latest-news state',async()=>{
 const time=Date.parse('2026-10-06T12:00:00Z');
 api.mockResolvedValue({ok:true,json:async()=>({symbol:'TEST',name:'Test company',description:'Actividad de prueba.',currency:'USD',exchange:'NASDAQ',timezone:'America/New_York',price:101,change:null,quoteAt:new Date(time).toISOString(),candles:[{time,open:100,high:103,low:99,close:101,volume:1000}],series:{'1d':{candles:[{time,open:200,high:203,low:199,close:201,volume:5000}],timezone:'America/New_York',session:'Sesión regular'}},news:[],session:'Sesión regular',newsSince:new Date(time-86400000).toISOString(),fetchedAt:new Date().toISOString()})});
 render(<AssetDetail symbol="TEST" stocks={['TEST']} onSelect={vi.fn()} onBack={vi.fn()} onAnalyze={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByText('PRECIO · VELAS 4H')).toBeInTheDocument());expect(screen.getByText('Actividad de prueba.')).toBeInTheDocument();expect(screen.getByText(/No hay noticias relevantes con hora/)).toBeInTheDocument();expect(screen.getByRole('button',{name:/apertura 100, máximo 103/})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Velas 1 DÍA'}));expect(screen.getByRole('button',{name:/apertura 200, máximo 203/})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Ampliar gráfico'}));expect(screen.getByRole('button',{name:'Reducir gráfico'})).toHaveAttribute('aria-expanded','true');
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('button',{name:'Ampliar gráfico'})).toHaveAttribute('aria-expanded','false');
 fireEvent.click(screen.getByRole('button',{name:'Velas 1 SEMANA'}));expect(screen.getByText(/No hay velas disponibles para este intervalo/)).toBeInTheDocument();expect(api).toHaveBeenCalledTimes(1);
});

import {cleanup,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MarketInstrumentDetail from '../components/MarketInstrumentDetail';
import type {MarketPulse} from '../../../supabase/functions/analyze-ticker/market-pulse';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
vi.mock('../components/MarketPulseChart',()=>({default:()=> <div>Gráfico del mercado</div>}));
vi.mock('../components/MarketRiskHistory',()=>({default:()=> <div>Histórico de riesgo</div>}));
vi.mock('../components/AssetInsightsPanel',()=>({default:()=>null}));
afterEach(()=>{cleanup();api.mockReset();});
function fixture(symbol:string):MarketPulse{
 const yen=symbol==='JPY=X';
 return {symbol,name:yen?'USD / JPY':'EUR / USD',description:'',instrument:{kind:'forex',priceUnit:yen?'JPY':'USD',volumeUnit:'unavailable',baseCurrency:yen?'USD':'EUR',quoteCurrency:yen?'JPY':'USD',priceDecimals:yen?3:5},currency:yen?'JPY':'USD',exchange:'FX',timezone:'UTC',price:yen?154.123:1.12345,change:.23,quoteAt:'2026-10-16T12:00:00Z',fetchedAt:new Date().toISOString(),session:{date:'2026-10-16',partial:true,open:yen?154:1.12,high:yen?155:1.125,low:yen?153:1.115,previousClose:yen?153.9:1.121,volume:null,averageVolume20:null,volumeRatio:null,rangePercent:.89,gapPercent:-.09,vol20:7.2,atr14:yen?1.234:.00123,riskDate:'2026-10-15'},rangePosition:75,vwapApprox:null,vwapAt:null,intraday:{date:'2026-10-16',intervalMinutes:5,candles:[],volume:[],coverageStart:null},daily:[],trend:{date:'2026-10-15',return5:.2,return20:1.5,ma20:yen?154.12:1.12009,ma50:yen?153.1:1.11817,aboveMa20:.3,aboveMa50:.5},risk:{currency:yen?'JPY':'USD',history:[{date:'2026-10-15',vol20:7.2,vol60:8.1,drawdown:-1.2,belowPeak:4,atr:yen?1.234:.00123,atrPercent:.1,volumeRatio:null}],percentiles:{},asOf:'2026-10-15',annualizationDays:252},rotation:{date:null,items:[]}};
}
function mockMarket(data:MarketPulse){
 const end=Date.parse(data.quoteAt!),candles=Array.from({length:193},(_,i)=>({time:end-(192-i)*14400000,open:data.session.open,high:data.session.high,low:data.session.low,close:data.price,volume:null}));
 api.mockImplementation(async(_url,init)=>{const body=JSON.parse(init.body);if(body.panel==='marketPulse')return{ok:true,json:async()=>data};if(body.panel==='assetCandles')return{ok:true,json:async()=>({symbol:data.symbol,currency:data.currency,timezone:data.timezone,instrument:data.instrument,series:{'4h':{candles,timezone:data.timezone,session:'Negociación de divisas'}}})};throw Error(`Unexpected panel ${body.panel}`);});
}
it('shows precise FX price, daily risk and pip metrics without stock volume or VWAP',async()=>{
 const data=fixture('EURUSD=X');mockMarket(data);
 render(<MarketInstrumentDetail symbol="EURUSD=X" onBack={vi.fn()}/>);
 const heading=await screen.findByRole('heading',{name:'EUR / USD'});
 expect(within(heading.closest('header')!).getByText('1,12345')).toBeVisible();expect(screen.getByText('1,12009')).toBeVisible();
 await screen.findByRole('application',{name:'Velas japonesas 4H de EURUSD=X'});
 expect(screen.getByLabelText('Datos de la vela seleccionada')).toHaveTextContent('1,12345');expect(screen.queryByRole('button',{name:'Mostrar volumen'})).toBeNull();
 expect(screen.getByText('12,3 pips')).toBeVisible();expect(screen.getByLabelText('Métricas del cruce de divisas')).toBeVisible();
 expect(screen.getByText('USD por 1 EUR. Corte diario: UTC.')).toBeVisible();
 expect(screen.getByText('Volatilidad realizada')).toBeVisible();expect(screen.getByText('Desde máximo de cierre')).toBeVisible();
 expect(screen.queryByText('Participaciones negociadas')).toBeNull();expect(screen.queryByText('VWAP aprox.')).toBeNull();
 expect(api.mock.calls.map(([,init])=>JSON.parse(init.body))).toEqual(expect.arrayContaining([{panel:'marketPulse',subject:'EURUSD=X'},{panel:'assetCandles',subject:'EURUSD=X'}]));
});
it('retains USD/JPY shorthand direction and three-decimal pricing, with correctly scaled pips',async()=>{
 const data=fixture('JPY=X');data.quoteBasis='bar-close';mockMarket(data);
 render(<MarketInstrumentDetail symbol="JPY=X" onBack={vi.fn()}/>);
 const heading=await screen.findByRole('heading',{name:'USD / JPY'});
 expect(within(heading.closest('header')!).getByText('154,123')).toBeVisible();expect(screen.getByText('123,4 pips')).toBeVisible();
 await screen.findByRole('application',{name:'Velas japonesas 4H de JPY=X'});
 expect(screen.getByLabelText('Datos de la vela seleccionada')).toHaveTextContent('154,123');expect(screen.queryByRole('button',{name:'Mostrar volumen'})).toBeNull();
 expect(screen.getByText('JPY por 1 USD. Corte diario: UTC.')).toBeVisible();expect(screen.getByText('Cierre de la última barra · 5 min')).toBeVisible();
});

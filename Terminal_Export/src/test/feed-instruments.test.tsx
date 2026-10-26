import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {FeedView} from '../components/MarketPanels';
import {TreasuryCard,FeedQuoteStamp} from '../components/FeedCards';
import AssetSession from '../components/AssetSession';
import AssetOverview from '../components/AssetOverview';
import AssetCandles from '../components/AssetCandles';
import type {AssetSnapshot} from '../../../supabase/functions/analyze-ticker/asset-snapshot';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api,accountApi:async()=>({groups:(await import('../../../supabase/functions/analyze-ticker/feed-preferences')).defaultFeedPreferences()})}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:'feed-instruments-user'})}));

it('opens every index and ETF through the watchlist asset route without enabling unrelated quote groups',async()=>{
 const quote=(symbol:string,label:string)=>({symbol,label,price:100,currency:'USD',date:'2026-10-16',change:1,session:'closed'});
 api.mockImplementation(async(_url:string,init:RequestInit)=>({ok:true,json:async()=>JSON.parse(init.body as string).panel==='feedMarkets'?{groups:[{label:'ÍNDICES',items:[quote('^KS11','KOSPI · Corea del Sur'),quote('NQ=F','Nasdaq 100 · Futuro')]},{label:'ETF PRINCIPALES',items:[quote('QQQ','Nasdaq 100 · QQQ')]},{label:'DIVISAS Y ACTIVOS DIGITALES',items:[{...quote('EURUSD=X','EUR/USD'),price:1.16473}]},{label:'MATERIAS PRIMAS',items:[quote('GC=F','Oro'),quote('BZ=F','Petróleo Brent'),{...quote('SGX-IODEX','Hierro · IODEX'),displaySymbol:'FEF',contractLabel:'Nov-26'}]}],treasury:[],earnings:[],fetchedAt:'2026-10-16T21:00Z'}:{headlines:[],geopolitics:[],fetchedAt:'2026-10-16T21:00Z'}}));
 const select=vi.fn();render(<FeedView stocks={[]} data={null} onChange={vi.fn()} onSelect={select}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Abrir ficha de KOSPI · Corea del Sur'}));expect(select).toHaveBeenLastCalledWith('^KS11');
 fireEvent.click(screen.getByRole('button',{name:'Abrir ficha de Nasdaq 100 · Futuro'}));expect(select).toHaveBeenLastCalledWith('NQ=F');
 fireEvent.click(screen.getByRole('button',{name:'Abrir ficha de Nasdaq 100 · QQQ'}));expect(select).toHaveBeenLastCalledWith('QQQ');
 fireEvent.click(screen.getByRole('button',{name:'Abrir ficha de EUR/USD'}));expect(select).toHaveBeenLastCalledWith('EURUSD=X');expect(screen.getByText('1,16473 USD')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Abrir ficha de Oro'})).toBeNull();
 for(const symbol of ['KOSPI','NQ','QQQ','EURUSD','GC','BZ','FEF'])expect(screen.getAllByText(symbol,{exact:true})[0]).toBeVisible();
 for(const symbol of ['^KS11','NQ=F','EURUSD=X','GC=F','BZ=F'])expect(screen.queryByText(symbol,{exact:true})).toBeNull();
 expect(screen.getAllByText('Futuros').length).toBeGreaterThan(0);
 expect(screen.getByText('SGX · Nov-26')).toBeVisible();expect(screen.queryByText('SGX-IODEX',{exact:true})).toBeNull();
});

it('labels three-month, six-month and one-year yields and draws only a curve with one common observation date',()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
 const points=[.25,.5,1,2,5,10,20].map(years=>({years,yield:4,date:'2026-10-16',changeBp:2}));
 const {rerender}=render(<TreasuryCard points={points}/>);
 expect(screen.getByText('3 meses')).toBeVisible();expect(screen.getByText('6 meses')).toBeVisible();expect(screen.getByText('1 año')).toBeVisible();
 for(const id of ['US03MY','US06MY','US01Y','US02Y','US05Y','US10Y','US20Y'])expect(screen.getByText(id,{exact:true})).toBeVisible();
 expect(screen.getByText('Rendimientos CMT diarios')).toBeVisible();expect(screen.getByText('US10Y')).toHaveAttribute('title',expect.stringContaining('No es un bono negociable'));
 expect(screen.queryByText(/Curva pendiente/)).toBeNull();
 rerender(<TreasuryCard points={points.map((p,i)=>i===0?{...p,date:'2026-10-15'}:p)}/>);
 expect(screen.getByText(/Curva pendiente de una fecha común/)).toBeVisible();
 vi.unstubAllGlobals();
});

it('does not present a dated spot close as an intraday market quote when the provider has no exact timestamp',()=>{
 const quote={symbol:'XAUUSD=X',label:'Oro al contado',price:4200,change:1,currency:'USD',date:'2026-10-23',session:'regular',at:null,delaySeconds:null,priceKind:'quote',reference:'previous-close'} as const;
 const {rerender}=render(<FeedQuoteStamp quote={quote}/>);expect(screen.getByText('Cierre de referencia · 2026-10-23')).toBeVisible();expect(screen.queryByText(/MARKET/)).toBeNull();
 rerender(<FeedQuoteStamp quote={{...quote,price:null}}/>);expect(screen.getByText('Sin cotización')).toBeVisible();
});

const snapshot:AssetSnapshot={symbol:'^GSPC',name:'S&P 500',description:'Índice de referencia.',currency:'USD',exchange:'SNP',timezone:'America/New_York',price:100,change:1,quoteAt:'2026-10-16T20:00Z',candles:[{time:Date.parse('2026-10-16T13:30Z'),open:99,high:101,low:98,close:100,volume:null}],session:'Sesión regular',news:[],newsSince:'2026-10-15T20:00Z',fetchedAt:'2026-10-16T20:00Z',instrument:{kind:'index',priceUnit:'pts',volumeUnit:'unavailable'},sessionStats:{date:'2026-10-16',partial:false,open:99,high:101,low:98,previousClose:99,volume:null,averageVolume20:null,volumeRatio:null,rangePercent:3.03,gapPercent:0,vol20:12,atr14:2,riskDate:'2026-10-16'}};
it('shows dated index session metrics in points without fabricated contracts or an unsupported report action',()=>{
 const {container}=render(<><AssetOverview symbol={snapshot.symbol} data={snapshot} onAnalyze={vi.fn()}/><AssetSession data={snapshot}/></>);
 expect(screen.queryByRole('button',{name:'Analizar ^GSPC'})).toBeNull();expect(screen.getByText('2026-10-16 · Última sesión disponible')).toBeVisible();
 expect(within(screen.getByLabelText('Actividad de la última sesión')).getByText('Cierre anterior')).toBeVisible();
 expect(container.textContent).not.toMatch(/Contratos|Volumen negociado/);expect(screen.getAllByText('pts').length).toBeGreaterThan(0);
});
it('uses an index chart without a fabricated volume histogram',()=>{
 const {container}=render(<AssetCandles data={snapshot}/>);
 expect(screen.getByRole('application',{name:'Velas japonesas 4H de ^GSPC'})).toBeVisible();
 expect(container.textContent).not.toMatch(/VOLUMEN|Vol\./);
});

import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useState} from 'react';
import Index,{ReportView} from '../pages/Index';

const state=vi.hoisted(()=>({api:vi.fn(),account:vi.fn(),stream:vi.fn(),fetchEtf:vi.fn()}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:state.api,accountApi:state.account}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:'earnings-navigation',isAdmin:false})}));
vi.mock('@/lib/analyze',()=>({streamAnalysis:state.stream,streamSectorAnalysis:vi.fn(),fetchMarketData:vi.fn(async()=>null)}));
vi.mock('@/lib/etf-api',()=>({fetchEtfData:state.fetchEtf}));
vi.mock('@/components/MarketPanels',()=>({FeedView:()=>null,BusinessView:()=>null,InstitutionalView:()=>null,NewsView:()=>null}));
vi.mock('@/components/IndexChartsPanel',()=>({default:()=>null}));
vi.mock('@/components/charts/InstrumentPriceChart',()=>({InstrumentPriceChart:()=>null}));
vi.mock('@/components/AssetInsightsPanel',()=>({default:()=>null}));
vi.mock('@/components/ReportQuote',()=>({default:()=>null}));
vi.mock('@/components/AnalyticsSuggestions',()=>({default:()=>null}));
vi.mock('@/components/EarningsReview',()=>({default:({symbol}:{symbol:string})=><section aria-label={`Resultados publicados de ${symbol}`}>Cifras publicadas de {symbol}</section>}));
const instrument=(symbol:string,type='stock')=>({symbol,providerSymbol:symbol,name:`Empresa ${symbol}`,exchange:'NASDAQ',currency:'USD',isin:null,type,primary:true});

beforeEach(()=>{
 state.api.mockReset();state.account.mockReset();state.stream.mockReset();state.fetchEtf.mockReset();
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});
 state.account.mockImplementation(async(action:string)=>action==='getWatchlist'?{symbols:[]}:action==='researchList'?{items:[]}:{unread:0});
 state.fetchEtf.mockResolvedValue({found:false});
 state.api.mockImplementation(async(_url,init)=>{const body=JSON.parse(init.body);return {ok:true,json:async()=>({status:'resolved',instrument:instrument(body.query.toUpperCase()),candidates:[]})};});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('shows one results section immediately after summary for older reports and opens it from the visible header shortcut',async()=>{
 function Report(){const [section,select]=useState('Resumen Ejecutivo');return <ReportView ticker="AAA" content="## Resumen Ejecutivo\nInforme guardado anterior a la nueva pestaña." quarterlyData={[]} isLoading={false} activeSection={section} onSelectSection={select}/>;}
 render(<Report/>);
 const navigation=screen.getByRole('navigation',{name:'Secciones del informe de AAA'}),buttons=within(navigation).getAllByRole('button');
 expect(buttons.slice(0,2).map(button=>button.textContent)).toEqual(['RESUMEN EJECUTIVO','ÚLTIMOS RESULTADOS']);
 expect(within(navigation).getAllByRole('button',{name:'ÚLTIMOS RESULTADOS'})).toHaveLength(1);
 expect(navigation).toHaveClass('flex-wrap');
 fireEvent.click(screen.getByRole('button',{name:'Ver últimos resultados de AAA'}));
 expect(await screen.findByRole('region',{name:'Resultados publicados de AAA'})).toBeVisible();
 expect(within(navigation).getByRole('button',{name:'ÚLTIMOS RESULTADOS'})).toHaveAttribute('aria-current','page');
});

it('opens results directly from TICKER search without generating a full report',async()=>{
 render(<Index/>);fireEvent.click(screen.getByRole('button',{name:'TICKER'}));
 const shortcut=screen.getByRole('button',{name:'ÚLTIMOS RESULTADOS'});expect(shortcut).toBeVisible();expect(shortcut).toBeDisabled();
 fireEvent.change(screen.getByPlaceholderText('TICKER — AAPL, MSFT, NVDA, ASML...'),{target:{value:'AAA'}});fireEvent.click(shortcut);
 expect(await screen.findByRole('region',{name:'Resultados publicados de AAA'})).toBeVisible();
 expect(state.stream).not.toHaveBeenCalled();expect(state.fetchEtf).not.toHaveBeenCalled();
 expect(JSON.parse(state.api.mock.calls[0][1].body)).toEqual({panel:'instrumentSearch',query:'AAA'});
 fireEvent.click(screen.getByRole('button',{name:'RESUMEN EJECUTIVO'}));expect(screen.getByRole('navigation',{name:'Secciones del informe de AAA'})).toBeVisible();
});

it('keeps the results action when an ambiguous company search requires choosing a listing',async()=>{
 state.api.mockImplementation(async(_url,init)=>{const query=JSON.parse(init.body).query;return {ok:true,json:async()=>query==='ACME CHOICE'?{status:'ambiguous',candidates:[instrument('ACM1'),instrument('ACM2')]}:{status:'resolved',instrument:instrument(query),candidates:[]}};});
 render(<Index/>);fireEvent.click(screen.getByRole('button',{name:'TICKER'}));fireEvent.change(screen.getByPlaceholderText('TICKER — AAPL, MSFT, NVDA, ASML...'),{target:{value:'Acme Choice'}});fireEvent.click(screen.getByRole('button',{name:'ÚLTIMOS RESULTADOS'}));
 fireEvent.click(await screen.findByRole('button',{name:/ACM2 NASDAQ/}));
 expect(await screen.findByRole('region',{name:'Resultados publicados de ACM2'})).toBeVisible();expect(state.stream).not.toHaveBeenCalled();
});

it('routes funds to the existing ETF action instead of presenting company earnings',async()=>{
 state.api.mockResolvedValue({ok:true,json:async()=>({status:'resolved',instrument:instrument('TESTFUND','etf'),candidates:[]})});
 render(<Index/>);fireEvent.click(screen.getByRole('button',{name:'TICKER'}));fireEvent.change(screen.getByPlaceholderText('TICKER — AAPL, MSFT, NVDA, ASML...'),{target:{value:'TESTFUND'}});fireEvent.click(screen.getByRole('button',{name:'ÚLTIMOS RESULTADOS'}));
 expect(await screen.findByRole('button',{name:'ANALIZAR EN ETF'})).toBeVisible();expect(screen.queryByRole('region',{name:'Resultados publicados de TESTFUND'})).toBeNull();expect(state.stream).not.toHaveBeenCalled();
});

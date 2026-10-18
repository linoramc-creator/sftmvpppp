import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import SectorActivity,{extractSectorActivityPeers} from '@/components/SectorActivity';
const state=vi.hoisted(()=>({api:vi.fn(),account:'sector-owner'}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:state.api}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:state.account})}));
const report=`## Visión del Sector
Contexto.
## Empresas Líderes
### Tabla de Empresas Líderes
| Empresa | Ticker | País |
| --- | --- | --- |
| **Alpha Research (AAA)** | NASDAQ:AAA | EE. UU. |
| Beta Research | bbb | España |
| Otra fila duplicada | AAA | EE. UU. |
## Mejores ETFs
| Empresa | Ticker | País |
| Core Fund | FUND | EE. UU. |
`;
const company=(symbol:string,currency='USD')=>({symbol,name:symbol==='AAA'?'Alpha Research Corporation':'Beta Research Corporation',currency,date:'2026-10-16',price:100,volume:1000,turnover:100000,relativeVolume:1,change1d:1,return20:3,volatility20:20,aboveMa50:true});
const group=(symbol:string,currency:string)=>({currency,date:'2026-10-16',companies:[company(symbol,currency)],knownTurnover:100000,completeTurnover:true,volumeObserved:1,breadth:{advancing:1,declining:0,unchanged:0,observed:1,aboveMa50:1,trendObserved:1},benchmark:null,chart:[],activity:[]});
const response=(sector:string)=>({sector,fetchedAt:'2026-10-18T10:00:00Z',requested:2,verified:2,groups:[group('AAA','USD'),group('BBB','EUR')],excluded:[],note:'Importe negociado aproximado; no flujos netos ni compras institucionales.'});
beforeEach(()=>{state.api.mockReset();state.account='sector-owner';state.api.mockImplementation(async(_url:string,init:RequestInit)=>({ok:true,json:async()=>response(JSON.parse(String(init.body)).subject)}));});
afterEach(()=>cleanup());

it('extracts and deduplicates only listed companies from the leader table of a free-sector report',()=>{
 expect(extractSectorActivityPeers(report)).toEqual([{symbol:'AAA',name:'Alpha Research (AAA)'},{symbol:'BBB',name:'Beta Research'}]);
 expect(extractSectorActivityPeers('## Empresas Líderes\nNo hay tabla verificable.')).toEqual([]);
 expect(extractSectorActivityPeers(report.replace('Beta Research','<script>bad</script>'))).toHaveLength(1);
});

it('does not issue requests during report generation or when the report has no verified ticker rows',async()=>{
 const page=render(<SectorActivity sector="Biotecnología de precisión" report={report} isLoading/>);
 expect(screen.getByText(/se preparará al completar el informe/)).toBeVisible();expect(state.api).not.toHaveBeenCalled();
 page.rerender(<SectorActivity sector="Biotecnología de precisión" report="## Empresas Líderes\nSin tabla."/>);
 expect(screen.getByText(/tickers verificables/)).toBeVisible();expect(state.api).not.toHaveBeenCalled();
});

it('requests the free-sector candidates once and keeps currency amounts in separate samples',async()=>{
 render(<SectorActivity sector="Actividad libre de prueba" report={report}/>);
 await screen.findByText('Alpha Research Corporation');
 expect(state.api).toHaveBeenCalledTimes(1);
 expect(JSON.parse(state.api.mock.calls[0][1].body)).toEqual({panel:'sectorActivity',subject:'Actividad libre de prueba',peers:[{symbol:'AAA',name:'Alpha Research (AAA)'},{symbol:'BBB',name:'Beta Research'}]});
 expect(screen.queryByText('Beta Research Corporation')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'EUR · 1 empresas'}));
 expect(screen.getByText('Beta Research Corporation')).toBeVisible();expect(screen.queryByText('Alpha Research Corporation')).not.toBeInTheDocument();
 expect(screen.getByText(/no flujos netos ni compras institucionales/)).toBeVisible();
});

it('reuses the public result for the account on remount and calculates the actual even-sample median',async()=>{
 state.api.mockResolvedValue({ok:true,json:async()=>{const data=response('Sector mediana');data.groups=[{...group('AAA','USD'),companies:[{...company('AAA'),relativeVolume:1},{...company('BBB'),relativeVolume:3}],knownTurnover:200000,volumeObserved:2}];return data;}});
 const page=render(<SectorActivity sector="Sector mediana" report={report}/>);await screen.findByText('Alpha Research Corporation');expect(screen.getByText('2×')).toBeVisible();
 page.unmount();render(<SectorActivity sector="Sector mediana" report={report}/>);await screen.findByText('Alpha Research Corporation');expect(state.api).toHaveBeenCalledTimes(1);
});

it('offers a meaningful retry on source failure and can show the recovered result',async()=>{
 state.api.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>response('Sector error')});
 render(<SectorActivity sector="Sector error" report={report}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido actualizar');
 fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByText('Alpha Research Corporation');
 await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(2));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

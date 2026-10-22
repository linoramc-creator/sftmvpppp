import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import SectorComparables,{stripComparisonTable} from '../components/SectorComparables';
const state=vi.hoisted(()=>({api:vi.fn(),account:0}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:state.api}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:'comparables-'+state.account})}));
beforeEach(()=>{state.api.mockReset();state.account++;});afterEach(cleanup);
const company=(symbol:string,patch:Record<string,unknown>={})=>({symbol,name:symbol+' Real Company',country:'EE. UU.',sector:'Industrials',industry:'Electrical Equipment',currency:'USD',capitalCurrency:'USD',financialCurrency:'USD',issuerId:symbol,quoteAt:'2026-10-21T20:00:00Z',recordDate:'2026-10-21',subject:symbol==='VRT',price:100,marketCap:1200000000,pe:25,forwardPe:null,pb:null,evEbitda:14,roe:12,netMargin:8,revenueGrowth:20,beta:null,...patch});
const data=(subject='VRT',mode='ticker')=>({subject,mode,fetchedAt:'2026-10-22T10:00:00Z',basis:'industry',reference:null,companies:[company('VRT',{pb:3}),company('PEER'),company('OTHER',{price:null,quoteAt:null})],note:'Empresas de la misma industria; sus actividades pueden diferir.'});
it('shows contemporaneous verified company metrics even when one price is unavailable, without empty columns or invented returns',async()=>{
 state.api.mockResolvedValue({ok:true,json:async()=>data()});render(<SectorComparables subject="VRT"/>);
 await screen.findByText('VRT · activo analizado');expect(JSON.parse(state.api.mock.calls[0][1].body)).toEqual({panel:'sectorComparables',subject:'VRT',sector:false,peers:[]});
 expect(screen.getByText('OTHER Real Company')).toBeVisible();expect(screen.getAllByText('Fundamentales 2026-10-21')).toHaveLength(3);
 expect(screen.getByRole('columnheader',{name:'PER · TTM'})).toBeVisible();expect(screen.queryByRole('columnheader',{name:'PER previsto'})).toBeNull();expect(screen.queryByRole('columnheader',{name:'Beta'})).toBeNull();
 const other=screen.getByText('OTHER Real Company').closest('tr')!;expect(within(other).getByText('25,00×')).toBeVisible();expect(within(other).getByText('Cotización —')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Más métricas'}));expect(screen.getByRole('columnheader',{name:'Precio / patrimonio'})).toBeVisible();expect(screen.queryByRole('columnheader',{name:'PER previsto'})).toBeNull();
 expect(screen.queryByText(/52W Return|N\/D|Finnhub|EODHD/)).toBeNull();
});
it('verifies report candidates for a customised sector and retains narrative after replacing the model table',async()=>{
 const report='## Empresas Líderes\n### Tabla de Empresas Líderes\n| Empresa | Ticker | País |\n| --- | --- | --- |\n| SAP SE | SAP.DE | Alemania |\n| ASML Holding | ASML.AS | Países Bajos |\n\nSAP mantiene una posición relevante.\n## Mejores ETFs\nTexto.';
 state.api.mockResolvedValue({ok:true,json:async()=>({...data('Software europeo','sector'),companies:[company('SAP.DE',{name:'SAP SE',currency:'EUR',capitalCurrency:'EUR',subject:false})],basis:'related'})});
 render(<SectorComparables subject="Software europeo" sector report={report}>{verified=><p>{verified?'Tabla verificada preparada':'Conservando informe previo'}</p>}</SectorComparables>);
 await screen.findByText('Tabla verificada preparada');expect(JSON.parse(state.api.mock.calls[0][1].body).peers).toEqual([{symbol:'SAP.DE',name:'SAP SE'},{symbol:'ASML.AS',name:'ASML Holding'}]);
 const stripped=stripComparisonTable(report);expect(stripped).not.toMatch(/Tabla de Empresas|\| Empresa|\| SAP SE/);expect(stripped).toContain('SAP mantiene una posición relevante.');expect(stripped).toContain('## Mejores ETFs');
});
it('does not load comparison data while a report is being generated',()=>{
 render(<SectorComparables subject="WAIT" isLoading/>);expect(state.api).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('al completar el informe');
});
it('removes model comparison tables with alternative headers while preserving adjacent prose',()=>{
 for(const heading of ['Empresa','Compañía','Company','Nombre','Ticker','Symbol','Símbolo']){
  const raw=`## Sector\n### Tabla comparativa\n\n| ${heading} | Valor |\n| :--- | ---: |\n| Incompleta | N/D |\n\nDescripción del sector.\n`;
  expect(stripComparisonTable(raw)).toBe('## Sector\n\nDescripción del sector.');
 }
});
it('provides retry on an actual data failure while preserving the previous narrative',async()=>{
 state.api.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>data('RETRY')});
 render(<SectorComparables subject="RETRY">{verified=><p>{verified?'Nueva tabla':'Narrativa original'}</p>}</SectorComparables>);
 await screen.findByRole('alert');expect(screen.getByText('Narrativa original')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByText('Nueva tabla');expect(state.api).toHaveBeenCalledTimes(2);
});
it('cannot show a previous sector or its verified children while a new sector report is streaming',async()=>{
 state.api.mockResolvedValue({ok:true,json:async()=>data('Primer sector','sector')});
 const page=render(<SectorComparables subject="Primer sector" sector>{verified=><p>{verified?'Actividad del primer sector':'Sin datos'}</p>}</SectorComparables>);
 await screen.findByText('VRT Real Company');expect(screen.getByText('Actividad del primer sector')).toBeVisible();
 page.rerender(<SectorComparables subject="Segundo sector" sector isLoading>{verified=><p>{verified?'Actividad vieja incorrecta':'Esperando datos nuevos'}</p>}</SectorComparables>);
 expect(screen.queryByText('VRT Real Company')).toBeNull();expect(screen.queryByText('Actividad vieja incorrecta')).toBeNull();expect(screen.queryByText('Esperando datos nuevos')).toBeNull();expect(state.api).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('status')).toHaveTextContent('al completar el informe');
});

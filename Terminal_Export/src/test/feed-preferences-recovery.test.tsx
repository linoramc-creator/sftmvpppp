import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FeedView} from '../components/MarketPanels';
import {defaultFeedPreferences} from '../../../supabase/functions/analyze-ticker/feed-preferences';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),account:vi.fn()}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:mocks.fetch,accountApi:mocks.account}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:'feed-preference-recovery'})}));
afterEach(cleanup);

it('resynchronizes saved preferences on retry after a change from another session',async()=>{
 let loads=0;const groups={...defaultFeedPreferences(),indices:['^FTSE']};
 mocks.account.mockImplementation(async()=>({groups:++loads===1?defaultFeedPreferences():groups}));
 mocks.fetch.mockImplementation(async(_url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));
  if(body.panel==='feedNews')return {ok:true,json:async()=>({headlines:[],geopolitics:[],fetchedAt:'2026-10-20T07:00Z'})};
  if(body.feedGroups.indices.includes('^GSPC'))return {ok:false,status:409};
  return {ok:true,json:async()=>({groups:[{label:'ÍNDICES',items:[{symbol:'^FTSE',label:'FTSE 100',price:100,change:1,currency:'GBP',date:'2026-10-20',session:'regular'}]}],treasury:[],earnings:[],fetchedAt:'2026-10-20T07:00Z'})};
 });
 render(<FeedView stocks={[]} data={null} onChange={vi.fn()} onSelect={vi.fn()}/>);
 await screen.findByText('No se ha podido actualizar. Inténtalo de nuevo.');fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));
 await screen.findByRole('button',{name:'Abrir ficha de FTSE 100'});expect(loads).toBe(2);
 await waitFor(()=>expect(mocks.fetch.mock.calls.filter(([,init])=>JSON.parse(String(init.body)).panel==='feedMarkets')).toHaveLength(2));
});

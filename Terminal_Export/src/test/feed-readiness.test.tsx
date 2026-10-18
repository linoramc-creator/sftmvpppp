import {act,render,waitFor} from '@testing-library/react';
import {FeedView} from '@/components/MarketPanels';
import {TerminalEntryProvider,type FeedReadiness} from '@/lib/terminal-entry';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));

it('loads news immediately but waits for personal watchlist, its actual market response and the ticker bar',async()=>{
 const requests:{panel:string;subject:string;resolve:(response:unknown)=>void}[]=[];
 api.mockImplementation((_url:string,init:RequestInit)=>new Promise(resolve=>requests.push({...JSON.parse(String(init.body)),resolve})));
 const report=vi.fn(),entry={sessionId:'entry-person-one',attempt:0,report};
 const view=(watchlistReady:boolean,tickerReady:boolean)=><TerminalEntryProvider value={entry}><FeedView stocks={['ENTRY-A']} data={null} onChange={vi.fn()} onSelect={vi.fn()} watchlistReady={watchlistReady} tickerReady={tickerReady}/></TerminalEntryProvider>;
 const mounted=render(view(false,false));
 expect(requests.map(r=>r.panel)).toEqual(['feedNews']);
 await act(async()=>requests[0].resolve({ok:true,json:async()=>({headlines:[],geopolitics:[],fetchedAt:'2026-10-18T07:00:00Z'})}));
 expect(report.mock.calls.some(([, ,state]:[string,number,FeedReadiness])=>state.status==='ready')).toBe(false);
 mounted.rerender(view(true,false));
 await waitFor(()=>expect(requests).toHaveLength(2));expect(requests[1].panel).toBe('feedMarkets');expect(requests[1].subject).toBe('ENTRY-A');
 await act(async()=>requests[1].resolve({ok:true,json:async()=>({groups:[],treasury:[],earnings:[],fetchedAt:'2026-10-18T07:00:00Z'})}));
 expect(report.mock.calls.some(([, ,state]:[string,number,FeedReadiness])=>state.status==='ready')).toBe(false);
 mounted.rerender(view(true,true));
 await waitFor(()=>expect(report).toHaveBeenLastCalledWith('entry-person-one',0,{status:'ready',detail:'Tu feed está preparado.'}));
 mounted.rerender(<TerminalEntryProvider value={{...entry,sessionId:'entry-person-two'}}><FeedView stocks={['ENTRY-B']} data={null} onChange={vi.fn()} onSelect={vi.fn()} watchlistReady tickerReady/></TerminalEntryProvider>);
 await waitFor(()=>expect(requests).toHaveLength(3));
 const secondCalls=report.mock.calls.filter(([id])=>id==='entry-person-two');
 expect(secondCalls.some(([, ,state]:[string,number,FeedReadiness])=>state.status==='ready')).toBe(false);
 await act(async()=>requests[2].resolve({ok:false}));
 await waitFor(()=>expect(report).toHaveBeenLastCalledWith('entry-person-two',0,{status:'error',detail:'No se han podido cargar los datos de mercado.'}));
});

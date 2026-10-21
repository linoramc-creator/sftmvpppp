import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import BondsCreditNews from '../components/BondsCreditNews';
import KeepPanel from '../components/KeepPanel';
const api=vi.hoisted(()=>vi.fn());
const identity=vi.hoisted(()=>({id:'news-test'}));
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
vi.mock('../components/AuthGate',()=>({useProfile:()=>({id:identity.id})}));
afterEach(cleanup);beforeEach(()=>{identity.id=crypto.randomUUID();api.mockReset();});
const result=(subject:string,title:string)=>({subject,fetchedAt:new Date().toISOString(),articles:[{title,url:`https://article.example/${subject}`,source:'Private provider',date:'2026-10-21',image:'https://images.example/story-economy.jpg',keyPoints:['Los rendimientos suben al revisarse las expectativas de tipos.']}]});
it('keeps news independent, removes stale country content, and ignores responses after a country switch',async()=>{
 let finish:(value:unknown)=>void=()=>{};
 api.mockImplementation((_url,init)=>JSON.parse(init.body).subject==='US'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,json:async()=>result('FR','Francia actualiza su plan de deuda')}));
 const {rerender,container}=render(<BondsCreditNews subject="US" title="Noticias"/>);
 expect(screen.getByRole('status',{name:'Cargando noticias de renta fija'})).toBeVisible();
 const signal=api.mock.calls[0][1].signal as AbortSignal;
 rerender(<BondsCreditNews subject="FR" title="Noticias"/>);
 await screen.findByRole('heading',{name:'Francia actualiza su plan de deuda'});expect(signal.aborted).toBe(true);
 finish({ok:true,json:async()=>result('US','Noticia antigua de Estados Unidos')});
 await waitFor(()=>expect(screen.queryByText('Noticia antigua de Estados Unidos')).toBeNull());
 expect(container.querySelector('a')).toBeNull();expect(container.textContent).not.toContain('Private provider');
});
it('reuses the ten-minute cache for the same account and isolates another account',async()=>{
 api.mockImplementation((_url,init)=>Promise.resolve({ok:true,json:async()=>result(JSON.parse(init.body).subject,'Crédito y mercados')}));
 const first=render(<BondsCreditNews subject="private" title="Noticias"/>);await screen.findByText('Crédito y mercados');first.unmount();
 const second=render(<BondsCreditNews subject="private" title="Noticias"/>);await screen.findByText('Crédito y mercados');expect(api).toHaveBeenCalledTimes(1);
 identity.id='another-account';second.rerender(<BondsCreditNews subject="private" title="Noticias"/>);
 await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));
});
it('offers retry independently and aborts when its terminal section becomes inactive',async()=>{
 api.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>result('GB','La deuda británica reacciona a los tipos')});
 const {rerender}=render(<KeepPanel active><BondsCreditNews subject="GB" title="Noticias"/></KeepPanel>);
 fireEvent.click(await screen.findByRole('button',{name:'Reintentar noticias'}));await screen.findByText('La deuda británica reacciona a los tipos');
 const last=api.mock.calls.at(-1)![1].signal as AbortSignal;
 rerender(<KeepPanel active={false}><BondsCreditNews subject="GB" title="Noticias"/></KeepPanel>);
 expect(last.aborted).toBe(true);
});
it.each([502,503,504])('retries a transient %s response once within the same request deadline',async status=>{
 api.mockResolvedValueOnce({ok:false,status}).mockResolvedValueOnce({ok:true,status:200,json:async()=>result('GB','La deuda británica recupera liquidez')});
 render(<BondsCreditNews subject="GB" title="Noticias"/>);
 await screen.findByText('La deuda británica recupera liquidez');
 expect(api).toHaveBeenCalledTimes(2);
 expect(api.mock.calls[0][1].signal).toBe(api.mock.calls[1][1].signal);
 expect(api.mock.calls[0][1].body).toBe(api.mock.calls[1][1].body);
 expect(screen.queryByText('No se han podido actualizar las noticias.')).toBeNull();
});
it('stops after one automatic retry when the gateway remains unavailable',async()=>{
 api.mockResolvedValue({ok:false,status:503});
 render(<BondsCreditNews subject="GB" title="Noticias"/>);
 await screen.findByRole('button',{name:'Reintentar noticias'});
 expect(api).toHaveBeenCalledTimes(2);
});
it.each([401,403,429,500])('does not automatically retry a permanent or limited %s response',async status=>{
 api.mockResolvedValue({ok:false,status});
 render(<BondsCreditNews subject="GB" title="Noticias"/>);
 await screen.findByRole('button',{name:'Reintentar noticias'});
 expect(api).toHaveBeenCalledTimes(1);
});

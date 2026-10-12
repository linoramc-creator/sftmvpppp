import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({admin:true,bodies:[] as Record<string,unknown>[]}));
vi.mock('../components/AuthGate',()=>({useProfile:()=>({isAdmin:state.admin,email:'admin@example.test'})}));
vi.mock('../lib/beta-api',()=>({authenticatedFetch:vi.fn(async(_url:string,init:RequestInit)=>{const body=JSON.parse(init.body as string);state.bodies.push(body);const data=body.operation==='list'?[]:body.operation==='settings'||body.operation==='saveSettings'?{enabled:true,time:body.time??'07:00',timezone:'Europe/Madrid',mailReady:false}:body.operation==='test'?{id:'t',date:'2026-10-12',kind:'test',status:'ready',html:'<p>Report</p>',mailStatus:'unavailable',mailReady:false}: {id:null,status:'missing'};return {ok:true,json:async()=>data};})}));
import DailyBrief from '../components/DailyBrief';
beforeEach(()=>{state.admin=true;state.bodies=[];});
it('saves the selected server schedule and waits for the real watchlist to sync before a new trial',async()=>{
 let synced=false;const sync=vi.fn(async()=>{synced=true;});
 render(<DailyBrief watchlist={['NVDA','MU','TLT']} syncWatchlist={sync}/>);
 await waitFor(()=>expect(screen.getByLabelText('Hora de la edición diaria · Madrid')).toBeEnabled());
 fireEvent.change(screen.getByLabelText('Hora de la edición diaria · Madrid'),{target:{value:'08:15'}});fireEvent.click(screen.getByText('Guardar horario'));
 await screen.findByText('Horario guardado: 08:15 · Madrid');expect(state.bodies).toContainEqual({operation:'saveSettings',time:'08:15'});
 fireEvent.click(screen.getByText('Nueva prueba'));await waitFor(()=>expect(state.bodies.some(b=>b.operation==='test')).toBe(true));expect(synced).toBe(true);expect(sync).toHaveBeenCalledTimes(1);
 expect(state.bodies.find(b=>b.operation==='test')?.requestId).toMatch(/^[0-9a-f-]{36}$/);expect(screen.getByText('NVDA · MU · TLT')).toBeVisible();
});
it('does not expose brief controls or make brief requests for another user',async()=>{
 state.admin=false;const {container}=render(<DailyBrief watchlist={['NVDA']} syncWatchlist={vi.fn()}/>);expect(container).toBeEmptyDOMElement();expect(state.bodies).toHaveLength(0);
});

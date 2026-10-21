import {act,cleanup,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import InstrumentSearchResults,{useInstrumentSearch} from '../components/InstrumentSearch';
import type {InstrumentResolution,ResolvedInstrument} from '../../../supabase/functions/analyze-ticker/instrument-resolver';

const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
let clock=2_000_000_000_000;
beforeEach(()=>{clock+=7200000;vi.spyOn(Date,'now').mockImplementation(()=>clock);api.mockReset();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const instrument=(symbol:string,name:string,exchange='US',type:ResolvedInstrument['type']='stock'):ResolvedInstrument=>({symbol,name,exchange,type,providerSymbol:`${symbol}.${exchange}`,currency:'USD',isin:null,primary:exchange==='US'});
const vrt=instrument('VRT','Vertiv Holdings Co'),googl=instrument('GOOGL','Alphabet Inc.');
const result=(query:string,status:InstrumentResolution['status'],item:ResolvedInstrument|null=null,candidates:ResolvedInstrument[]=item?[item]:[]):InstrumentResolution=>({query,status,instrument:item,candidates});
const response=(value:unknown)=>({ok:true,json:async()=>value});

describe('authenticated instrument identification',()=>{
 it('retains VRT and GOOGL mappings and routes company-name resolution through the own endpoint only',async()=>{
  const direct=vi.spyOn(globalThis,'fetch');
  api.mockImplementation(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));return response(result(body.query,'resolved',body.query.includes('Alphabet')?googl:vrt));});
  const {result:hook}=renderHook(()=>useInstrumentSearch());
  let selected:ResolvedInstrument|null=null;
  await act(async()=>{selected=await hook.current.resolve('VRT');});expect(selected).toEqual(vrt);
  await act(async()=>{selected=await hook.current.resolve('Alphabet Inc.');});expect(selected).toEqual(googl);
  expect(api).toHaveBeenCalledTimes(2);
  for(const [url,init] of api.mock.calls){
   expect(url).toMatch(/\/functions\/v1\/analyze-ticker$/);
   expect(url).not.toMatch(/eodhd|googleapis|tavily|api[_-]?(?:key|token)=/i);
   expect(JSON.parse(init.body)).toEqual({panel:'instrumentSearch',query:expect.any(String)});
   expect(init.headers).toEqual({'Content-Type':'application/json'});
  }
  expect(direct).not.toHaveBeenCalled();expect(hook.current.busy).toBe(false);
 });

 it('offers ambiguous listings with their markets for the user to choose and never recommends one',async()=>{
  const london={...instrument('ABC.L','ABC plc','LSE'),providerSymbol:'ABC.LSE',currency:'GBP'},us=instrument('ABC','ABC Corp');
  api.mockResolvedValue(response(result('ABC','ambiguous',null,[us,london])));
  const {result:hook}=renderHook(()=>useInstrumentSearch());let resolved:ResolvedInstrument|null=null;
  await act(async()=>{resolved=await hook.current.resolve('ABC');});expect(resolved).toBeNull();
  const select=vi.fn(),{container}=render(<InstrumentSearchResults state={hook.current} onSelect={select}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Selecciona la cotización que quieres analizar.');
  expect(screen.getByText('US · USD')).toBeVisible();expect(screen.getByText('LSE · GBP')).toBeVisible();
  expect(container.textContent).not.toMatch(/recomend|mejor|EODHD|Gemini/i);expect(container.querySelector('a')).toBeNull();
  expect(select).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:/ABC.L.*LSE.*ABC plc/}));expect(select).toHaveBeenCalledExactlyOnceWith('ABC.L');
 });

 it('rejects empty and oversized local input without requests and handles an invalid or not-found catalog result',async()=>{
  const {result:hook}=renderHook(()=>useInstrumentSearch());
  await act(async()=>{expect(await hook.current.resolve('   ')).toBeNull();});
  await act(async()=>{expect(await hook.current.resolve('X'.repeat(101))).toBeNull();});
  expect(api).not.toHaveBeenCalled();expect(hook.current.message).toBe('Introduce un nombre o símbolo válido.');
  for(const status of ['invalid','not-found'] as const){api.mockResolvedValueOnce(response(result(status,status)));await act(async()=>{expect(await hook.current.resolve(status)).toBeNull();});expect(hook.current.candidates).toEqual([]);expect(hook.current.message).toMatch(/No se ha identificado/);}
 });

 it('uses the one-hour normalized-query cache across hook instances and retries after expiry',async()=>{
  api.mockResolvedValue(response(result('GOOGL','resolved',googl)));
  const first=renderHook(()=>useInstrumentSearch());
  await act(async()=>{expect(await first.result.current.resolve('GOOGL')).toEqual(googl);});first.unmount();
  const second=renderHook(()=>useInstrumentSearch());
  await act(async()=>{expect(await second.result.current.resolve(' googl ')).toEqual(googl);});expect(api).toHaveBeenCalledTimes(1);
  clock+=3600001;
  await act(async()=>{expect(await second.result.current.resolve('GOOGL')).toEqual(googl);});expect(api).toHaveBeenCalledTimes(2);
 });

 it('does not cache catalog outages and only preserves a literal ticker, never a company name containing spaces',async()=>{
  api.mockImplementation(async(_url:string,init:RequestInit)=>response(result(JSON.parse(String(init.body)).query,'unavailable')));
  const {result:hook}=renderHook(()=>useInstrumentSearch());
  await act(async()=>{expect((await hook.current.resolve('VRT'))?.symbol).toBe('VRT');});
  await act(async()=>{expect((await hook.current.resolve('VRT'))?.symbol).toBe('VRT');});expect(api).toHaveBeenCalledTimes(2);
  await act(async()=>{expect(await hook.current.resolve('Vertiv Holdings Co')).toBeNull();});
  expect(hook.current.message).toMatch(/búsqueda no está disponible/);expect(hook.current.candidates).toEqual([]);
 });

 it('ignores an old response after a newer query, while aborting the old request',async()=>{
  let finish!:(value:unknown)=>void;
  api.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(response(result('GOOGL','resolved',googl)));
  const {result:hook}=renderHook(()=>useInstrumentSearch());let first!:Promise<ResolvedInstrument|null>;
  act(()=>{first=hook.current.resolve('VRT');});expect(hook.current.busy).toBe(true);
  const signal=api.mock.calls[0][1].signal as AbortSignal;
  await act(async()=>{expect(await hook.current.resolve('GOOGL')).toEqual(googl);});expect(signal.aborted).toBe(true);
  await act(async()=>{finish(response(result('VRT','ambiguous',null,[vrt,googl])));expect(await first).toBeNull();});
  expect(hook.current.query).toBe('GOOGL');expect(hook.current.message).toBe('');expect(hook.current.candidates).toEqual([]);expect(hook.current.busy).toBe(false);
 });

 it('aborts an in-flight lookup on unmount without publishing its eventual result',async()=>{
  let finish!:(value:unknown)=>void;api.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const hook=renderHook(()=>useInstrumentSearch());let pending!:Promise<ResolvedInstrument|null>;
  act(()=>{pending=hook.result.current.resolve('VRT');});const signal=api.mock.calls[0][1].signal as AbortSignal;
  hook.unmount();expect(signal.aborted).toBe(true);finish(response(result('VRT','resolved',vrt)));expect(await pending).toBeNull();
 });

 it('does not cache malformed resolved payloads or allow injected symbols, and keeps safe candidates',async()=>{
  api.mockResolvedValueOnce(response(result('VRT','resolved',null))).mockResolvedValueOnce(response(result('VRT','resolved',vrt)));
  const {result:hook}=renderHook(()=>useInstrumentSearch());
  await act(async()=>{expect(await hook.current.resolve('VRT')).toBeNull();});expect(hook.current.message).toMatch(/No se ha podido comprobar/);
  await act(async()=>{expect(await hook.current.resolve('VRT')).toEqual(vrt);});expect(api).toHaveBeenCalledTimes(2);
  api.mockResolvedValueOnce(response(result('BAD','resolved',{...vrt,symbol:'<script>'})));
  await act(async()=>{expect(await hook.current.resolve('BAD')).toBeNull();});
  api.mockResolvedValueOnce(response({query:'MIXED',status:'ambiguous',instrument:null,candidates:[null,{...vrt,type:'forex'},googl]}));
  await act(async()=>{expect(await hook.current.resolve('MIXED')).toBeNull();});expect(hook.current.candidates).toEqual([googl]);
 });

 it('keeps failed HTTP lookups explicit rather than silently inventing a listing',async()=>{
  api.mockResolvedValueOnce({ok:false,status:503});const {result:hook}=renderHook(()=>useInstrumentSearch());
  await act(async()=>{expect(await hook.current.resolve('VRT')).toBeNull();});expect(hook.current.message).toMatch(/No se ha podido comprobar/);expect(hook.current.busy).toBe(false);
 });
});

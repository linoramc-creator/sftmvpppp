import {it,expect,vi,afterEach} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}}}));
import {accountApi} from '../lib/beta-api';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('ordinary actions can time out without aborting an in-flight Pro summary, and neither action starts a retry',async()=>{
 const deadlines=new Map<number,AbortController[]>(),resolve=new Map<string,(response:Response)=>void>();
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();deadlines.set(ms,[...(deadlines.get(ms)??[]),controller]);return controller.signal;});
 const fetcher=vi.fn((_url,init)=>new Promise<Response>((yes,no)=>{const action=JSON.parse(init.body).accountAction;resolve.set(action,yes);init.signal.addEventListener('abort',()=>no(new DOMException('Aborted','AbortError')),{once:true});}));vi.stubGlobal('fetch',fetcher);
 const summary=accountApi('summarizeReport',{id:'saved-report'}),ordinary=accountApi('reports');
 const rejected=expect(ordinary).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 expect(deadlines.has(85000)).toBe(true);expect(deadlines.has(20000)).toBe(true);deadlines.get(20000)![0].abort();await rejected;
 expect(deadlines.get(85000)![0].signal.aborted).toBe(false);resolve.get('summarizeReport')!(Response.json({summary:'Resumen completo'}));await expect(summary).resolves.toEqual({summary:'Resumen completo'});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('explicit caller cancellation is combined with the summary deadline without issuing another billable request',async()=>{
 const caller=new AbortController();let forwarded:AbortSignal|null=null;
 const fetcher=vi.fn((_url,init)=>{forwarded=init.signal;return new Promise<Response>((_yes,no)=>init.signal.addEventListener('abort',()=>no(new DOMException('Aborted','AbortError')),{once:true}));});vi.stubGlobal('fetch',fetcher);
 const pending=accountApi('summarizeReport',{id:'saved-report'},{signal:caller.signal}),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());caller.abort();await rejected;expect(forwarded!.aborted).toBe(true);expect(fetcher).toHaveBeenCalledOnce();
});

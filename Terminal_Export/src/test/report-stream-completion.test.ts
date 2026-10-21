import {it,expect,vi,beforeEach} from 'vitest';
const api=vi.hoisted(()=>vi.fn());vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
import {streamAnalysis,streamSectorAnalysis} from '../lib/analyze';
beforeEach(()=>api.mockReset());
const event=(value:unknown)=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n';
const chunk=(content:string,finish_reason:string|null=null)=>({choices:[{index:0,delta:{content},finish_reason}]});
function response(text:string,fragment=17){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=fragment)controller.enqueue(bytes.slice(i,i+fragment));controller.close();}}));}
it('accepts fragmented UTF-8 reports only after a proper stop and DONE, keeping structured metadata separate',async()=>{
 const onDelta=vi.fn(),onDone=vi.fn(),onError=vi.fn(),onQuarterlyData=vi.fn();
 api.mockResolvedValue(response(': keepalive\n\n'+event({__quarterly:[{period:'Q2 2026'}]})+event(chunk('Análisis de energía y crédito.'))+event(chunk('','stop'))+event('[DONE]')));
 await streamAnalysis({ticker:'SPY',onDelta,onDone,onError,onQuarterlyData});
 expect(onDelta.mock.calls.flat().join('')).toBe('Análisis de energía y crédito.');expect(onQuarterlyData).toHaveBeenCalledWith([{period:'Q2 2026'}]);expect(onDone).toHaveBeenCalledTimes(1);expect(onError).not.toHaveBeenCalled();expect(api).toHaveBeenCalledTimes(1);
});
it.each(['length','content_filter','tool_calls'])('rejects %s even when the provider sends DONE after a long partial report, without retrying generation',async reason=>{
 const onDelta=vi.fn(),onDone=vi.fn(),onError=vi.fn();api.mockResolvedValue(response(event(chunk('Contenido parcial. '.repeat(80)))+event(chunk('',reason))+event('[DONE]')));
 await streamAnalysis({ticker:'AAPL',onDelta,onDone,onError});
 expect(onDone).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledTimes(1);expect(onError.mock.calls[0][0]).toMatch(reason==='length'?/límite/:/no.*complet|interrumpió/);expect(api).toHaveBeenCalledTimes(1);
});
it.each([event(chunk('Texto completo.'))+event('[DONE]'),event(chunk('Texto completo.'))+event(chunk('','stop'))])('rejects missing completion metadata or missing transport DONE',async text=>{
 const onDone=vi.fn(),onError=vi.fn();api.mockResolvedValue(response(text));await streamSectorAnalysis({sector:'Tecnología',onDelta:vi.fn(),onDone,onError});expect(onDone).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledTimes(1);
});
it('accepts the cache replay format only when it includes its stop marker',async()=>{
 const onDone=vi.fn(),onError=vi.fn();api.mockResolvedValue(response(event({__cache:{shared:true}})+event(chunk('Informe completo guardado.','stop'))+event('[DONE]')));
 await streamAnalysis({ticker:'AAPL',onDelta:vi.fn(),onDone,onError});expect(onDone).toHaveBeenCalledOnce();expect(onError).not.toHaveBeenCalled();
});

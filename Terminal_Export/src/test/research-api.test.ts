import {afterEach,expect,it,vi} from 'vitest';
import {researchSave,researchGet,researchMeta,researchCheck,researchExplain,researchAssess,researchSummary,researchAcknowledge,researchDelete,researchRestore,RESEARCH_CHANGED} from '../lib/research-api';
const api=vi.hoisted(()=>vi.fn());vi.mock('@/lib/beta-api',()=>({accountApi:api}));
afterEach(()=>api.mockReset());
it('uses the exact owner-bound action contracts and preserves the caller request ID across retries',async()=>{
 api.mockResolvedValue({});const changed=vi.fn();window.addEventListener(RESEARCH_CHANGED,changed);const input={requestId:'12345678-1234-4234-8234-123456789012',kind:'ticker' as const,subject:'AAPL',payload:{analysis:'Original',quarterlyData:[]}};
 await researchSave(input);await researchSave(input);expect(api.mock.calls.slice(0,2)).toEqual([['researchSave',input],['researchSave',input]]);expect(changed).toHaveBeenCalledTimes(2);window.removeEventListener(RESEARCH_CHANGED,changed);
 await researchGet('item','version');expect(api).toHaveBeenLastCalledWith('researchGet',{id:'item',versionId:'version'},expect.anything());
 await researchMeta('item',4,{title:'Tesis',folder:'',tags:[],thesis:'',risks:'',invalidation:'',notes:'',next_review:null,monitor_enabled:false,email_enabled:false,status:'active'});expect(api).toHaveBeenLastCalledWith('researchMeta',expect.objectContaining({id:'item',expectedRevision:4}));
 await researchCheck('item');await researchExplain('item','review');await researchSummary('item','version');await researchAcknowledge('item','review');await researchDelete('item');await researchRestore('item');
 expect(api.mock.calls.slice(-6)).toEqual([['researchCheck',{id:'item'}],['researchExplain',{id:'item',reviewId:'review'}],['researchSummary',{id:'item',versionId:'version'},{signal:undefined}],['researchAcknowledge',{id:'item',reviewId:'review'}],['researchDelete',{id:'item'}],['researchRestore',{id:'item'}]]);
});
it('scopes an explicit assessment to one version and forwards the cancellation signal',async()=>{api.mockResolvedValue({});const controller=new AbortController();await researchAssess('item','version',controller.signal);expect(api).toHaveBeenLastCalledWith('researchAssess',{id:'item',versionId:'version'},{signal:controller.signal});});

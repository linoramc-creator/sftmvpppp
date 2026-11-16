import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {labDelete,labList,labOpen,labRefresh,labRequestIdentity,labRun,labSave,labSymbols,MensorLabError} from '../lib/mensorlab-api';
import {analyticsQuery} from './fixtures/analytics';
const fetch=vi.hoisted(()=>vi.fn());vi.mock('@/lib/beta-api',()=>({authenticatedFetch:fetch}));
beforeEach(()=>{fetch.mockReset();fetch.mockResolvedValue({ok:true,json:async()=>({items:[]})});});afterEach(()=>vi.restoreAllMocks());
it('uses authenticated bounded actions and saves only server execution identity, never uploaded result data or owners',async()=>{
 const definition={version:1 as const,studies:[{id:'one',name:'Comparación',kind:'comparison' as const,query:analyticsQuery,benchmark:'^GSPC'}]};
 await labRun(definition);await labSave({name:'Proyecto',runId:'server-run',requestId:'request-1',id:'project',revision:2});await labOpen('project','snapshot');await labRefresh({id:'project',revision:2,requestId:'refresh-1'});await labDelete({id:'project',revision:3});await labList();
 const bodies=fetch.mock.calls.map(([,init])=>JSON.parse(init.body));
 expect(bodies).toEqual([{accountAction:'labRun',definition},{accountAction:'labSave',name:'Proyecto',runId:'server-run',requestId:'request-1',id:'project',revision:2},{accountAction:'labOpen',id:'project',snapshotId:'snapshot'},{accountAction:'labRefresh',id:'project',revision:2,requestId:'refresh-1'},{accountAction:'labDelete',id:'project',revision:3},{accountAction:'labList'}]);
 expect(bodies.every(body=>!('userId' in body)&&!('results' in body)&&!('code' in body))).toBe(true);
});
it('preserves aborts and exposes revision conflicts without faking a successful save',async()=>{fetch.mockResolvedValue({ok:false,status:409,json:async()=>({error:'La revisión ha cambiado.'})});const controller=new AbortController();await expect(labOpen('project',undefined,controller.signal)).rejects.toEqual(new MensorLabError('La revisión ha cambiado.',409));controller.abort();expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);});
it('reuses request identities for uncertain replies and explicitly deduplicates symbols without inventing data',()=>{const value=labRequestIdentity(null,'one');expect(labRequestIdentity(value,'one')).toBe(value);expect(labRequestIdentity(value,'two').id).not.toBe(value.id);expect(labSymbols('msft, MSFT; ^gspc\nGOOGL')).toEqual(['MSFT','^GSPC','GOOGL']);});

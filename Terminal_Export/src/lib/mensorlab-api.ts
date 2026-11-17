import {authenticatedFetch} from '@/lib/beta-api';
import type {LabDefinition,LabProject,LabProjectSummary,LabRun} from '../../../supabase/functions/analyze-ticker/mensorlab-types';
export type {LabDefinition,LabStudy,LabProject,LabProjectSummary,LabRun,LabStudyResult,LabAssetMetrics} from '../../../supabase/functions/analyze-ticker/mensorlab-types';

export class MensorLabError extends Error {
 constructor(message:string,readonly status:number){super(message);this.name='MensorLabError';}
}
async function request<T>(accountAction:string,body:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
 const deadline=AbortSignal.timeout(accountAction==='labRun'||accountAction==='labRefresh'?120000:30000);
 const response=await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountAction,...body}),signal:signal?AbortSignal.any([signal,deadline]):deadline});
 const data=await response.json();
 if(!response.ok)throw new MensorLabError(data.error||'No se ha podido completar el estudio.',response.status);
 return data as T;
}
export const labRun=(definition:LabDefinition,signal?:AbortSignal)=>request<LabRun>('labRun',{definition},signal);
export const labOrganize=(value:{runId:string;studies:{id:string;name:string}[]},signal?:AbortSignal)=>request<LabRun>('labOrganize',{runId:value.runId,studies:value.studies.map(({id,name})=>({id,name}))},signal);
export const labList=(signal?:AbortSignal)=>request<{items:LabProjectSummary[]}>('labList',{},signal);
export const labOpen=(id:string,snapshotId?:string,signal?:AbortSignal)=>request<{project:LabProject}>('labOpen',{id,...(snapshotId?{snapshotId}:{})},signal);
export const labSave=(value:{name:string;runId:string;requestId:string;id?:string;revision?:number},signal?:AbortSignal)=>request<{project:LabProject}>('labSave',{name:value.name,runId:value.runId,requestId:value.requestId,...(value.id?{id:value.id,revision:value.revision}:{})},signal);
export const labRefresh=(value:{id:string;revision:number;requestId:string},signal?:AbortSignal)=>request<{project:LabProject}>('labRefresh',{id:value.id,revision:value.revision,requestId:value.requestId},signal);
export const labDelete=(value:{id:string;revision:number;requestId?:string},signal?:AbortSignal)=>request<{ok:true}>('labDelete',{id:value.id,revision:value.revision,...(value.requestId?{requestId:value.requestId}:{})},signal);

/** Reuse one identity after uncertain replies; a changed request gets a new identity. */
export function labRequestIdentity(previous:{key:string;id:string}|null,key:string){return previous?.key===key?previous:{key,id:crypto.randomUUID()};}
export function labSymbols(value:string){return [...new Set(value.split(/[\s,;]+/).map(symbol=>symbol.trim().toUpperCase()).filter(Boolean))];}
export function labDefinitionEqual(a:LabDefinition,b:LabDefinition){return JSON.stringify(a)===JSON.stringify(b);}

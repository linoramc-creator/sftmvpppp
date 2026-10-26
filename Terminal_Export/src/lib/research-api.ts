import {accountApi} from '@/lib/beta-api';
import type {ResearchDetail,ResearchItem,ResearchKind,ResearchList,ResearchPayload,ResearchReview,ResearchSettings} from '../../../supabase/functions/analyze-ticker/research-types';
export type {ResearchDetail,ResearchItem,ResearchKind,ResearchList,ResearchPayload,ResearchReview,ResearchSettings};
export type ResearchSaveInput={requestId:string;kind:ResearchKind;subject:string;payload:ResearchPayload;settings?:ResearchSettings;itemId?:string};
export type ResearchMetadata=Pick<ResearchItem,'title'|'folder'|'tags'|'thesis'|'risks'|'invalidation'|'notes'|'next_review'|'monitor_enabled'|'email_enabled'|'status'>;
export const RESEARCH_CHANGED='research-library-changed';
export function researchChanged(){window.dispatchEvent(new Event(RESEARCH_CHANGED));}
export const researchList=(options:{query?:string;includeDeleted?:boolean}={},signal?:AbortSignal)=>accountApi<ResearchList>('researchList',{...options},{signal});
export const researchGet=(id:string,versionId?:string,signal?:AbortSignal)=>accountApi<ResearchDetail>('researchGet',{id,...(versionId?{versionId}:{})},{signal});
export async function researchSave(input:ResearchSaveInput){const detail=await accountApi<ResearchDetail>('researchSave',{...input});researchChanged();return detail;}
export async function researchMeta(id:string,expectedRevision:number,metadata:ResearchMetadata){const item=await accountApi<ResearchItem>('researchMeta',{id,expectedRevision,...metadata});researchChanged();return item;}
export async function researchCheck(id:string){const review=await accountApi<ResearchReview>('researchCheck',{id});researchChanged();return review;}
export const researchExplain=(id:string,reviewId:string)=>accountApi<{text:string;cached:boolean;model:string}>('researchExplain',{id,reviewId});
export const researchSummary=(id:string,versionId:string)=>accountApi<{summary:string;cached:boolean;model:string}>('researchSummary',{id,versionId});
export async function researchAcknowledge(id:string,reviewId:string){const detail=await accountApi<ResearchDetail>('researchAcknowledge',{id,reviewId});researchChanged();return detail;}
export async function researchDelete(id:string){await accountApi('researchDelete',{id});researchChanged();}
export async function researchRestore(id:string){await accountApi('researchRestore',{id});researchChanged();}

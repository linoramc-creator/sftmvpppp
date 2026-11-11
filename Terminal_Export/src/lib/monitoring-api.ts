import {accountApi} from './beta-api';
import type {MonitorOverview} from '../../../supabase/functions/analyze-ticker/monitoring-types';
export type {MonitorAlert,MonitorCondition,MonitorContext,MonitorField,MonitorNotice,MonitorOverview,MonitorAgendaItem,MonitorSnapshot} from '../../../supabase/functions/analyze-ticker/monitoring-types';

export function monitoringSourceUrl(value:string|null|undefined){try{const url=new URL(value??'');return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}

const VISIT_TTL=30*60*1000;
type Visit={id:string;createdAt:number};
const visits=new Map<string,Visit>();
/** Reuse a visit for 30 minutes; an already mounted workspace retains its ID. */
export function monitoringVisitId(accountId:string){
 const key=`mensor:monitor-visit:${accountId}`,now=Date.now();
 const valid=(visit:Visit|undefined)=>visit&&/^[0-9a-f-]{36}$/i.test(visit.id)&&Number.isFinite(visit.createdAt)&&now>=visit.createdAt&&now-visit.createdAt<VISIT_TTL;
 try{const existing=JSON.parse(sessionStorage.getItem(key)??'null') as Visit|null;if(existing&&valid(existing)){visits.set(accountId,existing);return existing.id;}}catch{/* Storage may be disabled or contain an expired legacy format. */}
 const previous=visits.get(accountId),visit=valid(previous)?previous!:{id:crypto.randomUUID(),createdAt:now};visits.set(accountId,visit);
 try{sessionStorage.setItem(key,JSON.stringify(visit));}catch{/* The in-memory identity remains stable. */}
 return visit.id;
}
export const monitoringOpen=(visitId:string,signal?:AbortSignal)=>accountApi<MonitorOverview>('monitorOpen',{visitId},{signal});
export const monitoringList=(visitId:string,options:{before?:string;unreadOnly?:boolean}={},signal?:AbortSignal)=>accountApi<MonitorOverview>('monitorList',{visitId,...options},{signal});
export const monitoringRead=(ids:string[],signal?:AbortSignal)=>accountApi<{ok:true}>('monitorRead',{ids},{signal});

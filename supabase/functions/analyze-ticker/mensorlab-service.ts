import {AnalyticsValidationError} from './analytics-engine.ts';
import {executeMensorLab,validateLabDefinition,LAB_LIMITS} from './mensorlab-engine.ts';
import type {LabRun,LabRunDependencies,LabProject} from './mensorlab-types.ts';

type Body=Record<string,unknown>;
type User={id:string;email?:string};
export type MensorLabServiceDependencies={rpc:(name:string,body:Body)=>Promise<any>;now?:()=>number;data?:LabRunDependencies;execute?:(input:unknown,deps:LabRunDependencies)=>Promise<LabRun>};
export class MensorLabError extends Error{status:number;constructor(message:string,status=400){super(message);this.name='MensorLabError';this.status=status;}}
const invalid=(message='Solicitud de MensorLab inválida.'):never=>{throw new MensorLabError(message);};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:invalid('Identificador de MensorLab inválido.');
const fields:Record<string,string[]>={labRun:['definition'],labSave:['name','runId','requestId','id','revision'],labList:[],labOpen:['id','snapshotId'],labDelete:['id','revision','requestId'],labRefresh:['id','revision','requestId']};
export function mensorLabRequestClass(body:Body):'account'|'data'|null{
 if(typeof body.accountAction!=='string'||!body.accountAction.startsWith('lab'))return null;
 const action=body.accountAction,allowed=fields[action];if(!allowed||Object.keys(body).some(key=>key!=='accountAction'&&!allowed.includes(key)))invalid();
 if(action==='labRun'){try{validateLabDefinition(body.definition);}catch(error){if(error instanceof AnalyticsValidationError)throw new MensorLabError(error.message);throw error;}return 'data';}
 if(action==='labSave'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||/[\p{Cc}\p{Cf}<>]/u.test(body.name))invalid('El proyecto necesita un nombre de hasta 100 caracteres.');
  uuid(body.runId);uuid(body.requestId);
  if(body.id===undefined&&body.revision!==undefined)invalid();
 }
 if(['labOpen','labDelete','labRefresh'].includes(action)||action==='labSave'&&body.id!==undefined)uuid(body.id);
 if(['labDelete','labRefresh'].includes(action)||action==='labSave'&&body.id!==undefined){if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)invalid('La revisión del proyecto es inválida.');}
 if(action==='labRefresh')uuid(body.requestId);
 if(action==='labDelete'&&body.requestId!==undefined)uuid(body.requestId);
 if(action==='labOpen'&&body.snapshotId!==undefined)uuid(body.snapshotId);
 return action==='labRefresh'?'data':'account';
}
const mappedError=(error:unknown):MensorLabError=>{
 if(error instanceof MensorLabError)return error;
 if(error instanceof AnalyticsValidationError)return new MensorLabError(error.message,error.code==='unavailable'?503:400);
 const code=error instanceof Error?error.message:typeof error==='object'&&error!==null?JSON.stringify(error):'';
 if(/BETA_LAB_(NOT_FOUND|RUN_EXPIRED)/.test(code))return new MensorLabError('El proyecto o la instantánea no existe, no pertenece a tu cuenta o ha caducado. Ejecuta el estudio de nuevo si no lo guardaste.',404);
 if(/BETA_LAB_CONFLICT/.test(code))return new MensorLabError('El proyecto cambió en otra sesión. Ábrelo de nuevo antes de guardar.',409);
 if(/BETA_LAB_FORBIDDEN/.test(code))return new MensorLabError('No tienes acceso a este proyecto.',403);
 if(/BETA_LAB_LIMIT/.test(code))return new MensorLabError('Se alcanzó el límite de MensorLab: 20 proyectos, 10 instantáneas por proyecto o 1,5 MB por ejecución.',409);
 if(/BETA_LAB_INVALID/.test(code))return new MensorLabError('La definición o la operación de MensorLab no es válida.');
 return new MensorLabError('MensorLab no está disponible temporalmente. Los estudios guardados se conservan.',503);
};

export async function handleMensorLabAction(body:Body,user:User,deps:MensorLabServiceDependencies):Promise<Response|null>{
 if(!mensorLabRequestClass(body))return null;
 if(!user?.id)throw new MensorLabError('Inicia sesión para usar MensorLab.',401);
 const store=(operation:string,payload:Body={})=>deps.rpc('beta_mensorlab_store',{operation,uid:user.id,payload});
 try{
  if(body.accountAction==='labList')return Response.json({items:await store('list')});
  if(body.accountAction==='labOpen')return Response.json({project:await store('open',{id:body.id,...(body.snapshotId?{snapshotId:body.snapshotId}:{})})});
  if(body.accountAction==='labDelete'){await store('delete',{id:body.id,revision:body.revision,...(body.requestId?{requestId:body.requestId}:{})});return Response.json({ok:true});}
  if(body.accountAction==='labSave')return Response.json({project:await store('save',{name:(body.name as string).trim(),runId:body.runId,requestId:body.requestId,...(body.id?{id:body.id,revision:body.revision}:{})})});
  const now=(deps.now??Date.now)();
  if(body.accountAction==='labRun'){
   const definition=validateLabDefinition(body.definition),run=await(deps.execute??executeMensorLab)(definition,{...deps.data,now});
   await store('putRun',{run});return Response.json(run);
  }
  // Refresh uses only the owned, persisted definition. A receipt is checked
  // before providers, preventing duplicate computation after a network retry.
  const receipt=await store('receipt',{id:body.id,revision:body.revision,requestId:body.requestId,action:'refresh'});
  if(receipt)return Response.json({project:receipt});
  const project:LabProject=await store('open',{id:body.id});
  if(project.revision!==body.revision)throw new MensorLabError('El proyecto cambió en otra sesión. Ábrelo de nuevo.',409);
  const run=await(deps.execute??executeMensorLab)(validateLabDefinition(project.definition),{...deps.data,now});
  return Response.json({project:await store('refresh',{id:body.id,revision:body.revision,requestId:body.requestId,run})});
 }catch(error){throw mappedError(error);}
}
export {LAB_LIMITS};

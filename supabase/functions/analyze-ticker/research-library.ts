import {captureResearchSnapshot,compareResearchSnapshots,explainResearchChanges,summarizeResearchVersion} from './research-data.ts';
import {PRIMARY_REPORT_MODEL} from './report-models.ts';
import {assessResearchVersion,RESEARCH_ASSESSMENT_MODEL,RESEARCH_ASSESSMENT_RECIPE} from './research-assessment.ts';
import {RESEARCH_SUMMARY_RECIPE,type ResearchKind,type ResearchPayload,type ResearchSettings,type ResearchSnapshot,type ResearchItem,type ResearchVersion,type ResearchReview,type ResearchDetail,type ResearchAssessment} from './research-types.ts';

type Body=Record<string,any>;
type Service=(path:string,init?:RequestInit)=>Promise<any>;
type Rpc=(name:string,body:Body)=>Promise<any>;
export type ResearchDependencies={service:Service;rpc:Rpc;env:(key:string)=>string;capture?:typeof captureResearchSnapshot;compare?:typeof compareResearchSnapshots;explain?:typeof explainResearchChanges;summarize?:typeof summarizeResearchVersion;assess?:typeof assessResearchVersion};
export class ResearchError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYMBOL=/^[A-Z0-9^][A-Z0-9.^=-]{0,24}$/;
const ACTIONS=new Set(['researchList','researchGet','researchSave','researchMeta','researchCheck','researchExplain','researchSummary','researchAssess','researchAcknowledge','researchDelete','researchRestore']);
const PAID=new Set(['researchSave','researchCheck','researchExplain','researchSummary','researchAssess']);
const META_TEXT={title:160,folder:80,thesis:6000,risks:6000,invalidation:6000,notes:16000} as const;
const ITEM_FIELDS=['id','kind','subject','title','folder','tags','thesis','risks','invalidation','notes','next_review','monitor_enabled','email_enabled','status','revision','created_at','updated_at','latest_version','needs_review','last_checked_at','deleted_at'];
const invalid=(text='Solicitud de biblioteca inválida.'):never=>{throw new ResearchError(400,text);};
const id=(value:unknown)=>typeof value==='string'&&UUID.test(value)?value:invalid('Identificador de biblioteca inválido.');
const object=(value:unknown):value is Body=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function bounded(value:unknown,max=1000000){try{if(new TextEncoder().encode(JSON.stringify(value)).length>max)invalid('El contenido supera el tamaño permitido.');}catch(error){if(error instanceof ResearchError)throw error;invalid();}}
const cleanItem=(row:Body)=>Object.fromEntries(ITEM_FIELDS.map(field=>[field,row[field]])) as ResearchItem;
const json=(value:unknown)=>Response.json(value);
const write=(deps:ResearchDependencies,uid:string,operation:string,data:Body)=>deps.rpc('beta_research_write',{uid,operation,data});
export function researchMailReady(env:ResearchDependencies['env']){return Boolean(env('BRIEF_FROM')&&(env('BRIEF_RESEND_API_KEY')||env('BRIEF_SMTP_HOST')&&env('BRIEF_SMTP_USER')&&env('BRIEF_SMTP_PASS')));}
function settings(input:unknown):ResearchSettings{
 if(input===undefined)return {};
 if(!object(input))invalid('Configuración del análisis inválida.');
 const value=input as Body;if(Object.keys(value).some(key=>!['symbols','range','benchmark','view'].includes(key)))invalid('Configuración del análisis inválida.');
 const result:ResearchSettings={};
 if(value.symbols!==undefined){if(!Array.isArray(value.symbols)||value.symbols.length<1||value.symbols.length>6||value.symbols.some(s=>typeof s!=='string'||!SYMBOL.test(s.trim().toUpperCase())))invalid();result.symbols=value.symbols.map((s:string)=>s.trim().toUpperCase());if(new Set(result.symbols).size!==result.symbols.length)invalid();}
 if(value.range!==undefined){if(!['1m','3m','6m','1y'].includes(value.range))invalid();result.range=value.range;}
 if(value.benchmark!==undefined){if(typeof value.benchmark!=='string'||!SYMBOL.test(value.benchmark.trim().toUpperCase()))invalid();result.benchmark=value.benchmark.trim().toUpperCase();}
 if(value.view!==undefined){if(typeof value.view!=='string'||value.view.length>80||/[\p{Cc}\p{Cf}]/u.test(value.view))invalid();result.view=value.view;}
 bounded(result,4096);return result;
}
function saveInput(body:Body):{kind:ResearchKind;subject:string;payload:ResearchPayload;settings:ResearchSettings;itemId?:string;requestId:string}{
 const requestId=id(body.requestId),kind=body.kind as ResearchKind;
 if(!['ticker','etf','sector','comparison'].includes(kind)||typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>120||/[\p{Cc}\p{Cf}<>]/u.test(body.subject))invalid('Informe inválido.');
 const subject=['ticker','etf'].includes(kind)?body.subject.trim().toUpperCase():body.subject.trim();
 if(['ticker','etf'].includes(kind)&&!SYMBOL.test(subject))invalid('Ticker inválido.');
 if(!object(body.payload)||typeof body.payload.analysis!=='string'||body.payload.analysis.length>900000||!Array.isArray(body.payload.quarterlyData)||body.payload.quarterlyData.length>200||kind!=='comparison'&&!body.payload.analysis.trim())invalid('Informe inválido.');
 const payload:ResearchPayload={analysis:body.payload.analysis,quarterlyData:body.payload.quarterlyData};
 if(kind==='etf'&&body.payload.etfDeep!==undefined)payload.etfDeep=body.payload.etfDeep;
 if(kind==='comparison'){if(!object(body.payload.comparison))invalid('Comparación inválida.');payload.comparison=body.payload.comparison;}
 bounded(payload);return {kind,subject,payload,settings:settings(body.settings),...(body.itemId!==undefined?{itemId:id(body.itemId)}:{}),requestId};
}
function metadata(body:Body):Body{
 id(body.id);if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<1)invalid('Revisión del elemento inválida.');
 const patch:Body={id:body.id,expected_revision:body.expectedRevision};
 for(const [key,max]of Object.entries(META_TEXT))if(body[key]!==undefined){if(typeof body[key]!=='string'||body[key].length>max||key==='title'&&!body[key].trim()||/[\u0000]/.test(body[key]))invalid('El texto supera el tamaño permitido.');patch[key]=key==='title'||key==='folder'?body[key].trim():body[key];}
 if(body.tags!==undefined){if(!Array.isArray(body.tags)||body.tags.length>20||body.tags.some((tag:unknown)=>typeof tag!=='string'||!tag.trim()||tag.length>48||/[\p{Cc}\p{Cf}]/u.test(tag)))invalid('Etiquetas inválidas.');patch.tags=[...new Set(body.tags.map((tag:string)=>tag.trim()))];}
 for(const key of ['monitor_enabled','email_enabled'])if(body[key]!==undefined){if(typeof body[key]!=='boolean')invalid();patch[key]=body[key];}
 if(body.status!==undefined){if(!['active','archived'].includes(body.status))invalid();patch.status=body.status;}
 if(body.next_review!==undefined){const value=body.next_review;if(value!==null&&(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value.slice(0,10)))invalid('Fecha de revisión inválida.');patch.next_review=value;}
 return patch;
}
export function researchRequestClass(body:Body):'account'|'expensive'|null{
 const action=body.accountAction;if(typeof action!=='string'||!action.startsWith('research'))return null;
 if(!ACTIONS.has(action))invalid('Operación de biblioteca inválida.');
 if(action==='researchSave')saveInput(body);
 else if(action==='researchMeta')metadata(body);
 else if(action==='researchList'){if(body.includeDeleted!==undefined&&typeof body.includeDeleted!=='boolean'||body.query!==undefined&&(typeof body.query!=='string'||body.query.length>120||/[\p{Cc}\p{Cf}]/u.test(body.query)))invalid();}
 else{id(body.id);if(action==='researchGet'&&body.versionId!==undefined)id(body.versionId);if(['researchSummary','researchAssess'].includes(action))id(body.versionId);if(['researchExplain','researchAcknowledge'].includes(action))id(body.reviewId);}
 return PAID.has(action)?'expensive':'account';
}
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value)??'null';
}
async function fingerprint(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
async function ownItem(uid:string,itemId:string,deps:ResearchDependencies){
 const rows=await deps.service(`beta_research_items?id=eq.${id(itemId)}&user_id=eq.${uid}&select=*&limit=1`);
 if(!rows?.length)throw new ResearchError(404,'Análisis no encontrado.');return rows[0] as Body;
}
async function ownVersion(uid:string,itemId:string,versionId:string|undefined,deps:ResearchDependencies):Promise<ResearchVersion>{
 const rows=await deps.service(`beta_research_versions?user_id=eq.${uid}&item_id=eq.${id(itemId)}&${versionId?`id=eq.${id(versionId)}`:'order=version.desc'}&select=*&limit=1`);
 if(!rows?.length)throw new ResearchError(404,'Versión no encontrada.');const {user_id,summary_fingerprint,...version}=rows[0];
 if(version.summary_recipe!==RESEARCH_SUMMARY_RECIPE||version.summary_model!==PRIMARY_REPORT_MODEL)version.summary=null;
 return version;
}
async function ownReview(uid:string,itemId:string,reviewId:string,deps:ResearchDependencies):Promise<ResearchReview>{
 const rows=await deps.service(`beta_research_reviews?id=eq.${id(reviewId)}&item_id=eq.${id(itemId)}&user_id=eq.${uid}&select=*&limit=1`);
 if(!rows?.length)throw new ResearchError(404,'Revisión no encontrada.');const {user_id,fingerprint,observed_at,...review}=rows[0];return review;
}
export async function readResearchDetail(uid:string,itemId:string,versionId:string|undefined,deps:ResearchDependencies):Promise<ResearchDetail>{
 const item=await ownItem(uid,itemId,deps),version=await ownVersion(uid,itemId,versionId,deps);
 const [versions,reviews,assessments]=await Promise.all([
  deps.service(`beta_research_versions?user_id=eq.${uid}&item_id=eq.${item.id}&select=id,item_id,version,created_at,legacy_report_id&order=version.desc&limit=500`),
  deps.service(`beta_research_reviews?user_id=eq.${uid}&item_id=eq.${item.id}&version_id=eq.${version.id}&select=id,item_id,version_id,created_at,current_snapshot,diff,explanation,explanation_model,acknowledged_at&order=observed_at.desc,id.desc&limit=1`),
  deps.service(`beta_research_assessments?user_id=eq.${uid}&item_id=eq.${item.id}&version_id=eq.${version.id}&model=eq.${RESEARCH_ASSESSMENT_MODEL}&recipe=eq.${RESEARCH_ASSESSMENT_RECIPE}&select=assessment&limit=1`),
 ]);
 return {item:cleanItem(item),versions,version,review:reviews?.[0]??null,assessment:assessments?.[0]?.assessment??null,mailReady:researchMailReady(deps.env)};
}
export async function checkResearchItem(uid:string,itemId:string,deps:ResearchDependencies):Promise<ResearchReview>{
 const item=await ownItem(uid,itemId,deps);if(item.deleted_at)throw new ResearchError(409,'Restaura el análisis antes de revisarlo.');
 const version=await ownVersion(uid,itemId,undefined,deps),current=await (deps.capture??captureResearchSnapshot)(item.kind,item.subject,version.settings,version.payload);
 bounded(current);const compare=deps.compare??compareResearchSnapshots,diff=compare(version.snapshot,current),notificationDiff=compare(item.notification_baseline??version.snapshot,current);bounded(diff);
 bounded(notificationDiff);return write(deps,uid,'review',{id:itemId,version_id:version.id,snapshot:current,diff,notification_diff:notificationDiff,notification_revision:item.notification_revision??0,notification_material:notificationDiff.material});
}
async function generate(uid:string,kind:'summary'|'explain',target:ResearchVersion|ResearchReview,deps:ResearchDependencies){
 const model=PRIMARY_REPORT_MODEL,recipe=kind==='summary'?RESEARCH_SUMMARY_RECIPE:'explain-v1',hash=await fingerprint(kind==='summary'?{recipe,payload:(target as ResearchVersion).payload,snapshot:(target as ResearchVersion).snapshot,settings:(target as ResearchVersion).settings}:{recipe,diff:(target as ResearchReview).diff});
 const claim=await write(deps,uid,'ai_claim',{kind,target_id:target.id,fingerprint:hash,model,recipe});
 if(claim.state==='ready')return {text:claim.text,cached:true,model};
 try{
  const key=deps.env('GEMINI_API_KEY')||deps.env('Gemini')||deps.env('GOOGLE_API_KEY');if(!key)throw new ResearchError(503,'La generación con IA no está disponible ahora.');
  const text=kind==='summary'?await (deps.summarize??summarizeResearchVersion)(target as ResearchVersion,key):await (deps.explain??explainResearchChanges)((target as ResearchReview).diff,key);
  if(typeof text!=='string'||!text.trim()||text.length>20000)throw new ResearchError(503,'No se ha podido completar el texto.');
  await write(deps,uid,'ai_finish',{id:claim.id,token:claim.token,text});return {text,cached:false,model};
 }catch(error){try{await write(deps,uid,'ai_fail',{id:claim.id,token:claim.token});}catch{}throw error;}
}
async function assess(uid:string,item:Body,version:ResearchVersion,deps:ResearchDependencies){
 const model=RESEARCH_ASSESSMENT_MODEL,recipe=RESEARCH_ASSESSMENT_RECIPE;
 const hash=await fingerprint({recipe,payload:version.payload,snapshot:version.snapshot,settings:version.settings});
 // Ownership, the per-version lease and the 24-hour cache are checked before
 // any fresh provider or model call. The archived report remains immutable.
 const claim=await write(deps,uid,'ai_claim',{kind:'assessment',target_id:version.id,fingerprint:hash,model,recipe});
 if(claim.state==='ready')return {assessment:claim.assessment as ResearchAssessment,cached:true,model};
 try{
  const key=deps.env('GEMINI_API_KEY')||deps.env('Gemini')||deps.env('GOOGLE_API_KEY');if(!key)throw new ResearchError(503,'La evaluación no está disponible ahora.');
  const current=await (deps.capture??captureResearchSnapshot)(item.kind,item.subject,version.settings,version.payload);bounded(current);
  const assessment=await (deps.assess??assessResearchVersion)(version,current,key);bounded(assessment,128000);
  if(!object(assessment)||assessment.schema!==1||assessment.versionId!==version.id||assessment.model!==model||assessment.recipe!==recipe||assessment.asOf!==current.capturedAt||assessment.originalAt!==version.created_at||!['complete','partial','insufficient'].includes(assessment.quality)||typeof assessment.executiveReading!=='string'||!['competitiveAdvantages','strengths','weaknesses','risks','watchpoints','news','coverageNotes'].every(field=>Array.isArray((assessment as unknown as Body)[field])))throw new ResearchError(503,'La evaluación no se ha podido completar.');
  const inputHash=await fingerprint({recipe,versionId:version.id,snapshot:current});
  await write(deps,uid,'ai_finish',{id:claim.id,token:claim.token,assessment,current_snapshot:current,input_fingerprint:inputHash});
  return {assessment,cached:false,model};
 }catch(error){try{await write(deps,uid,'ai_fail',{id:claim.id,token:claim.token});}catch{}throw error;}
}
export async function handleResearchAction(body:Body,user:{id:string;email?:string},deps:ResearchDependencies):Promise<Response|null>{
 if(researchRequestClass(body)===null)return null;
 const uid=id(user.id),action=body.accountAction;
 if(['researchList','researchGet'].includes(action))await deps.rpc('beta_research_import_legacy',{uid});
 if(action==='researchList')return json({items:await deps.rpc('beta_research_list',{uid,include_deleted:body.includeDeleted===true,search_query:body.query?.trim()??''}),mailReady:researchMailReady(deps.env)});
 if(action==='researchGet')return json(await readResearchDetail(uid,body.id,body.versionId,deps));
 if(action==='researchSave'){
  const input=saveInput(body),hash=await fingerprint({kind:input.kind,subject:input.subject,payload:input.payload,settings:input.settings,itemId:input.itemId??null});
  if(input.itemId){const item=await ownItem(uid,input.itemId,deps);if(item.deleted_at)throw new ResearchError(409,'Restaura el análisis antes de guardar una versión.');if(item.kind!==input.kind||item.subject.trim().toUpperCase()!==input.subject.toUpperCase())invalid('La versión corresponde a otro activo.');}
  const claim=await write(deps,uid,'claim_save',{request_id:input.requestId,input_hash:hash,kind:input.kind,subject:input.subject,item_id:input.itemId??null});
  if(claim.state==='ready')return json(await readResearchDetail(uid,claim.item_id,claim.version_id,deps));
  try{
   const snapshot=await (deps.capture??captureResearchSnapshot)(input.kind,input.subject,input.settings,input.payload);bounded(snapshot);
   const saved=await write(deps,uid,'save',{request_id:input.requestId,input_hash:hash,token:claim.token,kind:input.kind,subject:input.subject,payload:input.payload,snapshot,settings:input.settings,item_id:input.itemId??null});
   return json(await readResearchDetail(uid,saved.item_id,saved.version_id,deps));
  }catch(error){try{await write(deps,uid,'fail_save',{request_id:input.requestId,token:claim.token});}catch{}throw error;}
 }
 if(action==='researchMeta'){const patch=metadata(body);if(patch.email_enabled&&!researchMailReady(deps.env))throw new ResearchError(409,'El envío de correo no está conectado.');return json(await write(deps,uid,'meta',patch));}
 if(action==='researchCheck')return json(await checkResearchItem(uid,body.id,deps));
 if(action==='researchExplain'){
  await ownItem(uid,body.id,deps);const review=await ownReview(uid,body.id,body.reviewId,deps);return json(await generate(uid,'explain',review,deps));
 }
 if(action==='researchSummary'){
  await ownItem(uid,body.id,deps);const version=await ownVersion(uid,body.id,body.versionId,deps),result=await generate(uid,'summary',version,deps);return json({summary:result.text,cached:result.cached,model:result.model});
 }
 if(action==='researchAssess'){
  const item=await ownItem(uid,body.id,deps);if(item.deleted_at)throw new ResearchError(409,'Restaura el análisis antes de evaluarlo.');
  const version=await ownVersion(uid,body.id,body.versionId,deps);return json(await assess(uid,item,version,deps));
 }
 if(action==='researchAcknowledge'){const result=await write(deps,uid,'acknowledge',{id:body.id,review_id:body.reviewId});return json(await readResearchDetail(uid,result.item_id,result.version_id,deps));}
 return json(await write(deps,uid,action==='researchDelete'?'delete':'restore',{id:body.id}));
}

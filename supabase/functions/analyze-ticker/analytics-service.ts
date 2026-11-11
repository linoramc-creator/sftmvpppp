import {executeAnalytics,validateAnalyticsQuery,AnalyticsValidationError} from './analytics-engine.ts';
import {interpretAnalytics} from './analytics-interpret.ts';
import {portfolioMetrics,type PortfolioState} from './portfolio-model.ts';
import type {AnalyticsDependencies,AnalyticsQuery,AnalyticsResult,AnalyticsInterpretation,AnalyticsPortfolioInput} from './analytics-types.ts';

type Body=Record<string,unknown>;
type User={id:string;email:string};
export type AnalyticsServiceDependencies={
 rpc:(name:string,body:Record<string,unknown>)=>Promise<any>;
 env:(key:string)=>string;
 isAdmin?:(uid:string)=>Promise<boolean>;
 now?:()=>number;
 interpret?:(prompt:string,key:string)=>Promise<AnalyticsInterpretation>;
 execute?:(query:AnalyticsQuery,deps:AnalyticsDependencies)=>Promise<AnalyticsResult>;
 data?:Pick<AnalyticsDependencies,'fundamentals'>;
};
export class AnalyticsError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=['analyticsInterpret','analyticsRun','analyticsList','analyticsSave','analyticsDelete'] as const;
const invalid=(message='Consulta de Analytics inválida.'):never=>{throw new AnalyticsError(message);};
const id=(value:unknown)=>typeof value==='string'&&UUID.test(value)?value:invalid('Identificador de Analytics inválido.');
export function analyticsRequestClass(body:Body):'account'|'expensive'|'data'|null{
 if(typeof body.accountAction!=='string'||!body.accountAction.startsWith('analytics'))return null;
 if(!ACTIONS.includes(body.accountAction as typeof ACTIONS[number]))invalid();
 const fields:Record<string,string[]>={analyticsInterpret:['prompt'],analyticsRun:['query'],analyticsList:[],analyticsSave:['id','revision','name','query','requestId'],analyticsDelete:['id','revision']};
 if(Object.keys(body).some(key=>key!=='accountAction'&&!fields[body.accountAction as string].includes(key)))invalid();
 if(body.accountAction==='analyticsInterpret'){
  if(typeof body.prompt!=='string'||body.prompt.trim().length<4||body.prompt.length>1600||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}<>]/u.test(body.prompt))invalid('Escribe una petición de entre 4 y 1.600 caracteres.');
  return 'expensive';
 }
 if(body.accountAction==='analyticsRun'||body.accountAction==='analyticsSave'){
  try{validateAnalyticsQuery(body.query);}catch(error){if(error instanceof AnalyticsValidationError)throw new AnalyticsError(error.message);throw error;}
 }
 if(body.accountAction==='analyticsSave'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||/[\p{Cc}\p{Cf}<>]/u.test(body.name))invalid('Indica un nombre de hasta 100 caracteres.');
  if(body.id!==undefined){id(body.id);if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)invalid();}
  else{if(body.revision!==undefined)invalid();id(body.requestId);}
  if(body.requestId!==undefined)id(body.requestId);
 }
 if(body.accountAction==='analyticsDelete'){id(body.id);if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)invalid();}
 return body.accountAction==='analyticsRun'?'data':'account';
}

/** Only persisted valuations are read. No order, cash command, refresh or write
 * can be triggered by an Analytics request. The existing private simulator
 * remains restricted to its pinned administrator. */
export async function analyticsPortfolio(uid:string,email:string,portfolioId:string|undefined,deps:AnalyticsServiceDependencies):Promise<AnalyticsPortfolioInput|null>{
 if(email.toLowerCase()!=='linoramc@gmail.com'||!await (deps.isAdmin??(userId=>deps.rpc('beta_is_admin',{uid:userId})))(uid))throw new AnalyticsError('El portfolio simulado es privado del administrador.',403);
 const raw=await deps.rpc('beta_analytics_portfolio',{uid,pid:portfolioId??null});
 if(!raw)return null;
 const state=raw.state as PortfolioState,now=(deps.now??Date.now)(),metrics=portfolioMetrics(state,{quotes:state.marks??[],benchmark:null},now);
 return {id:raw.id,currency:state.currency,asOf:new Date(state.updatedAt).toISOString(),equity:metrics.equity,cash:state.cash,positions:metrics.positions.filter(p=>p.quantity!==0).map(p=>({symbol:p.symbol,quantity:p.quantity,marketValue:p.marketValue,currency:state.currency,priceAt:p.quoteAt?new Date(p.quoteAt).toISOString():null})),notes:[`Cartera: ${raw.name}. Valoración persistida; consultar Analytics no modifica operaciones ni adelanta su valoración.`,...(metrics.coverage==='complete'?[]:['Valoración parcial: las posiciones sin precio conservan exposición desconocida.']),...(now-state.updatedAt>300000?['La valoración del portfolio tiene más de cinco minutos; actualízala desde Portfolio.']:[])]};
}

export async function handleAnalyticsAction(body:Body,user:User,deps:AnalyticsServiceDependencies):Promise<Response|null>{
 if(!analyticsRequestClass(body))return null;
 const store=(operation:string,payload:Body={})=>deps.rpc('beta_analytics_store',{operation,uid:user.id,payload});
 try{
  if(body.accountAction==='analyticsList')return Response.json({items:await store('list')});
  if(body.accountAction==='analyticsDelete'){await store('delete',{id:body.id,revision:body.revision});return Response.json({ok:true});}
  if(body.accountAction==='analyticsSave')return Response.json(await store('save',{name:(body.name as string).trim(),query:validateAnalyticsQuery(body.query),...(body.id?{id:body.id,revision:body.revision}:{}),...(body.requestId?{requestId:body.requestId}:{})}));
  if(body.accountAction==='analyticsInterpret')return Response.json(await (deps.interpret??interpretAnalytics)((body.prompt as string).trim(),deps.env('GEMINI_API_KEY')||deps.env('Gemini')||deps.env('GOOGLE_API_KEY')));
  const query=validateAnalyticsQuery(body.query),result=await (deps.execute??executeAnalytics)(query,{...deps.data,now:(deps.now??Date.now)(),portfolio:pid=>analyticsPortfolio(user.id,user.email,pid,deps)});
  return Response.json(result);
 }catch(error){
  if(error instanceof AnalyticsError)throw error;
  if(error instanceof AnalyticsValidationError)throw new AnalyticsError(error.message,error.code==='forbidden'?403:error.code==='unavailable'?503:400);
  throw new AnalyticsError('Analytics no está disponible temporalmente. Tu consulta guardada se conserva.',503);
 }
}

import {createPortfolioState,applyPortfolioCommand,advancePortfolio,applyCorporateActions,portfolioMetrics,PortfolioError as ModelError,type PortfolioRecord,type PortfolioState,type PortfolioMarket,type PortfolioQuote,type PortfolioCommand} from './portfolio-model.ts';
import {loadPortfolioMarket,type PortfolioMarketResult} from './portfolio-market.ts';
import {PortfolioError,validatePortfolioRequest} from './portfolio-request.ts';
import {buildPortfolioAnalytics,type PortfolioAnalytics} from './portfolio-analytics.ts';
type Row=Record<string,any>;
type Store=(operation:string,uid?:string,pid?:string,version?:number,payload?:unknown)=>Promise<any>;
export type PortfolioLabDependencies={store?:Store;market?:(symbols:string[],now:number)=>Promise<PortfolioMarketResult>;analytics?:(state:PortfolioState,now:number)=>Promise<PortfolioAnalytics>;now?:()=>number};
export class StoreError extends PortfolioError{code:string;constructor(code:string,message:string,status=409){super(message,status);this.code=code;}}
const storeErrors:Record<string,[number,string]>={FORBIDDEN:[403,'Este laboratorio es privado del administrador.'],NOT_FOUND:[404,'No se ha encontrado la cartera.'],INVALID:[400,'La cartera contiene datos no válidos.'],CONFLICT:[409,'La cartera ha cambiado. Actualiza antes de continuar.'],ARCHIVED:[409,'Restaura la cartera antes de modificarla.'],ACTIVE_LIMIT:[409,'Puedes mantener hasta tres carteras de prueba activas.'],STORAGE_LIMIT:[409,'Has alcanzado el límite de carteras archivadas.']};
async function serviceStore(operation:string,uid?:string,pid?:string,version?:number,payload?:unknown):Promise<any>{
 const env=(globalThis as any).Deno?.env,key=env?.get('SUPABASE_SERVICE_ROLE_KEY'),base=env?.get('SUPABASE_URL');if(!key||!base)throw new PortfolioError('El almacenamiento del laboratorio no está disponible.',503);
 const r=await fetch(base+'/rest/v1/rpc/beta_portfolio_store',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({operation,uid:uid??null,pid:pid??null,expected_version:version??null,payload:payload??null}),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok){const detail=(await r.text()).slice(0,2000),code=detail.match(/BETA_PORTFOLIO_(FORBIDDEN|NOT_FOUND|INVALID|CONFLICT|ARCHIVED|ACTIVE_LIMIT|STORAGE_LIMIT)/)?.[1];if(code){const [status,message]=storeErrors[code];throw new StoreError(code,message,status);}throw new PortfolioError('No se ha podido guardar la cartera. Vuelve a intentarlo.',503);}return r.json();
}
const emptyMarket:PortfolioMarket={quotes:[],benchmark:null};
const activeOrder=(o:any)=>o.status==='open'||o.status==='partial';
const symbols=(s:PortfolioState)=>[...new Set([...s.positions.map(p=>p.symbol),...s.orders.filter(activeOrder).map(o=>o.symbol)])];
const thinQuote=(q:PortfolioQuote)=>{const {bars,...quote}=q;return quote;};
const publicMarket=(market:PortfolioMarket)=>({quotes:market.quotes.map(thinQuote),benchmark:market.benchmark?thinQuote(market.benchmark):null});
function result(portfolio:PortfolioRecord,market:PortfolioMarket,now:number){return {portfolio,metrics:portfolioMetrics(portfolio.state,market,now),market:publicMarket(market),asOf:new Date(now).toISOString()};}
function command(body:Row):PortfolioCommand{
 const id=body.requestId;
 if(body.action==='order')return {id,type:'order',order:body.order};
 if(body.action==='cancel')return {id,type:'cancel',orderId:body.orderId};
 if(body.action==='cash')return {id,type:'cash',amount:body.kind==='withdrawal'?-body.amount:body.amount};
 if(body.action==='settings')return {id,type:'settings',settings:{flatFee:body.feePerOrder,slippageBps:body.slippageBps}};
 return {id,type:'journal',note:body.note};
}
async function childId(requestId:string,orderId:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestId+':'+orderId))).slice(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
const archivedMarket=(record:PortfolioRecord):PortfolioMarket=>({quotes:record.state.marks??[],benchmark:(record.state.marks??[]).find(q=>q.symbol==='SPY')??null});
/** Commands and execution observations are committed together through a CAS.
 * No caller-supplied prices or balances cross this boundary. */
export async function handlePortfolioLab(body:Row,uid:string,deps:PortfolioLabDependencies={}):Promise<any>{
 validatePortfolioRequest(body);const store=deps.store??serviceStore,load=deps.market??loadPortfolioMarket,now=(deps.now??Date.now)();
 if(body.action==='list')return {portfolios:await store('list',uid)};
 if(body.action==='create'){const record:PortfolioRecord=await store('create',uid,undefined,undefined,{name:body.name.trim(),requestId:body.requestId,state:createPortfolioState(body.initialCash,now)});return result(record,emptyMarket,now);}
 let record:PortfolioRecord=await store('get',uid,body.portfolioId);
 if(body.action==='risk')return {analytics:await (deps.analytics??buildPortfolioAnalytics)(record.state,record.archived?record.state.updatedAt:now)};
 if(body.action==='rename'){
  for(let attempt=0;attempt<3;attempt++)try{const renamed:PortfolioRecord=await store('rename',uid,record.id,record.version,{name:body.name.trim(),requestId:body.requestId});return result(renamed,archivedMarket(renamed),renamed.state.updatedAt);}catch(error){if(error instanceof StoreError&&error.code==='CONFLICT'&&attempt<2){record=await store('get',uid,record.id);continue;}throw error;}
 }
 if(body.action==='quote'){
  if(record.archived)throw new PortfolioError('Restaura la cartera para preparar una operación.',409);
  const loaded=await load([body.symbol],now),quote=loaded.market.quotes.find(q=>q.symbol===body.symbol);if(!quote)throw new PortfolioError('No hay una cotización verificada para ese activo estadounidense en USD. Comprueba el ticker.',404);
  return {quote:thinQuote(quote),asOf:new Date(now).toISOString()};
 }
 if(body.action==='archive'&&!body.archived){const restored:PortfolioRecord=record.archived?await store('restore',uid,record.id,record.version):record;return result(restored,archivedMarket(restored),restored.state.updatedAt);}
 if(record.archived){if(body.action==='snapshot'||body.action==='archive')return result(record,archivedMarket(record),record.state.updatedAt);throw new PortfolioError('Restaura la cartera antes de modificarla.',409);}
 if(body.action==='snapshot'&&typeof record.state.lastAdvancedAt==='number'&&now>=record.state.lastAdvancedAt&&now-record.state.lastAdvancedAt<(record.state.orders.some(activeOrder)?60000:300000))return result(record,archivedMarket(record),now);
 const requested=body.action==='order'?body.order.symbol:null,loaded=await load([...symbols(record.state),...(requested?[requested]:[])],now),market=loaded.market;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const clock=(deps.now??Date.now)(),applyAt=Math.max(clock,record.state.updatedAt);if(applyAt>clock+60000)throw new PortfolioError('La cartera está pendiente de sincronizar su fecha. Vuelve a intentarlo.',409);
   let state=advancePortfolio(applyCorporateActions(record.state,loaded.actions,market,applyAt),market,applyAt);
   if(body.action==='archive'){
    for(const order of state.orders.filter(activeOrder))state=applyPortfolioCommand(state,{id:await childId(body.requestId,order.id),type:'cancel',orderId:order.id},market,applyAt);
    state=applyPortfolioCommand(state,{id:body.requestId,type:'journal',note:'Cartera archivada. Las órdenes pendientes se han cancelado.'},market,applyAt);
   }else if(body.action!=='snapshot')state=applyPortfolioCommand(state,command(body),market,applyAt);
   const saved:PortfolioRecord=await store('save',uid,record.id,record.version,{state});
   const final:PortfolioRecord=body.action==='archive'?await store('archive',uid,record.id,saved.version):saved;
   return result(final,market,applyAt);
  }catch(error){if(error instanceof StoreError&&error.code==='CONFLICT'&&attempt<2){record=await store('get',uid,record.id);if(record.archived){if(body.action==='snapshot'||body.action==='archive')return result(record,archivedMarket(record),record.state.updatedAt);throw new PortfolioError('La cartera se ha archivado mientras preparabas la operación.',409);}continue;}throw error;}
 }
 throw new PortfolioError('La cartera se está actualizando. Inténtalo de nuevo.',409);
}
export async function portfolioLabResponse(body:Row,uid:string){try{return Response.json(await handlePortfolioLab(body,uid));}catch(error){if(error instanceof PortfolioError)return Response.json({error:error.message},{status:error.status});if(error instanceof ModelError)return Response.json({error:error.message},{status:400});return Response.json({error:'No se ha podido actualizar el simulador. Se conserva la cartera guardada.'},{status:503});}}
export async function runPortfolioWorker(deps:PortfolioLabDependencies={}){
 const store=deps.store??serviceStore,load=deps.market??loadPortfolioMarket,now=(deps.now??Date.now)(),all:(PortfolioRecord&{userId:string})[]=await store('due'),due=all.filter(p=>p.state.orders.some(activeOrder)||p.state.positions.length>0&&(!p.state.lastAdvancedAt||now-p.state.lastAdvancedAt>=300000));
 if(!due.length)return {checked:0,updated:0,failed:0};const loaded=await load([...new Set(due.flatMap(p=>symbols(p.state)))],now);let updated=0,failed=0;
 for(let record of due){const owner=record.userId;try{for(let attempt=0;attempt<3;attempt++){try{const clock=(deps.now??Date.now)(),applyAt=Math.max(clock,record.state.updatedAt);if(applyAt>clock+60000)throw new PortfolioError('Fecha no sincronizada.',409);const state=advancePortfolio(applyCorporateActions(record.state,loaded.actions,loaded.market,applyAt),loaded.market,applyAt);await store('save',owner,record.id,record.version,{state});updated++;break;}catch(error){if(error instanceof StoreError&&error.code==='CONFLICT'&&attempt<2){record=await store('get',owner,record.id);if(record.archived)break;continue;}throw error;}}}catch{failed++;}}
 return {checked:due.length,updated,failed};
}

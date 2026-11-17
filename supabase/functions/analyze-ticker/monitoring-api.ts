import {MONITOR_FIELDS,type MonitorContext,type MonitorOverview,type MonitorPosition,type MonitorSnapshot} from './monitoring-types.ts';
import {portfolioMetrics,type PortfolioState} from './portfolio-model.ts';
import {buildMonitoringAgenda} from './monitoring-engine.ts';

type Row=Record<string,any>;
type Store=(operation:string,uid:string|null,payload?:Row)=>Promise<any>;
export class MonitoringError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYMBOL=/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/;
const ACTIONS=new Set(['monitorVisit','monitorStatus','monitorOpen','monitorList','monitorRead','monitorSaveAlert','monitorDeleteAlert','monitorPauseAlert','monitorWatchlist','monitorSaveWatchlist','monitorInbox','monitorAlertHistory']);
const invalid=()=>{throw new MonitoringError('Configuración de seguimiento inválida.');};
export function validateMonitoringRequest(body:Row):boolean{
 if(!ACTIONS.has(body.accountAction))return false;
 const allowed:Record<string,string[]>={monitorWatchlist:[],monitorSaveWatchlist:['symbols','revision'],monitorInbox:['before','alertId','unreadOnly'],monitorAlertHistory:['before','alertId'],monitorVisit:['visitId'],monitorStatus:[],monitorOpen:['visitId'],monitorList:['visitId','before','unreadOnly'],monitorRead:['ids'],monitorSaveAlert:['id','revision','requestId','symbol','name','conditions','enabled'],monitorDeleteAlert:['id','revision'],monitorPauseAlert:['id','revision','enabled']};
 if(Object.keys(body).some(k=>k!=='accountAction'&&!allowed[body.accountAction].includes(k)))invalid();
 if(body.accountAction==='monitorWatchlist')return true;
 if(body.accountAction==='monitorSaveWatchlist'){
  if(!Array.isArray(body.symbols)||body.symbols.length>7||body.symbols.some((symbol:unknown)=>typeof symbol!=='string'||!SYMBOL.test(symbol))||new Set(body.symbols).size!==body.symbols.length||!Number.isSafeInteger(body.revision)||body.revision<1)invalid();
  return true;
 }
 if(['monitorInbox','monitorAlertHistory'].includes(body.accountAction)){
  if(body.alertId!==undefined&&(typeof body.alertId!=='string'||!UUID.test(body.alertId)))invalid();
  if(body.unreadOnly!==undefined&&typeof body.unreadOnly!=='boolean')invalid();
  if(body.before!==undefined&&(!body.before||typeof body.before!=='object'||Array.isArray(body.before)||Object.keys(body.before).some(k=>!['at','id'].includes(k))||typeof body.before.at!=='string'||body.before.at.length>40||!Number.isFinite(Date.parse(body.before.at))||typeof body.before.id!=='string'||!UUID.test(body.before.id)))invalid();
  return true;
 }
 if(['monitorVisit','monitorOpen','monitorList'].includes(body.accountAction)){
  if(!UUID.test(body.visitId??''))invalid();
  if(body.before!==undefined&&(typeof body.before!=='string'||!Number.isFinite(Date.parse(body.before))||body.before.length>40))invalid();
  if(body.unreadOnly!==undefined&&typeof body.unreadOnly!=='boolean')invalid();
 }else if(body.accountAction==='monitorRead'){
  if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>100||body.ids.some((id:unknown)=>typeof id!=='string'||!UUID.test(id))||new Set(body.ids).size!==body.ids.length)invalid();
 }else if(body.accountAction!=='monitorStatus'){
  if(body.id!==undefined&&(!UUID.test(body.id)||!Number.isSafeInteger(body.revision)||body.revision<1))invalid();
  if(body.accountAction!=='monitorSaveAlert'&&!body.id)invalid();
  if(body.accountAction==='monitorSaveAlert'){
   if(!body.id&&!UUID.test(body.requestId??'')||body.requestId!==undefined&&!UUID.test(body.requestId)||typeof body.symbol!=='string'||!SYMBOL.test(body.symbol)||typeof body.name!=='string'||body.name.trim().length<1||body.name.length>80||/[<>\p{Cc}\p{Cf}]/u.test(body.name)||typeof body.enabled!=='boolean')invalid();
   if(!Array.isArray(body.conditions)||body.conditions.length<1||body.conditions.length>5)invalid();
   for(const c of body.conditions){if(!c||Array.isArray(c)||typeof c!=='object'||Object.keys(c).some(k=>!['field','op','value','currency','period'].includes(k))||!MONITOR_FIELDS.includes(c.field)||!['gt','gte','lt','lte'].includes(c.op)||typeof c.value!=='number'||!Number.isFinite(c.value)||Math.abs(c.value)>(c.field==='marketCap'?1e16:1e12))invalid();
    if(['price','marketCap','epsEstimate'].includes(c.field)&&!(/^[A-Z]{3}$/.test(c.currency??'')))invalid();
    if(c.currency!==undefined&&!/^[A-Z]{3}$/.test(c.currency))invalid();
    if(c.period!==undefined&&(typeof c.period!=='string'||c.period.length>40||!/^[\w .:/-]+$/.test(c.period)))invalid();
    if(['price','marketCap','earningsWithinDays'].includes(c.field)&&c.value<0||c.field==='earningsWithinDays'&&(!Number.isInteger(c.value)||c.value>90)||c.field==='changePct'&&Math.abs(c.value)>10000)invalid();
   }
  }else if(body.accountAction==='monitorPauseAlert'&&typeof body.enabled!=='boolean')invalid();
 }
 return true;
}
export function monitoringContext(raw:Row,now=Date.now()):MonitorContext{
 const positions:MonitorPosition[]=[],coverage:string[]=Array.isArray(raw.coverage)?raw.coverage.filter((s:unknown)=>typeof s==='string'):[];
 for(const portfolio of raw.portfolios??[]){try{const state=portfolio.state as PortfolioState,metrics=portfolioMetrics(state,{quotes:state.marks??[],benchmark:null},now);for(const p of metrics.positions)if(p.quantity!==0)positions.push({portfolioId:portfolio.id,portfolioName:portfolio.name,symbol:p.symbol,quantity:p.quantity,marketValue:p.marketValue,currency:state.currency,quoteAt:p.quoteAt?new Date(p.quoteAt).toISOString():null,equity:metrics.equity});if(metrics.coverage!=='complete')coverage.push(portfolio.name+': valoración parcial; exposición desconocida conservada como no disponible.');}catch{coverage.push('Una cartera no dispone de valoración verificable.');}}
 const snapshots:MonitorSnapshot[]=Array.isArray(raw.snapshots)?raw.snapshots:[];
 for(const snapshot of snapshots)for(const note of snapshot.coverage??[])coverage.push(snapshot.symbol+' · '+note);
 return {watchlist:raw.watchlist??[],symbols:raw.symbols??[],positions,snapshots,coverage:[...new Set(coverage)].slice(0,50)};
}
export async function handleMonitoringAction(body:Row,uid:string,deps:{store:Store;following?:Store;now?:()=>number}):Promise<Response|null>{
 if(!validateMonitoringRequest(body))return null;
 const store=(op:string,payload:Row={})=>deps.store(op,uid,payload),now=(deps.now??Date.now)();
 if(['monitorWatchlist','monitorSaveWatchlist','monitorInbox','monitorAlertHistory'].includes(body.accountAction)){
  if(!deps.following)throw new MonitoringError('El espacio de seguimiento no está disponible temporalmente.',503);
  const operation={monitorWatchlist:'watchlist',monitorSaveWatchlist:'save_watchlist',monitorInbox:'inbox',monitorAlertHistory:'alert_history'}[body.accountAction as string];
  const {accountAction,...payload}=body;return Response.json(await deps.following(operation,uid,payload));
 }
 if(body.accountAction==='monitorVisit')return Response.json(await store('visit',{visitId:body.visitId}));
 if(body.accountAction==='monitorStatus'){const [data,state]=await Promise.all([store('list'),deps.following?.('state',uid,{})]);return Response.json({unread:state?.unread??data.unread,lastCollectedAt:data.lastCollectedAt});}
 if(body.accountAction==='monitorRead'){await store('read',{ids:body.ids});if(deps.following)await deps.following('read',uid,{ids:body.ids});return Response.json({ok:true});}
 if(body.accountAction==='monitorSaveAlert'){const {accountAction,...payload}=body;return Response.json(await store('save_alert',payload));}
 if(body.accountAction==='monitorDeleteAlert'){await store('delete_alert',{id:body.id,revision:body.revision});return Response.json({ok:true});}
 if(body.accountAction==='monitorPauseAlert')return Response.json(await store('pause_alert',{id:body.id,revision:body.revision,enabled:body.enabled}));
 const visit=await store('visit',{visitId:body.visitId});
 // Initialize the independent list before subscriptions/context are queried.
 const state=deps.following?await deps.following('state',uid,{}):null;
 const [raw,rows]=await Promise.all([store('context'),store('list',{...(body.before?{before:body.before}:{}),...(body.unreadOnly?{unreadOnly:true}:{})})]);
 if(state){raw.watchlist=state.watchlist;rows.unread=state.unread;}
 const context=monitoringContext(raw,now),result:MonitorOverview={...rows,baseline:visit.baseline,visitAt:visit.visitAt,context,agenda:buildMonitoringAgenda(context,now)};
 return Response.json(result);
}

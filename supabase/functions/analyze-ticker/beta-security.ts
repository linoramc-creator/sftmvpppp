type Body = Record<string, any>;
type User = { id: string; email: string; email_confirmed_at?: string };
const SITE = 'https://sftmvpppp.vercel.app';
const ORIGINS = new Set([SITE, 'http://127.0.0.1:4173', 'http://localhost:5173']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYMBOL = /^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/;
export class BetaError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
const env = (key: string) => Deno.env.get(key) ?? '';
async function service(path: string, init: RequestInit = {}) {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { ...init, headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type':'application/json', ...init.headers }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const message = (await response.text()).slice(0,2000);
    if (message.includes('BETA_REVOKED')) throw new BetaError(403,'Tu acceso está revocado. Contacta con el administrador.');
    if (message.includes('BETA_BUSY')) throw new BetaError(429,'Ya tienes un informe en curso. Espera a que termine.');
    if (message.includes('BETA_STORAGE_LIMIT')) throw new BetaError(409,'Has alcanzado los 100 informes guardados. Elimina alguno antes de guardar otro.');
    if (message.includes('BETA_LIMIT')) throw new BetaError(429,'Has alcanzado un límite de uso de la beta. Inténtalo más tarde.');
    if (message.includes('BETA_FORBIDDEN')) throw new BetaError(403,'No tienes permiso para esta operación.');
    throw new BetaError(503,'El servicio no está disponible temporalmente.');
  }
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
const rpc = (name: string, body: Body) => service(`rpc/${name}`, {method:'POST',body:JSON.stringify(body)});
export async function readBody(req: Request): Promise<Body> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new BetaError(415,'Formato de petición inválido.');
  const reader = req.body?.getReader(); if (!reader) throw new BetaError(400,'Petición vacía.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength;
    if(size>520000){await reader.cancel();throw new BetaError(413,'La petición es demasiado grande.');} chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body: unknown;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new BetaError(400,'JSON inválido.');}
  if(!body||Array.isArray(body)||typeof body!=='object')throw new BetaError(400,'Petición inválida.');
  if((body as Body).accountAction!=='saveReport'&&size>4096)throw new BetaError(413,'La petición es demasiado grande.');
  return body as Body;
}
export function classify(body: Body): {request_class:string;report_kind?:string;report_subject?:string} {
  const symbol = (v: unknown) => typeof v==='string'&&SYMBOL.test(v.trim().toUpperCase());
  if(body.ticker!==undefined&&!symbol(body.ticker))throw new BetaError(400,'Ticker inválido.');
  if(body.subject!==undefined&&body.panel!=='bonds'&&(typeof body.subject!=='string'||body.subject.trim().length<1||body.subject.length>80))throw new BetaError(400,'Activo inválido.');
  if(body.accountAction) return {request_class:'account'};
  if(body.panel){
    if(!['bonds','news','institutional','business'].includes(body.panel))throw new BetaError(400,'Panel inválido.');
    if(body.panel!=='bonds' && !(body.panel==='news'&&body.sector===true) && !symbol(body.subject))throw new BetaError(400,'Ticker inválido.');
    return {request_class:['news','business'].includes(body.panel)?'expensive':'data'};
  }
  if(body.marketData===true){if(body.symbols!==undefined&&(!Array.isArray(body.symbols)||body.symbols.length>6||body.symbols.some((s:unknown)=>!symbol(s))))throw new BetaError(400,'Lista de activos inválida.');return {request_class:'data'};}
  if(body.macroCalendar===true)return {request_class:'data'};
  if(body.optionsAction){if(!['expiries','chain','aggregations','skew','surface','term-structure','ivhv'].includes(body.optionsAction)||!symbol(body.ticker))throw new BetaError(400,'Consulta de opciones inválida.');if(body.expiry!==undefined&&(typeof body.expiry!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.expiry)))throw new BetaError(400,'Vencimiento inválido.');if(body.window!==undefined&&(!Number.isInteger(body.window)||body.window<5||body.window>252))throw new BetaError(400,'Ventana inválida.');return {request_class:'data'};}
  if(body.fundamentals===true||body.risk===true||body.etf===true||body.technicals===true){if(!symbol(body.ticker))throw new BetaError(400,'Ticker inválido.');return {request_class:body.etf===true?'expensive':'data'};}
  if(body.sector!==undefined){if(typeof body.sector!=='string'||! /^[\p{L}\p{N} &.,()/-]{2,80}$/u.test(body.sector.trim()))throw new BetaError(400,'Sector inválido.');return {request_class:'report',report_kind:'sector',report_subject:body.sector.trim()};}
  if(symbol(body.ticker))return {request_class:'report',report_kind:body.etfReport===true?'etf':'ticker',report_subject:body.ticker.trim().toUpperCase()};
  throw new BetaError(400,'Petición inválida.');
}
async function userFrom(req: Request): Promise<User> {
  const authorization=req.headers.get('authorization')??'';
  if(!/^Bearer \S{20,4096}$/i.test(authorization))throw new BetaError(401,'Inicia sesión para continuar.');
  const response=await fetch(`${env('SUPABASE_URL')}/auth/v1/user`,{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:authorization},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new BetaError(401,'Tu sesión ha caducado. Vuelve a entrar.');
  const user=await response.json();
  if(!UUID.test(user.id??'')||!user.email||!user.email_confirmed_at)throw new BetaError(403,'Confirma tu e-mail para acceder.');
  if(!await rpc('beta_active_user',{uid:user.id}))throw new BetaError(403,'Tu acceso está revocado. Contacta con el administrador.');
  return user;
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function account(body: Body,user: User): Promise<Response> {
  switch(body.accountAction){
    case 'profile':return json({id:user.id,email:user.email,isAdmin:await rpc('beta_is_admin',{uid:user.id}),dailyReportLimit:20});
    case 'listReports':return json(await service(`beta_reports?user_id=eq.${user.id}&select=id,kind,subject,saved_at&order=saved_at.desc&limit=100`));
    case 'getReport':{if(!UUID.test(body.id??''))throw new BetaError(400,'Informe inválido.');const rows=await service(`beta_reports?id=eq.${body.id}&user_id=eq.${user.id}&select=*&limit=1`);if(!rows.length)throw new BetaError(404,'Informe no encontrado.');return json(rows[0]);}
    case 'saveReport':{
      const {kind,subject,payload}=body;
      if(!['ticker','etf','sector'].includes(kind)||typeof subject!=='string'||!subject.trim()||subject.length>80||!payload||typeof payload.analysis!=='string'||payload.analysis.length<1||payload.analysis.length>250000||!Array.isArray(payload.quarterlyData)||payload.quarterlyData.length>40)throw new BetaError(400,'Informe inválido.');
      const cleaned={analysis:payload.analysis,quarterlyData:payload.quarterlyData,etfDeep:kind==='etf'?payload.etfDeep??null:null};
      return json(await rpc('beta_save_report',{uid:user.id,report_kind:kind,report_subject:subject.trim(),report_payload:cleaned}));
    }
    case 'deleteReport':if(!UUID.test(body.id??''))throw new BetaError(400,'Informe inválido.');await service(`beta_reports?id=eq.${body.id}&user_id=eq.${user.id}`,{method:'DELETE'});return json({ok:true});
    case 'adminOverview':{
      if(body.targetId!==undefined&&body.targetId!==null&&!UUID.test(body.targetId))throw new BetaError(400,'Usuario inválido.');
      return json(await rpc('beta_admin_overview',{admin_uid:user.id,page_number:Number.isInteger(body.page)?Math.max(0,Math.min(10000,body.page)):0,target_uid:body.targetId??null}));
    }
    case 'adminRevoke':if(!UUID.test(body.targetId??'')||typeof body.revoked!=='boolean')throw new BetaError(400,'Usuario inválido.');await rpc('beta_set_revoked',{admin_uid:user.id,target_uid:body.targetId,revoke_access:body.revoked});return json({ok:true});
    default:throw new BetaError(400,'Operación inválida.');
  }
}
async function finish(id: string,status: string){try{await service(`beta_usage?id=eq.${id}&status=eq.started`,{method:'PATCH',body:JSON.stringify({status,finished_at:new Date().toISOString()})});}catch{console.error('Could not finalize usage record');}}
function tracked(response: Response,id: string): Response {
  if(!response.ok||!response.body){void finish(id,'failed');return response;}
  const reader=response.body.getReader();const decoder=new TextDecoder();let tail='',doneEvent=false,failed=false;
  const body=new ReadableStream<Uint8Array>({
    async pull(controller){try{const part=await reader.read();if(part.done){await finish(id,doneEvent&&!failed?'completed':'failed');controller.close();return;}
      tail=(tail+decoder.decode(part.value,{stream:true})).slice(-2048);if(tail.includes('data: [DONE]'))doneEvent=true;if(/data: \{\s*"(?:__)?error"/.test(tail))failed=true;controller.enqueue(part.value);
    }catch{await finish(id,'failed');controller.error(new Error('La generación se interrumpió.'));}},
    async cancel(){try{await reader.cancel();}finally{await finish(id,'cancelled');}}
  });return new Response(body,{status:response.status,headers:response.headers});
}
export async function secureRequest(req: Request,dispatch: (body:Body)=>Promise<Response>): Promise<Response> {
  const origin=req.headers.get('origin');
  const headers={'Access-Control-Allow-Origin':origin&&ORIGINS.has(origin)?origin:SITE,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const wrap=(r:Response)=>{const h=new Headers(r.headers);for(const[k,v]of Object.entries(headers))h.set(k,v);return new Response(r.body,{status:r.status,headers:h});};
  let eventId:string|null=null;
  try{
    if(origin&&!ORIGINS.has(origin))throw new BetaError(403,'Origen no permitido.');
    if(req.method==='OPTIONS')return wrap(new Response(null,{status:204}));
    if(req.method!=='POST')throw new BetaError(405,'Método no permitido.');
    // Verify identity before parsing payloads or contacting paid data providers.
    const user=await userFrom(req);const body=await readBody(req);const request=classify(body);
    eventId=await rpc('beta_reserve',{uid:user.id,request_class:request.request_class,report_kind:request.report_kind??null,report_subject:request.report_subject??null});
    const response=body.accountAction?await account(body,user):await dispatch(body);
    return wrap(eventId?tracked(response,eventId):response);
  }catch(error){if(eventId)await finish(eventId,'failed');return wrap(json({error:error instanceof BetaError?error.message:'No se ha podido completar la solicitud.'},error instanceof BetaError?error.status:503));}
}

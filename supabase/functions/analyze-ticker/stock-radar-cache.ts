type Payload={fetchedAt:string;status:string;horizonMonths:number;candidates:unknown[]};
type Claim<T>={state:'ready'|'building'|'cooling'|'claimed';payload:T|null;token?:string};
type Rpc=(operation:'claim'|'finish'|'fail',token?:string,output?:unknown)=>Promise<unknown>;
export type RadarResult<T>={status:200;data:T&{refreshing?:boolean}}|{status:202;data:{status:'building';retryAfterSeconds:8}}|{status:503;data:{error:string}};
const active=new Map<string,Promise<unknown>>();
const safePayload=(p:unknown):p is Payload=>!!p&&typeof p==='object'&&Array.isArray((p as Payload).candidates)&&(p as Payload).candidates.length>0&&['ready','partial'].includes((p as Payload).status)&&(p as Payload).horizonMonths===6&&Number.isFinite(Date.parse((p as Payload).fetchedAt));
async function serviceRpc(operation:'claim'|'finish'|'fail',token?:string,output?:unknown):Promise<unknown>{
 const env=(globalThis as any).Deno?.env,base=env?.get('SUPABASE_URL'),secret=env?.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!secret)throw Error('RADAR_CACHE_UNAVAILABLE');
 const response=await fetch(base+'/rest/v1/rpc/beta_stock_radar_job',{method:'POST',headers:{'Content-Type':'application/json',apikey:secret,Authorization:'Bearer '+secret},body:JSON.stringify({operation,claim_token:token??null,output:output??null}),signal:AbortSignal.timeout(5000)});
 if(!response.ok){await response.body?.cancel();throw Error('RADAR_CACHE_UNAVAILABLE');}return response.json();
}
/** Acquire the durable global lease before any paid market-data work. A cache
 * failure never falls through into an unbounded provider rebuild per visitor. */
export async function sharedStockRadar<T extends Payload>(create:()=>Promise<T>,options:{rpc?:Rpc;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void}={}):Promise<RadarResult<T>>{
 const rpc=options.rpc??serviceRpc,now=options.now??Date.now;let claim:Claim<T>;
 try{claim=await rpc('claim') as Claim<T>;}catch{return {status:503,data:{error:'El radar no está disponible temporalmente. Inténtalo más tarde.'}};}
 const prior=safePayload(claim?.payload)&&now()-Date.parse(claim.payload.fetchedAt)<86400000&&Date.parse(claim.payload.fetchedAt)<=now()+60000?claim.payload:null;
 if(claim?.state==='ready'&&prior)return {status:200,data:prior};
 if(claim?.state==='building')return prior?{status:200,data:{...prior,refreshing:true}}:{status:202,data:{status:'building',retryAfterSeconds:8}};
 if(claim?.state==='cooling')return prior?{status:200,data:prior}:{status:503,data:{error:'El radar está pendiente de una actualización de datos. Inténtalo más tarde.'}};
 if(claim?.state!=='claimed'||typeof claim.token!=='string')return {status:503,data:{error:'No se ha podido preparar el radar.'}};
 const token=claim.token,build=async():Promise<RadarResult<T>>=>{
  try{const data=await create();if(safePayload(data)){await rpc('finish',token,data);return {status:200,data};}
   await rpc('fail',token);return prior?{status:200,data:prior}:{status:200,data};
  }catch{try{await rpc('fail',token);}catch{/* Lease expiry permits a later bounded retry. */}return prior?{status:200,data:prior}:{status:503,data:{error:'No se ha podido actualizar el radar. Inténtalo más tarde.'}};}
 };
 let task=active.get(token) as Promise<RadarResult<T>>|undefined;
 if(!task){task=build().finally(()=>active.delete(token));active.set(token,task);}
 const edge=(globalThis as any).EdgeRuntime;
 const waitUntil=options.waitUntil??(edge?.waitUntil?((promise:Promise<unknown>)=>edge.waitUntil(promise)):undefined);
 if(waitUntil){waitUntil(task);return prior?{status:200,data:{...prior,refreshing:true}}:{status:202,data:{status:'building',retryAfterSeconds:8}};}
 return task;
}

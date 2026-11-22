export class AccessCodeError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;this.name='AccessCodeError';}}
export function accessSessionId(authorization:string,userId:string):string|null{
 try{const token=authorization.replace(/^Bearer\s+/i,''),part=token.split('.')[1];if(!part||part.length>8000)return null;const claims=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));return claims.sub===userId&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(claims.session_id??'')?claims.session_id:null;}catch{return null;}
}
/** Called only AFTER GoTrue has verified this exact bearer and its user. */
export async function requireCodeSession(authorization:string,uid:string,rpc:(name:string,body:Record<string,unknown>)=>Promise<unknown>){
 const sid=accessSessionId(authorization,uid);
 if(!sid||await rpc('beta_access_session',{uid,sid})!==true)throw new AccessCodeError(401,'Introduce tu código personal para acceder.');
 return sid;
}

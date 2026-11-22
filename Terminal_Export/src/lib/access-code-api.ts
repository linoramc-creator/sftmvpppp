import type {Session} from '@supabase/supabase-js';
export {generateAccessCode,normalizeAccessCode} from '../../../supabase/functions/analyze-ticker/access-code-format';
export type AccessTokens=Pick<Session,'access_token'|'refresh_token'>;
export async function accessCodeApi<T>(action:string,values:Record<string,string>={},token?:string):Promise<T>{
 const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/terminal-access`,{method:'POST',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...values}),signal:AbortSignal.timeout(45000)});
 const body=await response.json();if(!response.ok)throw new Error(body.error??'No se ha podido completar el acceso.');return body;
}

// Stop repeated paid-discovery attempts when the provider explicitly reports an
// exhausted plan. No keys or provider response bodies are logged or returned.
let unavailableUntil=0;
export const tavilyLimited=()=>Date.now()<unavailableUntil;
export async function tavilyJson(body:Record<string,unknown>,key:string,timeoutMs=12000):Promise<any|null>{
 if(!key||tavilyLimited())return null;
 try{
  const response=await fetch('https://api.tavily.com/'+(Array.isArray(body.urls)?'extract':'search'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,api_key:key}),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  if(!response.ok){if([401,403,432,433].includes(response.status))unavailableUntil=Date.now()+30*60000;await response.body?.cancel();return null;}
  return await response.json();
 }catch{return null;}
}

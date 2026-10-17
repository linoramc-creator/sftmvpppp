// Public market comparisons only; never user profiles, sessions or saved reports.
function settings(){const runtime=globalThis as any,base=runtime.Deno?.env.get('SUPABASE_URL'),key=runtime.Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY');return base&&key?{base,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'}}:null;}
export async function readRelativeCache(key:string):Promise<any|null>{const config=settings();if(!config)return null;try{
 const r=await fetch(`${config.base}/rest/v1/beta_analysis_cache?cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=payload&limit=1`,{headers:config.headers,signal:AbortSignal.timeout(2000)});return r.ok?(await r.json())[0]?.payload??null:null;
}catch{return null;}}
export async function writeRelativeCache(key:string,payload:unknown,ttl:number){const config=settings();if(!config)return;try{
 await fetch(`${config.base}/rest/v1/beta_analysis_cache?on_conflict=cache_key`,{method:'POST',headers:{...config.headers,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({cache_key:key,kind:'relative',subject:key.slice(0,80),payload,expires_at:new Date(Date.now()+ttl).toISOString()}),signal:AbortSignal.timeout(2500)});
}catch{/* The comparison remains available during a cache outage. */}}

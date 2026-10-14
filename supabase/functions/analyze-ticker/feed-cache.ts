// Shared across edge instances. All callers still pass authentication and quotas.
const active=new Map<string,Promise<any>>();
export async function sharedFeed<T extends {fetchedAt:string}>(key:string,create:()=>Promise<T>,options:{ttlMs?:number;maxStaleMs?:number;staleWhileRevalidate?:boolean}={}):Promise<T>{
  const ttl=options.ttlMs??300000,maxStale=options.maxStaleMs??15*60000;
  const runtime=globalThis as any;
  const base=runtime.Deno?.env.get('SUPABASE_URL'),secret=runtime.Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||!secret)return create();
  const headers={'Content-Type':'application/json',apikey:secret,Authorization:`Bearer ${secret}`};
  const endpoint=`${base}/rest/v1/beta_feed_cache`;
  const refresh=()=>{
    if(active.has(key))return active.get(key)! as Promise<T>;
    const task=create().then(async payload=>{
      // Do not replace useful cached data with a total provider outage.
      const p=payload as any;
      const usable=key.includes('markets')?p.groups?.some((g:any)=>g.items?.some((q:any)=>q.price!==null)):p.headlines?.length>0;
      if(usable)try{await fetch(endpoint+'?on_conflict=cache_key',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({cache_key:key,payload,expires_at:new Date(Date.parse(payload.fetchedAt)+ttl).toISOString()}),signal:AbortSignal.timeout(2500)});}catch{/* caching must not fail the feed */}
      return payload;
    }).finally(()=>active.delete(key));active.set(key,task);return task;
  };
  try{
    const response=await fetch(`${endpoint}?cache_key=eq.${encodeURIComponent(key)}&select=payload,expires_at&limit=1`,{headers,signal:AbortSignal.timeout(2000)});
    const hit=response.ok?(await response.json())?.[0]:null;
    if(hit?.payload&&Number.isFinite(Date.parse(hit.payload.fetchedAt))){
      if(Math.min(Date.parse(hit.expires_at),Date.parse(hit.payload.fetchedAt)+ttl)>Date.now())return hit.payload;
      if(options.staleWhileRevalidate!==false&&Date.now()-Date.parse(hit.payload.fetchedAt)<maxStale&&runtime.EdgeRuntime?.waitUntil){runtime.EdgeRuntime.waitUntil(refresh().catch(()=>{}));return hit.payload;}
    }
  }catch{/* use existing providers if database cache is unavailable */}
  return refresh();
}

type Row=Record<string,unknown>;
const readers=new Map<string,ReturnType<typeof createRadarFmpReader>>();
/** Small, fixed endpoint set. A denied statement route is cooled down once
 * across the sample; no client URL, provider diagnostic or credential escapes. */
export function createRadarFmpReader(key:string,fetcher:typeof fetch=fetch,now=Date.now){
 const values=new Map<string,{until:number;data:unknown}>(),denied=new Map<string,number>(),pending=new Map<string,Promise<unknown>>();
 return async(path:string,query:Record<string,string|number>):Promise<unknown>=>{
  if(!key||!['profile','quote','income-statement','cash-flow-statement'].includes(path)||Object.keys(query).some(k=>!['symbol','period','limit'].includes(k))||typeof query.symbol!=='string'||!/^[A-Z][A-Z0-9-]{0,15}$/.test(query.symbol)||query.period!==undefined&&query.period!=='quarter'||query.limit!==undefined&&(!Number.isInteger(query.limit)||Number(query.limit)<1||Number(query.limit)>8))return null;
  if((denied.get(path)??0)>now())return null;const id=path+':'+JSON.stringify(query),cached=values.get(id);if(cached&&cached.until>now())return cached.data;if(pending.has(id))return pending.get(id)!;
  const task=(async()=>{try{const url=new URL('https://financialmodelingprep.com/stable/'+path);for(const [name,value]of Object.entries(query))url.searchParams.set(name,String(value));url.searchParams.set('apikey',key);
   const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok){if([401,402,403,429].includes(response.status))denied.set(path,now()+1800000);await response.body?.cancel();return null;}
   const data=await response.json();if(!Array.isArray(data)||!data.length||data.length>100)return null;const rows=data.filter((r:unknown)=>r&&typeof r==='object'&&!Array.isArray(r)&&(r as Row).symbol===query.symbol);if(!rows.length)return null;
   if(values.size>=80)values.delete(values.keys().next().value!);values.set(id,{until:now()+6*3600000,data:rows});return rows;
  }catch{return null;}})().finally(()=>pending.delete(id));pending.set(id,task);return task;
 };
}
export function radarFmpRead(key:string,path:string,query:Record<string,string|number>):Promise<unknown>{let reader=readers.get(key);if(!reader){if(readers.size>=2)readers.delete(readers.keys().next().value!);reader=createRadarFmpReader(key);readers.set(key,reader);}return reader(path,query);}

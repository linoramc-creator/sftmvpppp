export const PRIMARY_REPORT_MODEL='gemini-3.1-pro-preview';
// Flash is reserved for small auxiliary extraction/translation work, never a
// silent downgrade of a requested research report.
export const REPORT_MODELS=[PRIMARY_REPORT_MODEL,'gemini-3-flash-preview'] as const;
export const REPORT_OUTPUT_TOKENS=14000;
export type GeminiResult={ok:true;response:Response;model:string}|{ok:false;status:number;error:string};
export async function streamReport(messages:unknown[],key:string,fetcher:typeof fetch=fetch):Promise<GeminiResult>{
 for(const model of [PRIMARY_REPORT_MODEL]){
  let response:Response;
  try{response=await fetcher('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({messages,stream:true,model,max_tokens:REPORT_OUTPUT_TOKENS,temperature:0.2,reasoning_effort:'medium'}),signal:AbortSignal.timeout(110000)});}catch{return {ok:false,status:503,error:'La generación se interrumpió. Inténtalo de nuevo.'};}
  if(response.ok)return {ok:true,response,model};
  await response.body?.cancel();
  if([404,429,500,502,503,504].includes(response.status))continue;
  return {ok:false,status:response.status===401||response.status===403?403:503,error:'No se ha podido generar el informe en este momento.'};
 }
 return {ok:false,status:503,error:'La generación no está disponible temporalmente.'};
}
export async function evidenceJson(prompt:string,key:string,options:{timeoutMs?:number;maxTokens?:number;fast?:boolean;grounded?:boolean;thinkingLevel?:'low'|'medium'}={},fetcher:typeof fetch=fetch):Promise<any|null>{
 const deadline=Date.now()+(options.timeoutMs??50000);
 const models=options.fast?[REPORT_MODELS[1]]:[PRIMARY_REPORT_MODEL];
 for(const model of models){try{
  if(deadline-Date.now()<1000)return null;
  const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},redirect:'error',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),body:JSON.stringify({contents:[{parts:[{text:prompt}]}],...(options.grounded?{tools:[{google_search:{}}]}:{}),generationConfig:{temperature:0.1,maxOutputTokens:Math.min(14000,Math.max(512,options.maxTokens??10000)),...(!options.grounded?{responseMimeType:'application/json'}:{}),thinkingConfig:{thinkingLevel:model===PRIMARY_REPORT_MODEL?(options.thinkingLevel??'low'):'minimal'}}})});
  if(!response.ok){await response.body?.cancel();if([404,429,503].includes(response.status))continue;return null;}
  return await response.json();
 }catch{return null;}}
 return null;
}

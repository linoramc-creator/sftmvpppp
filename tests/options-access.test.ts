import test from 'node:test';import assert from 'node:assert/strict';import {testAccessToken} from './access-fixture.ts';
test('legacy options route requires GoTrue verification and a code grant before provider access',async()=>{
 let handler:(r:Request)=>Promise<Response>=null!;
 const originalDeno=(globalThis as any).Deno,originalFetch=globalThis.fetch;const calls:string[]=[];
 (globalThis as any).Deno={env:{get:(key:string)=>({SUPABASE_URL:'https://fixture.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}[key])},serve:(fn:typeof handler)=>{handler=fn;}};
 let granted=false,verified=true;
 globalThis.fetch=async(input,init)=>{const url=String(input);calls.push(url);if(url.endsWith('/auth/v1/user'))return verified?Response.json({id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-11-22'}):new Response(null,{status:401});if(url.endsWith('/rest/v1/rpc/beta_access_session')){assert.equal(new Headers(init?.headers).get('authorization'),'Bearer service');return Response.json(granted);}throw Error('Unexpected provider request before validation');};
 try{
  await import('../supabase/functions/options-data/index.ts');
  const req=(token?:string)=>new Request('https://fixture.test/options-data',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action:'expiries',ticker:'invalid!symbol'})});
  assert.equal((await handler(req())).status,401);assert.equal(calls.length,0);
  const token=testAccessToken('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
  assert.equal((await handler(req(token))).status,401);assert.equal(calls.length,2);
  granted=true;assert.equal((await handler(req(token))).status,400);assert.equal(calls.length,4);
  verified=false;assert.equal((await handler(req(token))).status,401);assert.equal(calls.length,5);
  assert.equal((await handler(new Request('https://fixture.test/options-data'))).status,405);
  assert.equal((await handler(new Request('https://fixture.test/options-data',{method:'POST',headers:{origin:'https://foreign.test'}}))).status,403);
 }finally{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;}
});

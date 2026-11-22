import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accessHandler} from '../supabase/functions/analyze-ticker/access-code-service.ts';
import {generateAccessCode,normalizeAccessCode} from '../supabase/functions/analyze-ticker/access-code-format.ts';
import {accessSessionId,requireCodeSession,AccessCodeError} from '../supabase/functions/analyze-ticker/access-code-session.ts';
import {secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
import {testAccessToken} from './access-fixture.ts';

const uid='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222',legacySid='33333333-3333-4333-8333-333333333333';
const code='MNSR-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF',nextCode='MNSR-FEDC-BA98-7654-3210-FEDC-BA98-7654-3210';
const pepper='test-only-pepper-at-least-thirty-two-characters',url='https://access-fixture.example.test';
const legacyToken=testAccessToken(uid,legacySid),email='fixture@example.test';
type Call={path:string;method:string;body:any;headers:Headers};

async function digest(value:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))).toString('hex');}
async function fixture(options:{hasCode?:boolean;pending?:boolean;active?:boolean;rateAllowed?:boolean;adminUid?:string;linkUid?:string;verifyUid?:string;tokenUid?:string;failPasswords?:number;logoutMissing?:boolean}={}){
 const calls:Call[]=[],grants=new Set<string>(),state={hasCode:options.hasCode??true,pending:options.pending??false,active:options.active??true,rateAllowed:options.rateAllowed??true,version:1,hash:await digest('code:'+normalizeAccessCode(code)),failPasswords:options.failPasswords??0,minted:0};
 const user=(id=uid)=>({id,email:id===uid?email:'foreign@example.test',email_confirmed_at:'2026-11-22T07:00:00Z'});
 const fetcher:typeof fetch=async(input,init)=>{
  const target=new URL(String(input)),path=target.pathname+target.search,method=init?.method??'GET',body=typeof init?.body==='string'?JSON.parse(init.body):null,headers=new Headers(init?.headers);calls.push({path,method,body,headers});
  if(path==='/rest/v1/rpc/beta_access_attempt')return Response.json(state.rateAllowed);
  if(path==='/rest/v1/rpc/beta_active_user')return Response.json(state.active);
  if(path==='/rest/v1/rpc/beta_access_session')return Response.json(body.uid===uid&&grants.has(body.sid));
  if(path==='/rest/v1/rpc/beta_access_store'){
   assert.equal(headers.get('apikey'),'service-fixture');assert.equal(headers.get('Authorization'),'Bearer service-fixture');
   if(body.operation==='find')return Response.json(state.hasCode&&body.payload.digest===state.hash?{userId:uid,version:state.version,state:state.pending?'pending':'active'}:null);
   assert.equal(body.uid,uid);
   if(body.operation==='status')return Response.json({hasCode:state.hasCode,pending:state.pending,version:state.version});
   if(body.operation==='prepare'){state.hash=body.payload.digest;state.version++;state.pending=true;state.hasCode=true;return Response.json({version:state.version});}
   if(body.operation==='activate'){assert.equal(body.payload.digest,state.hash);assert.equal(body.payload.version,state.version);state.pending=false;state.hasCode=true;grants.clear();return Response.json({ok:true});}
   if(body.operation==='grant'){assert.equal(body.payload.digest,state.hash);assert.equal(body.payload.version,state.version);grants.add(body.payload.sessionId);return Response.json({ok:true});}
   if(body.operation==='logout'){grants.delete(body.payload.sessionId);return Response.json({ok:true});}
   throw Error('Unexpected store operation in isolated fixture');
  }
  if(path==='/auth/v1/user')return Response.json(user());
  if(path==='/auth/v1/token?grant_type=password')return Response.json({user:user(),access_token:legacyToken,refresh_token:'legacy-refresh-fixture'});
  if(path==='/auth/v1/admin/users'&&method==='POST')return Response.json(user());
  if(path==='/auth/v1/admin/users/'+uid&&method==='GET')return Response.json(user(options.adminUid));
  if(path==='/auth/v1/admin/users/'+uid&&method==='PUT'){
   if(state.failPasswords-->0)return Response.json({error:'secret-upstream-fixture'}, {status:500});
   return Response.json(user());
  }
  if(path==='/auth/v1/admin/users/'+uid&&method==='DELETE')return new Response(null,{status:204});
  if(path==='/auth/v1/admin/generate_link')return Response.json({user:user(options.linkUid??options.adminUid),properties:{hashed_token:'private-otp-hash-fixture',action_link:'https://private.example.test/otp-secret',email_otp:'12345678'}});
  if(path==='/auth/v1/verify'){state.minted++;return Response.json({user:user(options.verifyUid),access_token:testAccessToken(options.tokenUid??uid,randomUUID()),refresh_token:'private-refresh-fixture-'+state.minted});}
  if(options.logoutMissing&&path==='/auth/v1/logout?scope=global'&&headers.get('authorization')==='Bearer '+legacyToken)return Response.json({error_code:'session_not_found'},{status:403});
  if(path.startsWith('/auth/v1/logout?scope='))return new Response(null,{status:204});
  throw Error('Unexpected HTTP path in isolated fixture: '+path);
 };
 const handler=accessHandler({url,serviceKey:'service-fixture',anonKey:'anon-fixture',pepper,fetcher});
 const post=(body:unknown,token?:string,headers:Record<string,string>={})=>handler(new Request(url+'/functions/v1/access-code',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body)}));
 const operations=()=>calls.filter(call=>call.path==='/rest/v1/rpc/beta_access_store').map(call=>call.body.operation);
 return {handler,post,calls,grants,state,fetcher,operations};
}

test('personal codes normalize only full high-entropy credentials, and generator supplies unique usable codes',()=>{
 assert.equal(normalizeAccessCode(code),normalizeAccessCode('  mnsr 0123 4567 89ab cdef 0123 4567 89ab cdef  '));
 for(const invalid of [null,1234,'123456','MNSR-'+'0'.repeat(32),'MNSR-'+ '0123456'.repeat(4)+'0123','MNSR-'+ 'Z'.repeat(32),code+'extra','x'.repeat(101)])assert.equal(normalizeAccessCode(invalid),null);
 const generated=new Set<string>();for(let i=0;i<100;i++){const value=generateAccessCode();assert.ok(normalizeAccessCode(value));assert.match(value,/^MNSR-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);generated.add(value);}assert.equal(generated.size,100);
});

test('session claims are owner-bound and a GoTrue-verified legacy JWT without a grant cannot enter paid handlers or reserve credit',async t=>{
 assert.equal(accessSessionId('Bearer '+legacyToken,uid),legacySid);assert.equal(accessSessionId('Bearer '+legacyToken,foreign),null);assert.equal(accessSessionId('Bearer invalid',uid),null);
 await assert.rejects(requireCodeSession('Bearer '+legacyToken,uid,async()=>false),error=>error instanceof AccessCodeError&&error.status===401);
 const f=await fixture(),originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno;let paid=0;
 globalThis.fetch=f.fetcher;(globalThis as any).Deno={env:{get:(key:string)=>({SUPABASE_URL:url,SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'}[key])}};
 t.after(()=>{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;});
 const request=new Request(url,{method:'POST',headers:{Authorization:'Bearer '+legacyToken,'Content-Type':'application/json'},body:JSON.stringify({ticker:'MSFT'})});
 const response=await secureRequest(request,async()=>{paid++;return Response.json({});});assert.equal(response.status,401);assert.equal(paid,0);assert.equal(f.calls.some(call=>/beta_reserve|beta_usage/.test(call.path)),false);assert.equal(f.calls.at(-1)!.path,'/rest/v1/rpc/beta_access_session');
});

test('wrong, malformed and unknown access codes return the same denial without minting sessions; valid login grants only the minted owner session',async()=>{
 const f=await fixture();
 for(const candidate of ['123456',nextCode]){const response=await f.post({action:'login',code:candidate});assert.equal(response.status,401);assert.equal((await response.json()).error,'Código incorrecto o acceso no disponible.');}
 assert.equal(f.state.minted,0);
 const response=await f.post({action:'login',code});assert.equal(response.status,200);const result=await response.json(),sid=accessSessionId('Bearer '+result.access_token,uid)!;assert.ok(f.grants.has(sid));assert.equal(f.grants.size,1);assert.equal(f.state.minted,1);assert.deepEqual(f.operations().slice(-2),['find','grant']);
 assert.deepEqual(Object.keys(result).sort(),['access_token','refresh_token']);assert.doesNotMatch(JSON.stringify(result),/otp|12345678|service-fixture|pepper|hashed_token|password|MNSR/);
 assert.equal(f.calls.find(call=>call.path==='/auth/v1/verify')!.body.token_hash,'private-otp-hash-fixture');
 for(const call of f.calls.filter(call=>call.path.includes('/rest/v1/rpc/'))){assert.doesNotMatch(JSON.stringify(call.body),/MNSR|fixture@example|12345678/);if(call.body.payload?.digest)assert.match(call.body.payload.digest,/^[0-9a-f]{64}$/);}
});

test('rate-denied committed attempt RPC stops auth and credential lookup even when HTTP itself succeeded',async()=>{
 const f=await fixture({rateAllowed:false}),response=await f.post({action:'login',code});assert.equal(response.status,429);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/rest/v1/rpc/beta_access_attempt');assert.equal(f.state.minted,0);
 assert.match(f.calls[0].body.ip_hash,/^[0-9a-f]{64}$/);assert.match(f.calls[0].body.code_hash,/^[0-9a-f]{64}$/);assert.equal(JSON.stringify(f.calls[0].body).includes(pepper),false);
});

test('legacy password bootstrap is available only to an existing account without a code and never creates a paid-access grant',async()=>{
 const setup=await fixture({hasCode:false}),response=await setup.post({action:'bootstrap',email:' FIXTURE@example.test ',password:'old-password-fixture'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{bootstrapToken:legacyToken});assert.equal(setup.grants.size,0);assert.equal(setup.state.minted,0);assert.deepEqual(setup.operations(),['status']);
 const existing=await fixture(),blocked=await existing.post({action:'bootstrap',email,password:'old-password-fixture'});assert.equal(blocked.status,409);assert.equal(existing.grants.size,0);assert.ok(existing.calls.some(call=>call.path==='/auth/v1/logout?scope=local'));assert.equal(existing.calls.some(call=>call.path.includes('generate_link')),false);
});

test('activation retires old password and all refresh sessions, stores only HMAC and preserves the existing UID, profiles and paid-data identity',async()=>{
 const f=await fixture({hasCode:false}),response=await f.post({action:'activate',code:nextCode},legacyToken);assert.equal(response.status,200);const result=await response.json();
 assert.equal(accessSessionId('Bearer '+result.access_token,foreign),null);assert.ok(f.grants.has(accessSessionId('Bearer '+result.access_token,uid)!));assert.equal(f.state.pending,false);assert.deepEqual(f.operations(),['status','prepare','activate','grant']);
 const update=f.calls.find(call=>call.path==='/auth/v1/admin/users/'+uid&&call.method==='PUT')!;assert.deepEqual(Object.keys(update.body),['password']);assert.equal(typeof update.body.password,'string');assert.ok(update.body.password.length>=40&&Buffer.byteLength(update.body.password)<=72);assert.notEqual(update.body.password,nextCode);assert.notEqual(update.body.password,normalizeAccessCode(nextCode));
 assert.ok(f.calls.findIndex(call=>call.path==='/auth/v1/logout?scope=global')<f.calls.findIndex(call=>call.body?.operation==='activate'));assert.equal(f.calls.some(call=>call.path==='/auth/v1/admin/users'&&call.method==='POST'),false);
 assert.deepEqual(f.calls.filter(call=>call.body?.operation==='prepare').map(call=>Object.keys(call.body.payload)),[['digest']]);assert.doesNotMatch(JSON.stringify(result),/password|MNSR|otp|private-otp|12345678/);
 assert.equal(f.calls.some(call=>/portfolio|profiles|reports|usage|reserve/.test(call.path)),false);
});

test('rotation requires an existing granted code session and replaces its credential without accepting a legacy session',async()=>{
 const denied=await fixture(),blocked=await denied.post({action:'rotate',code:nextCode},legacyToken);assert.equal(blocked.status,401);assert.equal(denied.operations().includes('prepare'),false);assert.equal(denied.state.minted,0);
 const f=await fixture();f.grants.add(legacySid);const response=await f.post({action:'rotate',code:nextCode},legacyToken);assert.equal(response.status,200);const result=await response.json(),newSid=accessSessionId('Bearer '+result.access_token,uid)!;assert.notEqual(newSid,legacySid);assert.equal(f.grants.has(legacySid),false);assert.equal(f.grants.has(newSid),true);assert.ok(f.calls.some(call=>call.path==='/auth/v1/logout?scope=global'));assert.equal(f.calls.find(call=>call.body?.operation==='prepare')!.body.payload.sessionId,legacySid);
 const old=await f.post({action:'login',code});assert.equal(old.status,401);const next=await f.post({action:'login',code:nextCode});assert.equal(next.status,200);
});

test('pending login is recoverable after an interrupted password transition without granting the temporary bootstrap session',async()=>{
 const f=await fixture({pending:true,failPasswords:1}),failed=await f.post({action:'login',code});assert.equal(failed.status,503);assert.equal(f.state.pending,true);assert.equal(f.grants.size,0);assert.doesNotMatch(JSON.stringify(await failed.json()),/secret-upstream|otp|MNSR/);
 const retried=await f.post({action:'login',code});assert.equal(retried.status,200);assert.equal(f.state.pending,false);assert.equal(f.grants.size,1);assert.equal(f.state.minted,3);assert.ok(f.calls.some(call=>call.path==='/auth/v1/logout?scope=global'));assert.equal(f.operations().filter(operation=>operation==='activate').length,1);assert.equal(f.operations().filter(operation=>operation==='grant').length,1);
});

test('revoked users and foreign identities cannot mint or receive a code-session grant, and wrong minted sessions are locally revoked',async()=>{
 const revoked=await fixture({active:false}),denied=await revoked.post({action:'login',code});assert.equal(denied.status,403);assert.equal(revoked.state.minted,0);assert.equal(revoked.operations().includes('grant'),false);assert.equal(revoked.calls.some(call=>call.path.includes('generate_link')),false);
 for(const options of [{adminUid:foreign},{linkUid:foreign},{verifyUid:foreign},{tokenUid:foreign}]){const f=await fixture(options),response=await f.post({action:'login',code});assert.equal(response.status,503);assert.equal(f.grants.size,0);assert.equal(f.operations().includes('grant'),false);if(options.verifyUid||options.tokenUid)assert.ok(f.calls.some(call=>call.path==='/auth/v1/logout?scope=local'));}
});

test('unauthenticated settings, activation and rotation return401, malformed/oversized payloads never call credential storage',async()=>{
 for(const action of ['status','activate','rotate']){const f=await fixture(),response=await f.post({action,code});assert.equal(response.status,401);assert.equal(f.calls.some(call=>call.path==='/auth/v1/user'),false);assert.deepEqual(f.operations(),[]);}
 for(const payload of [null,[],{action:'sql'},{action:'login',code,uid:foreign}]){const f=await fixture(),response=await f.post(payload);assert.equal(response.status,400);assert.equal(f.calls.length,0);}
 const f=await fixture();assert.equal((await f.handler(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{not JSON'}))).status,400);assert.equal((await f.post({action:'login',code:'x'.repeat(5000)})).status,413);assert.equal((await f.handler(new Request(url,{method:'POST',body:'{}'}))).status,415);assert.equal((await f.handler(new Request(url,{method:'GET'}))).status,405);assert.equal((await f.post({action:'login',code},undefined,{Origin:'https://untrusted.example.test'})).status,403);assert.equal(f.calls.length,0);
 const preflight=await f.handler(new Request(url,{method:'OPTIONS',headers:{Origin:'https://sftmvpppp.vercel.app'}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://sftmvpppp.vercel.app');
});

test('new registration stores the display name, random GoTrue password and only a code digest; no user password or email OTP is requested',async()=>{
 const f=await fixture({hasCode:false}),response=await f.post({action:'register',email,name:'Cliente de prueba',code});assert.equal(response.status,200);assert.ok(f.grants.size===1);
 const create=f.calls.find(call=>call.path==='/auth/v1/admin/users'&&call.method==='POST')!;assert.equal(create.body.email,email);assert.equal(create.body.email_confirm,true);assert.deepEqual(create.body.user_metadata,{display_name:'Cliente de prueba'});assert.ok(create.body.password.length>=40&&Buffer.byteLength(create.body.password)<=72);assert.notEqual(create.body.password,code);assert.deepEqual(f.operations(),['prepare','activate','grant']);assert.doesNotMatch(JSON.stringify(await response.json()),/otp|MNSR|password/);
});


test('password retirement handles GoTrue session_not_found403 by revoking all sessions through a freshly verified temporary session',async()=>{const f=await fixture({hasCode:false,logoutMissing:true}),r=await f.post({action:'activate',code:nextCode},legacyToken);assert.equal(r.status,200);const logout=f.calls.filter(call=>call.path==='/auth/v1/logout?scope=global');assert.equal(logout.length,2);assert.notEqual(logout[1].headers.get('authorization'),'Bearer '+legacyToken);assert.equal(f.state.minted,2);assert.equal(f.grants.size,1);});

test('authenticated settings and logout do not share one credential rate bucket across different sessions',async()=>{const f=await fixture();await f.post({action:'logout'},legacyToken);await f.post({action:'logout'},testAccessToken(uid,randomUUID()));const keys=f.calls.filter(call=>call.path==='/rest/v1/rpc/beta_access_attempt').map(call=>call.body.code_hash);assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);});

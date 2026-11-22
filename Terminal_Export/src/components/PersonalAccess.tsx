import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,Eye,EyeOff,KeyRound,Loader2} from 'lucide-react';
import {accessCodeApi,normalizeAccessCode,type AccessTokens} from '@/lib/access-code-api';

type Props={onEnter:(tokens:AccessTokens)=>Promise<void>;token?:string;onClose?:()=>void;onBusyChange?:(busy:boolean)=>void};
type Mode='login'|'register'|'activate'|'legacy';

export default function PersonalAccess({onEnter,token,onClose,onBusyChange}:Props){
 const [mode,setMode]=useState<Mode>(token?'activate':'login');
 const [bootstrap,setBootstrap]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('');
 const [code,setCode]=useState(''),[fresh,setFresh]=useState(''),[confirmation,setConfirmation]=useState('');
 const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const creating=!!token||mode==='register'||(mode==='activate'||mode==='legacy')&&!!bootstrap;
 const legacyEntry=mode==='legacy'&&!bootstrap;
 const newCodeValid=normalizeAccessCode(fresh)===fresh&&fresh===confirmation;

 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);

 function switchMode(next:Mode){
  setMode(next);setError('');setPassword('');setCode('');setFresh('');setConfirmation('');setBootstrap('');setVisible(false);
 }

 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   if(mode==='activate'&&!token&&!bootstrap){
    const value=await accessCodeApi<{bootstrapToken:string}>('bootstrap',{email:email.trim(),password});
    setBootstrap(value.bootstrapToken);setPassword('');return;
   }
   if(legacyEntry){
    const value=await accessCodeApi<{bootstrapToken:string}>('legacy',{code:code.trim()});
    setBootstrap(value.bootstrapToken);setCode('');setVisible(false);return;
   }
   if(creating){
    if(normalizeAccessCode(fresh)!==fresh)throw new Error('Elige un código de exactamente 5 dígitos.');
    if(fresh!==confirmation)throw new Error('Los códigos no coinciden.');
    const action=token||mode==='legacy'?'rotate':mode==='register'?'register':'activate';
    const values=action==='register'?{code:fresh,email:email.trim(),name}:{code:fresh};
    const tokens=await accessCodeApi<AccessTokens>(action,values,token??bootstrap);
    await onEnter(tokens);setFresh('');setConfirmation('');setPassword('');setBootstrap('');onClose?.();
   }else{
    if(normalizeAccessCode(code)!==code)throw new Error('Introduce tu código de 5 dígitos.');
    await onEnter(await accessCodeApi<AccessTokens>('login',{email:email.trim(),code}));setCode('');
   }
  }catch(cause){setError(cause instanceof Error?cause.message:'No se ha podido completar el acceso.');}
  finally{setBusy(false);}
 }

 const field='auth-input';
 const primary='flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-40';
 const codeField=field+' pr-12 font-mono text-lg tracking-[0.3em]';
 const title=token?'Cambiar mi código':mode==='login'?'Acceso privado':mode==='register'?'Crear cuenta':mode==='legacy'?'Actualizar mi código':'Activar mi código';
 const description=creating?'Elige tu código de 5 dígitos y repítelo para confirmarlo.':mode==='activate'?'Usa tu e-mail y contraseña actuales una sola vez para elegir tu código.':legacyEntry?'Introduce tu código anterior. Después podrás elegir uno de 5 dígitos.':'Entra con tu e-mail y tu código personal de 5 dígitos.';
 const visibilityButton=<button type="button" aria-label={visible?'Ocultar código':'Mostrar código'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)} className="absolute bottom-3 right-3 text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">{visible?<EyeOff size={16}/>:<Eye size={16}/>}</button>;

 const form=<section aria-label={token?'Cambiar código personal':'Acceso a la terminal'} className="auth-card mx-auto w-full max-w-md rounded-2xl border border-slate-700/60 bg-[#101216] p-6 sm:p-8">
  <div className="mb-6"><KeyRound size={21} className="mb-4 text-blue-300/80"/><h1 className="font-body text-[23px] font-semibold tracking-tight text-slate-100">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p></div>
  {error&&<p role="alert" className="mb-5 rounded-lg border border-rose-300/20 p-3 text-sm text-rose-200">{error}</p>}
  <form onSubmit={submit} className="space-y-4">
   {mode==='register'&&<label className="block text-sm text-slate-300">Nombre<input aria-label="Nombre" autoComplete="name" required maxLength={60} value={name} onChange={event=>setName(event.target.value)} className={field}/></label>}
   {!token&&(mode==='login'||mode==='register'||mode==='activate'&&!bootstrap)&&<label className="block text-sm text-slate-300">E-mail<input aria-label="E-mail" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} className={field}/></label>}
   {mode==='activate'&&!token&&!bootstrap&&<label className="block text-sm text-slate-300">Contraseña actual<input aria-label="Contraseña actual" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} className={field}/></label>}
   {creating?<>
    <label className="block text-sm text-slate-300">Código personal nuevo<div className="relative"><input aria-label="Código personal nuevo" type={visible?'text':'password'} inputMode="numeric" pattern="[0-9]{5}" minLength={5} maxLength={5} autoComplete="new-password" required value={fresh} onChange={event=>setFresh(event.target.value)} placeholder="5 dígitos" spellCheck={false} className={codeField}/>{visibilityButton}</div></label>
    <label className="block text-sm text-slate-300">Repetir código<input aria-label="Repetir código" type={visible?'text':'password'} inputMode="numeric" pattern="[0-9]{5}" minLength={5} maxLength={5} autoComplete="new-password" required value={confirmation} onChange={event=>setConfirmation(event.target.value)} placeholder="5 dígitos" spellCheck={false} className={field+' font-mono text-lg tracking-[0.3em]'}/></label>
    {confirmation&&fresh!==confirmation&&<p className="text-xs text-rose-200" role="status">Los códigos no coinciden.</p>}
   </>:mode==='login'?<label className="block text-sm text-slate-300">Código personal<div className="relative"><input aria-label="Código personal" type={visible?'text':'password'} inputMode="numeric" pattern="[0-9]{5}" minLength={5} maxLength={5} autoComplete="current-password" required value={code} onChange={event=>setCode(event.target.value)} placeholder="5 dígitos" spellCheck={false} className={codeField}/>{visibilityButton}</div></label>:legacyEntry&&<label className="block text-sm text-slate-300">Código anterior<div className="relative"><input aria-label="Código anterior" type={visible?'text':'password'} autoComplete="current-password" required maxLength={100} value={code} onChange={event=>setCode(event.target.value)} placeholder="MNSR-…" spellCheck={false} className={field+' pr-12 font-mono text-xs'}/>{visibilityButton}</div></label>}
   <button disabled={busy||creating&&!newCodeValid} className={primary}>{busy?<Loader2 size={15} className="animate-spin"/>:<ArrowRight size={15}/>} {busy?'Comprobando acceso…':token?'Guardar código nuevo':creating?mode==='register'?'Crear cuenta y entrar':'Guardar código y entrar':mode==='activate'?'Comprobar cuenta':legacyEntry?'Comprobar código anterior':'Entrar a la terminal'}</button>
  </form>
  {!token&&<div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-3 text-xs text-slate-400">{mode!=='login'&&<button disabled={busy} onClick={()=>switchMode('login')}>Ya tengo código</button>}{mode!=='activate'&&<button disabled={busy} onClick={()=>switchMode('activate')}>Activar mi código</button>}{mode!=='register'&&<button disabled={busy} onClick={()=>switchMode('register')}>Crear cuenta</button>}{mode==='login'&&<button disabled={busy} onClick={()=>switchMode('legacy')}>Tengo un código anterior</button>}</div>}
  {token&&<button onClick={onClose} disabled={busy} className="mt-5 w-full text-xs text-slate-400">Cancelar</button>}
  <p className="mt-6 border-t border-slate-800 pt-4 text-[11px] leading-5 text-slate-500">Versión beta, no definitiva. Puede presentar pequeños errores.</p>
 </section>;
 return token?form:<main className="auth-page flex min-h-screen items-center justify-center px-5 py-10 font-body text-slate-200"><div className="grid w-full max-w-[960px] items-center gap-9 lg:grid-cols-[1fr_1.05fr] lg:gap-20"><section className="mx-auto w-full max-w-md"><p className="text-lg font-semibold tracking-tight text-white">MensorTerminal</p><h2 className="mt-6 text-3xl font-medium leading-tight text-slate-100">Tu espacio de mercado.</h2><p className="mt-4 text-sm leading-7 text-slate-500">Noticias, análisis y seguimiento en una terminal privada.</p></section>{form}</div></main>;
}

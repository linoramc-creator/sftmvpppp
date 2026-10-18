import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link, useLocation } from 'react-router-dom';
import { supabase, isPasswordRecovery } from '@/integrations/supabase/client';
import { accountApi,type Profile } from '@/lib/beta-api';
import { normalizeProfileName, profileDisplayName } from '../../../supabase/functions/analyze-ticker/profile-name';
import TerminalWelcome from './TerminalWelcome';
import {TerminalEntryProvider,type FeedReadiness} from '@/lib/terminal-entry';
import './auth-experience.css';
const Context = createContext<Profile | null>(null);
export const useProfile = () => useContext(Context)!;
export default function AuthGate({children}: {children:ReactNode}) {
  const [showPassword,setShowPassword]=useState(false);
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [name,setName]=useState('');
  const location=useLocation();
  const [welcome,setWelcome]=useState<{id:string;profileId:string;name:string;attempt:number;startedAt:number;phase:'loading'|'ready'|'error'|'leaving';detail:string}|null>(null);
  const welcomedUsers=useRef(new Set<string>());
  const [register,setRegister]=useState(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const [settings,setSettings]=useState(isPasswordRecovery),[notice,setNotice]=useState('');
  const [recovery,setRecovery]=useState(isPasswordRecovery);
  useEffect(()=>{let active=true;supabase.auth.getSession().then(({data,error})=>{if(active){setSession(data.session);setReady(true);if(error)setError('No se pudo recuperar la sesión.');}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,value)=>{if(event==='PASSWORD_RECOVERY'){setRecovery(true);setSettings(true);}setSession(value);setReady(true);});return()=>{active=false;subscription.unsubscribe();};},[]);
  useEffect(()=>{let active=true;setProfile(previous=>previous?.id===session?.user?.id?previous:null);setError('');if(!session)return;
    // Profile uses the normal authenticated request but not the global 403
    // listener, avoiding an access-check loop for revoked accounts.
    const load=async()=>{try{const r=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({accountAction:'profile'}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudo comprobar el acceso.');if(active)setProfile(data);}catch(e){if(active)setError((e as Error).message);}};
    void load();const check=()=>{void load();};window.addEventListener('beta-access-check',check);
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener('beta-access-check',check);};},[session?.access_token,retry]);
  const recordedAccess=useRef(new Map<string,string>());
  useEffect(()=>{if(!profile)return;let visit=recordedAccess.current.get(profile.id);if(visit)return;visit=crypto.randomUUID();recordedAccess.current.set(profile.id,visit);void accountApi('recordAccess',{visitId:visit}).catch(()=>{recordedAccess.current.delete(profile.id);});},[profile?.id]);
  useEffect(()=>{
    if(location.pathname!=='/'||!profile||error||recovery){setWelcome(null);return;}
    if(welcomedUsers.current.has(profile.id))return;
    setWelcome(previous=>previous?.profileId===profile.id?previous:{id:crypto.randomUUID(),profileId:profile.id,name:normalizeProfileName(profile.displayName)||profileDisplayName(session?.user?.user_metadata,profile.email),attempt:0,startedAt:Date.now(),phase:'loading',detail:'Preparando tu espacio de mercado…'});
  },[profile?.id,error,recovery,location.pathname]);
  const reportReadiness=useCallback((id:string,attempt:number,state:FeedReadiness)=>{
    setWelcome(previous=>!previous||previous.id!==id||previous.attempt!==attempt||previous.phase==='leaving'||previous.phase===state.status&&previous.detail===(state.detail??'')?previous:{...previous,phase:state.status,detail:state.detail??''});
  },[]);
  const entryContext=useMemo(()=>welcome?{sessionId:welcome.id,attempt:welcome.attempt,report:reportReadiness}:null,[welcome?.id,welcome?.attempt,reportReadiness]);
  useEffect(()=>{
    if(!welcome||welcome.phase==='leaving')return;
    const id=welcome.id,attempt=welcome.attempt;
    const timer=window.setTimeout(()=>setWelcome(previous=>previous?.id===id&&previous.attempt===attempt&&previous.phase==='loading'?{...previous,phase:'error',detail:'La carga está tardando más de lo esperado. Puedes reintentar o entrar con lo que ya está disponible.'}:previous),90000);
    return()=>window.clearTimeout(timer);
  },[welcome?.id,welcome?.attempt]);
  useEffect(()=>{
    if(welcome?.phase!=='ready')return;
    const id=welcome.id,attempt=welcome.attempt;
    const timer=window.setTimeout(()=>setWelcome(previous=>previous?.id===id&&previous.attempt===attempt&&previous.phase==='ready'?{...previous,phase:'leaving'}:previous),Math.max(0,2000-(Date.now()-welcome.startedAt)));
    return()=>window.clearTimeout(timer);
  },[welcome?.id,welcome?.attempt,welcome?.phase]);
  useEffect(()=>{
    if(welcome?.phase!=='leaving')return;
    const id=welcome.id;
    const timer=window.setTimeout(()=>setWelcome(previous=>{if(previous?.id!==id)return previous;welcomedUsers.current.add(previous.profileId);return null;}),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:380);
    return()=>window.clearTimeout(timer);
  },[welcome?.id,welcome?.phase]);
  const welcomeVisible=location.pathname==='/'&&!recovery&&!!profile&&!error&&(!welcomedUsers.current.has(profile.id)||welcome?.profileId===profile.id);
  const signOut=async()=>{await supabase.auth.signOut({scope:'local'});window.location.assign('/');};
  async function enter(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      if(register&&password!==confirmation){setError('Las contraseñas no coinciden.');return;}
      const displayName=normalizeProfileName(name);
      if(register&&!displayName){setError('Escribe tu nombre, con un máximo de 60 caracteres.');return;}
      const credentials={email:email.trim().toLowerCase(),password};
      const result=register?await supabase.auth.signUp({...credentials,options:{data:{display_name:displayName}}}):await supabase.auth.signInWithPassword(credentials);
      if(result.error){setError(result.error.status===429?'Demasiados intentos. Espera unos minutos.':register?'No se pudo crear la cuenta. Usa una contraseña de al menos 12 caracteres; si ya tienes cuenta, inicia sesión.':'E-mail o contraseña incorrectos.');return;}
      if(!result.data.session){setError('No se pudo iniciar la sesión. Contacta con el administrador.');return;}
      setPassword('');setConfirmation('');setSession(result.data.session);
    } catch {setError('No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.');} finally {setBusy(false);}
  }
  async function savePassword(event:FormEvent){event.preventDefault();if(busy)return;setNotice('');
    if(password!==confirmation){setNotice('Las contraseñas no coinciden.');return;}setBusy(true);
    try{const {error}=await supabase.auth.updateUser({password});if(error){setNotice('No se pudo guardar la contraseña. Usa al menos 12 caracteres y vuelve a intentarlo.');return;}setPassword('');setConfirmation('');setRecovery(false);setNotice('Contraseña guardada. Ya puedes entrar con tu e-mail y contraseña.');}catch{setNotice('No se pudo conectar. Inténtalo de nuevo.');}finally{setBusy(false);}
  }
  const passwordFields=<><div className="flex justify-end"><button type="button" aria-label={showPassword?"Ocultar contraseña":"Mostrar contraseña"} aria-pressed={showPassword} className="text-xs text-slate-400 inline-flex gap-2 items-center hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={14}/>:<Eye size={14}/>} {showPassword?"Ocultar":"Mostrar"}</button></div><label className="block text-sm text-slate-300">Contraseña<input type={showPassword?"text":"password"} autoComplete={register||settings?'new-password':'current-password'} required minLength={register||settings?12:undefined} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} className="auth-input"/></label>{(register||settings)&&<><p className="text-xs text-slate-400">Mínimo 12 caracteres. Utiliza una contraseña única.</p><label className="block text-sm text-slate-300">Repetir contraseña<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="auth-input"/></label></>}</>;
  if(!ready)return <div role="status" className="auth-page min-h-screen flex items-center justify-center gap-3 text-sm text-slate-400"><Loader2 size={17} className="text-emerald-400 motion-safe:animate-spin"/>Comprobando sesión…</div>;
  if(session&&recovery)return <main className="min-h-screen flex items-center justify-center p-5"><section className="w-full max-w-md border border-border bg-card p-7 space-y-5"><h1 className="text-xl">Establecer nueva contraseña</h1><p className="text-sm text-slate-400">Tu cuenta y tus informes se conservarán.</p><form onSubmit={savePassword} className="space-y-4">{passwordFields}<button disabled={busy} className="w-full rounded-md bg-primary text-black font-semibold py-3 hover:brightness-110 transition disabled:opacity-50">{busy?'Guardando…':'Guardar contraseña'}</button></form>{notice&&<p role="status">{notice}</p>}</section></main>;
  if(session&&profile&&!error)return <Context.Provider value={profile}><TerminalEntryProvider value={entryContext}><div ref={node=>{if(node)node.inert=welcomeVisible;}} aria-hidden={welcomeVisible||undefined}><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border text-xs"><span className="truncate">{profile.email}</span><nav className="flex flex-wrap gap-4 text-white/80"><Link to="/">Terminal</Link>{profile.isAdmin&&<Link className="text-white" to="/admin">Administración</Link>}<button onClick={()=>{setSettings(!settings);setPassword('');setConfirmation('');setNotice('');}}>Mi contraseña</button><button onClick={signOut}>Cerrar sesión</button></nav></div>{settings&&<section className="max-w-md mx-auto p-6 space-y-4 border border-border"><h2>Establecer o cambiar contraseña</h2><form onSubmit={savePassword} className="space-y-4">{passwordFields}<button disabled={busy} className="bg-primary text-black px-4 py-3 disabled:opacity-50">{busy?'Guardando…':'Guardar contraseña'}</button></form>{notice&&<p role="status" className="text-sm">{notice}</p>}</section>}<div key={profile.id}>{children}</div></div>{welcomeVisible&&<TerminalWelcome name={welcome?.name??(normalizeProfileName(profile.displayName)||profileDisplayName(session.user?.user_metadata,profile.email))} phase={welcome?.phase??'loading'} detail={welcome?.detail??'Preparando tu espacio de mercado…'} onRetry={()=>setWelcome(previous=>previous?{...previous,attempt:previous.attempt+1,startedAt:Date.now(),phase:'loading',detail:'Volviendo a preparar tu feed…'}:previous)} onContinue={()=>setWelcome(previous=>previous?{...previous,phase:'leaving'}:previous)} onSignOut={signOut}/>}</TerminalEntryProvider></Context.Provider>;
  return <main className="auth-page relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10 text-slate-200 sm:px-8">
    <div className="relative grid w-full max-w-[960px] items-center gap-9 lg:grid-cols-[1fr_1.05fr] lg:gap-20">
      <section className="auth-intro mx-auto w-full max-w-md lg:mx-0">
        <p className="flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.22em] text-slate-200"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_#34d39950]"/>TERMINAL<span className="ml-1 rounded border border-slate-600/70 px-1.5 py-0.5 text-[9px] tracking-wider text-slate-400">BETA</span></p>
        <h2 className="mt-7 max-w-sm font-body text-[30px] font-medium leading-[1.2] tracking-tight text-slate-100 sm:text-[36px]">Una mirada más clara<br className="hidden sm:block"/> al mercado.</h2>
        <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">Noticias, análisis y seguimiento de activos en tu espacio de trabajo.</p>
        <div aria-hidden="true" className="mt-8 hidden h-px w-32 bg-gradient-to-r from-emerald-400/70 via-sky-400/40 to-transparent lg:block"/>
      </section>
      <section aria-label="Acceso a la terminal" className="auth-card mx-auto w-full max-w-md rounded-2xl border border-slate-700/70 bg-[#101823]/90 p-6 shadow-[0_24px_90px_#0005] sm:p-8">
        <div className="mb-7"><h1 className="font-body text-[23px] font-semibold tracking-tight text-slate-100">{session?'Preparando tu acceso':register?'Crear cuenta':'Bienvenido de nuevo'}</h1><p className="mt-2.5 text-sm leading-6 text-slate-400">{register?'Crea tu espacio con tu e-mail y una contraseña.':'Accede a tu terminal y a tus informes guardados.'}</p></div>
        {error&&<p role="alert" className="mb-5 rounded-lg border border-rose-400/30 bg-rose-400/5 p-3 text-sm leading-relaxed text-rose-300">{error}</p>}
        {session&&!error?<p role="status" className="flex items-center gap-3 py-5 text-sm text-slate-400"><Loader2 className="h-4 w-4 text-emerald-400 motion-safe:animate-spin"/>Comprobando el acceso a tu espacio…</p>:session?<div className="flex gap-4 text-sm"><button className="text-emerald-300" onClick={()=>setRetry(n=>n+1)}>Reintentar</button><button className="text-slate-300" onClick={signOut}>Cerrar sesión</button></div>:<>
          <form onSubmit={enter} className="space-y-4">
            {register&&<label className="block text-sm text-slate-300">Nombre<input type="text" autoComplete="name" required maxLength={60} value={name} onChange={event=>setName(event.target.value)} className="auth-input" placeholder="Tu nombre"/></label>}
            <label className="block text-sm text-slate-300">E-mail<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} className="auth-input" placeholder="tu@email.com"/></label>
            {passwordFields}
            <button disabled={busy} className="!mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101823] disabled:opacity-60">{busy?<><Loader2 className="h-4 w-4 motion-safe:animate-spin"/>{register?'Creando tu cuenta…':'Entrando…'}</>:<>{register?'Crear cuenta':'Entrar a la terminal'}<ArrowRight size={16} aria-hidden="true"/></>}</button>
          </form>
          <button disabled={busy} className="mt-5 w-full rounded text-center text-xs leading-relaxed text-slate-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" onClick={()=>{setRegister(!register);setError('');setPassword('');setConfirmation('');}}>{register?'Ya tengo cuenta · Iniciar sesión':'No tengo cuenta · Registrarme'}</button>
        </>}
        <p className="mt-7 border-t border-slate-700/50 pt-5 text-[11px] leading-5 text-slate-500">Esta es una versión beta, no la versión final. Puede presentar pequeños errores.</p>
      </section>
    </div>
  </main>;
}

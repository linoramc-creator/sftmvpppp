import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { type Profile } from '@/lib/beta-api';
const Context = createContext<Profile | null>(null);
export const useProfile = () => useContext(Context)!;
export default function AuthGate({children}: {children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [register,setRegister]=useState(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const [settings,setSettings]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;supabase.auth.getSession().then(({data,error})=>{if(active){setSession(data.session);setReady(true);if(error)setError('No se pudo recuperar la sesión.');}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,value)=>{setSession(value);setReady(true);});return()=>{active=false;subscription.unsubscribe();};},[]);
  useEffect(()=>{let active=true;setProfile(null);setError('');if(!session)return;
    // Profile uses the normal authenticated request but not the global 403
    // listener, avoiding an access-check loop for revoked accounts.
    const load=async()=>{try{const r=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({accountAction:'profile'}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudo comprobar el acceso.');if(active)setProfile(data);}catch(e){if(active)setError((e as Error).message);}};
    void load();const check=()=>{void load();};window.addEventListener('beta-access-check',check);
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener('beta-access-check',check);};},[session?.access_token,retry]);
  const signOut=async()=>{await supabase.auth.signOut({scope:'local'});window.location.assign('/');};
  async function enter(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      if(register&&password!==confirmation){setError('Las contraseñas no coinciden.');return;}
      const credentials={email:email.trim().toLowerCase(),password};
      const result=register?await supabase.auth.signUp(credentials):await supabase.auth.signInWithPassword(credentials);
      if(result.error){setError(result.error.status===429?'Demasiados intentos. Espera unos minutos.':register?'No se pudo crear la cuenta. Usa una contraseña de al menos 12 caracteres; si ya tienes cuenta, inicia sesión.':'E-mail o contraseña incorrectos.');return;}
      if(!result.data.session){setError('No se pudo iniciar la sesión. Contacta con el administrador.');return;}
      setPassword('');setConfirmation('');setSession(result.data.session);
    } catch {setError('No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.');} finally {setBusy(false);}
  }
  async function savePassword(event:FormEvent){event.preventDefault();if(busy)return;setNotice('');
    if(password!==confirmation){setNotice('Las contraseñas no coinciden.');return;}setBusy(true);
    try{const {error}=await supabase.auth.updateUser({password});if(error){setNotice('No se pudo guardar la contraseña. Usa al menos 12 caracteres y vuelve a intentarlo.');return;}setPassword('');setConfirmation('');setNotice('Contraseña guardada. Ya puedes entrar con tu e-mail y contraseña.');}catch{setNotice('No se pudo conectar. Inténtalo de nuevo.');}finally{setBusy(false);}
  }
  const passwordFields=<><label className="block text-sm">Contraseña<input type="password" autoComplete={register||settings?'new-password':'current-password'} required minLength={register||settings?12:undefined} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} className="block mt-2 w-full bg-background border border-border px-3 py-3"/></label>{(register||settings)&&<><p className="text-xs text-slate-400">Mínimo 12 caracteres. Utiliza una contraseña única.</p><label className="block text-sm">Repetir contraseña<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="block mt-2 w-full bg-background border border-border px-3 py-3"/></label></>}</>;
  if(!ready)return <div className="p-8 text-sm">Comprobando sesión…</div>;
  if(session&&profile&&!error)return <Context.Provider value={profile}><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border text-xs"><span className="truncate">{profile.email}</span><nav className="flex flex-wrap gap-4"><Link to="/">Terminal</Link>{profile.isAdmin&&<Link className="text-primary" to="/admin">Administración</Link>}<button onClick={()=>{setSettings(!settings);setPassword('');setConfirmation('');setNotice('');}}>Mi contraseña</button><button onClick={signOut}>Cerrar sesión</button></nav></div>{settings&&<section className="max-w-md mx-auto p-6 space-y-4 border border-border"><h2>Establecer o cambiar contraseña</h2><form onSubmit={savePassword} className="space-y-4">{passwordFields}<button disabled={busy} className="bg-primary text-black px-4 py-3 disabled:opacity-50">{busy?'Guardando…':'Guardar contraseña'}</button></form>{notice&&<p role="status" className="text-sm">{notice}</p>}</section>}<div key={profile.id}>{children}</div></Context.Provider>;
  return <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5"><section className="w-full max-w-md border border-border bg-card p-7 space-y-6">
    <div><p className="text-primary text-xs tracking-widest mb-3">TERMINAL · BETA</p><h1 className="text-xl font-semibold">{session?'Acceso a tu cuenta':register?'Crear cuenta':'Iniciar sesión'}</h1><p className="text-sm text-slate-400 mt-3">Accede con tu e-mail y contraseña. Tus informes guardados estarán disponibles solo en tu cuenta.</p></div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {session?<div className="flex gap-4"><button onClick={()=>setRetry(n=>n+1)}>Reintentar</button><button onClick={signOut}>Cerrar sesión</button></div>:<><form onSubmit={enter} className="space-y-4"><label className="block text-sm">E-mail<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className="block mt-2 w-full bg-background border border-border px-3 py-3" placeholder="tu@email.com"/></label>{passwordFields}<button disabled={busy} className="w-full bg-primary text-black font-semibold py-3 disabled:opacity-50">{busy?'Un momento…':register?'Crear cuenta':'Entrar'}</button></form><button disabled={busy} className="text-primary text-sm" onClick={()=>{setRegister(!register);setError('');setPassword('');setConfirmation('');}}>{register?'Ya tengo cuenta · Iniciar sesión':'No tengo cuenta · Registrarme'}</button><p className="text-xs text-slate-400">No se envían correos de confirmación. Guarda tu contraseña: la recuperación por e-mail no está disponible en esta beta.</p></>}
    <p className="text-xs text-slate-400 leading-relaxed">Al acceder a esta beta, el administrador podrá ver tu e-mail y qué activos analizas para gestionar las pruebas y el uso del servicio. Los informes son informativos y pueden contener errores. No introduzcas información financiera personal.</p>
  </section></main>;
}

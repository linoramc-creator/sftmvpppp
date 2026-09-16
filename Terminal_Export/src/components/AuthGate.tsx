import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { accountApi, type Profile } from '@/lib/beta-api';
const Context = createContext<Profile | null>(null);
export const useProfile = () => useContext(Context)!;
export default function AuthGate({children}: {children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
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
    const {error}=await supabase.auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:window.location.origin+'/',shouldCreateUser:true}});
    if(error)setError(error.status===429?'Espera unos minutos antes de pedir otro enlace.':'No se pudo enviar el enlace de acceso. Si persiste, contacta con el administrador.');else setSent(true);setBusy(false);
  }
  if(!ready)return <div className="p-8 text-sm">Comprobando sesión…</div>;
  if(session&&profile&&!error)return <Context.Provider value={profile}><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border text-xs"><span className="truncate">{profile.email}</span><nav className="flex gap-4"><Link to="/">Terminal</Link>{profile.isAdmin&&<Link className="text-primary" to="/admin">Administración</Link>}<button onClick={signOut}>Cerrar sesión</button></nav></div><div key={profile.id}>{children}</div></Context.Provider>;
  return <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5"><section className="w-full max-w-md border border-border bg-card p-7 space-y-6">
    <div><p className="text-primary text-xs tracking-widest mb-3">TERMINAL · BETA</p><h1 className="text-xl font-semibold">{session?'Acceso a tu cuenta':'Tu terminal de análisis'}</h1><p className="text-sm text-muted-foreground mt-3">Entra con tu e-mail, sin contraseña. Tus informes guardados estarán disponibles solo en tu cuenta.</p></div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {session?<div className="flex gap-4"><button onClick={()=>setRetry(n=>n+1)}>Reintentar</button><button onClick={signOut}>Cerrar sesión</button></div>:sent?<div role="status" className="space-y-4 text-sm"><p>Revisa tu correo y pulsa el enlace de acceso. Mira también la carpeta de spam. El enlace es personal; no lo compartas.</p><button className="text-primary" onClick={()=>setSent(false)}>Usar otro e-mail o reenviar</button></div>:<form onSubmit={enter} className="space-y-4"><label className="block text-sm">E-mail<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className="block mt-2 w-full bg-background border border-border px-3 py-3" placeholder="tu@email.com"/></label><button disabled={busy} className="w-full bg-primary text-black font-semibold py-3 disabled:opacity-50">{busy?'Enviando…':'Recibir enlace de acceso'}</button></form>}
    <p className="text-xs text-muted-foreground leading-relaxed">Al acceder a esta beta, el administrador podrá ver tu e-mail y qué activos analizas para gestionar las pruebas y el uso del servicio. Los informes son informativos y pueden contener errores. No introduzcas información financiera personal.</p>
  </section></main>;
}

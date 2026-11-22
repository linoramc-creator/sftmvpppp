import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { accountApi,type Profile } from '@/lib/beta-api';
import { normalizeProfileName, profileDisplayName } from '../../../supabase/functions/analyze-ticker/profile-name';
import TerminalWelcome from './TerminalWelcome';
import {TerminalEntryProvider,type FeedReadiness,type TerminalEntryScope} from '@/lib/terminal-entry';
import './auth-experience.css';
import PersonalAccess from './PersonalAccess';
import {accessCodeApi,type AccessTokens} from '@/lib/access-code-api';
const Context = createContext<Profile | null>(null);
export const useProfile = () => useContext(Context)!;
export default function AuthGate({children}: {children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState('');
  const location=useLocation(),currentToken=useRef(session?.access_token);currentToken.current=session?.access_token;
  const [welcome,setWelcome]=useState<{id:string;profileId:string;name:string;attempt:number;startedAt:number;phase:'loading'|'ready'|'error'|'leaving';detail:string;portfolioRequired:boolean;gates:Partial<Record<TerminalEntryScope,FeedReadiness>>}|null>(null);
  const welcomedUsers=useRef(new Set<string>());
  const [retry,setRetry]=useState(0),[settings,setSettings]=useState(false);
  const recovery=false,changingAccess=useRef(false);
  const accessBusy=useCallback((value:boolean)=>{changingAccess.current=value;},[]);
  useEffect(()=>{let active=true;supabase.auth.getSession().then(({data,error})=>{if(active){setSession(data.session);setReady(true);if(error)setError('No se pudo recuperar la sesión.');}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,value)=>{if(event==='PASSWORD_RECOVERY'){setSession(null);queueMicrotask(()=>void supabase.auth.signOut({scope:'local'}));return;}setSession(value);setReady(true);});return()=>{active=false;subscription.unsubscribe();};},[]);
  useEffect(()=>{let active=true;setProfile(previous=>previous?.id===session?.user?.id?previous:null);setError('');if(!session)return;
    // Profile uses the normal authenticated request but not the global 403
    // listener, avoiding an access-check loop for revoked accounts.
    const load=async()=>{try{const r=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({accountAction:'profile'}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!active||currentToken.current!==session.access_token)return;if(!r.ok){if(r.status===401){if(changingAccess.current)return;await supabase.auth.signOut({scope:'local'});if(active){setSession(null);setProfile(null);setWelcome(null);}return;}throw new Error(data.error||'No se pudo comprobar el acceso.');}if(active)setProfile(data);}catch(e){if(active)setError((e as Error).message);}};
    void load();const check=()=>{void load();};window.addEventListener('beta-access-check',check);
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener('beta-access-check',check);};},[session?.access_token,retry]);
  const recordedAccess=useRef(new Map<string,string>());
  useEffect(()=>{if(!profile)return;let visit=recordedAccess.current.get(profile.id);if(visit)return;visit=crypto.randomUUID();recordedAccess.current.set(profile.id,visit);void accountApi('recordAccess',{visitId:visit}).catch(()=>{recordedAccess.current.delete(profile.id);});},[profile?.id]);
  useEffect(()=>{
    if(location.pathname!=='/'||!profile||error||recovery){setWelcome(null);return;}
    if(welcomedUsers.current.has(profile.id))return;
    setWelcome(previous=>previous?.profileId===profile.id?previous:{id:crypto.randomUUID(),profileId:profile.id,name:normalizeProfileName(profile.displayName)||profileDisplayName(session?.user?.user_metadata,profile.email),attempt:0,startedAt:Date.now(),phase:'loading',detail:'Preparando tu espacio de mercado…',portfolioRequired:false,gates:{}});
  },[profile?.id,error,recovery,location.pathname]);
  const reportReadiness=useCallback((id:string,attempt:number,state:FeedReadiness,scope:TerminalEntryScope='feed')=>{
    setWelcome(previous=>{
      if(!previous||previous.id!==id||previous.attempt!==attempt||previous.phase==='leaving'||scope==='portfolio'&&!previous.portfolioRequired)return previous;
      const prior=previous.gates[scope];if(prior?.status===state.status&&prior.detail===state.detail)return previous;
      const gates={...previous.gates,[scope]:state},required:TerminalEntryScope[]=previous.portfolioRequired?['feed','portfolio']:['feed'];
      const failed=required.find(key=>gates[key]?.status==='error'),pending=required.find(key=>gates[key]?.status!=='ready');
      const phase=failed?'error':pending?'loading':'ready';
      const detail=failed?(gates[failed]?.detail??'No se ha podido preparar tu espacio.'):pending?(gates[pending]?.detail??(pending==='portfolio'?'Preparando tu portfolio y sus métricas…':'Preparando tu feed…')):'Tu espacio de trabajo está preparado.';
      return {...previous,gates,phase,detail};
    });
  },[]);
  const entryContext=useMemo(()=>welcome?{sessionId:welcome.id,attempt:welcome.attempt,portfolioRequired:welcome.portfolioRequired,report:reportReadiness}:null,[welcome?.id,welcome?.attempt,welcome?.portfolioRequired,reportReadiness]);
  useEffect(()=>{
    if(!welcome||welcome.phase==='leaving')return;
    const id=welcome.id,attempt=welcome.attempt;
    const timer=window.setTimeout(()=>setWelcome(previous=>previous?.id===id&&previous.attempt===attempt&&previous.phase==='loading'?{...previous,phase:'error',detail:'La carga está tardando más de lo esperado. Puedes reintentar o entrar con lo que ya está disponible.'}:previous),90000);
    return()=>window.clearTimeout(timer);
  },[welcome?.id,welcome?.attempt]);
  useEffect(()=>{
    if(welcome?.phase!=='ready')return;
    const id=welcome.id,attempt=welcome.attempt;
    const timer=window.setTimeout(()=>setWelcome(previous=>previous?.id===id&&previous.attempt===attempt&&previous.phase==='ready'?{...previous,phase:'leaving'}:previous),Math.max(0,3500-(Date.now()-welcome.startedAt)));
    return()=>window.clearTimeout(timer);
  },[welcome?.id,welcome?.attempt,welcome?.phase]);
  useEffect(()=>{
    if(welcome?.phase!=='leaving')return;
    const id=welcome.id;
    const timer=window.setTimeout(()=>setWelcome(previous=>{if(previous?.id!==id)return previous;welcomedUsers.current.add(previous.profileId);return null;}),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:380);
    return()=>window.clearTimeout(timer);
  },[welcome?.id,welcome?.phase]);
  const welcomeVisible=location.pathname==='/'&&!recovery&&!!profile&&!error&&(!welcomedUsers.current.has(profile.id)||welcome?.profileId===profile.id);
  const signOut=async()=>{if(session)await accessCodeApi('logout',{},session.access_token).catch(()=>{});await supabase.auth.signOut({scope:'local'});window.location.assign('/');};
  const enterWithCode=async(tokens:AccessTokens)=>{const result=await supabase.auth.setSession(tokens);if(result.error||!result.data.session)throw new Error('No se ha podido iniciar la sesión. Vuelve a introducir tu código.');setSession(result.data.session);};
  if(!ready||session)return <>
    {ready&&session&&profile&&!error&&<Context.Provider value={profile}><TerminalEntryProvider value={entryContext}><div ref={node=>{if(node)node.inert=welcomeVisible;}} aria-hidden={welcomeVisible||undefined}><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border text-xs"><span className="truncate">{profile.email}</span><nav className="flex flex-wrap gap-4 text-white/80"><Link to="/">Terminal</Link>{profile.isAdmin&&<Link className="text-white" to="/admin">Administración</Link>}<button onClick={()=>setSettings(!settings)}>Mi código</button><button onClick={signOut}>Cerrar sesión</button></nav></div>{settings&&<div className="mx-auto max-w-md p-5"><PersonalAccess token={session.access_token} onEnter={enterWithCode} onBusyChange={accessBusy} onClose={()=>setSettings(false)}/></div>}<div key={profile.id}>{children}</div></div></TerminalEntryProvider></Context.Provider>}
    {(!ready||!profile||error||welcomeVisible)&&<TerminalWelcome
      name={profile?(normalizeProfileName(profile.displayName)||profileDisplayName(session?.user?.user_metadata,profile.email)):session?profileDisplayName(session.user?.user_metadata,session.user?.email??''):''}
      phase={error?'error':welcome?.phase??'loading'}
      detail={error||(!ready?'Comprobando sesión…':!profile?'Comprobando el acceso a tu espacio…':welcome?.detail??'Preparando tu espacio de mercado…')}
      onRetry={()=>{if(!profile||error){setRetry(n=>n+1);return;}setWelcome(previous=>previous?{...previous,attempt:previous.attempt+1,startedAt:Date.now(),phase:'loading',detail:'Volviendo a preparar tu espacio…',gates:{}}:previous);}}
      onContinue={profile&&!error?()=>setWelcome(previous=>previous?{...previous,phase:'leaving'}:previous):undefined}
      onSignOut={session?signOut:undefined}
    />}
  </>;
  return <PersonalAccess onEnter={enterWithCode} onBusyChange={accessBusy}/>;
}

import {useEffect,useRef,useState} from 'react';
import {accountApi} from '@/lib/beta-api';
import {defaultFeedPreferences,normalizeFeedPreferences,type FeedPreferences} from '../../../supabase/functions/analyze-ticker/feed-preferences';

export function useFeedPreferences(accountId:string){
 const [groups,setGroups]=useState<FeedPreferences>(defaultFeedPreferences),[loadedOwner,setLoadedOwner]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const owner=useRef(accountId);owner.current=accountId;
 useEffect(()=>{
  let active=true;setLoadedOwner('');setError('');setGroups(defaultFeedPreferences());
  void accountApi<{groups:FeedPreferences}>('getFeedPreferences').then(result=>{
   if(!active)return;const normalized=normalizeFeedPreferences(result.groups);if(!normalized)throw new Error('Configuración inválida.');setGroups(normalized);setLoadedOwner(accountId);
  }).catch(()=>{if(active)setError('No se ha podido sincronizar tu configuración de mercado.');});
  return()=>{active=false;};
 },[accountId,attempt]);
 const save=async(value:FeedPreferences)=>{
  const account=accountId;if(owner.current!==account)throw new Error('Tu sesión ha cambiado. Vuelve a abrir la configuración.');
  const result=await accountApi<{groups:FeedPreferences}>('saveFeedPreferences',{groups:value});
  if(owner.current!==account)throw new Error('Tu sesión ha cambiado.');
  const normalized=normalizeFeedPreferences(result.groups);if(!normalized)throw new Error('No se ha podido guardar la configuración.');
  setGroups(normalized);setLoadedOwner(account);setError('');
 };
 return {groups,ready:loadedOwner===accountId,error,save,retry:()=>setAttempt(value=>value+1)};
}

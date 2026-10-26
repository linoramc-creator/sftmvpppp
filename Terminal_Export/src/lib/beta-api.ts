import { supabase } from '@/integrations/supabase/client';
export type Profile = { id: string; email: string; displayName?: string; isAdmin: boolean; dailyReportLimit: number };
export async function sessionHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Inicia sesión para continuar.');
  return { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
}
export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { ...init.headers, ...await sessionHeaders() } });
  if (response.status === 401 || response.status === 403) window.dispatchEvent(new Event('beta-access-check'));
  return response;
}
export async function accountApi<T>(accountAction: string, body: Record<string, unknown> = {},options:{signal?:AbortSignal}={}): Promise<T> {
  const deadline=AbortSignal.timeout(accountAction==='researchSave'?90000:['summarizeReport','researchCheck','researchExplain','researchSummary'].includes(accountAction)?85000:20000);
  const signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
  const response = await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountAction,...body}),signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se ha podido completar la operación.');
  return data;
}

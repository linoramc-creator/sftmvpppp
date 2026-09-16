// Only explicit HTTPS news links may leave the application, in a separate tab.
// Infrastructure dashboards and local/private destinations are never news links.
export function safeNewsHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return;
    if (['supabase.com','supabase.co','supabase.in','vercel.com','vercel.app','lovable.dev','lovable.app','localhost','local','internal','test'].some(domain => host === domain || host.endsWith('.'+domain))) return;
    return url.href;
  } catch { return; }
}

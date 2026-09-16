import { safeNewsHref } from '@/lib/navigation';
it('rejects unsafe navigation and infrastructure links',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','//example.com','http://example.com','https://supabase.com/dashboard','https://project.supabase.co/auth/v1/authorize','https://vercel.com/account','https://other.vercel.app','https://supabase.com./dashboard','https://127.0.0.1','https://[::1]','https://internal','https://host.local','https://user:pass@example.com','https://example.com:8443']) expect(safeNewsHref(url)).toBeUndefined();
});
it('permits normal HTTPS article links',()=>{expect(safeNewsHref('https://www.reuters.com/markets/article')).toBe('https://www.reuters.com/markets/article');});

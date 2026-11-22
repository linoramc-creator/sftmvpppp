import {accessHandler} from '../analyze-ticker/access-code-service.ts';
Deno.serve(accessHandler({url:Deno.env.get('SUPABASE_URL')??'',serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',anonKey:Deno.env.get('SUPABASE_ANON_KEY')??'',pepper:Deno.env.get('ACCESS_CODE_PEPPER')??''}));

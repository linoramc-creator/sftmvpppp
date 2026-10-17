begin;
alter table public.beta_analysis_cache drop constraint beta_analysis_cache_kind_check;
alter table public.beta_analysis_cache add constraint beta_analysis_cache_kind_check
 check (kind in ('ticker','etf','sector','relative'));
-- Existing RLS, service-only privileges, key and payload bounds remain intact.
commit;

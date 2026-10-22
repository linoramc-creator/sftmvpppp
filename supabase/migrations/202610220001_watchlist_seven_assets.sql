begin;

-- PostgreSQL names the inline symbols CHECK in 202610120002_daily_brief.sql
-- beta_watchlists_symbols_check. Raise if it has drifted instead of silently
-- leaving an older six-asset restriction in place.
alter table public.beta_watchlists
 drop constraint beta_watchlists_symbols_check;
alter table public.beta_watchlists
 add constraint beta_watchlists_symbols_check check (cardinality(symbols) <= 7);

-- Keep every saved selection, owner identity, grant and RLS policy intact.
commit;

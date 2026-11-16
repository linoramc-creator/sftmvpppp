begin;
-- Explicitly requested new Seguimiento rules. Historical rules stay paused;
-- each user must choose to create or resume a rule through the owned RPC.
drop trigger if exists beta_monitor_alerts_retired on public.beta_monitor_alerts;
drop function if exists beta_private.monitor_alerts_retired();
commit;

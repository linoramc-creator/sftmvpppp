begin;

-- Replace only the exact previous seven-commodity preset. A reordered,
-- shortened or otherwise personalized commodity selection remains untouched;
-- every other group and the authenticated owner remain unchanged.
update public.beta_feed_preferences
set groups=jsonb_set(groups,'{commodities}','["XAUUSD=X","XAGUSD=X","CL=F","BZ=F","HG=F","NG=F","SGX-IODEX"]'::jsonb),
 updated_at=now()
where groups->'commodities'='["GC=F","SI=F","CL=F","BZ=F","HG=F","NG=F","SGX-IODEX"]'::jsonb;

commit;

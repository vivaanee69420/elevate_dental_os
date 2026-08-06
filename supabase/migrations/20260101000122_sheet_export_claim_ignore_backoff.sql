-- Manual re-check support for the sheet conversion export: "Export now" and
-- the post-GHL-sync re-match must claim rows IMMEDIATELY — pending rows
-- regardless of retry backoff, and no_match rows regardless of the 4h revisit
-- gate (still only within the 30-day window, still attempts < 10). The
-- scheduled sweep keeps the gated behaviour (p_ignore_backoff defaults false).

drop function if exists public.sheet_export_claim(uuid, int, boolean);

create or replace function public.sheet_export_claim(
  p_org uuid, p_limit int default 50, p_include_no_match boolean default false,
  p_ignore_backoff boolean default false)
returns setof public.sheet_export_queue
language sql
security definer
set search_path = public as $$
  update public.sheet_export_queue q
  set status = 'processing', claimed_at = now(), updated_at = now()
  where q.id in (
    select id from public.sheet_export_queue
    where organisation_id = p_org
      and attempts < 10
      and (
        (status = 'pending' and (p_ignore_backoff or attempts = 0 or
          updated_at < now() - make_interval(mins =>
            least(power(2, least(attempts, 10)), 1440)::int)))
        or (status = 'processing' and claimed_at < now() - interval '10 minutes')
        or (p_include_no_match and status = 'no_match'
            and created_at > now() - interval '30 days'
            and (p_ignore_backoff or updated_at < now() - interval '4 hours')))
    order by (status = 'pending') desc, created_at asc
    limit p_limit
    for update skip locked)
  returning q.*;
$$;

grant execute on function public.sheet_export_claim(uuid, int, boolean, boolean) to service_role;
revoke all on function public.sheet_export_claim(uuid, int, boolean, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Business Hub period filter: add an optional upper bound (p_until) so the hub
-- can window by a single month/day, not just a trailing N days. settled_revenue
-- already had p_until (000019); this adds it to the appointments + treatments
-- rollups and gives the leads rollup an optional created_at window.
-- CREATE OR REPLACE can't change a function's arg list, so each is dropped and
-- recreated with the extra default-null arg. All idempotent + backward
-- compatible: omit p_until (or pass null) for the old open-ended behaviour.

drop function if exists public.appointments_rollup_by_practice(uuid, timestamptz);
create or replace function public.appointments_rollup_by_practice(
  p_org uuid, p_since timestamptz, p_until timestamptz default null
)
returns table(practice_id uuid, total bigint, completed bigint, no_shows bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         count(*)::bigint,
         count(*) filter (where status = 'completed')::bigint,
         count(*) filter (where status = 'no_show')::bigint
  from public.appointments
  where organisation_id = p_org and starts_at >= p_since
    and (p_until is null or starts_at <= p_until)
  group by practice_id;
$$;
grant execute on function public.appointments_rollup_by_practice(uuid, timestamptz, timestamptz) to service_role, authenticated;

drop function if exists public.treatments_rollup_by_org(uuid, timestamptz);
create or replace function public.treatments_rollup_by_org(
  p_org uuid, p_since timestamptz, p_until timestamptz default null
)
returns table(started bigint, completed bigint, closed_value_pence bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (
      where start_date >= p_since::date
        and (p_until is null or start_date <= p_until::date)
    )::bigint,
    count(*) filter (
      where completed and completed_at >= p_since
        and (p_until is null or completed_at <= p_until)
    )::bigint,
    coalesce(sum(private_value_pence) filter (
      where completed and completed_at >= p_since
        and (p_until is null or completed_at <= p_until)
        and private_value_pence > 0
    ), 0)::bigint
  from public.treatment_plans
  where organisation_id = p_org;
$$;
grant execute on function public.treatments_rollup_by_org(uuid, timestamptz, timestamptz) to service_role, authenticated;

-- Leads rollup: optional created_at window. Null/null = all-time (unchanged).
drop function if exists public.leads_rollup_by_practice(uuid);
create or replace function public.leads_rollup_by_practice(
  p_org uuid, p_since timestamptz default null, p_until timestamptz default null
)
returns table(practice_id uuid, total bigint, converted bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         count(*)::bigint,
         count(*) filter (where status in ('treatment_started', 'treatment_completed'))::bigint
  from public.leads
  where organisation_id = p_org
    and (p_since is null or created_at >= p_since)
    and (p_until is null or created_at <= p_until)
  group by practice_id;
$$;
grant execute on function public.leads_rollup_by_practice(uuid, timestamptz, timestamptz) to service_role, authenticated;

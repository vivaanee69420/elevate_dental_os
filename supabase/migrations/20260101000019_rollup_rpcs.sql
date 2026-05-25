-- Exact per-practice rollups computed in Postgres (GROUP BY), so Business Hub +
-- Command Centre aggregates aren't truncated by PostgREST's 1000-row read cap
-- (the old path fetched rows and counted in Node — wrong for >1000 rows).
-- All security definer + granted; org-scoping is the p_org arg.

-- Settled revenue per practice in a window (p_until NULL = open).
create or replace function public.settled_revenue_by_practice(
  p_org uuid, p_since timestamptz, p_until timestamptz default null
)
returns table(practice_id uuid, pence bigint)
language sql stable security definer set search_path = public as $$
  select practice_id, coalesce(sum(amount_pence), 0)::bigint
  from public.payments
  where organisation_id = p_org and status = 'settled' and processed_at >= p_since
    and (p_until is null or processed_at <= p_until)
  group by practice_id;
$$;

-- Appointment rollup per practice since a date.
create or replace function public.appointments_rollup_by_practice(
  p_org uuid, p_since timestamptz
)
returns table(practice_id uuid, total bigint, completed bigint, no_shows bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         count(*)::bigint,
         count(*) filter (where status = 'completed')::bigint,
         count(*) filter (where status = 'no_show')::bigint
  from public.appointments
  where organisation_id = p_org and starts_at >= p_since
  group by practice_id;
$$;

-- Leads rollup per practice (all-time); converted = treatment started/completed.
create or replace function public.leads_rollup_by_practice(p_org uuid)
returns table(practice_id uuid, total bigint, converted bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         count(*)::bigint,
         count(*) filter (where status in ('treatment_started', 'treatment_completed'))::bigint
  from public.leads
  where organisation_id = p_org
  group by practice_id;
$$;

grant execute on function public.settled_revenue_by_practice(uuid, timestamptz, timestamptz) to service_role, authenticated;
grant execute on function public.appointments_rollup_by_practice(uuid, timestamptz) to service_role, authenticated;
grant execute on function public.leads_rollup_by_practice(uuid) to service_role, authenticated;

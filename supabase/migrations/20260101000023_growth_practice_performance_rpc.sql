-- Exact per-practice growth rollup computed in Postgres (GROUP BY), so the
-- Growth "Practices & Patients" screen is not truncated by PostgREST's 1000-row
-- read cap. The old route fetched rows and counted in Node, which double-broke:
--   * "All practices" undercounted (only the first 1000 org rows were tallied,
--     then split per practice), and
--   * a single-practice filter capped each metric at exactly 1000.
-- Windowed by p_since/p_until (p_until NULL = open). p_practice NULL = all.
-- new_patients = contacts of type 'patient' created in-window (Dentally patients).
-- security definer + granted; org-scoping is the p_org arg.
create or replace function public.growth_practice_performance(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz default null,
  p_practice uuid default null
)
returns table(
  practice_id uuid,
  name text,
  new_patients bigint,
  appts bigint,
  completed bigint,
  no_shows bigint,
  revenue_pence bigint
)
language sql stable security definer set search_path = public as $$
  with pr as (
    select id, name from public.practices
    where organisation_id = p_org
      and (p_practice is null or id = p_practice)
  ),
  pat as (
    select practice_id, count(*)::bigint as n
    from public.contacts
    where organisation_id = p_org and type = 'patient'
      and created_at >= p_since
      and (p_until is null or created_at <= p_until)
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  ),
  appt as (
    select practice_id,
           count(*)::bigint as total,
           count(*) filter (where status = 'completed')::bigint as completed,
           count(*) filter (where status = 'no_show')::bigint as no_shows
    from public.appointments
    where organisation_id = p_org
      and starts_at >= p_since
      and (p_until is null or starts_at <= p_until)
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  ),
  pay as (
    select practice_id, coalesce(sum(amount_pence), 0)::bigint as pence
    from public.payments
    where organisation_id = p_org and status = 'settled'
      and processed_at >= p_since
      and (p_until is null or processed_at <= p_until)
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  )
  select pr.id, pr.name,
         coalesce(pat.n, 0),
         coalesce(appt.total, 0),
         coalesce(appt.completed, 0),
         coalesce(appt.no_shows, 0),
         coalesce(pay.pence, 0)
  from pr
  left join pat  on pat.practice_id  = pr.id
  left join appt on appt.practice_id = pr.id
  left join pay  on pay.practice_id  = pr.id
  order by pr.name;
$$;

grant execute on function public.growth_practice_performance(uuid, timestamptz, timestamptz, uuid) to service_role, authenticated;

NOTIFY pgrst, 'reload schema';

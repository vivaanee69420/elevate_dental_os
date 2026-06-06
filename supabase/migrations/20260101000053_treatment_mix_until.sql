-- Treatment Mix period filter: add an optional upper bound (p_until) so the
-- Treatment Mix chart can window by the global month/year/custom filter, not
-- just a trailing window. Mirrors 000049 (appointments_rollup_by_practice) —
-- same starts_at <= p_until semantics so the two appointment-based figures
-- reconcile. CREATE OR REPLACE can't change a function's arg list, so it's
-- dropped and recreated with the extra default-null arg. Idempotent + backward
-- compatible: omit p_until (or pass null) for the old open-ended behaviour.

drop function if exists public.treatment_mix_stats(uuid, uuid, timestamptz);
create or replace function public.treatment_mix_stats(
  p_org uuid, p_practice uuid, p_since timestamptz, p_until timestamptz default null
)
returns table (appointment_type text, volume bigint)
language sql stable as $$
  select coalesce(a.appointment_type, 'Unspecified') as appointment_type,
         count(*)::bigint as volume
  from public.appointments a
  where a.organisation_id = p_org
    and a.starts_at >= p_since
    and (p_until is null or a.starts_at <= p_until)
    and (p_practice is null or a.practice_id = p_practice)
  group by coalesce(a.appointment_type, 'Unspecified')
  order by volume desc;
$$;
grant execute on function public.treatment_mix_stats(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';

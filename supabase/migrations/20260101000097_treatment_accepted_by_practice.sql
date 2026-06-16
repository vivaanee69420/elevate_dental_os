-- Treatments Accepted — per-practice breakdown for the Business Hub card.
-- Companion to treatment_accepted_aggregate (000096): same window + status
-- filter, but GROUPed by practice_id so the card can show which practice's data
-- it reflects (click-to-breakdown) and respect the Dentally practice filter.
-- null practice_id folds into a single "unmapped" bucket (practice_id is null).
-- Idempotent. Additive only — safe to re-apply. Money is integer pence.
-- After applying on hosted run: NOTIFY pgrst, 'reload schema';

create or replace function public.treatment_accepted_by_practice(
  p_org      uuid,
  p_since    timestamptz,
  p_until    timestamptz default null
)
returns table(practice_id uuid, accepted_count bigint, accepted_value_pence bigint)
language sql stable security definer set search_path = public as $$
  select
    t.practice_id,
    count(*)::bigint as accepted_count,
    coalesce(sum(t.value_pence), 0)::bigint as accepted_value_pence
  from public.treatment_accepted t
  where t.organisation_id = p_org
    and t.status = 'accepted'
    and (p_since is null or t.accepted_date >= p_since::date)
    and (p_until is null or t.accepted_date <= p_until::date)
  group by t.practice_id;
$$;

grant execute on function public.treatment_accepted_by_practice(uuid, timestamptz, timestamptz)
  to service_role, authenticated;

notify pgrst, 'reload schema';

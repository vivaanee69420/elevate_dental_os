-- 000037  Booked chair-minutes from completed appointments (utility RPC)
--
-- NOTE: NOT the Chair-view occupancy source. Per product decision, chair
-- occupancy comes from the MANUAL chair-utilisation grid (chair_utilisation,
-- owner-maintained) — see analyticsService.chairAnalytics. This RPC is kept as
-- a utility for a future "actual (appointments) vs manual (grid)" comparison:
-- it sums COMPLETED-appointment chair-time per practice (clean ~45min durations;
-- confirmed/scheduled rows carry garbage ends_at), clamped to [0,480] min/appt.
--
-- Idempotent.

create or replace function public.chair_booked_minutes_by_practice(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz default null
)
returns table(practice_id uuid, booked_minutes bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         coalesce(sum(
           least(greatest(extract(epoch from (ends_at - starts_at)) / 60.0, 0), 480)
         ), 0)::bigint as booked_minutes
  from public.appointments
  where organisation_id = p_org
    and status = 'completed'
    and ends_at is not null
    and starts_at >= p_since
    and (p_until is null or starts_at <= p_until)
  group by practice_id
$$;

grant execute on function public.chair_booked_minutes_by_practice(uuid, timestamptz, timestamptz)
  to service_role, authenticated;

notify pgrst, 'reload schema';

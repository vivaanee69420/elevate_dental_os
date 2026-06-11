-- Group Overview "Appointments" headline was count(*) of EVERY row in the window,
-- including ~139/month patient-less rows (blocked time, admin slots, gaps) that we
-- sync from Dentally but the practice does not count as appointments. Dentally's
-- default appointments view applies a "With patients" filter, so its number
-- (Ashford May 2026 = 801) excludes those rows. Our count(*) returned 940 for the
-- same window, which read as "53 extra appointments out of nowhere".
--
-- Redefine the rollup to count only appointments that have a patient
-- (pms_patient_id is not null). This reconciles the headline to Dentally exactly
-- (verified: Ashford May 2026 -> 801). All statuses are kept, including cancelled
-- and future-booked, because Dentally's "With patients / Status: All / Future: All"
-- view counts them too — patient-presence, not status, is the correct axis.
-- completed / no_shows columns are likewise scoped to with-patient rows (an
-- appointment cannot be completed or a no-show without a patient, so this is
-- consistent, not a change in meaning). Date predicate untouched.
drop function if exists public.appointments_rollup_by_practice(uuid, timestamptz, timestamptz);
create or replace function public.appointments_rollup_by_practice(
  p_org uuid, p_since timestamptz, p_until timestamptz default null
)
returns table(practice_id uuid, total bigint, completed bigint, no_shows bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         count(*) filter (where pms_patient_id is not null)::bigint,
         count(*) filter (where pms_patient_id is not null and status = 'completed')::bigint,
         count(*) filter (where pms_patient_id is not null and status = 'no_show')::bigint
  from public.appointments
  where organisation_id = p_org and starts_at >= p_since
    and (p_until is null or starts_at <= p_until)
  group by practice_id;
$$;
grant execute on function public.appointments_rollup_by_practice(uuid, timestamptz, timestamptz) to service_role, authenticated;

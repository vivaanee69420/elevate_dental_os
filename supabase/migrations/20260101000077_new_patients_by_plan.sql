-- 20260101000077_new_patients_by_plan.sql
-- "New Patients" for the Business Hub, matching Dentally's own "New Patients per
-- Month" report exactly, PER PRACTICE.
--
-- Dentally defines a new patient by the patient's REGISTRATION ("joined") date,
-- not by their first treatment plan or first appointment. We capture that date
-- in contacts.pms_registered_at (migration 000073, populated from the Dentally
-- patient payload). Counting patients whose pms_registered_at falls in the
-- window, grouped by practice, reproduces Dentally's monthly per-location totals
-- (e.g. Ashford May 2026 = 93, exact). The group total is the sum of the rows.
--
-- PURE registration — no first-appointment fallback. The shared
-- org_new_patients_count (000072/000073) keeps the COALESCE(reg, first_appt)
-- fallback for the growth pages, but that fallback OVER-counts vs Dentally, so
-- the Business Hub uses the strict registration count. Patients without a synced
-- pms_registered_at are not counted until the next full Dentally patient sync
-- backfills the column (currently ~53% coverage -> a small current-month
-- under-count that closes as the backfill completes).
--
-- Upper bound EXCLUSIVE (matches the hub's [since, until) window). Returns one
-- row per practice_id present in the window (practice_id may be NULL for an
-- unassigned patient; the service folds that into the group total only). STABLE
-- pure read, org-scoped, idempotent.
create or replace function public.org_new_patients_registered_by_practice(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz default null
)
returns table(practice_id uuid, new_patients bigint)
language sql stable security definer set search_path = public as $$
  select c.practice_id, count(*)::bigint
  from public.contacts c
  where c.organisation_id = p_org
    and c.type = 'patient'
    and c.pms_registered_at is not null
    and c.pms_registered_at >= p_since
    and (p_until is null or c.pms_registered_at < p_until)
  group by c.practice_id;
$$;

grant execute on function public.org_new_patients_registered_by_practice(uuid, timestamptz, timestamptz)
  to service_role, authenticated;

-- PostgREST schema cache goes stale after DDL (recurring gotcha).
notify pgrst, 'reload schema';

-- 20260101000063_patient_retention.sql
-- Attrition & Retention (DentaCFO gap Phase 6). Per-practice patient cohorts by
-- last-visit recency in ONE query — appointments is large (100k+ rows/org), so a
-- JS-side paginated scan + per-patient max() is too heavy; this RPC does the
-- per-patient grouping in Postgres. Mirrors the *_rollup_by_practice RPCs:
-- security definer, granted to service_role (the path analytics.repository takes)
-- + authenticated for parity. Idempotent. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
--
-- A "visit" = a past appointment that was not cancelled (completed / confirmed-
-- but-past / in_progress / no_show all count as the patient having engaged the
-- practice). Patient identity = COALESCE(contact_id, 'pms:'||pms_patient_id) so
-- Dentally-only patients (pms id, no CRM contact) still count; appointments with
-- NEITHER id are unrecoverable (the linkage data wall) — counted separately as
-- unlinked_appts and surfaced as an informational flag, never as a cohort.
-- Each patient is attributed to the practice of their MOST RECENT visit.
--
-- Cohorts (relative to p_now, passed in for deterministic testing):
--   active   last visit  > p_now - 12 months
--   lapsed   p_now-24mo  < last visit <= p_now - 12 months  (recall / reactivation target)
--   dormant  last visit <= p_now - 24 months                 (largely gone)
create or replace function public.patient_retention_by_practice(p_org uuid, p_now timestamptz)
returns table(
  practice_id uuid,
  active_patients bigint,
  lapsed_patients bigint,
  dormant_patients bigint,
  total_patients bigint,
  unlinked_appts bigint
)
language sql stable security definer set search_path = public as $$
  with visits as (
    select a.practice_id,
           coalesce(a.contact_id::text, 'pms:' || a.pms_patient_id) as patient_key,
           a.starts_at
    from public.appointments a
    where a.organisation_id = p_org
      and a.starts_at <= p_now
      and a.status <> 'cancelled'
      and (a.contact_id is not null or a.pms_patient_id is not null)
  ),
  last_visit as (
    -- each patient's most recent visit + the practice it happened at
    select distinct on (patient_key)
           patient_key, practice_id, starts_at as last_at
    from visits
    order by patient_key, starts_at desc
  ),
  cohorts as (
    select practice_id,
           count(*) filter (where last_at >  p_now - interval '12 months')::bigint as active_patients,
           count(*) filter (where last_at <= p_now - interval '12 months'
                              and last_at >  p_now - interval '24 months')::bigint as lapsed_patients,
           count(*) filter (where last_at <= p_now - interval '24 months')::bigint as dormant_patients,
           count(*)::bigint                                                        as total_patients
    from last_visit
    group by practice_id
  ),
  unlinked as (
    select a.practice_id, count(*)::bigint as unlinked_appts
    from public.appointments a
    where a.organisation_id = p_org
      and a.contact_id is null and a.pms_patient_id is null
    group by a.practice_id
  )
  select
    coalesce(c.practice_id, u.practice_id) as practice_id,
    coalesce(c.active_patients, 0)         as active_patients,
    coalesce(c.lapsed_patients, 0)         as lapsed_patients,
    coalesce(c.dormant_patients, 0)        as dormant_patients,
    coalesce(c.total_patients, 0)          as total_patients,
    coalesce(u.unlinked_appts, 0)          as unlinked_appts
  from cohorts c
  full outer join unlinked u on c.practice_id = u.practice_id;
$$;

grant execute on function public.patient_retention_by_practice(uuid, timestamptz) to service_role, authenticated;

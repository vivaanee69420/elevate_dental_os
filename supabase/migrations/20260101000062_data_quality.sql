-- 20260101000062_data_quality.sql
-- Data Quality Engine (DentaCFO gap Phase 5). Per-practice defect counts in ONE
-- query — appointments is large (100k+ rows/org), so a JS-side paginated scan is
-- too heavy; this RPC does the GROUP BY in Postgres. Mirrors the existing
-- *_rollup_by_practice RPCs: security definer, granted to service_role (the path
-- analytics.repository takes) + authenticated for parity. Idempotent.
--
-- Defects counted:
--   uncoded_appts    appointment_type null/blank (no treatment coding)
--   unlinked_appts   no patient identity at all (contact_id AND pms_patient_id null) -> name unrecoverable
--   unassigned_appts no clinician (associate_id null) -- informational; surfaced as a flag, NOT scored
--   unmatched_invoices invoice with no patient match (contact_id null)
--   invoiced/outstanding pence -> collection rate
create or replace function public.data_quality_by_practice(p_org uuid)
returns table(
  practice_id uuid,
  total_appts bigint,
  uncoded_appts bigint,
  unlinked_appts bigint,
  unassigned_appts bigint,
  total_invoices bigint,
  unmatched_invoices bigint,
  invoiced_pence bigint,
  outstanding_pence bigint
)
language sql stable security definer set search_path = public as $$
  with appt as (
    select a.practice_id,
           count(*)::bigint                                                                        as total_appts,
           count(*) filter (where a.appointment_type is null or a.appointment_type = '')::bigint   as uncoded_appts,
           count(*) filter (where a.contact_id is null and a.pms_patient_id is null)::bigint        as unlinked_appts,
           count(*) filter (where a.associate_id is null)::bigint                                   as unassigned_appts
    from public.appointments a
    where a.organisation_id = p_org
    group by a.practice_id
  ),
  inv as (
    select i.practice_id,
           count(*)::bigint                                              as total_invoices,
           count(*) filter (where i.contact_id is null)::bigint          as unmatched_invoices,
           coalesce(sum(i.amount_pence), 0)::bigint                      as invoiced_pence,
           coalesce(sum(i.amount_outstanding_pence), 0)::bigint          as outstanding_pence
    from public.invoices i
    where i.organisation_id = p_org
    group by i.practice_id
  )
  select
    coalesce(a.practice_id, i.practice_id)        as practice_id,
    coalesce(a.total_appts, 0)                    as total_appts,
    coalesce(a.uncoded_appts, 0)                  as uncoded_appts,
    coalesce(a.unlinked_appts, 0)                 as unlinked_appts,
    coalesce(a.unassigned_appts, 0)               as unassigned_appts,
    coalesce(i.total_invoices, 0)                 as total_invoices,
    coalesce(i.unmatched_invoices, 0)             as unmatched_invoices,
    coalesce(i.invoiced_pence, 0)                 as invoiced_pence,
    coalesce(i.outstanding_pence, 0)              as outstanding_pence
  from appt a
  full outer join inv i on a.practice_id = i.practice_id;
$$;

grant execute on function public.data_quality_by_practice(uuid) to service_role, authenticated;

NOTIFY pgrst, 'reload schema';

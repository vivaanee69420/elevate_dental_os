-- 20260101000108_business_hub_perf_indexes.sql
-- Speed up the Business Hub / Group Performance load. The endpoint fans out to
-- ~16 parallel rollup RPCs; profiling Plan4growth (107k appointments, 31k
-- payments) found two of them dominated the critical path because they lacked a
-- covering / partial index:
--
--   appointments_rollup_by_practice  2317ms -> 49ms   (47x)
--   settled_receipts_by_day          1150ms -> 68ms   (17x)
--
-- 1) appointments rollup filters (organisation_id, starts_at) then counts by
--    practice with FILTERs on pms_patient_id + status. The old idx_appts_org_date
--    (organisation_id, starts_at) forced a heap fetch per row (24k rows/window).
--    INCLUDE the counted columns so the aggregate is an index-ONLY scan.
--
-- 2) settled_receipts_by_day reads settled payments by processed_at, but the only
--    usable index was idx_payments_org (organisation_id) — so it read ALL 31k org
--    payments and discarded ~28k non-settled rows. A PARTIAL index on settled rows
--    keyed by processed_at (INCLUDE the summed/scoped columns) reads only the few
--    thousand settled rows and stays index-only. Also speeds cashflow + takings.
--
-- On hosted these were created CONCURRENTLY (no table lock) and the table was
-- VACUUMed to clear the visibility map (that VACUUM is what realised the
-- appointments index-only scan; autovacuum maintains it thereafter). This file
-- uses plain CREATE INDEX IF NOT EXISTS for fresh/local `supabase db reset`
-- (tiny tables there) and is a no-op on hosted where the indexes already exist.
-- Idempotent.

CREATE INDEX IF NOT EXISTS idx_appts_rollup_cov
  ON public.appointments (organisation_id, starts_at)
  INCLUDE (practice_id, pms_patient_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_settled_processed
  ON public.payments (organisation_id, processed_at)
  INCLUDE (amount_pence, practice_id, source)
  WHERE status = 'settled';

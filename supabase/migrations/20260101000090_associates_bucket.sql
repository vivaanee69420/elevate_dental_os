-- 000090 — Split fee-earning clinician pay into its own `associates` dental_bucket.
--
-- The Profit Benchmark "Dentist / associate" line reads costs.associates, but the
-- Xero/QuickBooks sync heuristic used to fold "Associate salary" / "Principal
-- salary" / hygienist pay into `staff` (the name carries "salary"). That made the
-- Dentist line read £0 / 0% (a false "Lean") and inflated Support staff.
--
-- This migration (1) widens the dental_bucket CHECK to allow 'associates' and
-- (2) backfills existing monthly_financials rows whose account name looks like a
-- fee-earning clinician account, mirroring the sync heuristic. Idempotent.

ALTER TABLE monthly_financials
  DROP CONSTRAINT IF EXISTS monthly_financials_dental_bucket_check;

ALTER TABLE monthly_financials
  ADD CONSTRAINT monthly_financials_dental_bucket_check
  CHECK (dental_bucket = ANY (ARRAY[
    'revenue','associates','staff','lab','materials','overhead','tax','other'
  ]));

-- Backfill: reclassify clinician-named cost rows currently mis-bucketed. account_code
-- holds the account NAME from the P&L sync, so the same regex the heuristic uses on
-- the name applies here. Only touch cost buckets (never revenue/tax).
UPDATE monthly_financials
SET dental_bucket = 'associates'
WHERE dental_bucket IN ('staff','overhead','other')
  AND account_code ~* '(associate|locum|principal|hygien|hygenist|therapist|self.?employed|dentist)';

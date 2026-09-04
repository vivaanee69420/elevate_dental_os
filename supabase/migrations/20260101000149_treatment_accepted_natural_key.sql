-- ============================================================================
-- treatment_accepted: a DB-enforced natural key, so no ingestion path can
-- double-count an Emergent record.
--
-- THE BUG. Emergent sends no stable record id, so the sync synthesised one:
--   sha256(business_id | date | patient_name | treatment_accepted | amount)
-- hashed over the RAW field values. Two consequences, both live on Plan4growth:
--
--   1. COSMETIC EDITS MINT A NEW IDENTITY. 228 of 229 duplicate pairs differ
--      only by trailing whitespace ('craig attawater' vs 'craig attawater ').
--      Different hash -> the ON CONFLICT (organisation_id, source, external_id)
--      guard misses -> both rows insert and both count.
--   2. AMOUNT IS PART OF THE IDENTITY. A plan logged at £0 and priced later
--      hashes differently once the price lands, so the corrected row is INSERTED
--      alongside the stale £0 one instead of replacing it.
--
-- Measured effect before this migration (Plan4growth): 975 rows where there
-- are 745 real records (+30.9%), and £3,523,594 of accepted value where the
-- truth is £2,508,947 — £1,014,647 overstated. It fed the Daily Cockpit,
-- Business Hub and marketing attribution alike.
--
-- THE FIX, AND WHY IT LIVES HERE RATHER THAN IN THE SYNC. Identity is enforced
-- by a UNIQUE INDEX over normalised generated columns, so it is a property of
-- the TABLE, not of whichever code path happens to be writing. This is a
-- multi-tenant product: the nightly pull, the real-time webhook, CSV import and
-- any importer written for a tenant onboarded next year all get the same
-- guarantee for free, and none of them can opt out by forgetting to normalise.
-- A path that computes an identity wrongly now fails loudly on a constraint
-- rather than silently inflating a tenant's revenue.
--
-- KEY CHOICE: (organisation_id, source, business_id, accepted_date,
--              patient_norm, treatment_norm)
--   * organisation_id LEADS it, so the key is tenant-scoped by construction —
--     two tenants can never collide, and the dedupe below can never merge one
--     tenant's record into another's.
--   * amount is EXCLUDED, so re-pricing UPDATES the record instead of forking
--     it. Verified safe across every tenant: there is not one case where the
--     same (org, business, date, patient, treatment) carries two DISTINCT
--     NON-ZERO amounts, so nothing collapses that should stay separate.
--   * business_id is INCLUDED, so the same patient reported by two different
--     Emergent businesses stays two rows. Merging them would corrupt
--     per-practice P&L. One such pair exists (Claire Cox, £822, 2026-08-03) and
--     is left for the owner to resolve at source — a key cannot decide which
--     business truthfully owns it.
--   * NULLS NOT DISTINCT (PG15+) makes a NULL business_id or treatment_name
--     collide like any other value. Without it NULLs are distinct and the
--     duplicates walk straight back in through the rows that lack a treatment.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Normalised generated columns.
--
-- Trim, collapse internal whitespace runs, lowercase. 'Craig  Attawater ' and
-- 'craig attawater' become the same record. Immutable expressions only, which
-- is what GENERATED ... STORED requires. Mirrors the email_norm / phone10
-- pattern already used on contacts.
-- ----------------------------------------------------------------------------
ALTER TABLE public.treatment_accepted
  ADD COLUMN IF NOT EXISTS patient_norm text
  GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(coalesce(patient_name, ''), '\s+', ' ', 'g')))
  ) STORED;

ALTER TABLE public.treatment_accepted
  ADD COLUMN IF NOT EXISTS treatment_norm text
  GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(coalesce(treatment_name, ''), '\s+', ' ', 'g')))
  ) STORED;

-- ----------------------------------------------------------------------------
-- 2. Archive, don't destroy.
--
-- The dedupe removes rows from a live tenant's revenue history. Keeping them
-- makes the change reversible and auditable — an owner asking "why did accepted
-- value drop by £1m overnight" can be shown exactly which rows went and why.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treatment_accepted_dedup_archive (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  -- The whole original row, so a restore needs no schema archaeology.
  row_data jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ta_dedup_archive_org
  ON public.treatment_accepted_dedup_archive (organisation_id, archived_at DESC);

-- Same posture as every other tenant table: RLS on, service_role only.
ALTER TABLE public.treatment_accepted_dedup_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.treatment_accepted_dedup_archive FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.treatment_accepted_dedup_archive TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Dedupe: newest row per natural key wins.
--
-- created_at DESC (id DESC to break ties deterministically) is deliberate and
-- verified against the live data: on the £0-then-priced pairs the priced row is
-- the later one, so newest-wins keeps £16,955 and archives the £0 twin. It also
-- handles a correction DOWNWARD, which a max(value_pence) rule would get wrong.
--
-- Runs per (organisation_id, ...) so it is safe for every tenant at once and
-- can never fold one tenant's row into another's.
-- ----------------------------------------------------------------------------
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organisation_id, source, business_id, accepted_date,
                        patient_norm, treatment_norm
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.treatment_accepted
),
losers AS (SELECT id FROM ranked WHERE rn > 1)
INSERT INTO public.treatment_accepted_dedup_archive (id, organisation_id, reason, row_data)
SELECT t.id, t.organisation_id,
       'natural-key dedupe (migration 000149): raw-field hash minted a second identity',
       to_jsonb(t)
FROM public.treatment_accepted t
JOIN losers l ON l.id = t.id
ON CONFLICT (id) DO NOTHING;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organisation_id, source, business_id, accepted_date,
                        patient_norm, treatment_norm
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.treatment_accepted
)
DELETE FROM public.treatment_accepted
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ----------------------------------------------------------------------------
-- 4. The guarantee. After this, a duplicate is IMPOSSIBLE rather than unlikely,
-- for every tenant and every write path. This is also the upsert's conflict
-- target, so a re-pulled record UPDATES in place — which is what makes the
-- sync self-healing for rows whose external_id was computed the old way.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_treatment_accepted_natural
  ON public.treatment_accepted (
    organisation_id, source, business_id, accepted_date, patient_norm, treatment_norm
  ) NULLS NOT DISTINCT;

-- Supports the dedupe/reporting queries and the practice restamp.
CREATE INDEX IF NOT EXISTS idx_ta_org_patient_norm
  ON public.treatment_accepted (organisation_id, patient_norm);

-- ----------------------------------------------------------------------------
-- 5. Re-hash external_id under the new normalised scheme.
--
-- external_id is no longer the upsert's conflict target (the natural key is),
-- but the webhook's delete path and the Data Room still read it, so it must not
-- be left holding a hash of the raw fields. This expression is byte-identical to
-- externalId() in lib/integrations/emergent-sync.js — verified by computing both
-- for a live row and by test/emergent-natural-key.test.mjs. Deterministic, so
-- re-running is a no-op.
-- ----------------------------------------------------------------------------
UPDATE public.treatment_accepted
SET external_id = substr(encode(digest(
      coalesce(business_id, '') || '|' ||
      coalesce(to_char(accepted_date, 'YYYY-MM-DD'), '') || '|' ||
      patient_norm || '|' || treatment_norm
    , 'sha256'), 'hex'), 1, 32)
WHERE source = 'emergent'
  AND external_id IS DISTINCT FROM substr(encode(digest(
      coalesce(business_id, '') || '|' ||
      coalesce(to_char(accepted_date, 'YYYY-MM-DD'), '') || '|' ||
      patient_norm || '|' || treatment_norm
    , 'sha256'), 'hex'), 1, 32);

NOTIFY pgrst, 'reload schema';

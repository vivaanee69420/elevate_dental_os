-- 20260101000039_treatment_plans_unique_idx.sql
-- Fix: the Dentally sync upserts treatment_plans with
-- onConflict='organisation_id,source,pms_external_id', but the table only had a
-- PK on id — no matching unique constraint. Postgres rejects every such upsert
-- ("no unique or exclusion constraint matching the ON CONFLICT specification"),
-- which upsertChunked swallows row-by-row, so treatment_plans stayed at 0 rows
-- despite ~61k plans available on Dentally. This index makes the upsert valid.
-- Idempotent (IF NOT EXISTS); table is empty so there are no dup rows to break it.

CREATE UNIQUE INDEX IF NOT EXISTS treatment_plans_org_source_extid_uniq
  ON treatment_plans (organisation_id, source, pms_external_id);

NOTIFY pgrst, 'reload schema';

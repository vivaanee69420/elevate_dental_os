-- ============================================================================
-- ai_context_snapshots — period-keyed cache of the aggregated AI context bundle.
--   One row per (organisation_id, period_key). period_key is 'YYYY-MM' for a
--   month or 'YYYY' for a yearly rollup. is_final=true marks a closed period
--   that is never recomputed. snapshot holds the aggregated, sanitized JSON the
--   AI features read instead of re-running ~10 live rollups per call.
-- MULTI-TENANT: organisation_id on every row; repos read/write via serviceClient
-- with an explicit organisation_id filter (project convention — no RLS on app
-- tables; the serviceClient path is the isolation boundary).
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_context_snapshots (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_key      TEXT NOT NULL,
  snapshot        JSONB NOT NULL,
  is_final        BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, period_key)
);

NOTIFY pgrst, 'reload schema';

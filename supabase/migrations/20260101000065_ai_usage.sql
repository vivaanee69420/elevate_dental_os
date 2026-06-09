-- ============================================================================
-- ai_usage / ai_config — per-org AI cost tracking + optional budget override.
--   ai_usage:  one row per AI call (tokens + estimated pence), for the monthly
--              budget check and spend visibility.
--   ai_config: optional per-org override of the monthly token budget + model.
-- MULTI-TENANT: rows carry organisation_id; repos read/write via serviceClient
-- with an explicit organisation_id filter (project convention — same as
-- crm_settings etc.; no RLS on app tables, the serviceClient path is the
-- isolation boundary).
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  day             DATE NOT NULL DEFAULT CURRENT_DATE,
  feature         TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_pence      INTEGER NOT NULL DEFAULT 0,
  call_count      INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_usage_org_day_idx ON ai_usage (organisation_id, day);

CREATE TABLE IF NOT EXISTS ai_config (
  organisation_id      UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  monthly_token_budget INTEGER NOT NULL DEFAULT 2000000,  -- ~£10/mo at a Sonnet blended rate
  model_override       TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ai_decision_lens — cache of the AI-generated "Decision Lens" per surface.
--   One row per (organisation_id, surface, cache_key). cache_key encodes the
--   scope + period window so a practice/month switch caches separately. items
--   holds the generated lens ([{tone,title,body,value}]). Regenerated lazily on
--   a ~6h TTL (the service checks generated_at) or on explicit refresh.
-- MULTI-TENANT: organisation_id on every row; repos read/write via serviceClient
-- with an explicit organisation_id filter (project convention — no RLS on app
-- tables; the serviceClient path is the isolation boundary).
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_decision_lens (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  surface         TEXT NOT NULL,
  cache_key       TEXT NOT NULL,
  items           JSONB NOT NULL DEFAULT '[]',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, surface, cache_key)
);

NOTIFY pgrst, 'reload schema';

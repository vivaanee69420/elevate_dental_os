-- ============================================================================
-- review_sources — per-org dimension of the review locations each provider
-- (Google / Facebook) exposes, with a per-source selection flag. Each row is a
-- single Google Business listing (place_id) or Facebook Page (page id) that the
-- reviews sync pulls from; rows are optionally linked to a practice so the
-- Reviews screen can break down by practice. MULTI-TENANT: every row carries
-- organisation_id; the sync writes via serviceClient with an explicit org filter.
--
--   provider     = 'google' | 'facebook' (matches reviews.source)
--   external_id  = Google place_id | Facebook page id (the per-account key)
--   rating       = provider's CURRENT overall star rating for the location
--   total_count  = provider's TOTAL review count (Google user_ratings_total) —
--                  the true volume, vs the ≤5 individual reviews Places returns.
--
-- "Pull selected, filter on read": deselecting a source stops it syncing and
-- drops it from the Reviews view; its already-synced reviews are kept. Mirrors
-- ad_accounts. Idempotent + additive. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS review_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                  -- 'google' | 'facebook'
  external_id TEXT NOT NULL,               -- Google place_id | Facebook page id
  name TEXT,                               -- business / page display name (label)
  address TEXT,                            -- formatted address (Google), optional
  practice_id UUID REFERENCES practices(id) ON DELETE SET NULL,
  is_selected BOOLEAN NOT NULL DEFAULT TRUE,
  rating NUMERIC,                          -- latest overall rating from provider
  total_count INTEGER,                     -- provider's total review count
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, provider, external_id)
);

CREATE TRIGGER review_sources_updated_at BEFORE UPDATE ON review_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_review_sources_org_provider
  ON review_sources(organisation_id, provider);
CREATE INDEX IF NOT EXISTS idx_review_sources_selected
  ON review_sources(organisation_id, provider) WHERE is_selected;
CREATE INDEX IF NOT EXISTS idx_review_sources_practice
  ON review_sources(organisation_id, practice_id) WHERE practice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- reviews dedup key. The sync upserts on (org, source, external_id) so a
-- re-pull updates the same row instead of duplicating. external_id is the
-- provider review id (Google: "<place_id>:<unix_time>"; Facebook: "<page>:<time>").
-- FULL (not partial) unique index: PostgREST's upsert infers the conflict target
-- by column list and cannot target a partial index (it can't supply the WHERE
-- predicate). Legacy mock/direct rows carry a NULL external_id; under the default
-- NULLS DISTINCT those never collide, so a full index still allows them.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_org_source_external
  ON reviews(organisation_id, source, external_id);

-- Reviews list filters by source / practice / published_at; back the common path.
CREATE INDEX IF NOT EXISTS idx_reviews_org_published
  ON reviews(organisation_id, published_at DESC);

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';

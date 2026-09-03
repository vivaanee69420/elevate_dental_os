-- ============================================================================
-- Ads deep-grain tables — Meta ad set/ad and Google ad group/ad/keyword, at
-- day grain. Campaign grain stays in ad_metrics and is NOT touched here.
--
-- FIVE SEPARATE TABLES, not one table with a `level` column: a read that
-- omitted the level filter would sum every grain into one figure — spend
-- multiplied five times over. Separate tables make that impossible; there is
-- no column to forget.
--
-- The shared core contract is generated from ONE definition in the loop below
-- so the five cannot drift apart. That is what lets a single rollup RPC serve
-- every grain. Per-grain extras are added afterwards.
--
-- MULTI-TENANT: every row carries organisation_id. serviceClient bypasses RLS,
-- so the explicit organisation_id filter IS the isolation (see CLAUDE.md).
-- RLS is enabled with no policy: anon/authenticated get nothing, service_role
-- bypasses. Idempotent + additive. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_meta_adsets','ad_meta_ads','ad_google_adgroups',
                           'ad_google_ads','ad_google_keywords']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS public.%I (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        practice_id     uuid REFERENCES practices(id) ON DELETE SET NULL,
        provider        text NOT NULL,
        customer_id     text NOT NULL,
        campaign_id     text NOT NULL,
        campaign_name   text,
        parent_id       text NOT NULL,
        entity_id       text NOT NULL,
        entity_name     text,
        entity_status   text,
        metric_date     date NOT NULL,
        spend_pence     bigint        NOT NULL DEFAULT 0,
        impressions     bigint        NOT NULL DEFAULT 0,
        clicks          bigint        NOT NULL DEFAULT 0,
        conversions     numeric(14,2) NOT NULL DEFAULT 0,
        created_at      timestamptz DEFAULT now(),
        updated_at      timestamptz DEFAULT now(),
        UNIQUE (organisation_id, provider, customer_id, parent_id, entity_id, metric_date)
      )$f$, t);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id, provider, customer_id, metric_date)',
                   'idx_'||t||'_org_acct_date', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id, campaign_id, metric_date)',
                   'idx_'||t||'_org_camp_date', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t||'_updated_at', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $mig$;

-- Per-grain extras. Meta reports deduplicated reach and frequency at ad set and
-- ad level; Google does not report either at any grain.
ALTER TABLE public.ad_meta_adsets ADD COLUMN IF NOT EXISTS reach     bigint;
ALTER TABLE public.ad_meta_adsets ADD COLUMN IF NOT EXISTS frequency numeric;
ALTER TABLE public.ad_meta_ads    ADD COLUMN IF NOT EXISTS reach     bigint;
ALTER TABLE public.ad_meta_ads    ADD COLUMN IF NOT EXISTS frequency numeric;

-- Keyword extras. Google removed average position in September 2019; impression
-- share and Quality Score are what replaced it as ranking signals.
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS match_type                           text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS quality_score                        integer;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS creative_quality_score               text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS post_click_quality_score             text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_predicted_ctr                 text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_impression_share              numeric;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_top_impression_share          numeric;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_absolute_top_impression_share numeric;

NOTIFY pgrst, 'reload schema';

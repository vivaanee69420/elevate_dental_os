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
    -- The rollups' ACTUAL predicate. Both RPCs filter organisation_id +
    -- metric_date and leave account and campaign as optional NULLs, so the
    -- common read — the whole org over a window, which is what the
    -- reconciliation panel and the deep-grain pages issue — matches neither
    -- index above: both lead with a second column the query does not
    -- constrain. Without this the rollup falls back to a sequential scan over
    -- every grain row the org has.
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id, metric_date)',
                   'idx_'||t||'_org_date', t);
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

-- ---------------------------------------------------------------------------
-- Grain allowlist. p_grain is a LOOKUP KEY, never an interpolated identifier —
-- no caller-supplied string reaches SQL as a table name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ad_grain_table(p_grain text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_grain
    WHEN 'meta_adset'     THEN 'ad_meta_adsets'
    WHEN 'meta_ad'        THEN 'ad_meta_ads'
    WHEN 'google_adgroup' THEN 'ad_google_adgroups'
    WHEN 'google_ad'      THEN 'ad_google_ads'
    WHEN 'google_keyword' THEN 'ad_google_keywords'
    ELSE NULL
  END;
END $$;

CREATE OR REPLACE FUNCTION public._ad_grain_provider(p_grain text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE
    WHEN p_grain LIKE 'meta_%'   THEN 'meta_ads'
    WHEN p_grain LIKE 'google_%' THEN 'google_ads'
    ELSE NULL
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Replace one account-set's rows for a grain. Mirrors ad_metrics_replace_window
-- (migration 000106) rather than inventing a second pattern.
--
-- DELETES EVERYTHING for those accounts, not just the window, then reinserts
-- the window. That is what keeps these tables at exactly the last 92 days
-- instead of growing without bound. Widening the window later needs a re-pull,
-- which is safe: Google keeps full account history and Meta keeps 37 months.
--
-- The column list is read from information_schema so per-grain extras (reach,
-- quality_score, impression share) are carried automatically and cannot fall
-- out of sync with the table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_grain_replace_window(
  p_org          uuid,
  p_grain        text,
  p_customer_ids text[],
  p_rows         jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tbl text; prov text; cols text; upd text; sel text; n integer;
BEGIN
  tbl  := public._ad_grain_table(p_grain);
  prov := public._ad_grain_provider(p_grain);
  IF tbl IS NULL OR prov IS NULL THEN
    RAISE EXCEPTION 'ad_grain_replace_window: unknown grain %', p_grain;
  END IF;

  -- Serialize concurrent replaces for the same (org, grain). Taken BEFORE any
  -- row is touched so a second caller waits on the cheap advisory lock instead
  -- of blocking mid-sequence on row locks held by the first.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_grain, 0));
  SET LOCAL lock_timeout = '15s';
  SET LOCAL statement_timeout = '60s';

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at');

  SELECT string_agg(format('%I = EXCLUDED.%I', column_name, column_name), ', ')
    INTO upd FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at','organisation_id',
                             'provider','customer_id','parent_id','entity_id','metric_date');

  -- A payload row can legitimately omit a metric column (a keyword with no
  -- spend yet, a connector field gap). Restoring the table's own column
  -- default for any such NOT NULL column lets that one row degrade to its
  -- default instead of violating the NOT NULL constraint and aborting the
  -- whole INSERT — which would cost the account its entire grain for the
  -- night over one partial row. Columns that are NOT NULL with NO default
  -- (provider, customer_id, campaign_id, parent_id, entity_id, metric_date)
  -- are deliberately left unwrapped: a row missing one of those SHOULD be
  -- rejected, not defaulted. column_default comes from the system catalogue,
  -- never from a caller, so interpolating it here is safe.
  SELECT string_agg(
           CASE WHEN is_nullable = 'NO' AND column_default IS NOT NULL
                THEN format('COALESCE(%I, %s) AS %I', column_name, column_default, column_name)
                ELSE quote_ident(column_name) END,
           ', ' ORDER BY ordinal_position)
    INTO sel FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at');

  EXECUTE format('DELETE FROM public.%I WHERE organisation_id = $1 AND provider = $2 AND customer_id = ANY($3)', tbl)
    USING p_org, prov, p_customer_ids;

  -- DISTINCT ON guards against an exact duplicate in one payload, which would
  -- otherwise abort the whole INSERT ... ON CONFLICT.
  --
  -- provider is filtered (WHERE provider = $3), not trusted from the payload:
  -- the DELETE above is scoped to the grain's own provider (prov), so a row
  -- whose payload provider disagreed with the grain would land here but could
  -- never be cleaned up by a later replace — a permanent orphan inflating
  -- every rollup forever. provider is also folded into DISTINCT ON/ORDER BY
  -- because it is part of the real conflict key; omitting it would let two
  -- legitimately-distinct rows differing only by provider collide.
  EXECUTE format($q$
    WITH src AS (
      SELECT DISTINCT ON (provider, customer_id, parent_id, entity_id, metric_date) %4$s
        FROM jsonb_populate_recordset(NULL::public.%1$I, $2)
       WHERE metric_date IS NOT NULL AND entity_id IS NOT NULL
         AND parent_id IS NOT NULL AND organisation_id = $1
         AND provider = $3
       ORDER BY provider, customer_id, parent_id, entity_id, metric_date
    )
    INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM src
    ON CONFLICT (organisation_id, provider, customer_id, parent_id, entity_id, metric_date)
    DO UPDATE SET %3$s
  $q$, tbl, cols, upd, sel) USING p_org, p_rows, prov;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- Stamp practice at the write choke point, from the account mapping.
  EXECUTE format($u$
    UPDATE public.%I t SET practice_id = a.practice_id
      FROM public.ad_accounts a
     WHERE a.organisation_id = t.organisation_id
       AND a.provider    = t.provider
       AND a.customer_id = t.customer_id
       AND t.organisation_id = $1
       AND t.practice_id IS DISTINCT FROM a.practice_id
  $u$, tbl) USING p_org;

  RETURN n;
END $$;

-- Backfill practice_id across all five grains after a mapping change, mirroring
-- restamp_ad_metrics_practices (migration 000140).
CREATE OR REPLACE FUNCTION public.ad_grain_restamp_practices(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; n integer := 0; k integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_meta_adsets','ad_meta_ads','ad_google_adgroups',
                           'ad_google_ads','ad_google_keywords']
  LOOP
    EXECUTE format($u$
      UPDATE public.%I t SET practice_id = a.practice_id
        FROM public.ad_accounts a
       WHERE a.organisation_id = t.organisation_id
         AND a.provider    = t.provider
         AND a.customer_id = t.customer_id
         AND t.organisation_id = $1
         AND t.practice_id IS DISTINCT FROM a.practice_id
    $u$, t) USING p_org;
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.ad_grain_replace_window(uuid, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_replace_window(uuid, text, text[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ad_grain_restamp_practices(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_restamp_practices(uuid) TO service_role;

-- These two are internal helpers, but `public` is the PostgREST-exposed schema
-- and a newly created function there is anon-executable by default on this
-- project (verified against the live database). Without this, anyone could
-- call POST /rpc/_ad_grain_table unauthenticated and enumerate our table names.
REVOKE ALL ON FUNCTION public._ad_grain_table(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ad_grain_table(text) TO service_role;
REVOKE ALL ON FUNCTION public._ad_grain_provider(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ad_grain_provider(text) TO service_role;

-- ---------------------------------------------------------------------------
-- The ONLY read path for the deep-grain tables. No repository selects from
-- them directly: PostgREST truncates at 1000 rows without saying so, and one
-- practice-month of keyword rows is well past that.
--
-- plpgsql + RETURN QUERY EXECUTE ... USING is load-bearing. A LANGUAGE sql
-- function with SECURITY DEFINER + SET search_path cannot be inlined, so it is
-- planned with p_org UNKNOWN — measured elsewhere in this codebase at 11.1s
-- against 55ms for the plpgsql form.
--
-- GROUP BY (entity_id, parent_id), not entity_id alone: a Google ad or keyword
-- can live under several ad groups and they are genuinely different rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_grain_rollup(
  p_org      uuid,
  p_grain    text,
  p_since    date,
  p_until    date,
  p_practice uuid DEFAULT NULL,
  p_campaign text DEFAULT NULL,
  p_parent   text DEFAULT NULL
) RETURNS TABLE (
  entity_id text, entity_name text, parent_id text,
  campaign_id text, campaign_name text, entity_status text,
  spend_pence bigint, impressions bigint, clicks bigint, conversions numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tbl text;
BEGIN
  tbl := public._ad_grain_table(p_grain);
  IF tbl IS NULL THEN
    RAISE EXCEPTION 'ad_grain_rollup: unknown grain %', p_grain;
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT g.entity_id,
           max(g.entity_name)   AS entity_name,
           g.parent_id,
           max(g.campaign_id)   AS campaign_id,
           max(g.campaign_name) AS campaign_name,
           max(g.entity_status) AS entity_status,
           sum(g.spend_pence)::bigint  AS spend_pence,
           sum(g.impressions)::bigint  AS impressions,
           sum(g.clicks)::bigint       AS clicks,
           sum(g.conversions)::numeric AS conversions
      FROM public.%I g
     WHERE g.organisation_id = $1
       AND g.metric_date >= $2
       AND g.metric_date <= $3
       AND ($4::uuid IS NULL OR g.practice_id  = $4)
       AND ($5::text IS NULL OR g.campaign_id  = $5)
       AND ($6::text IS NULL OR g.parent_id    = $6)
     GROUP BY g.entity_id, g.parent_id
  $q$, tbl) USING p_org, p_since, p_until, p_practice, p_campaign, p_parent;
END $$;

-- Keyword-specific read. Quality Score and impression share are point-in-time
-- ratios, not sums.
--
-- KNOWN LIMITATION, carried deliberately: impression share is stored per day
-- and aggregated here as an IMPRESSION-WEIGHTED AVERAGE. Google computes its
-- own range figure from eligible impressions, which the API does not expose, so
-- a multi-day impression share may differ slightly from Google's. It is
-- labelled as approximate in the UI. Spend, clicks, impressions and conversions
-- are exact; only these ratios are not.
CREATE OR REPLACE FUNCTION public.ad_keyword_rollup(
  p_org      uuid,
  p_since    date,
  p_until    date,
  p_practice uuid DEFAULT NULL,
  p_campaign text DEFAULT NULL,
  p_parent   text DEFAULT NULL
) RETURNS TABLE (
  entity_id text, entity_name text, parent_id text,
  campaign_id text, campaign_name text, entity_status text,
  spend_pence bigint, impressions bigint, clicks bigint, conversions numeric,
  match_type text, quality_score numeric,
  search_impression_share numeric,
  search_top_impression_share numeric,
  search_absolute_top_impression_share numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT g.entity_id,
           max(g.entity_name)   AS entity_name,
           g.parent_id,
           max(g.campaign_id)   AS campaign_id,
           max(g.campaign_name) AS campaign_name,
           max(g.entity_status) AS entity_status,
           sum(g.spend_pence)::bigint  AS spend_pence,
           sum(g.impressions)::bigint  AS impressions,
           sum(g.clicks)::bigint       AS clicks,
           sum(g.conversions)::numeric AS conversions,
           max(g.match_type)           AS match_type,
           -- Latest non-null Quality Score in the range, not an average: it is
           -- a 1-10 grade Google assigns, and averaging grades is meaningless.
           (array_agg(g.quality_score ORDER BY g.metric_date DESC)
              FILTER (WHERE g.quality_score IS NOT NULL))[1]::numeric AS quality_score,
           -- The denominator is FILTERED to the same days as the numerator.
           -- Google reports no impression share on a day a keyword was not
           -- eligible to compete (Display/Video traffic, a paused day), and
           -- sum() skips those NULLs in the numerator. Dividing by the
           -- UNFILTERED impression total would then weight the average by days
           -- that contributed nothing to it, dragging every figure downward —
           -- a keyword with a true 80% share on its one eligible day out of
           -- four would read far lower, and the owner would tune bids against
           -- an invented number.
           CASE WHEN sum(g.impressions) FILTER (WHERE g.search_impression_share IS NOT NULL) > 0
                THEN sum(g.search_impression_share * g.impressions)
                     / sum(g.impressions) FILTER (WHERE g.search_impression_share IS NOT NULL)
                END AS search_impression_share,
           CASE WHEN sum(g.impressions) FILTER (WHERE g.search_top_impression_share IS NOT NULL) > 0
                THEN sum(g.search_top_impression_share * g.impressions)
                     / sum(g.impressions) FILTER (WHERE g.search_top_impression_share IS NOT NULL)
                END AS search_top_impression_share,
           CASE WHEN sum(g.impressions) FILTER (WHERE g.search_absolute_top_impression_share IS NOT NULL) > 0
                THEN sum(g.search_absolute_top_impression_share * g.impressions)
                     / sum(g.impressions) FILTER (WHERE g.search_absolute_top_impression_share IS NOT NULL)
                END AS search_absolute_top_impression_share
      FROM public.ad_google_keywords g
     WHERE g.organisation_id = $1
       AND g.metric_date >= $2
       AND g.metric_date <= $3
       AND ($4::uuid IS NULL OR g.practice_id = $4)
       AND ($5::text IS NULL OR g.campaign_id = $5)
       AND ($6::text IS NULL OR g.parent_id   = $6)
     GROUP BY g.entity_id, g.parent_id
  $q$ USING p_org, p_since, p_until, p_practice, p_campaign, p_parent;
END $$;

REVOKE ALL ON FUNCTION public.ad_grain_rollup(uuid, text, date, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_rollup(uuid, text, date, date, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ad_keyword_rollup(uuid, date, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_keyword_rollup(uuid, date, date, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

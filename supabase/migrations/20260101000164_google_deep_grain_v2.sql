-- ============================================================================
-- Google deep grain, second pass — the fields the first pass left on the table.
--
-- WHAT THIS ADDS AND WHY EACH ONE EARNS ITS COLUMN
--
--   Impression share (search / top / absolute top) plus the two LOST shares
--   (budget, rank). 000148 pulled these at KEYWORD grain only. They are the
--   most actionable numbers Google publishes and they belong at campaign and
--   ad-group grain far more than at keyword grain, because that is where the
--   lever is: "you were eligible for 3x the traffic you got, and you missed it
--   because the budget ran out" is a different instruction from "…because your
--   bid was too low", and only budget-lost vs rank-lost separates the two.
--
--   Conversion VALUE. 000148 stores a conversion COUNT and nothing else, so a
--   campaign producing ten £40 enquiries and one producing ten £4,000 implant
--   consultations are indistinguishable in every view we have.
--
--   Ad creative. Measured before writing this: 0 of 186 ads in this org's
--   deep tables have a name. ad_group_ad.ad.name is an optional internal
--   label almost no advertiser sets, so the Ads tab currently renders a bare
--   numeric id on every single row — a table nobody can read. The first
--   responsive-search headline is what a human calls that ad, so that is what
--   is stored and shown.
--
--   Search terms — a whole new grain. This is what people actually typed, as
--   opposed to what we bid on. It is the one report that says where money is
--   leaking (a dental group paying for "dental nurse jobs" finds out here and
--   nowhere else), and it cannot be derived from anything already stored.
--
-- ============================================================================
-- WHY EVERY GOOGLE GRAIN TABLE GETS THE SAME COLUMN SET
--
-- Google reports different things at different grains: impression share has
-- no meaning on an individual ad, quality score exists only on a keyword, a
-- search term has no creative. The tempting shape is a bespoke column set per
-- table and a bespoke rollup function per grain.
--
-- That was rejected. ad_grain_rollup builds its query with format() against a
-- table name resolved at runtime, so a column referenced in the query text
-- must exist on EVERY table that query can be pointed at — otherwise the
-- shared reader has to fork per grain, and four near-identical 60-line SQL
-- functions drift apart the first time one of them is edited. 000148's own
-- header makes the same argument for the core contract ("generated from ONE
-- definition so the five cannot drift apart"); this extends it.
--
-- So the Google tables share the full superset, and a column Google does not
-- report at that grain simply stays NULL. Nulls are free in Postgres, and the
-- NULL is itself honest: it says "not reported here", which is exactly right,
-- where a 0 would say "measured, and it was zero".
--
-- ad_meta_adsets / ad_meta_ads are NOT touched. They keep ad_grain_rollup;
-- Google reads move to ad_google_rollup below.
--
-- Idempotent and additive: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
-- After applying on hosted:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The new grain's table, built from the same core contract as the other
--    five so ad_grain_delete_window / ad_grain_upsert_chunk serve it unchanged.
--
--    entity_id IS THE SEARCH TERM TEXT. Google gives a search term no id — it
--    is not an entity in the account, it is a string a stranger typed — so the
--    text is the identity, and (parent_id = ad group, entity_id = the term)
--    is exactly the unique key the shared writer already conflicts on. That is
--    not a hack around the contract; a search term genuinely is identified by
--    its text within an ad group.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_google_search_terms (
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
);

CREATE INDEX IF NOT EXISTS idx_ad_google_search_terms_org_acct_date
  ON public.ad_google_search_terms (organisation_id, provider, customer_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_ad_google_search_terms_org_camp_date
  ON public.ad_google_search_terms (organisation_id, campaign_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_ad_google_search_terms_org_date
  ON public.ad_google_search_terms (organisation_id, metric_date);

DROP TRIGGER IF EXISTS ad_google_search_terms_updated_at ON public.ad_google_search_terms;
CREATE TRIGGER ad_google_search_terms_updated_at
  BEFORE UPDATE ON public.ad_google_search_terms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ad_google_search_terms ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. The shared Google superset, applied to all four Google grain tables.
--    ad_google_keywords already carries some of these from 000148; ADD COLUMN
--    IF NOT EXISTS makes re-declaring them a no-op rather than a conflict.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_google_adgroups','ad_google_ads',
                           'ad_google_keywords','ad_google_search_terms']
  LOOP
    -- Value, not just count. Stored as integer pence like every other money
    -- column in this schema (rule 2); Google reports it as a float in account
    -- currency, so the connector multiplies by 100 and rounds.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS conversions_value_pence bigint', t);
    -- Google counts a conversion once per conversion ACTION and once per
    -- action-with-"include in Conversions"-off under all_conversions. Phone
    -- calls from call extensions land in all_conversions only, which for a
    -- dental practice is most of the point.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS all_conversions numeric(14,2)', t);

    -- The five impression-share ratios, all 0..1. Google caps the reported
    -- value at 0.9 for very high shares, so treat them as indicative.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS search_impression_share numeric', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS search_top_impression_share numeric', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS search_absolute_top_impression_share numeric', t);
    -- The two that say WHY the share was missed. Together with the share
    -- itself these three sum to approximately 1.
    --
    -- search_budget_lost_impression_share is STRUCTURALLY NULL on every one of
    -- these tables and always will be: Google reports it at CAMPAIGN grain
    -- only (a budget is a campaign-level object, so "share lost to budget" is
    -- a campaign fact an ad group merely inherits), and asking any other
    -- resource for it fails the whole GAQL query. Measured against the live
    -- API — see the support table in google-ads-deep-sync.js. The column stays
    -- for the uniform-superset reason in this file's header; its nullness here
    -- is the honest answer, not a gap waiting to be filled.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS search_budget_lost_impression_share numeric', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS search_rank_lost_impression_share numeric', t);

    -- Keyword-shaped extras. match_type is meaningful on a search term too:
    -- it is the match type of the keyword that CAUGHT that term.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS match_type text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS quality_score integer', t);

    -- Search-term extras. keyword_text is which keyword matched the term —
    -- the join that makes a search term actionable ("this keyword is pulling
    -- in this rubbish"). search_term_status is Google's ADDED / EXCLUDED /
    -- NONE, i.e. whether someone has already acted on it.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS keyword_text text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS search_term_status text', t);

    -- Creative. headlines/descriptions are jsonb ARRAYS of plain strings —
    -- Google returns objects carrying a pinned-field marker we do not use, so
    -- the connector flattens to text before storing. final_url is the FIRST
    -- of Google's final_urls: an ad may declare several, and a landing page
    -- column showing one of them labelled as "the" URL would be a lie, so the
    -- first is stored and the column is named for what it is.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ad_type text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ad_strength text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS approval_status text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS final_url text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS headlines jsonb', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS descriptions jsonb', t);
  END LOOP;
END $mig$;

-- ---------------------------------------------------------------------------
-- 3. Campaign grain lives in ad_metrics, which is SHARED WITH META. The five
--    shares and the two value columns are Google-only and stay NULL on every
--    Meta row — the same arrangement reach/frequency already have in the other
--    direction (Meta-only, NULL on Google).
-- ---------------------------------------------------------------------------
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS conversions_value_pence              bigint;
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS all_conversions                      numeric(14,2);
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS phone_calls                          bigint;
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS search_impression_share              numeric;
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS search_top_impression_share          numeric;
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS search_absolute_top_impression_share numeric;
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS search_budget_lost_impression_share  numeric;
ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS search_rank_lost_impression_share    numeric;

-- ---------------------------------------------------------------------------
-- 4. Register the new grain. _ad_grain_provider needs no change: it keys off
--    the 'google_' prefix, which 'google_search_term' already has.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ad_grain_table(p_grain text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_grain
    WHEN 'meta_adset'         THEN 'ad_meta_adsets'
    WHEN 'meta_ad'            THEN 'ad_meta_ads'
    WHEN 'google_adgroup'     THEN 'ad_google_adgroups'
    WHEN 'google_ad'          THEN 'ad_google_ads'
    WHEN 'google_keyword'     THEN 'ad_google_keywords'
    WHEN 'google_search_term' THEN 'ad_google_search_terms'
    ELSE NULL
  END;
END $$;

-- Practice restamping must cover the new table too, or every practice-filtered
-- search-term read returns nothing while the other tabs work — the exact
-- failure 000160's header records from when this step lost its caller.
CREATE OR REPLACE FUNCTION public.ad_grain_restamp_practices(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; n integer := 0; k integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_meta_adsets','ad_meta_ads','ad_google_adgroups',
                           'ad_google_ads','ad_google_keywords','ad_google_search_terms']
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

-- ---------------------------------------------------------------------------
-- 5. ad_metrics_replace_window — the campaign-grain writer, shared with Meta.
--
--    Its column list is EXPLICIT (unlike the deep-grain writer, which reads
--    information_schema), so new columns are invisible to it until they are
--    added here by hand. Rewritten in full rather than patched so the three
--    lists — recordset, INSERT, DO UPDATE — cannot fall out of step.
--
--    Meta's connector sends none of the new keys, so jsonb_to_recordset yields
--    NULL for them and Meta rows are written exactly as before. Verified by
--    the meta-ads sync tests, which assert the written row shape.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_metrics_replace_window(
  p_org uuid, p_provider text, p_customer_ids text[], p_since date, p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_provider, 0));
  SET LOCAL lock_timeout = '15s';
  SET LOCAL statement_timeout = '60s';

  DELETE FROM ad_metrics
   WHERE organisation_id = p_org
     AND provider        = p_provider
     AND customer_id     = ANY (p_customer_ids)
     AND metric_date    >= p_since;

  WITH src AS (
    SELECT DISTINCT ON (x.customer_id, x.campaign_id, x.metric_date) x.*
    FROM jsonb_to_recordset(p_rows) AS x(
      practice_id     uuid,
      source          text,
      customer_id     text,
      campaign_id     text,
      campaign_name   text,
      metric_date     date,
      spend_pence     bigint,
      impressions     bigint,
      clicks          bigint,
      leads           integer,
      conversions     numeric(14,2),
      reach           bigint,
      frequency       numeric,
      campaign_status text,
      objective       text,
      conversions_value_pence              bigint,
      all_conversions                      numeric(14,2),
      phone_calls                          bigint,
      search_impression_share              numeric,
      search_top_impression_share          numeric,
      search_absolute_top_impression_share numeric,
      search_budget_lost_impression_share  numeric,
      search_rank_lost_impression_share    numeric
    )
    WHERE x.metric_date IS NOT NULL
    ORDER BY x.customer_id, x.campaign_id, x.metric_date
  )
  INSERT INTO ad_metrics (
    organisation_id, practice_id, provider, source, customer_id,
    campaign_id, campaign_name, metric_date,
    spend_pence, impressions, clicks, leads, conversions,
    reach, frequency, campaign_status, objective,
    conversions_value_pence, all_conversions, phone_calls,
    search_impression_share, search_top_impression_share,
    search_absolute_top_impression_share,
    search_budget_lost_impression_share, search_rank_lost_impression_share
  )
  SELECT
    p_org,
    COALESCE(src.practice_id, aa.practice_id),
    p_provider,
    COALESCE(src.source, p_provider),
    src.customer_id,
    src.campaign_id,
    src.campaign_name,
    src.metric_date,
    COALESCE(src.spend_pence, 0),
    COALESCE(src.impressions, 0),
    COALESCE(src.clicks, 0),
    COALESCE(src.leads, 0),
    COALESCE(src.conversions, 0),
    src.reach,
    src.frequency,
    src.campaign_status,
    src.objective,
    -- NOT coalesced to 0. A campaign Google reports no conversion value for is
    -- not a campaign worth £0.00 — it is one we cannot price, and the reader
    -- must be able to tell those apart. Same rule perUnitPence follows in the
    -- service layer: unknown is null, never zero.
    src.conversions_value_pence,
    src.all_conversions,
    src.phone_calls,
    src.search_impression_share,
    src.search_top_impression_share,
    src.search_absolute_top_impression_share,
    src.search_budget_lost_impression_share,
    src.search_rank_lost_impression_share
  FROM src
  LEFT JOIN ad_accounts aa
         ON aa.organisation_id = p_org
        AND aa.provider        = p_provider
        AND aa.customer_id     = src.customer_id
  ON CONFLICT (organisation_id, provider, customer_id, campaign_id, metric_date)
  DO UPDATE SET
    practice_id     = EXCLUDED.practice_id,
    source          = EXCLUDED.source,
    campaign_name   = EXCLUDED.campaign_name,
    spend_pence     = EXCLUDED.spend_pence,
    impressions     = EXCLUDED.impressions,
    clicks          = EXCLUDED.clicks,
    leads           = EXCLUDED.leads,
    conversions     = EXCLUDED.conversions,
    reach           = EXCLUDED.reach,
    frequency       = EXCLUDED.frequency,
    campaign_status = EXCLUDED.campaign_status,
    objective       = EXCLUDED.objective,
    conversions_value_pence              = EXCLUDED.conversions_value_pence,
    all_conversions                      = EXCLUDED.all_conversions,
    phone_calls                          = EXCLUDED.phone_calls,
    search_impression_share              = EXCLUDED.search_impression_share,
    search_top_impression_share          = EXCLUDED.search_top_impression_share,
    search_absolute_top_impression_share = EXCLUDED.search_absolute_top_impression_share,
    search_budget_lost_impression_share  = EXCLUDED.search_budget_lost_impression_share,
    search_rank_lost_impression_share    = EXCLUDED.search_rank_lost_impression_share,
    updated_at      = NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. ad_google_rollup — ONE read for all four Google grains.
--
--    Supersedes ad_keyword_rollup (kept in place, unchanged, so nothing that
--    still calls it breaks) and replaces ad_grain_rollup for Google grains.
--    ad_grain_rollup itself is untouched and still serves Meta.
--
--    THE AGGREGATION RULES, and why they differ per column:
--
--      spend / impressions / clicks / conversions / value  -> SUM. Additive.
--      quality score                                       -> LATEST non-null.
--          A 1-10 grade Google assigns. Averaging grades is meaningless, and
--          today's grade is what you would act on.
--      impression share (all five)                         -> IMPRESSION-
--          WEIGHTED MEAN, with the denominator FILTERED to the days that
--          actually reported a share. 000148 established this and the reason
--          is worth restating: Google reports no share on a day the entity was
--          not eligible to compete, sum() skips those NULLs in the numerator,
--          and dividing by the UNFILTERED impression total would weight the
--          mean by days that contributed nothing — dragging every figure down
--          and inviting the owner to raise bids against an invented number.
--      names / status / creative / match type              -> MAX, i.e. any.
--          These do not vary across the days of one entity; MAX is just a
--          legal aggregate for a column not in the GROUP BY.
--
--    KNOWN AND ACCEPTED: a multi-day impression share computed this way can
--    differ slightly from the figure Google shows for the same range, because
--    Google divides by ELIGIBLE impressions, which the API does not expose.
--    Everything else here is exact. The UI labels the shares approximate.
--
--    GROUP BY (entity_id, parent_id), never entity_id alone — a Google ad or
--    keyword can sit under more than one ad group and those are genuinely
--    different rows. It is also why the reader pages on both columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_google_rollup(
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
  spend_pence bigint, impressions bigint, clicks bigint, conversions numeric,
  conversions_value_pence bigint, all_conversions numeric,
  search_impression_share numeric,
  search_top_impression_share numeric,
  search_absolute_top_impression_share numeric,
  search_budget_lost_impression_share numeric,
  search_rank_lost_impression_share numeric,
  match_type text, quality_score numeric,
  keyword_text text, search_term_status text,
  ad_type text, ad_strength text, approval_status text,
  final_url text, headlines jsonb, descriptions jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tbl text;
BEGIN
  tbl := public._ad_grain_table(p_grain);
  IF tbl IS NULL OR tbl NOT LIKE 'ad_google_%' THEN
    RAISE EXCEPTION 'ad_google_rollup: not a Google grain: %', p_grain;
  END IF;

  -- plpgsql + RETURN QUERY EXECUTE ... USING is load-bearing, not stylistic.
  -- A LANGUAGE sql function with SECURITY DEFINER + SET search_path cannot be
  -- inlined, so it is planned with p_org UNKNOWN — measured elsewhere in this
  -- codebase at 11.1s against 55ms for this form.
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
           sum(g.conversions)::numeric AS conversions,
           sum(g.conversions_value_pence)::bigint AS conversions_value_pence,
           sum(g.all_conversions)::numeric        AS all_conversions,
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
                END AS search_absolute_top_impression_share,
           CASE WHEN sum(g.impressions) FILTER (WHERE g.search_budget_lost_impression_share IS NOT NULL) > 0
                THEN sum(g.search_budget_lost_impression_share * g.impressions)
                     / sum(g.impressions) FILTER (WHERE g.search_budget_lost_impression_share IS NOT NULL)
                END AS search_budget_lost_impression_share,
           CASE WHEN sum(g.impressions) FILTER (WHERE g.search_rank_lost_impression_share IS NOT NULL) > 0
                THEN sum(g.search_rank_lost_impression_share * g.impressions)
                     / sum(g.impressions) FILTER (WHERE g.search_rank_lost_impression_share IS NOT NULL)
                END AS search_rank_lost_impression_share,
           max(g.match_type) AS match_type,
           (array_agg(g.quality_score ORDER BY g.metric_date DESC)
              FILTER (WHERE g.quality_score IS NOT NULL))[1]::numeric AS quality_score,
           max(g.keyword_text)        AS keyword_text,
           max(g.search_term_status)  AS search_term_status,
           max(g.ad_type)             AS ad_type,
           max(g.ad_strength)         AS ad_strength,
           max(g.approval_status)     AS approval_status,
           max(g.final_url)           AS final_url,
           -- jsonb has no max(); pick any non-null. These do not vary across
           -- the days of one ad, and when an ad IS edited mid-window the
           -- latest text is the one worth showing.
           (array_agg(g.headlines ORDER BY g.metric_date DESC)
              FILTER (WHERE g.headlines IS NOT NULL))[1]     AS headlines,
           (array_agg(g.descriptions ORDER BY g.metric_date DESC)
              FILTER (WHERE g.descriptions IS NOT NULL))[1]  AS descriptions
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

REVOKE ALL ON FUNCTION public.ad_google_rollup(uuid, text, date, date, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_google_rollup(uuid, text, date, date, uuid, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. ad_google_campaign_rollup — campaign grain, from ad_metrics, with the new
--    columns. The existing campaignSpendByProvider read is a plain PostgREST
--    select and cannot aggregate the weighted shares, so campaign grain gets
--    the same treatment as the deep grains: aggregate in SQL, read once.
--
--    PostgREST's silent 1000-row cap applies to this exactly as to everything
--    else, so the caller pages it. A campaign count over 1000 is unlikely but
--    "unlikely" is how the keyword truncation shipped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_google_campaign_rollup(
  p_org      uuid,
  p_since    date,
  p_until    date,
  p_practice uuid DEFAULT NULL
) RETURNS TABLE (
  entity_id text, entity_name text, entity_status text, objective text,
  spend_pence bigint, impressions bigint, clicks bigint, conversions numeric,
  conversions_value_pence bigint, all_conversions numeric, phone_calls bigint,
  search_impression_share numeric,
  search_top_impression_share numeric,
  search_absolute_top_impression_share numeric,
  search_budget_lost_impression_share numeric,
  search_rank_lost_impression_share numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT m.campaign_id AS entity_id,
           max(m.campaign_name)   AS entity_name,
           max(m.campaign_status) AS entity_status,
           max(m.objective)       AS objective,
           sum(m.spend_pence)::bigint  AS spend_pence,
           sum(m.impressions)::bigint  AS impressions,
           sum(m.clicks)::bigint       AS clicks,
           sum(m.conversions)::numeric AS conversions,
           sum(m.conversions_value_pence)::bigint AS conversions_value_pence,
           sum(m.all_conversions)::numeric        AS all_conversions,
           sum(m.phone_calls)::bigint             AS phone_calls,
           CASE WHEN sum(m.impressions) FILTER (WHERE m.search_impression_share IS NOT NULL) > 0
                THEN sum(m.search_impression_share * m.impressions)
                     / sum(m.impressions) FILTER (WHERE m.search_impression_share IS NOT NULL)
                END,
           CASE WHEN sum(m.impressions) FILTER (WHERE m.search_top_impression_share IS NOT NULL) > 0
                THEN sum(m.search_top_impression_share * m.impressions)
                     / sum(m.impressions) FILTER (WHERE m.search_top_impression_share IS NOT NULL)
                END,
           CASE WHEN sum(m.impressions) FILTER (WHERE m.search_absolute_top_impression_share IS NOT NULL) > 0
                THEN sum(m.search_absolute_top_impression_share * m.impressions)
                     / sum(m.impressions) FILTER (WHERE m.search_absolute_top_impression_share IS NOT NULL)
                END,
           CASE WHEN sum(m.impressions) FILTER (WHERE m.search_budget_lost_impression_share IS NOT NULL) > 0
                THEN sum(m.search_budget_lost_impression_share * m.impressions)
                     / sum(m.impressions) FILTER (WHERE m.search_budget_lost_impression_share IS NOT NULL)
                END,
           CASE WHEN sum(m.impressions) FILTER (WHERE m.search_rank_lost_impression_share IS NOT NULL) > 0
                THEN sum(m.search_rank_lost_impression_share * m.impressions)
                     / sum(m.impressions) FILTER (WHERE m.search_rank_lost_impression_share IS NOT NULL)
                END
      FROM ad_metrics m
     WHERE m.organisation_id = $1
       AND m.provider = 'google_ads'
       AND m.metric_date >= $2
       AND m.metric_date <= $3
       AND ($4::uuid IS NULL OR m.practice_id = $4)
     GROUP BY m.campaign_id
  $q$ USING p_org, p_since, p_until, p_practice;
END $$;

REVOKE ALL ON FUNCTION public.ad_google_campaign_rollup(uuid, date, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_google_campaign_rollup(uuid, date, date, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

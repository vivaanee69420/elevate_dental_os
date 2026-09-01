-- ============================================================================
-- ad_metrics.practice_id — stamp it, instead of leaving it permanently NULL.
--
-- THE BUG: every ad_metrics row in the database had practice_id = NULL (20,201
-- rows, 2 orgs, both providers), because both ad connectors pass a literal null
-- and nothing ever filled it in. Any screen that scoped ad spend by practice
-- therefore filtered on a column that is null everywhere and got ZERO. On the
-- Marketing overview, picking "Barnet" showed Ad spend £0.00 beside 315 leads —
-- while that practice's mapped Meta account had £4,612.79 of spend that month.
-- Cost per lead and cost per patient both collapsed to "—". Only "All
-- practices" ever produced a real number.
--
-- The mapping was never missing: ad_accounts.practice_id (migration 000069) has
-- been correctly maintained by the Integrations mapping UI all along. It simply
-- was not carried onto the rows that the read paths filter.
--
-- WHY STAMP RATHER THAN JOIN AT READ TIME: parts of the codebase had already
-- worked around this by resolving practice -> ad_accounts -> customer_ids and
-- filtering on customer_id (/marketing/roi does exactly that). That works, but
-- it must be remembered at EVERY call site forever, and three of them had
-- already forgotten — marketing.repository (returned £0), analytics.repository
-- (returned £0), and /marketing/ad-spend (silently ignored the practice filter
-- and showed org-wide spend instead). Stamping the column fixes every present
-- and future read path at once, and matches the restamp idiom this codebase
-- already uses for exactly this shape of denormalised mapping
-- (restamp_sheet_lead_practices, restamp_treatment_item_practices,
-- restamp_treatment_plan_practices, Emergent's restampPractice).
--
-- Three parts:
--   1. ad_metrics_replace_window resolves practice_id itself, so no connector
--      can forget it again — including connectors not yet written.
--   2. restamp_ad_metrics_practices(p_org) re-stamps a whole org, for when an
--      owner changes which practice an ad account belongs to.
--   3. a one-off backfill of every existing row, for every org.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The write choke point.
--
-- Both connectors build their row payload with practice_id: null. Rather than
-- fix each connector and rely on the next one remembering, the RPC that every
-- ad write already goes through resolves the practice itself from ad_accounts.
-- COALESCE keeps an explicitly supplied practice_id winning, so a caller that
-- does know better is not overridden.
--
-- The join is LEFT: a metrics row for an account with no ad_accounts row, or an
-- account deliberately left unmapped, keeps practice_id NULL. Unmapped spend is
-- org-wide spend that belongs to no practice, and must stay excluded from a
-- practice filter rather than being guessed at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_metrics_replace_window(
  p_org          uuid,
  p_provider     text,
  p_customer_ids text[],
  p_since        date,
  p_rows         jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  -- Serialize concurrent replaces for the same (org, provider). Acquired BEFORE
  -- any row is touched, so a second caller waits here (cheap) rather than
  -- blocking mid-sequence on ad_metrics row locks held by the first.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_provider, 0));

  -- The whole replace is one statement-call from PostgREST's view, so it is
  -- bounded by the authenticator role's 8s statement_timeout. A large 6-month
  -- backfill (delete + a few thousand inserts) plus any advisory wait can brush
  -- that ceiling — give the atomic operation explicit headroom for its txn.
  SET LOCAL lock_timeout = '15s';
  SET LOCAL statement_timeout = '60s';

  DELETE FROM ad_metrics
   WHERE organisation_id = p_org
     AND provider        = p_provider
     AND customer_id     = ANY (p_customer_ids)
     AND metric_date    >= p_since;

  WITH src AS (
    -- DISTINCT ON guards against an exact-duplicate (customer, campaign, day)
    -- in the payload, which would otherwise make a single INSERT ... ON CONFLICT
    -- "affect row a second time". Dupes carry identical aggregates.
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
      conversions     integer,
      reach           bigint,
      frequency       numeric,
      campaign_status text,
      objective       text
    )
    WHERE x.metric_date IS NOT NULL
    ORDER BY x.customer_id, x.campaign_id, x.metric_date
  )
  INSERT INTO ad_metrics (
    organisation_id, practice_id, provider, source, customer_id,
    campaign_id, campaign_name, metric_date,
    spend_pence, impressions, clicks, leads, conversions,
    reach, frequency, campaign_status, objective
  )
  SELECT
    p_org,
    -- The fix: fall back to the account's mapped practice. Org-scoped on both
    -- sides of the join, so one tenant's mapping can never stamp another's row.
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
    src.objective
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
    updated_at      = NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.ad_metrics_replace_window(uuid, text, text[], date, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_metrics_replace_window(uuid, text, text[], date, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Restamp on a mapping change.
--
-- Moving an ad account from one practice to another must not wait for the
-- nightly sync to re-cut the window — the owner changes the mapping and expects
-- the Marketing screens to agree immediately. Same instant-backfill contract as
-- Emergent's restampPractice.
--
-- plpgsql + EXECUTE ... USING is deliberate: a LANGUAGE sql function that is
-- SECURITY DEFINER with a SET clause cannot be inlined, so it is planned
-- GENERICALLY with p_org unknown and will not choose the org index. That trap
-- cost 11.1s vs 55ms on ad_lead_conversions (000139). Do not "simplify" this.
--
-- Only rows whose (provider, customer_id) matches one of the org's ad_accounts
-- are touched — an INNER join — so a manually entered spend row carrying its
-- own practice_id is never clobbered.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restamp_ad_metrics_practices(p_org uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  EXECUTE $q$
    UPDATE ad_metrics m
       SET practice_id = aa.practice_id
      FROM ad_accounts aa
     WHERE m.organisation_id  = $1
       AND aa.organisation_id = $1
       AND aa.provider        = m.provider
       AND aa.customer_id     = m.customer_id
       AND m.practice_id IS DISTINCT FROM aa.practice_id
  $q$ USING p_org;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.restamp_ad_metrics_practices(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restamp_ad_metrics_practices(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill every existing row, for every organisation.
--
-- Runs per-org so each statement stays small, and so a future tenant added
-- after this migration is covered by the write path above rather than needing
-- another backfill.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  org_id uuid;
  total  integer := 0;
  n      integer;
BEGIN
  FOR org_id IN SELECT DISTINCT organisation_id FROM ad_metrics LOOP
    SELECT public.restamp_ad_metrics_practices(org_id) INTO n;
    total := total + COALESCE(n, 0);
  END LOOP;
  RAISE NOTICE 'ad_metrics practice backfill: % rows stamped', total;
END;
$$;

-- ---------------------------------------------------------------------------
-- The index the practice-scoped reads want. Partial: unmapped rows are never
-- the target of a practice filter, so they do not belong in the index.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ad_metrics_org_practice_date
  ON ad_metrics (organisation_id, practice_id, metric_date)
  WHERE practice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

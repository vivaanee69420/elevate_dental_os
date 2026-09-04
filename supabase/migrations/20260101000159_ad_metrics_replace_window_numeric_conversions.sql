-- ============================================================================
-- ad_metrics_replace_window — parse conversions as NUMERIC, not INTEGER.
--
-- THE BUG: 000157 widened ad_metrics.conversions from INTEGER to
-- numeric(14,2) and google-ads-sync.js stopped rounding, but the WRITE PATH
-- was left behind. Every campaign-grain row reaches the table through this
-- function, and its jsonb_to_recordset column list still declared
--
--     conversions integer
--
-- so the widening was only half-applied: the column would accept a fraction
-- that the only function able to write to it could not parse.
--
-- This is not a truncation. jsonb_to_recordset does not round "0.333334" down
-- to 0 — it raises
--
--     invalid input syntax for type integer: "0.333334"
--
-- and the whole transaction aborts. The sync then reports the failure as an
-- upsert error, marks the integration failed, and stores NOTHING for that
-- night: not the fractional conversions, not the spend, not the clicks.
-- Google's modelled conversions are fractional by design, so this was a
-- guaranteed break waiting on the first fraction in the window — which is
-- exactly how it surfaced, on a live 3-month pull for Ashford and Barnet.
--
-- Meta is on the same path and already sends fractional conversions
-- (meta-ads-sync.js's conversionsFromActions is documented "FRACTIONAL, never
-- rounded"), so this fixes both providers, not only Google.
--
-- The body below is byte-for-byte the deployed function with ONE token
-- changed: `conversions integer` -> `conversions numeric(14,2)` in the
-- jsonb_to_recordset column list. Nothing else about the delete-window,
-- advisory lock, dedup, practice backfill or conflict handling moves.
--
-- Idempotent: CREATE OR REPLACE, safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_metrics_replace_window(
  p_org uuid, p_provider text, p_customer_ids text[], p_since date, p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
      -- The one changed line. Google and Meta both report modelled
      -- conversions as fractions; integer here aborts the whole write.
      conversions     numeric(14,2),
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
$function$;

-- Never callable by a browser JWT: every caller is the service-role worker.
REVOKE ALL ON FUNCTION public.ad_metrics_replace_window(uuid, text, text[], date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_metrics_replace_window(uuid, text, text[], date, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

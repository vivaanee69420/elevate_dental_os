-- ============================================================================
-- ad_metrics_replace_window — atomic, serialized "replace this window" for the
-- ad connectors (meta_ads / google_ads).
--
-- WHY: the connectors used to DELETE the window then chunk-UPSERT the new rows
-- as separate PostgREST statements (separate autocommit transactions). When two
-- syncs for the SAME (org, provider) overlapped — e.g. the fire-and-forget
-- post-connect 6-month backfill racing the nightly incremental cron — one
-- transaction's DELETE held row locks that the other's UPSERT waited on. The
-- blocked upsert sat until the authenticator role's 8s statement_timeout fired:
-- "ad_metrics upsert: canceling statement due to statement timeout". (Each
-- statement in isolation runs in ~1.3s on a few-thousand-row table; the 8s was
-- pure lock-wait, not work.)
--
-- FIX: collapse delete + upsert into ONE transaction guarded by a per-(org,
-- provider) transaction advisory lock. Concurrent replaces now queue on the
-- cheap advisory lock BEFORE touching any row, so they serialize cleanly
-- instead of deadlocking on ad_metrics row locks. A local statement/lock
-- timeout bump gives the atomic replace room to finish on a large backfill.
--
-- Rows are passed as a JSONB array of ad_metrics-shaped objects (the exact
-- objects the connectors already build). Money stays INTEGER PENCE (rule 2).
-- Idempotent: re-applies cleanly. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

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
    src.practice_id,
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

-- serviceClient (service_role) is the only caller (webhooks/workers path).
GRANT EXECUTE ON FUNCTION public.ad_metrics_replace_window(uuid, text, text[], date, jsonb) TO service_role;

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';

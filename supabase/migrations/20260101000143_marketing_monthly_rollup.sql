-- ============================================================================
-- marketing_monthly_rollup — spend, leads and patients per MONTH per CHANNEL.
--
-- WHY A DEDICATED RPC: the Channels-over-time screen needs a year, and
-- ad_lead_conversions returns one row per person. A 12-month window is 10,429
-- rows and 2.8s per call — and the repository must PAGE it (PostgREST caps a
-- set-returning function at 1000 rows), so eleven calls at 2.8s each. Roughly
-- half a minute to draw a chart with 36 points on it.
--
-- Aggregating in SQL returns at most months x 3 channels. The row-level
-- function stays the right tool for a single month, where its detail is used.
--
-- CHANNEL RESOLUTION MATCHES THE SERVICE, and must keep matching it:
--   1. a campaign id we hold spend for names its own provider  (definitive)
--   2. attribution_source 'Paid Search' -> google_ads
--      (gclid and Paid Search are perfectly coincident in the data)
--   3. attribution_source 'Paid Social' -> meta_ads
--   4. everything else -> other  (organic, referral, direct, untracked)
-- Organic social is NOT folded into paid social: it cost nothing, and putting
-- it in the paid denominator would flatter cost per lead.
--
-- Months are bucketed in EUROPE/LONDON, not UTC. date_trunc on a timestamptz
-- uses the session TimeZone, which for the API role is UTC — so a lead created
-- at 00:30 on 1 August BST would fall into July. AT TIME ZONE pins it.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS marketing_monthly_rollup(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION marketing_monthly_rollup(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  month date, channel text,
  leads bigint, patients bigint, new_patients bigint, spend_pence bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE ... USING, for the same reason as ad_lead_conversions:
  -- SECURITY DEFINER + SET search_path block inlining, so a LANGUAGE sql body
  -- would be planned generically with p_org unknown and never probe the org
  -- indexes. Do NOT "simplify" this.
  RETURN QUERY EXECUTE $q$
    WITH campaign_provider AS (
      -- The definitive arm: campaigns we actually hold spend for.
      SELECT DISTINCT campaign_id, provider
      FROM ad_metrics
      WHERE organisation_id = $1 AND campaign_id IS NOT NULL
    ),
    -- ONE ROW PER PERSON PER MONTH, not one per person across the window.
    --
    -- Deduping per person over the whole window makes the months incomparable:
    -- someone who enquired in June and again in August is absorbed into June,
    -- so August reads low purely because the window started earlier. Measured:
    -- August returned 1,295 that way against the 1,333 the Overview shows for
    -- the same month. Each month must count the people who enquired in it.
    lead_months AS (
      SELECT DISTINCT ON (c.id, date_trunc('month', l.created_at AT TIME ZONE 'Europe/London'))
             c.id,
             date_trunc('month', l.created_at AT TIME ZONE 'Europe/London')::date AS month,
             c.ad_campaign_id, c.attribution_source,
             c.email_norm AS em, c.phone10 AS ph,
             (c.pms_external_id IS NOT NULL) AS is_patient
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
      WHERE l.organisation_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
        AND ($4::uuid IS NULL OR l.practice_id = $4::uuid)
      ORDER BY c.id,
               date_trunc('month', l.created_at AT TIME ZONE 'Europe/London'),
               l.created_at
    ),
    -- Matching is per PERSON, not per person-month: whether someone matches a
    -- patient record does not change from month to month.
    persons AS (
      SELECT DISTINCT id, em, ph, is_patient FROM lead_months
    ),
    matched AS (
      SELECT pe.id AS lead_id, p.id AS patient_id
      FROM persons pe
      JOIN contacts p ON p.organisation_id = $1
                     AND p.pms_external_id IS NOT NULL
                     AND p.email_norm IS NOT NULL AND p.email_norm = pe.em
      UNION ALL
      SELECT pe.id, p.id
      FROM persons pe
      JOIN contacts p ON p.organisation_id = $1
                     AND p.pms_external_id IS NOT NULL
                     AND p.phone10 IS NOT NULL AND p.phone10 = pe.ph
      WHERE length(pe.ph) >= 10
      UNION ALL
      SELECT pe.id, pe.id FROM persons pe WHERE pe.is_patient
    ),
    pairs AS (SELECT DISTINCT lead_id, patient_id FROM matched),
    converted AS (SELECT DISTINCT lead_id FROM pairs),
    -- "New" is measured against EACH MONTH's own start, not the window's, or
    -- a person would be called new in November because they had no appointment
    -- back in January.
    prior_visit AS (
      SELECT DISTINCT lm.id AS lead_id, lm.month
      FROM lead_months lm
      JOIN pairs pr ON pr.lead_id = lm.id
      WHERE EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.organisation_id = $1 AND a.contact_id = pr.patient_id
           AND a.starts_at < (lm.month::timestamp AT TIME ZONE 'Europe/London')
      )
    ),
    lead_rows AS (
      SELECT lm.month,
        COALESCE(
          cp.provider,
          CASE lower(COALESCE(lm.attribution_source, ''))
            WHEN 'paid search' THEN 'google_ads'
            WHEN 'paid social' THEN 'meta_ads'
            ELSE 'other'
          END
        ) AS channel,
        (cv.lead_id IS NOT NULL) AS is_converted,
        (cv.lead_id IS NOT NULL AND pv.lead_id IS NULL) AS is_new
      FROM lead_months lm
      LEFT JOIN campaign_provider cp ON cp.campaign_id = lm.ad_campaign_id
      LEFT JOIN converted   cv ON cv.lead_id = lm.id
      LEFT JOIN prior_visit pv ON pv.lead_id = lm.id AND pv.month = lm.month
    ),
    lead_agg AS (
      SELECT month, channel,
             count(*) AS leads,
             count(*) FILTER (WHERE is_converted) AS patients,
             count(*) FILTER (WHERE is_new) AS new_patients
      FROM lead_rows GROUP BY month, channel
    ),
    spend_agg AS (
      -- metric_date is a DATE and already a London calendar day, so it needs no
      -- timezone conversion — only the same month bucket.
      SELECT date_trunc('month', m.metric_date)::date AS month,
             m.provider AS channel,
             sum(m.spend_pence)::bigint AS spend_pence
      FROM ad_metrics m
      WHERE m.organisation_id = $1
        AND m.metric_date >= ($2 AT TIME ZONE 'Europe/London')::date
        AND m.metric_date <  ($3 AT TIME ZONE 'Europe/London')::date
        AND ($4::uuid IS NULL OR m.practice_id = $4::uuid)
      GROUP BY 1, 2
    )
    -- FULL JOIN: a month may have spend with no leads, or leads with no spend.
    -- An inner join would silently drop either.
    SELECT COALESCE(l.month, s.month)     AS month,
           COALESCE(l.channel, s.channel) AS channel,
           COALESCE(l.leads, 0)::bigint,
           COALESCE(l.patients, 0)::bigint,
           COALESCE(l.new_patients, 0)::bigint,
           COALESCE(s.spend_pence, 0)::bigint
    FROM lead_agg l
    FULL JOIN spend_agg s ON s.month = l.month AND s.channel = l.channel
    ORDER BY 1, 2
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION marketing_monthly_rollup(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION marketing_monthly_rollup(uuid, timestamptz, timestamptz, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

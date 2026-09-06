-- ===========================================================================
-- ad_meta_lead_ledger v2 — GoHighLevel is the source of truth for leads.
--
-- v1 (000167) identified a Meta lead by its ad_id resolving to a Meta campaign,
-- which made META the arbiter of which leads exist. Every Facebook lead reaches
-- this system through GHL; Meta supplies spend, impressions and clicks and
-- nothing else. The Google ledger (000158) already takes its pool from
-- ad_channel_pipelines; this brings Facebook into line.
--
-- Measured, Plan4growth, Jun-Aug 2026, switching the pool:
--   +397 leads in meta_ads pipelines that Meta never attributed (invisible before)
--   -285 Meta-attributed leads whose pipeline nobody has categorised
-- The second number is a mapping gap the report NAMES rather than swallows.
--
-- POOL = leads whose pipeline is mapped channel='meta_ads' (always-on) OR
-- mapped to an open day. An open-day pipeline counts WITHOUT a channel
-- mapping, so a half-finished mapping still reports correctly.
--
-- A lead's CAMPAIGN still comes from its ad_id. That is what ties it to a
-- campaign/ad set/ad row; a lead without one lands in the visible
-- "Not attributed" bucket rather than being dropped.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer);

CREATE FUNCTION public.ad_meta_lead_ledger(
  p_org uuid, p_since timestamptz, p_until timestamptz,
  p_min_paid_pence integer DEFAULT 4000
) RETURNS TABLE (
  contact_id uuid, practice_id uuid, practice_name text,
  campaign_id text, campaign_name text, ad_set_id text, ad_id text,
  lead_at timestamptz, name text, email text, treatment text,
  booked boolean, accepted boolean, is_new_patient boolean, paid_pence bigint,
  open_day_id uuid, meta_attributed boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH first_lead AS (
      -- One row per contact, its FIRST lead in the window. Matches
      -- ad_lead_conversions' own DISTINCT ON (contact) ORDER BY created_at, so
      -- the pipeline we read is the pipeline that funnel used.
      SELECT DISTINCT ON (l.contact_id)
             l.contact_id, l.integration_account_id, l.ghl_pipeline_id, l.created_at
        FROM leads l
       WHERE l.organisation_id = $1
         AND l.created_at >= $2 AND l.created_at < $3
       ORDER BY l.contact_id, l.created_at
    ),
    pooled AS (
      SELECT fl.contact_id, fl.created_at, odp.open_day_id
        FROM first_lead fl
        LEFT JOIN ad_open_day_pipelines odp
          ON odp.organisation_id = $1
         AND odp.integration_account_id = fl.integration_account_id
         AND odp.ghl_pipeline_id = fl.ghl_pipeline_id
        LEFT JOIN ad_channel_pipelines acp
          ON acp.organisation_id = $1
         AND acp.integration_account_id = fl.integration_account_id
         AND acp.ghl_pipeline_id = fl.ghl_pipeline_id
       WHERE odp.open_day_id IS NOT NULL OR acp.channel = 'meta_ads'
    ),
    funnel AS (
      SELECT f.* FROM ad_lead_conversions($1, $2, $3, NULL) f
    ),
    paid AS (
      SELECT p.contact_id, sum(pm.amount_pence)::bigint AS paid_pence
        FROM pooled p
        JOIN funnel f ON f.contact_id = p.contact_id
        JOIN payments pm
          ON pm.organisation_id = $1
         AND pm.contact_id = f.patient_contact
         AND pm.status = 'settled'
         AND pm.processed_at >= london_day_start(p.created_at)
       GROUP BY p.contact_id
    ),
    main_treatment AS (
      SELECT DISTINCT ON (p.contact_id) p.contact_id, ii.treatment_name
        FROM pooled p
        JOIN funnel f ON f.contact_id = p.contact_id
        JOIN invoice_items ii
          ON ii.organisation_id = $1
         AND ii.contact_id = f.patient_contact
         AND ii.treatment_plan_id IS NOT NULL
         AND ii.invoiced_on >= london_day(p.created_at)
       ORDER BY p.contact_id, ii.fee_pence DESC NULLS LAST, ii.invoiced_on, ii.id
    ),
    ad_parent AS (
      SELECT DISTINCT ON (entity_id) entity_id, parent_id
        FROM ad_meta_ads WHERE organisation_id = $1
       ORDER BY entity_id, metric_date DESC
    ),
    campaign_names AS (
      SELECT DISTINCT ON (m.campaign_id) m.campaign_id, m.campaign_name
        FROM ad_metrics m
       WHERE m.organisation_id = $1 AND m.provider = 'meta_ads'
         AND m.campaign_id IS NOT NULL
       ORDER BY m.campaign_id, m.metric_date DESC
    )
    SELECT p.contact_id,
           f.practice_id,
           pr.name AS practice_name,
           c.ad_campaign_id AS campaign_id,
           cn.campaign_name,
           ap.parent_id AS ad_set_id,
           c.ad_id,
           p.created_at AS lead_at,
           nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS name,
           c.email,
           mt.treatment_name AS treatment,
           (f.booked_at IS NOT NULL) AS booked,
           (coalesce(pd.paid_pence, 0) > $4::bigint) AS accepted,
           coalesce(f.is_new_patient, false) AS is_new_patient,
           coalesce(pd.paid_pence, 0)::bigint AS paid_pence,
           p.open_day_id,
           -- Whether META can account for this lead. Not a filter any more —
           -- a column, so the report can state how much of a cost figure
           -- rests on leads the ads cannot be shown to have bought.
           (cn.campaign_id IS NOT NULL) AS meta_attributed
      FROM pooled p
      LEFT JOIN funnel f          ON f.contact_id = p.contact_id
      LEFT JOIN contacts c        ON c.id = p.contact_id AND c.organisation_id = $1
      LEFT JOIN practices pr      ON pr.id = f.practice_id AND pr.organisation_id = $1
      LEFT JOIN paid pd           ON pd.contact_id = p.contact_id
      LEFT JOIN main_treatment mt ON mt.contact_id = p.contact_id
      LEFT JOIN ad_parent ap      ON ap.entity_id = c.ad_id
      LEFT JOIN campaign_names cn ON cn.campaign_id = c.ad_campaign_id
  $q$ USING p_org, p_since, p_until, p_min_paid_pence;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

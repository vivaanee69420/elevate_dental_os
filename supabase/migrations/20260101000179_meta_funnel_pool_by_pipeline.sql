-- ============================================================================
-- ad_meta_funnel — the pool comes from the PIPELINE, matching the ledger.
--
-- Owner's instruction, 2026-09-08, stated twice: "if a lead has come from
-- google ads pipeline that lead belongs to google ads only whether it has gclid
-- or not, and same goes for meta ads as well."
--
-- ============================================================================
-- MOST OF THIS WAS ALREADY DONE, AND ONE FUNCTION WAS MISSED.
--
-- 000171 moved ad_meta_lead_ledger onto exactly this rule a while ago: "v1
-- (000167) identified a Meta lead by its ad_id resolving to a Meta campaign,
-- which made META the arbiter of which leads exist... Meta supplies spend,
-- impressions and clicks and nothing else." Its pool is the contact's FIRST
-- lead, kept when that lead's pipeline is mapped to channel='meta_ads' OR to an
-- open day.
--
-- ad_meta_funnel was left behind on the old structural test — ad_campaign_id
-- resolving to a Meta campaign in ad_metrics. So the Facebook report has been
-- running on TWO different populations at once: the performance panel's cards
-- from the pipeline pool, and the Campaigns / Ad sets / Ads tabs beneath them
-- from the structural one. They were close enough in total to look consistent
-- and were never the same set.
--
-- Measured before the change, 90 days to 2026-09-08:
--
--     ad_meta_lead_ledger (pipeline pool)   2,171 leads
--     ad_meta_funnel      (structural)      2,172 leads
--
-- One lead apart, and built from different people. 113 leads sat in a Meta
-- pipeline with no resolvable Meta campaign id, counted by the panel and
-- missing from the tabs; a similar number resolved to a Meta campaign while
-- sitting in a Google pipeline or an unmapped one, counted by the tabs and
-- missing from the panel. After the change both return 2,171 and the tabs
-- reconcile to the cards above them.
--
-- ============================================================================
-- THE POOL IS COPIED FROM 000171 ON PURPOSE, OPEN DAYS INCLUDED.
--
-- A first cut of this migration used channel='meta_ads' alone and would have
-- dropped every open-day pipeline from the tabs while the panel kept them —
-- replacing one disagreement with another. An open-day pipeline counts WITHOUT
-- a channel mapping (000170) so that a half-finished mapping still reports
-- correctly, and the funnel has to honour that too.
--
-- Joined on ghl_pipeline_id alone where 000171 joins on
-- (integration_account_id, ghl_pipeline_id): ad_lead_conversions returns the
-- pipeline id but not the account id, and GoHighLevel pipeline ids are unique
-- within an org — verified on this org, 15 mappings, 15 distinct pipeline ids,
-- none under more than one account.
--
-- ============================================================================
-- A CAMPAIGN ID IS STILL WHAT PLACES A LEAD IN A CAMPAIGN ROW, and that has not
-- changed — it is a different question from which channel the lead belongs to.
-- A pipeline-selected lead with no campaign id now reaches the funnel with a
-- NULL campaign_id instead of being excluded, and
-- facebook-report.service.js:626 already partitions exactly that case into its
-- stated `unmatchedLeads` bucket rather than dropping it. 253 of the 2,171 are
-- in that position today.
--
-- ad_meta_lead_ledger is deliberately NOT redefined here. It has been correct
-- since 000171 and re-stating it in this file would be a second copy free to
-- drift from that one.
--
-- Return type unchanged, so CREATE OR REPLACE — no DROP of a live function.
-- Idempotent. After applying on hosted:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_meta_funnel(
  p_org      uuid,
  p_since    timestamptz,
  p_until    timestamptz,
  p_practice uuid DEFAULT NULL
) RETURNS TABLE (
  campaign_id text, ad_set_id text, ad_id text, practice_id uuid,
  leads bigint, booked bigint, attended bigint,
  patients bigint, new_patients bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT f.ad_campaign_id                                   AS campaign_id,
           a.parent_id                                        AS ad_set_id,
           f.ad_id                                            AS ad_id,
           f.practice_id                                      AS practice_id,
           count(*)::bigint                                   AS leads,
           count(f.booked_at)::bigint                         AS booked,
           count(*) FILTER (WHERE f.attended)::bigint         AS attended,
           count(*) FILTER (WHERE f.converted)::bigint        AS patients,
           count(*) FILTER (WHERE f.is_new_patient)::bigint   AS new_patients
      FROM ad_lead_conversions($1, $2, $3, $4::uuid) f
      -- DISTINCT ON collapses the ad's day rows to one, so a lead is counted
      -- once however many days its ad ran.
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, parent_id
          FROM ad_meta_ads
         WHERE organisation_id = $1
         ORDER BY entity_id, metric_date DESC
      ) a ON a.entity_id = f.ad_id
     -- THE POOL, identical to ad_meta_lead_ledger's (000171). Kept in step by
     -- test/meta-pool-agreement.test.mjs, which fails if the two drift.
     WHERE f.ghl_pipeline_id IN (
       SELECT acp.ghl_pipeline_id FROM ad_channel_pipelines acp
        WHERE acp.organisation_id = $1 AND acp.channel = 'meta_ads'
       UNION
       SELECT odp.ghl_pipeline_id FROM ad_open_day_pipelines odp
        WHERE odp.organisation_id = $1
     )
     GROUP BY f.ad_campaign_id, a.parent_id, f.ad_id, f.practice_id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_meta_funnel(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_meta_funnel(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

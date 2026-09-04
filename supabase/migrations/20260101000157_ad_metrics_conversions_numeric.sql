-- ============================================================================
-- ad_metrics.conversions — widen from INTEGER to NUMERIC(14,2). Fixes a
-- non-reconciling figure under one column name.
--
-- THE BUG: ad_metrics.conversions was declared INTEGER (000034), and
-- google-ads-sync.js wrapped every value in Math.round(...) before storage.
-- The deep-grain tables added later (ad_google_adgroups/ad_google_ads/
-- ad_google_keywords, migration 000148) declared the SAME metric
-- numeric(14,2) and store it fractional ON PURPOSE: Google reports modelled
-- conversions as fractions (3.5 is a real value in Google's own interface,
-- not a rounding artefact), and google-ads-deep-sync.js already keeps it
-- exact. So the campaign tier and the ad-group/ad/keyword tiers of the SAME
-- report disagreed about the SAME campaign's conversions by construction —
-- not a sync gap, a schema gap.
--
-- MEASURED ON HOSTED: 899 of 1,774 google_ads campaign-days with spend in the
-- last 92 days show exactly 0 conversions (50.7%). A campaign averaging 0.3
-- conversions/day reads "0" with an em-dash cost-per-conversion on the
-- Campaigns tab, and a real ~27.6 conversions with a real cost on the Ad
-- groups tab one click away, for the SAME window. The owner cannot tell
-- "converts nothing" from "converts a little, every day".
--
-- google-report.service.js's own header already asserted "conversions is
-- NUMERIC, not an integer... never Number.parseInt" — true of the service,
-- false of the campaign tier's column until this migration.
--
-- Idempotent: ALTER COLUMN TYPE is safe to re-run (Postgres no-ops a TYPE
-- change to the same type). numeric(14,2) losslessly holds every existing
-- integer value, so no data is altered by the widening itself.
--
-- HISTORICAL ROWS STAY ROUNDED until the nightly sync re-pulls its trailing
-- 90-day window (google-ads-sync.js's INCREMENTAL_DAYS) and replaces them —
-- that heals the window that matters within one night. Rows outside that
-- window (older history) keep their rounded value permanently unless a
-- reconnect/backfill re-pulls them; the code fix here only stops the loss on
-- every write going forward.
--
-- NOT YET APPLIED ON HOSTED — the developer applies and verifies migrations
-- against hosted directly (see CLAUDE.md). Do not apply from this branch.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- The Data Room view reads this column, and Postgres refuses to alter a type
-- a view depends on. Dropped and recreated verbatim around the ALTER — the
-- definition below is pg_get_viewdef() output from hosted, not a rewrite, so
-- the view's own logic is unchanged. Its cpl_pence already casts conversions
-- to numeric, so widening the column changes nothing about what it returns.
DROP VIEW IF EXISTS public.data_room_ad_metrics;

ALTER TABLE ad_metrics ALTER COLUMN conversions TYPE numeric(14,2);

CREATE VIEW public.data_room_ad_metrics AS
 SELECT m.id,
    m.organisation_id,
    m.practice_id,
    m.provider,
    m.source,
    m.customer_id,
    m.campaign_id,
    m.campaign_name,
    m.metric_date,
    m.spend_pence,
    m.impressions,
    m.clicks,
    m.leads,
    m.conversions,
    m.created_at,
    m.updated_at,
    m.reach,
    m.frequency,
    m.campaign_status,
    m.objective,
    pr.name AS practice_name,
        CASE
            WHEN COALESCE(m.conversions, 0) > 0 THEN round(m.spend_pence::numeric / m.conversions::numeric)::bigint
            ELSE NULL::bigint
        END AS cpl_pence
   FROM ad_metrics m
     LEFT JOIN LATERAL ( SELECT aa.practice_id
           FROM ad_accounts aa
          WHERE aa.organisation_id = m.organisation_id AND aa.provider = m.provider AND aa.customer_id = m.customer_id
         LIMIT 1) acc ON true
     LEFT JOIN practices pr ON pr.id = acc.practice_id;

-- Restore the grants the dropped view held: service_role only. anon and
-- authenticated deliberately hold nothing on the Data Room views.
GRANT SELECT ON public.data_room_ad_metrics TO service_role;

NOTIFY pgrst, 'reload schema';

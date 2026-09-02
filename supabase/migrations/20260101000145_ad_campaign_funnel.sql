-- ============================================================================
-- ad_campaign_funnel — the campaign table's counts, aggregated in SQL.
--
-- WHY: ad_lead_conversions returns ONE ROW PER PERSON — 10,429 rows at 2.8s
-- over a year — and PostgREST caps a set-returning function at 1000 rows, so
-- the service was making eleven calls purely to count them. This returns at
-- most (campaigns x sources x practices) rows, realistically a few hundred.
-- The row-level function stays the right tool for the leads list and the
-- campaign detail page, where the per-person detail is the point.
--
-- IT READS THROUGH ad_lead_conversions rather than restating its query. booked,
-- attended, converted and is_new_patient then have exactly ONE definition. The
-- section already carries duplicated channel resolution between
-- marketing_monthly_rollup and marketing.service.js; a third copy of the funnel
-- rules is not acceptable.
--
-- GROUPED BY (campaign, source, practice), not campaign alone, because the same
-- call feeds the campaign table, the channel split AND the practice comparison.
-- This is exact rather than approximate because ad_lead_conversions emits
-- DISTINCT ON (c.id) — one row per person — so each person lands in exactly one
-- group and the group counts sum to the population without double-counting.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS ad_campaign_funnel(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION ad_campaign_funnel(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  ad_campaign_id text, attribution_source text, practice_id uuid,
  leads bigint, booked bigint, attended bigint,
  patients bigint, new_patients bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE ... USING for the same reason as ad_lead_conversions:
  -- SECURITY DEFINER + SET search_path block inlining, so a LANGUAGE sql body
  -- would be planned generically with p_org unknown. Do NOT "simplify" this.
  RETURN QUERY EXECUTE $q$
    SELECT f.ad_campaign_id,
           f.attribution_source,
           f.practice_id,
           count(*)::bigint                                        AS leads,
           count(f.booked_at)::bigint                              AS booked,
           count(*) FILTER (WHERE f.attended)::bigint              AS attended,
           count(*) FILTER (WHERE f.converted)::bigint             AS patients,
           count(*) FILTER (WHERE f.is_new_patient)::bigint        AS new_patients
    FROM ad_lead_conversions($1, $2, $3, $4::uuid) f
    GROUP BY f.ad_campaign_id, f.attribution_source, f.practice_id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION ad_campaign_funnel(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_campaign_funnel(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

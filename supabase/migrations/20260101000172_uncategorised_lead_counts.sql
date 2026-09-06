-- Leads whose GHL pipeline has no channel and no open day. The report states
-- this instead of silently dropping them: switching the Facebook pool to the
-- GHL mapping leaves 212 Meta-attributed leads out for this org today, and a
-- number nobody can see is a number nobody will fix.
DROP FUNCTION IF EXISTS public.ad_uncategorised_lead_counts(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.ad_uncategorised_lead_counts(
  p_org uuid, p_since timestamptz, p_until timestamptz
) RETURNS TABLE (leads bigint, attributed bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH first_lead AS (
      SELECT DISTINCT ON (l.contact_id)
             l.contact_id, l.integration_account_id, l.ghl_pipeline_id
        FROM leads l
       WHERE l.organisation_id = $1 AND l.created_at >= $2 AND l.created_at < $3
       ORDER BY l.contact_id, l.created_at
    )
    SELECT count(*)::bigint,
           count(*) FILTER (WHERE c.ad_campaign_id IN (
             SELECT m.campaign_id FROM ad_metrics m
              WHERE m.organisation_id = $1 AND m.provider = 'meta_ads'
                AND m.campaign_id IS NOT NULL))::bigint
      FROM first_lead fl
      LEFT JOIN contacts c ON c.id = fl.contact_id AND c.organisation_id = $1
      LEFT JOIN ad_channel_pipelines acp
        ON acp.organisation_id = $1
       AND acp.integration_account_id = fl.integration_account_id
       AND acp.ghl_pipeline_id = fl.ghl_pipeline_id
      LEFT JOIN ad_open_day_pipelines odp
        ON odp.organisation_id = $1
       AND odp.integration_account_id = fl.integration_account_id
       AND odp.ghl_pipeline_id = fl.ghl_pipeline_id
     WHERE acp.channel IS NULL AND odp.open_day_id IS NULL
  $q$ USING p_org, p_since, p_until;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_uncategorised_lead_counts(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_uncategorised_lead_counts(uuid, timestamptz, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';

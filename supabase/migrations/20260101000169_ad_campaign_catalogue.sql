-- ===========================================================================
-- ad_campaign_catalogue — every campaign an org has metrics for, ONE ROW EACH.
--
-- The open-day mapping screen needs a pick list: every Meta campaign, with the
-- account it belongs to, when it last ran and what it spent, so an owner can
-- recognise "Mint: Implants Open Day LF July 26" among 84 of them.
--
-- WHY AN RPC AND NOT A TABLE READ. ad_metrics holds one row per campaign PER
-- DAY — 84 campaigns across ~450 days for this org, tens of thousands of rows —
-- and PostgREST truncates a table read at 1000 rows IN SILENCE. Folding
-- campaign x day to campaign in JavaScript would therefore work in testing and
-- quietly lose most of the pick list in production, which is the same trap
-- documented on monthly_financials and ad_lead_conversions. Aggregating in SQL
-- returns ~84 rows and cannot be truncated.
--
-- Provider is a parameter rather than hardcoded to Meta: the table already
-- allows google_ads open days, and this is the read that would feed that UI.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.ad_campaign_catalogue(uuid, text);

CREATE FUNCTION public.ad_campaign_catalogue(p_org uuid, p_provider text)
RETURNS TABLE (
  campaign_id text, campaign_name text, customer_id text, account_name text,
  first_day date, last_day date, spend_pence bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT m.campaign_id,
           -- A campaign can be renamed mid-life, so ad_metrics holds several
           -- names for one id. Take the MOST RECENT: the owner is looking for
           -- the name they see in Meta today, not the one it launched under.
           (array_agg(m.campaign_name ORDER BY m.metric_date DESC))[1] AS campaign_name,
           m.customer_id,
           max(a.name)               AS account_name,
           min(m.metric_date)        AS first_day,
           max(m.metric_date)        AS last_day,
           sum(m.spend_pence)::bigint AS spend_pence
      FROM ad_metrics m
      LEFT JOIN ad_accounts a
        ON a.organisation_id = m.organisation_id
       AND a.provider = m.provider
       AND a.customer_id = m.customer_id
     WHERE m.organisation_id = $1
       AND m.provider = $2
       AND m.campaign_id IS NOT NULL
     GROUP BY m.campaign_id, m.customer_id
     -- Most recently active first: an owner mapping an event is almost always
     -- reaching for something that ran lately.
     ORDER BY max(m.metric_date) DESC, sum(m.spend_pence) DESC
  $q$ USING p_org, p_provider;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_campaign_catalogue(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_campaign_catalogue(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

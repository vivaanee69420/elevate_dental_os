-- ============================================================================
-- ad_lead_conversions — did a GoHighLevel lead become a Dentally patient?
--
-- This is DELIBERATELY NOT the ad platforms' own `conversions` figure. Google
-- and Facebook count a form submission; this counts a person who appears in
-- Dentally. Both are shown in the UI, labelled distinctly. Never conflate them.
--
-- MUST be a UNION ALL of equi-joins, never one OR'd join: measured at 25,127
-- lead contacts against 63,349 patients, the OR form plans a nested loop and
-- times out through PostgREST while looking fine in the SQL editor. Same
-- lesson as cockpit_accepted_lead_source (000112).
--
-- Matching is email OR last-10-digits of phone. Dentally patients are contacts
-- with a pms_external_id. Org-scoped on every arm (rule 3).
-- ============================================================================

-- Functional indexes the equi-joins need; without these each arm seq-scans.
CREATE INDEX IF NOT EXISTS idx_contacts_org_lower_email
  ON contacts(organisation_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_org_phone10
  ON contacts(organisation_id, right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10))
  WHERE phone IS NOT NULL;

-- p_since/p_until are timestamptz and the window is HALF-OPEN: >= since, < until.
-- The shared ScopePeriod window already hands us the start of the next London
-- day/month as `until`, so any <= or +1 here would double-count the boundary.
CREATE OR REPLACE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, matched_by text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lead_contacts AS (
    SELECT DISTINCT c.id, c.ad_campaign_id, c.attribution_source,
           lower(c.email) AS em,
           right(regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g'), 10) AS ph
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = p_org
    WHERE l.organisation_id = p_org
      AND l.created_at >= p_since AND l.created_at < p_until
      AND (p_practice IS NULL OR l.practice_id = p_practice)
      AND c.pms_external_id IS NULL          -- the lead side, not the patient side
  ),
  patients AS (
    SELECT lower(email) AS em,
           right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) AS ph
    FROM contacts
    WHERE organisation_id = p_org AND pms_external_id IS NOT NULL
  ),
  matches AS (
    SELECT lc.id, 'email'::text AS how
    FROM lead_contacts lc JOIN patients p ON p.em = lc.em
    WHERE lc.em IS NOT NULL
    UNION ALL
    SELECT lc.id, 'phone'::text
    FROM lead_contacts lc JOIN patients p ON p.ph = lc.ph
    WHERE length(lc.ph) >= 10
  )
  SELECT lc.id, lc.ad_campaign_id, lc.attribution_source,
         (m.id IS NOT NULL) AS converted,
         min(m.how) AS matched_by
  FROM lead_contacts lc
  LEFT JOIN matches m ON m.id = lc.id
  GROUP BY lc.id, lc.ad_campaign_id, lc.attribution_source, (m.id IS NOT NULL);
$$;

-- SECURITY DEFINER + p_org means this must never be callable by an anon or
-- end-user role; the backend calls it with the service key. Mandatory idiom.
REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ad_lead_conversions — stop dropping leads who are already patients.
--
-- THE BUG: the lead population was `c.pms_external_id IS NULL`. That filter is
-- a MATCHING concern — "join the lead side to the patient side" — and it leaked
-- into the definition of who counts as a lead. Anyone who enquired AND already
-- carries a Dentally patient id on the same contact row was excluded from the
-- result entirely: not counted as a lead, and not counted as a patient either.
--
-- Measured on Plan4growth, August 2026:
--   Barnet          335 people with a lead -> 315 returned (20 dropped)
--   whole org     1,333 people with a lead -> 1,222 returned (111 dropped)
--
-- Every one of the dropped 20 turns out to match a patient record, so they were
-- exactly the leads that converted — the most valuable rows in the table were
-- the ones being discarded. Barnet's true August figures are 335 leads and 50
-- patients, not 315 and 30: a conversion rate of 14.9%, reported as 9.5%.
--
-- THE FIX: the population is every distinct contact with a lead in the window.
-- A contact that IS a patient record is trivially converted — no join needed to
-- establish it — so `converted` becomes "carries a patient id, OR matches a
-- patient record by email or phone".
--
-- Same name, same signature, same returned columns: this is a body change only,
-- so CREATE OR REPLACE is enough and no caller changes.
--
-- NOTE ON THE METRIC (unchanged, but worth stating): "became a patient" means
-- matched to a Dentally patient record, which includes an existing patient who
-- enquired again. Distinguishing a NEW patient needs the first-appointment date
-- against the lead date, and is a separate change.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

CREATE OR REPLACE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, matched_by text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE ... USING is deliberate and load-bearing. As a plain
  -- LANGUAGE sql function this ran 10.7s while the IDENTICAL query inline ran
  -- 608ms: SECURITY DEFINER and SET search_path both block SQL-function
  -- inlining, so the body was planned GENERICALLY with p_org unknown and never
  -- chose the per-lead index probes. EXECUTE ... USING forces a custom plan
  -- built with the real parameter values on every call.
  --
  -- Do NOT "simplify" this back to LANGUAGE sql.
  RETURN QUERY EXECUTE $q$
    WITH lead_contacts AS (
      -- Every person who enquired in the window. NOT filtered on
      -- pms_external_id: that filter belongs to the matching step below, and
      -- using it here silently deleted the leads who had already converted.
      SELECT DISTINCT c.id, c.ad_campaign_id, c.attribution_source,
             c.email_norm AS em, c.phone10 AS ph,
             (c.pms_external_id IS NOT NULL) AS is_patient
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
      WHERE l.organisation_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
        AND ($4::uuid IS NULL OR l.practice_id = $4::uuid)
    ),
    -- The patient side is probed ONCE PER LEAD through a partial index, never
    -- assembled as a whole. A shared `patients` CTE selecting both keys at once
    -- can use neither partial index and cost 892ms of bitmap heap scan over
    -- 7,183 blocks; splitting it per arm turns each into an Index Only Scan.
    -- Still a UNION ALL of equi-joins, never one OR'd join (see 000112).
    matches AS (
      SELECT lc.id, 'email'::text AS how
      FROM lead_contacts lc
      JOIN (SELECT email_norm AS em FROM contacts
             WHERE organisation_id = $1
               AND pms_external_id IS NOT NULL AND email_norm IS NOT NULL) p ON p.em = lc.em
      UNION ALL
      SELECT lc.id, 'phone'::text
      FROM lead_contacts lc
      JOIN (SELECT phone10 AS ph FROM contacts
             WHERE organisation_id = $1
               AND pms_external_id IS NOT NULL AND phone10 IS NOT NULL) p ON p.ph = lc.ph
      WHERE length(lc.ph) >= 10
    )
    SELECT lc.id, lc.ad_campaign_id, lc.attribution_source,
           -- A contact holding a patient id needs no join to prove it converted.
           (lc.is_patient OR m.id IS NOT NULL) AS converted,
           CASE WHEN lc.is_patient THEN 'self' ELSE min(m.how) END AS matched_by
    FROM lead_contacts lc
    LEFT JOIN matches m ON m.id = lc.id
    GROUP BY lc.id, lc.ad_campaign_id, lc.attribution_source, lc.is_patient, (m.id IS NOT NULL)
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

-- The lead side is no longer restricted to non-patients, so the partial index
-- built for that filter can never be chosen. Dropping it saves write cost on
-- every contact upsert.
DROP INDEX IF EXISTS idx_contacts_lead_side;

-- SECURITY DEFINER + p_org means this must never be callable by an anon or
-- end-user role; the backend calls it with the service key. Mandatory idiom.
REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

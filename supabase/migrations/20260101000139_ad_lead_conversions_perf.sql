-- ============================================================================
-- ad_lead_conversions performance rebuild.
--
-- THE BUG: on Plan4growth (22,658 leads / 22,796 patients / 48,924 contacts)
-- the function took 11.1s and PostgREST cut it off at 8s, so the whole
-- Marketing section rendered "canceling statement due to statement timeout".
--
-- WHY: the `patients` CTE seq-scanned 96,233 contact rows and ran lower() plus
-- a phone regexp_replace on EVERY one of them, then hash-joined the computed
-- values — 2,308ms of a 2,376ms inlined run, and worse inside the function
-- where each UNION arm rescans the CTE. The expression indexes added in
-- 000138 were never used: the query computed the expressions into a CTE
-- instead of probing an index, and rewriting it as per-lead EXISTS probes made
-- it far worse (50s) because the planner would not cost the phone expression
-- index and fell back to a seq scan PER LEAD.
--
-- THE FIX: stop computing. `email_norm` and `phone10` become STORED generated
-- columns, so the normalisation happens once on write instead of 96k times per
-- request, and plain btree equality is something the planner always costs
-- correctly — no expression-matching fragility. The matching keeps its
-- UNION ALL of equi-joins (never one OR'd join — see 000138's note and
-- cockpit_accepted_lead_source in 000112).
--
-- The new indexes are partial on the PATIENT side (pms_external_id IS NOT
-- NULL), so they cover ~22.8k rows rather than the whole 96k table.
--
-- Adding two STORED generated columns rewrites the table once. At this size
-- that is seconds, and it is a one-off.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- Normalised match keys, computed on write. NULLIF keeps a blank string from
-- matching another blank string — without it every contact with an empty phone
-- would "convert" against every patient with an empty phone.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_norm TEXT
  GENERATED ALWAYS AS (lower(nullif(btrim(email), ''))) STORED;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone10 TEXT
  GENERATED ALWAYS AS (
    nullif(right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10), '')
  ) STORED;

-- Patient-side lookup indexes: partial, so they hold only the rows the join
-- actually probes.
CREATE INDEX IF NOT EXISTS idx_contacts_patient_email
  ON contacts(organisation_id, email_norm)
  WHERE pms_external_id IS NOT NULL AND email_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_patient_phone
  ON contacts(organisation_id, phone10)
  WHERE pms_external_id IS NOT NULL AND phone10 IS NOT NULL;

-- Lead-side: the window scan joins leads to their contact and keeps only the
-- non-patient rows.
CREATE INDEX IF NOT EXISTS idx_contacts_lead_side
  ON contacts(organisation_id, id)
  WHERE pms_external_id IS NULL;

-- The 000138 expression indexes are superseded by the generated columns and
-- were never chosen by the planner anyway. Dropping them saves write cost on
-- every contact upsert.
DROP INDEX IF EXISTS idx_contacts_org_lower_email;
DROP INDEX IF EXISTS idx_contacts_org_phone10;

-- Same contract as 000138 — same name, same signature, same returned columns.
--
-- plpgsql + EXECUTE ... USING is deliberate and load-bearing. As a plain
-- LANGUAGE sql function this ran 10.7s while the IDENTICAL query inline ran
-- 608ms: SECURITY DEFINER and SET search_path both block SQL-function
-- inlining, so the body was planned GENERICALLY with p_org unknown and never
-- chose the per-lead index probes. EXECUTE ... USING forces a custom plan
-- built with the real parameter values on every call. Measured on Plan4growth,
-- August 2026: 11,136ms -> 55ms.
--
-- Do NOT "simplify" this back to LANGUAGE sql.
CREATE OR REPLACE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, matched_by text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH lead_contacts AS (
      SELECT DISTINCT c.id, c.ad_campaign_id, c.attribution_source,
             c.email_norm AS em, c.phone10 AS ph
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
      WHERE l.organisation_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
        AND ($4::uuid IS NULL OR l.practice_id = $4::uuid)
        AND c.pms_external_id IS NULL          -- the lead side, not the patient side
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
           (m.id IS NOT NULL) AS converted,
           min(m.how) AS matched_by
    FROM lead_contacts lc
    LEFT JOIN matches m ON m.id = lc.id
    GROUP BY lc.id, lc.ad_campaign_id, lc.attribution_source, (m.id IS NOT NULL)
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

-- SECURITY DEFINER + p_org means this must never be callable by an anon or
-- end-user role; the backend calls it with the service key. Mandatory idiom.
REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

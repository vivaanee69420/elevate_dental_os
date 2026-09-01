-- ============================================================================
-- ad_lead_conversions — widen the row so the Marketing section can be more
-- than two screens, and separate a NEW patient from an existing one.
--
-- Adds four columns:
--   practice_id     which practice the person first enquired at
--   first_lead_at   when they first enquired inside the window
--   is_new_patient  converted AND had no appointment before the window began
--   patient_contact the matched Dentally contact (null when unmatched)
--
-- WHY is_new_patient: "became a patient" means matched to a Dentally record,
-- which counts an existing patient who enquired again — 111 of 1,333 people in
-- Plan4growth's August window are matched to themselves (`self`), i.e. they
-- already held a patient record when they enquired. Reporting those as
-- acquisition overstates what the advertising bought.
--
-- NEW means: converted, and no appointment starting before the window opened.
-- That is the same idea as newPatientsCount (000072) — someone with no prior
-- visit — expressed as a bounded EXISTS rather than a MIN over their whole
-- appointment history, because the question only needs the first row found. A
-- converted person with no appointments at all counts as new: they were
-- registered as a patient in or after this window.
--
-- WHY practice_id and first_lead_at: a per-practice comparison and a month-by-
-- month trend would otherwise need one RPC call per practice and per month.
-- One row per person carrying both lets a single call serve every screen.
--
-- DISTINCT ON (c.id) ORDER BY l.created_at keeps EXACTLY ONE ROW PER CONTACT —
-- the repository pages this function with ORDER BY contact_id and would
-- duplicate or skip rows if a person could appear twice. A person with leads at
-- two practices is attributed to the earlier one, which also means the
-- per-practice figures sum to the group total instead of double-counting.
--
-- The return type changes, so this DROPs before CREATEing.
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- The prior-visit probe needs (org, contact, starts_at) together to answer
-- "any appointment before X" from the index alone. idx_appts_contact is on
-- contact_id by itself, so it cannot bound the range or supply starts_at.
CREATE INDEX IF NOT EXISTS idx_appointments_org_contact_starts
  ON appointments (organisation_id, contact_id, starts_at);

DROP FUNCTION IF EXISTS ad_lead_conversions(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, practice_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, is_new_patient boolean, matched_by text,
  first_lead_at timestamptz, patient_contact uuid
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
      -- Every person who enquired in the window, once. NOT filtered on
      -- pms_external_id: that belongs to the matching step, and using it here
      -- silently deleted the leads who had already converted (000141).
      SELECT DISTINCT ON (c.id)
             c.id, l.practice_id, l.created_at AS first_lead_at,
             c.ad_campaign_id, c.attribution_source,
             c.email_norm AS em, c.phone10 AS ph,
             (c.pms_external_id IS NOT NULL) AS is_patient
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
      WHERE l.organisation_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
        AND ($4::uuid IS NULL OR l.practice_id = $4::uuid)
      ORDER BY c.id, l.created_at
    ),
    -- The patient side is probed once per lead through the partial indexes,
    -- never assembled as a whole. Still a UNION ALL of equi-joins, never one
    -- OR'd join (see 000112) — an OR here cannot use either index.
    matched AS (
      SELECT lc.id AS lead_id, p.id AS patient_id, 'email'::text AS how
      FROM lead_contacts lc
      JOIN contacts p ON p.organisation_id = $1
                     AND p.pms_external_id IS NOT NULL
                     AND p.email_norm IS NOT NULL
                     AND p.email_norm = lc.em
      UNION ALL
      SELECT lc.id, p.id, 'phone'::text
      FROM lead_contacts lc
      JOIN contacts p ON p.organisation_id = $1
                     AND p.pms_external_id IS NOT NULL
                     AND p.phone10 IS NOT NULL
                     AND p.phone10 = lc.ph
      WHERE length(lc.ph) >= 10
      UNION ALL
      -- A contact that IS a patient record is its own match; no join needed.
      SELECT lc.id, lc.id, 'self'::text FROM lead_contacts lc WHERE lc.is_patient
    ),
    agg AS (
      SELECT lead_id, min(patient_id::text)::uuid AS patient_id, min(how) AS how
      FROM matched GROUP BY lead_id
    ),
    -- Had this person been to the practice BEFORE the window opened?
    --
    -- An EXISTS bounded by starts_at, over the DISTINCT (lead, patient) pairs,
    -- rather than MIN(starts_at) over every appointment they have ever had:
    -- the question is only "was there one before $2", so the index range is
    -- bounded and most probes stop at the first row. The pairs are deduped
    -- because email and phone routinely match the SAME patient record, which
    -- made 709 probes out of 347 distinct pairs.
    prior_visit AS (
      SELECT DISTINCT pr.lead_id
      FROM (SELECT DISTINCT lead_id, patient_id FROM matched) pr
      WHERE EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.organisation_id = $1
           AND a.contact_id = pr.patient_id
           AND a.starts_at < $2
      )
    )
    SELECT lc.id, lc.practice_id, lc.ad_campaign_id, lc.attribution_source,
           (agg.lead_id IS NOT NULL) AS converted,
           -- New = converted, and no appointment before this window began. A
           -- converted person with no appointment history at all counts as new:
           -- they were registered as a patient in or after this window.
           (agg.lead_id IS NOT NULL AND pv.lead_id IS NULL) AS is_new_patient,
           -- 'self' is the more informative label when both apply.
           CASE WHEN lc.is_patient THEN 'self' ELSE agg.how END AS matched_by,
           lc.first_lead_at,
           agg.patient_id
    FROM lead_contacts lc
    LEFT JOIN agg         ON agg.lead_id = lc.id
    LEFT JOIN prior_visit pv ON pv.lead_id = lc.id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

-- SECURITY DEFINER + p_org means this must never be callable by an anon or
-- end-user role; the backend calls it with the service key. Mandatory idiom.
REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

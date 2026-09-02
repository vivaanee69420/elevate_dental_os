-- ============================================================================
-- ad_lead_conversions — carry the GoHighLevel pipeline the person came in on.
--
-- WHY: "Other sources" was the largest bucket on the leads screen (1,567 of the
-- Jun-Aug window) and it said nothing about origin — 848 of those carry no
-- attribution_source at all, so the row rendered blank. Every one of them DOES
-- carry a ghl_pipeline_id, so the origin was already in the database and simply
-- was not being read: "6. Chatbot Website", "5. Website Leads", and so on.
--
-- FIRST TOUCH, not latest: lead_contacts is DISTINCT ON (c.id) ORDER BY
-- l.created_at, so a person with several leads keeps their EARLIEST. The
-- pipeline therefore answers "where did this person first come in", which is
-- the same basis every other attribution field on this row uses.
--
-- The id is returned RAW. Names live in integration_accounts.config->'pipelines'
-- and are resolved in the service, because a name is a display concern and one
-- org can hold several subaccounts whose pipeline sets are disjoint.
--
-- The return type changes, so this DROPs before CREATEing. ad_campaign_funnel
-- (000145) reads this function but selects its columns BY NAME and does not
-- select this one, so it is unaffected and does not need recreating.
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS ad_lead_conversions(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, practice_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, is_new_patient boolean, matched_by text,
  first_lead_at timestamptz, patient_contact uuid,
  booked_at timestamptz, attended boolean,
  ghl_pipeline_id text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE ... USING is deliberate and load-bearing. SECURITY
  -- DEFINER and SET search_path both block SQL-function inlining, so a
  -- LANGUAGE sql body is planned GENERICALLY with p_org unknown and never
  -- chooses the per-lead index probes: 10.7s against 608ms for the identical
  -- query inline. Do NOT "simplify" this back to LANGUAGE sql.
  RETURN QUERY EXECUTE $q$
    WITH lead_contacts AS (
      SELECT DISTINCT ON (c.id)
             c.id, l.practice_id, l.created_at AS first_lead_at,
             c.ad_campaign_id, c.attribution_source,
             l.ghl_pipeline_id::text AS ghl_pipeline_id,
             c.email_norm AS em, c.phone10 AS ph,
             (c.pms_external_id IS NOT NULL) AS is_patient
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
      WHERE l.organisation_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
        AND ($4::uuid IS NULL OR l.practice_id = $4::uuid)
      ORDER BY c.id, l.created_at
    ),
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
      SELECT lc.id, lc.id, 'self'::text FROM lead_contacts lc WHERE lc.is_patient
    ),
    agg AS (
      SELECT lead_id, min(patient_id::text)::uuid AS patient_id, min(how) AS how
      FROM matched GROUP BY lead_id
    ),
    prior_visit AS (
      SELECT DISTINCT pr.lead_id
      FROM (SELECT DISTINCT lead_id, patient_id FROM matched) pr
      WHERE EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.organisation_id = $1
           AND a.contact_id = pr.patient_id
           AND a.starts_at < $2
      )
    ),
    booking AS (
      SELECT lead_id, min(booked_at) AS booked_at, bool_or(attended) AS attended
      FROM (
        SELECT lc.id AS lead_id, g.starts_at AS booked_at, false AS attended
        FROM lead_contacts lc
        JOIN ghl_appointments g
          ON g.organisation_id = $1
         AND g.contact_id = lc.id
         AND g.starts_at >= lc.first_lead_at
         AND coalesce(g.status, '') NOT IN ('cancelled', 'invalid')
        UNION ALL
        SELECT lc.id, a.starts_at, (a.status = 'completed')
        FROM lead_contacts lc
        JOIN (SELECT DISTINCT lead_id, patient_id FROM matched) pr
          ON pr.lead_id = lc.id
        JOIN appointments a
          ON a.organisation_id = $1
         AND a.contact_id = pr.patient_id
         AND a.starts_at >= lc.first_lead_at
         AND coalesce(a.status, '') <> 'cancelled'
        UNION ALL
        SELECT lc.id, a.starts_at, (a.status = 'completed')
        FROM lead_contacts lc
        JOIN appointments a
          ON a.organisation_id = $1
         AND a.contact_id = lc.id
         AND a.starts_at >= lc.first_lead_at
         AND coalesce(a.status, '') <> 'cancelled'
      ) b
      GROUP BY lead_id
    )
    SELECT lc.id, lc.practice_id, lc.ad_campaign_id, lc.attribution_source,
           (agg.lead_id IS NOT NULL) AS converted,
           (agg.lead_id IS NOT NULL AND pv.lead_id IS NULL) AS is_new_patient,
           CASE WHEN lc.is_patient THEN 'self' ELSE agg.how END AS matched_by,
           lc.first_lead_at,
           agg.patient_id,
           bk.booked_at,
           coalesce(bk.attended, false) AS attended,
           lc.ghl_pipeline_id
    FROM lead_contacts lc
    LEFT JOIN agg         ON agg.lead_id = lc.id
    LEFT JOIN prior_visit pv ON pv.lead_id = lc.id
    LEFT JOIN booking     bk ON bk.lead_id = lc.id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ad_lead_conversions — add the booking stage between "enquired" and "became a
-- patient". The section could say a campaign was expensive but never where it
-- leaked: booking or attendance.
--
-- BOOKED = a GoHighLevel calendar booking, OR a Dentally appointment. The
-- Dentally arm probes the matched PATIENT record as well as the lead contact
-- itself, because only 52 ad-attributed contacts link to a Dentally appointment
-- by contact_id directly against 157 that resolve through the match. Dropping
-- that second probe collapses the signal.
--
-- BOTH ARMS EXCLUDE CANCELLATIONS and BOTH require the appointment to start AT
-- OR AFTER the person enquired. Without the second rule an existing patient who
-- enquired again counts as "booked" on a visit from two years ago, which is the
-- same class of error is_new_patient was added in 000142 to correct.
--
-- ATTENDED comes from Dentally ONLY. GoHighLevel has recorded 1,096 confirmed,
-- 15 cancelled and TWO noshow across its entire history — nobody updates those
-- statuses. So attended=false means UNKNOWN for a GHL-only booking, and the API
-- and UI must say so rather than reporting it as a no-show.
--
-- The return type changes, so this DROPs before CREATEing.
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- The GHL booking probe needs (org, contact) together; idx_ghl_appts_org_start
-- is on starts_at and cannot bound a per-contact lookup.
CREATE INDEX IF NOT EXISTS idx_ghl_appts_org_contact
  ON public.ghl_appointments (organisation_id, contact_id)
  WHERE contact_id IS NOT NULL;

DROP FUNCTION IF EXISTS ad_lead_conversions(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, practice_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, is_new_patient boolean, matched_by text,
  first_lead_at timestamptz, patient_contact uuid,
  booked_at timestamptz, attended boolean
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
    -- The booking stage. UNION ALL of three equi-joins, then one aggregate --
    -- never an OR'd join, which cannot use either index (the 000112 lesson).
    -- min() picks the earliest booking; bool_or() says whether ANY of the
    -- Dentally appointments was completed.
    booking AS (
      SELECT lead_id, min(booked_at) AS booked_at, bool_or(attended) AS attended
      FROM (
        -- GoHighLevel calendar. Contributes to booked, NEVER to attended.
        SELECT lc.id AS lead_id, g.starts_at AS booked_at, false AS attended
        FROM lead_contacts lc
        JOIN ghl_appointments g
          ON g.organisation_id = $1
         AND g.contact_id = lc.id
         AND g.starts_at >= lc.first_lead_at
         AND coalesce(g.status, '') NOT IN ('cancelled', 'invalid')
        UNION ALL
        -- Dentally, on the PATIENT record this person matched to.
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
        -- Dentally, on the lead contact itself. Not redundant with the arm
        -- above: a contact can hold appointments without ever matching a
        -- patient record.
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
           -- NULL from the aggregate means "no Dentally row at all", which is
           -- unknown, not attended. Coalescing to false here is safe only
           -- because the API layer reports attendance as unknown whenever
           -- booked_at came from GoHighLevel alone.
           coalesce(bk.attended, false) AS attended
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

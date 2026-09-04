-- ============================================================================
-- ad_lead_conversions — carry the resolved ad_id, LAST, for the ad_meta_funnel
-- join below. Everything else in this function is unchanged from 000146; see
-- that migration's header for why FIRST TOUCH, the match ladder, and the
-- plpgsql + EXECUTE ... USING shape all matter.
--
-- The return type changes, so this DROPs before CREATEing. ad_campaign_funnel
-- (000145) reads this function but selects its columns BY NAME and does not
-- select this one, so it is unaffected and does not need recreating — same
-- reasoning 000146 already relied on when it made the same kind of change.
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
  ghl_pipeline_id text,
  ad_id text
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
             (c.pms_external_id IS NOT NULL) AS is_patient,
             c.ad_id
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
           lc.ghl_pipeline_id,
           lc.ad_id
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

-- ---------------------------------------------------------------------------
-- ad_meta_funnel — the Facebook report's counts, at ad and ad-set grain.
--
-- Reads THROUGH ad_lead_conversions rather than re-deriving anything: booked,
-- attended, converted and is_new_patient keep ONE definition across every
-- grain. A second copy at ad grain would be two definitions of "booked" that
-- can silently disagree.
--
-- MULTI-TENANT (M2): a lead is a Meta lead because its ad_campaign_id
-- resolves inside THIS org's own Meta ad_metrics rows — a structural test,
-- applied via the `IN` clause in the WHERE below. That clause decides
-- whether a lead enters this funnel AT ALL; the ad_meta_ads LEFT JOIN
-- further down does a DIFFERENT job — naming which ad set a Meta lead
-- belongs to. Both tests are doing work: removing the `IN` clause on the
-- assumption "the join already restricts to Meta" is wrong, because a LEFT
-- JOIN cannot exclude rows — every lead carrying ANY campaign id, Google
-- included, would re-enter the funnel. It is deliberately NOT
-- `attribution_source = 'Paid Social'`, which is a GoHighLevel label: another
-- tenant's CRM may label it differently, or not at all, and the report would
-- render nothing while appearing to work.
--
-- AD SET BY ID, NOT NAME: contacts.ad_set_id is null for every row GoHighLevel
-- has ever sent, but ad_meta_ads.parent_id IS the ad set id. Joining a lead's
-- ad_id to ad_meta_ads.entity_id therefore names its ad set exactly, and
-- survives a rename. A lead with no resolvable ad set emits ad_set_id NULL —
-- the "not identified" bucket, which carries leads but never spend.
--
-- LEFT JOIN, not inner: a lead whose ad_id is absent from ad_meta_ads (the ad
-- is older than the 92-day window, or was deleted) must still be counted at
-- campaign grain rather than vanishing from the report.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_meta_funnel(
  p_org      uuid,
  p_since    timestamptz,
  p_until    timestamptz,
  p_practice uuid DEFAULT NULL
) RETURNS TABLE (
  campaign_id text, ad_set_id text, ad_id text, practice_id uuid,
  leads bigint, booked bigint, attended bigint,
  patients bigint, new_patients bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT f.ad_campaign_id                                   AS campaign_id,
           a.parent_id                                        AS ad_set_id,
           f.ad_id                                            AS ad_id,
           f.practice_id                                      AS practice_id,
           count(*)::bigint                                   AS leads,
           count(f.booked_at)::bigint                         AS booked,
           count(*) FILTER (WHERE f.attended)::bigint         AS attended,
           count(*) FILTER (WHERE f.converted)::bigint        AS patients,
           count(*) FILTER (WHERE f.is_new_patient)::bigint   AS new_patients
      FROM ad_lead_conversions($1, $2, $3, $4::uuid) f
      -- DISTINCT ON collapses the ad's day rows to one, so a lead is counted
      -- once however many days its ad ran.
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, parent_id
          FROM ad_meta_ads
         WHERE organisation_id = $1
         ORDER BY entity_id, metric_date DESC
      ) a ON a.entity_id = f.ad_id
     WHERE f.ad_campaign_id IS NOT NULL
       -- M2, the structural Meta test. Without this, the LEFT JOIN to
       -- ad_meta_ads cannot exclude anything and every lead carrying ANY
       -- campaign id enters this funnel: measured on live data, 11 Google
       -- campaigns and 50 campaigns from no known feed were being counted as
       -- Meta, diluting the coverage figure the page shows the tenant.
       -- Deliberately NOT scoped by date: whether a campaign is Meta is a
       -- question of provider identity, not of the reporting window.
       AND f.ad_campaign_id IN (
         SELECT m.campaign_id FROM ad_metrics m
          WHERE m.organisation_id = $1
            AND m.provider = 'meta_ads'
            AND m.campaign_id IS NOT NULL
       )
     GROUP BY f.ad_campaign_id, a.parent_id, f.ad_id, f.practice_id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_meta_funnel(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_meta_funnel(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

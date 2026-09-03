-- ============================================================================
-- 000152 — lead_report_aggregate(p_org, p_since, p_until, p_practice, p_account)
--
-- WHY. CRM Reports (`/crm-reports`) built every figure it shows — leads
-- received, the five-stage funnel, conversion %, FTA rate, pipeline value,
-- average first-response time, and the by-source and by-practice tables — by
-- fetching `GET /api/leads?limit=1000` and counting the rows in the browser.
--
-- `limit: 1000` reads as a deliberate, generous bound. It is not one.
-- Plan4growth has 22,807 leads, so the page rendered:
--
--     Leads received      1,000     (truth: 22,807 — 22x out)
--     FTA rate             0.00%    (truth: 0.08% — reported as zero)
--     Pipeline value       ~1/22 of the real figure
--
-- The conversion RATE happened to survive (2.20% against a true 2.16%) because
-- leads are homogeneous enough that the newest 1,000 resemble the whole. That
-- is luck, not design, and it did NOT hold on the Command Centre, where
-- recency correlates with conversion and the same pattern produced a permanent
-- 0.0%. A number that is right by luck is not right.
--
-- 1000 is also exactly PostgREST's row cap, so raising the Zod limit alone
-- would have changed nothing without paging. Aggregating in SQL removes the
-- ceiling entirely: this returns one row per (dimension, key), so the payload
-- is bounded by cardinality — a handful of sources and practices — no matter
-- how many leads a tenant accumulates.
--
-- SHAPE. One call returns all three groupings so the page makes a single round
-- trip and every table it draws is guaranteed to come from the same scan of
-- the same window:
--   dimension = 'all'      -> one row, the headline totals
--   dimension = 'source'   -> one row per lead source
--   dimension = 'practice' -> one row per practice (key_id + key name)
--
-- Response-time is returned as a SUM and a COUNT rather than a pre-computed
-- average, so the caller can average across groupings without averaging
-- averages (which weights a source with 3 leads the same as one with 3,000).
--
-- Tenant-scoped by p_org on the single scan. plpgsql + EXECUTE ... USING
-- because a LANGUAGE sql body with SECURITY DEFINER + SET search_path never
-- inlines and gets planned with p_org unknown (the generic-plan trap).
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS lead_report_aggregate(uuid, timestamptz, timestamptz, uuid, uuid);

CREATE FUNCTION lead_report_aggregate(
  p_org      uuid,
  p_since    timestamptz DEFAULT NULL,
  p_until    timestamptz DEFAULT NULL,
  p_practice uuid        DEFAULT NULL,
  p_account  uuid        DEFAULT NULL
)
RETURNS TABLE (
  dimension              text,
  key_id                 uuid,
  key                    text,
  total                  bigint,
  contacted              bigint,
  consult_booked         bigint,
  consult_attended       bigint,
  treatment_started      bigint,
  not_proceeding         bigint,
  failed_to_attend       bigint,
  converted_value_pence  bigint,
  pipeline_value_pence   bigint,
  response_minutes_sum   bigint,
  response_minutes_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH scoped AS (
      SELECT l.status,
             l.source,
             l.practice_id,
             coalesce(l.estimated_value_pence, 0) AS value_pence,
             l.last_response_minutes
      FROM leads l
      WHERE l.organisation_id = $1
        AND ($2 IS NULL OR l.created_at >= $2)
        AND ($3 IS NULL OR l.created_at <= $3)
        AND ($4 IS NULL OR l.practice_id = $4)
        AND ($5 IS NULL OR l.integration_account_id = $5)
    ),
    -- The stage predicates, written ONCE. Duplicating them per grouping is how
    -- a by-source table ends up disagreeing with the funnel above it.
    tagged AS (
      SELECT s.*,
             (s.status <> 'new')                                          AS is_contacted,
             (s.status IN ('consultation_booked', 'consultation_attended',
                           'treatment_started', 'treatment_completed'))    AS is_booked,
             (s.status IN ('consultation_attended', 'treatment_started',
                           'treatment_completed'))                        AS is_attended,
             (s.status IN ('treatment_started', 'treatment_completed'))    AS is_started,
             (s.status = 'not_proceeding')                                AS is_lost,
             (s.status = 'failed_to_attend')                              AS is_fta
      FROM scoped s
    ),
    agg AS (
      SELECT grouping_set.dimension                                        AS dimension,
             grouping_set.key_id                                           AS key_id,
             grouping_set.key                                              AS key,
             count(*)::bigint                                              AS total,
             count(*) FILTER (WHERE t.is_contacted)::bigint                AS contacted,
             count(*) FILTER (WHERE t.is_booked)::bigint                   AS consult_booked,
             count(*) FILTER (WHERE t.is_attended)::bigint                 AS consult_attended,
             count(*) FILTER (WHERE t.is_started)::bigint                  AS treatment_started,
             count(*) FILTER (WHERE t.is_lost)::bigint                     AS not_proceeding,
             count(*) FILTER (WHERE t.is_fta)::bigint                      AS failed_to_attend,
             coalesce(sum(t.value_pence) FILTER (WHERE t.is_started), 0)::bigint
                                                                           AS converted_value_pence,
             -- Pipeline value excludes leads that are no longer live.
             coalesce(sum(t.value_pence) FILTER (WHERE NOT t.is_lost), 0)::bigint
                                                                           AS pipeline_value_pence,
             coalesce(sum(t.last_response_minutes), 0)::bigint              AS response_minutes_sum,
             count(t.last_response_minutes)::bigint                        AS response_minutes_count
      FROM tagged t
      CROSS JOIN LATERAL (
        VALUES ('all'::text,      NULL::uuid,    ''::text),
               ('source'::text,   NULL::uuid,    coalesce(nullif(t.source, ''), 'Unattributed')),
               ('practice'::text, t.practice_id, NULL::text)
      ) AS grouping_set(dimension, key_id, key)
      GROUP BY 1, 2, 3
    )
    SELECT a.dimension,
           a.key_id,
           -- Resolve the practice name here rather than embedding practices in
           -- the read path: a PostgREST embed under serviceClient carries no
           -- org predicate. This join sits inside the org-scoped scan.
           CASE WHEN a.dimension = 'practice'
                THEN coalesce(pr.name, 'Unassigned')
                ELSE a.key END,
           a.total, a.contacted, a.consult_booked, a.consult_attended,
           a.treatment_started, a.not_proceeding, a.failed_to_attend,
           a.converted_value_pence, a.pipeline_value_pence,
           a.response_minutes_sum, a.response_minutes_count
    FROM agg a
    LEFT JOIN practices pr ON pr.id = a.key_id AND pr.organisation_id = $1
    ORDER BY 1, 4 DESC
  $q$ USING p_org, p_since, p_until, p_practice, p_account;
END;
$fn$;

-- Tenant data: service_role only, same as every other p_org RPC.
REVOKE ALL ON FUNCTION lead_report_aggregate(uuid, timestamptz, timestamptz, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lead_report_aggregate(uuid, timestamptz, timestamptz, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

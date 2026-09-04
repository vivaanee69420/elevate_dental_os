-- ============================================================================
-- 000151 — lead_funnel_counts + a NULL guard on settled_receipts_by_day.
--
-- WHY (1): the Command Centre lead funnel was computed IN THE BROWSER from
-- `GET /api/leads`, whose Zod default is `limit: 100` over an ORDER BY
-- created_at DESC. On Plan4growth that meant the funnel, the "N leads" header
-- and the headline conversion rate were all derived from the 100 newest leads
-- out of 1,388 in the window (22,768 in the org). Because the newest leads are
-- days old and have not converted yet, the page reported a permanent
-- **0.0% conversion** against a real 3.5%. The number was not merely
-- imprecise, it was structurally pinned to zero.
--
-- The second lead path was truncated too: `lead.repository.funnelRows` selected
-- every lead with no .limit(), so PostgREST's 1000-row cap silently applied
-- (the cap hits tables and set-returning RPCs alike — the recurring gotcha
-- behind the monthly_financials and ad_lead_conversions incidents).
--
-- An aggregate belongs in SQL. Counting rows in Node means shipping every row
-- to Node, which is exactly the pressure that produced both caps. This RPC
-- returns at most one row per status (9), so no cap can ever apply, no matter
-- how many leads a tenant accumulates.
--
-- WHY (2): settled_receipts_by_day guards its source filter with
--   cardinality(p_exclude_sources) = 0 or ...
-- With a NULL argument, cardinality(NULL) is NULL, the whole predicate is NULL,
-- and the function returns ZERO ROWS — a tenant's entire settled-receipts
-- revenue silently reads as £0 rather than failing. Today every caller goes
-- through groupReceiptExcludedSources(), which always returns an array, so the
-- trap is latent. It is one `?? null` away from being live, and a silent zero
-- on a revenue figure is the worst possible failure mode. coalesce() closes it.
--
-- Tenant-scoped by p_org. plpgsql + EXECUTE ... USING because a LANGUAGE sql
-- body with SECURITY DEFINER + SET search_path never inlines and gets planned
-- with p_org unknown (the generic-plan trap: 11.1s vs 55ms).
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS lead_funnel_counts(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION lead_funnel_counts(
  p_org      uuid,
  p_since    timestamptz DEFAULT NULL,
  p_until    timestamptz DEFAULT NULL,
  p_practice uuid        DEFAULT NULL
)
RETURNS TABLE (
  status      text,
  n           bigint,
  value_pence bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT l.status::text,
           count(*)::bigint,
           coalesce(sum(l.estimated_value_pence), 0)::bigint
    FROM leads l
    WHERE l.organisation_id = $1
      AND ($2 IS NULL OR l.created_at >= $2)
      AND ($3 IS NULL OR l.created_at <= $3)
      AND ($4 IS NULL OR l.practice_id = $4)
    GROUP BY l.status
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

-- Tenant data: service_role only, same as every other p_org RPC. An anon or
-- authenticated caller must never be able to pass an arbitrary p_org.
REVOKE ALL ON FUNCTION lead_funnel_counts(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lead_funnel_counts(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

-- The window + practice predicates this RPC filters on.
CREATE INDEX IF NOT EXISTS idx_leads_org_created_status
  ON public.leads (organisation_id, created_at DESC, status);

-- ----------------------------------------------------------------------------
-- NULL guard on settled_receipts_by_day. Body is otherwise byte-identical to
-- the live definition; only the cardinality() call gains a coalesce().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settled_receipts_by_day(
  p_org              uuid,
  p_since            timestamptz,
  p_practice         uuid        DEFAULT NULL,
  p_until            timestamptz DEFAULT NULL,
  p_exclude_sources  text[]      DEFAULT '{}'::text[]
)
RETURNS TABLE(day date, pence bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  select date_trunc('day', processed_at)::date as day,
         coalesce(sum(amount_pence), 0)::bigint as pence
  from public.payments
  where organisation_id = p_org
    and status = 'settled'
    and processed_at >= p_since
    and (p_until is null or processed_at <= p_until)
    and (p_practice is null or practice_id = p_practice)
    -- coalesce: a NULL p_exclude_sources must mean "exclude nothing", never
    -- "return no rows". See the header.
    and (coalesce(cardinality(p_exclude_sources), 0) = 0
         or coalesce(source, '') <> all(p_exclude_sources))
  group by 1
  order by 1;
$function$;

NOTIFY pgrst, 'reload schema';

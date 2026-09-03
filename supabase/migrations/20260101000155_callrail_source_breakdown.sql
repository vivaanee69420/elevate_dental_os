-- ============================================================================
-- callrail_source_breakdown — what CallRail itself attributes an org's calls
-- to, grouped and counted in SQL.
--
-- WHY AN RPC AND NOT A POSTGREST AGGREGATE SELECT: the first implementation
-- used `select=source,call_count:callrail_id.count()`. PostgREST aggregate
-- functions are DISABLED on this project — verified live against the hosted
-- REST endpoint, which answers `PGRST123: Use of aggregate functions is not
-- allowed` with HTTP 400. The rejection happens at parse time, BEFORE the
-- role check (the same request without aggregates gets a 401 instead), so
-- service_role hits it exactly as anon does. Every other aggregate in this
-- codebase is an RPC for the same reason; this one now matches.
--
-- LANGUAGE plpgsql with RETURN QUERY EXECUTE ... USING, not LANGUAGE sql:
-- a SECURITY DEFINER sql function with SET search_path never inlines, so the
-- planner builds a GENERIC plan with p_org UNKNOWN and picks a seq scan. The
-- EXECUTE ... USING shape re-plans per call with the real value. See the
-- rpc-generic-plan-trap note; it cost 11.1s vs 55ms on another RPC here.
--
-- Row volume is bounded by the number of DISTINCT source values an org's
-- calls carry — a handful of CallRail source names, never near PostgREST's
-- 1000-row cap. This is deliberately not paged.
--
-- MULTI-TENANT: p_org is the only scope. serviceClient bypasses RLS, so this
-- filter IS the tenant boundary.
-- Idempotent; re-applies cleanly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.callrail_source_breakdown(p_org uuid)
RETURNS TABLE (source text, call_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT c.source, count(*)::bigint AS call_count
      FROM callrail_calls c
     WHERE c.organisation_id = $1
     GROUP BY c.source
     ORDER BY count(*) DESC, c.source ASC NULLS LAST
  $q$ USING p_org;
END;
$fn$;

-- Mandatory grant idiom: a newly created function in public IS anon-executable
-- by default on this project. Only the backend's service_role may call it.
REVOKE ALL ON FUNCTION public.callrail_source_breakdown(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.callrail_source_breakdown(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

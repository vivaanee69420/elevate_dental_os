-- ============================================================================
-- Deep-grain writes, split so one account's window cannot outgrow the
-- statement timeout.
--
-- THE BUG: ad_grain_replace_window does the DELETE and the whole INSERT in one
-- statement, so its cost scales with the account's row count. Barnet's 92-day
-- keyword pull is 9,341 rows / 6.35 MB and does not finish in time; the pull
-- succeeds, the write dies, and the deep tables keep serving stale rows. The
-- deep sync is deliberately wrapped so it can never fail the campaign sync, so
-- the ONLY symptom was silence.
--
-- WHY THE FUNCTION'S OWN `SET LOCAL statement_timeout = '60s'` DID NOT SAVE IT:
-- it cannot. A GUC set inside a function applies to statements that START
-- after it, and the function call is itself one statement whose deadline was
-- fixed before its body ever ran. The binding limit is the LOGIN role's:
-- PostgREST connects as `authenticator` (statement_timeout 8s) and only SET
-- ROLEs to service_role, and role GUCs apply at session start, not at SET
-- ROLE. So `service_role` having no timeout of its own does not lift the cap —
-- ALTER ROLE service_role was measured on the live database and changed
-- nothing. Every one of these writes was really racing 8s, not 60s.
--
-- Raising the cap was rejected: the only lever that would bite is
-- `authenticator`, which is the login role for anon and authenticated browser
-- traffic too, and widening a browser-facing timeout to fix a nightly batch
-- write is the wrong trade. The write is made to fit instead.
--
-- THE SHAPE: delete once, then append in chunks the caller sizes.
--   ad_grain_delete_window(org, grain, customer_ids) — the destructive half,
--     unchanged in meaning and scoped exactly as before.
--   ad_grain_upsert_chunk(org, grain, rows)          — idempotent append.
-- Practice restamping is NOT done per chunk: ad_grain_restamp_practices(org)
-- already exists and scans the whole table, so running it per chunk would
-- multiply a fixed cost by the chunk count. The caller runs it once at the end.
--
-- WHAT THIS COSTS: the window replace is no longer a single transaction. A
-- failure between chunks leaves a partially refreshed window rather than an
-- untouched one. That is a deliberate trade — the alternative in force today
-- is no data at all for the affected account — and it is not silent: the
-- reconciliation endpoint compares deep-grain spend against the campaign-grain
-- total per platform, so a short window shows up there as a gap, and the next
-- nightly run replaces the window wholesale.
--
-- ad_grain_replace_window is left in place, unchanged, for callers that write
-- a small window in one shot.
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_grain_delete_window(
  p_org uuid, p_grain text, p_customer_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tbl text; prov text; n integer;
BEGIN
  tbl  := public._ad_grain_table(p_grain);
  prov := public._ad_grain_provider(p_grain);
  IF tbl IS NULL OR prov IS NULL THEN
    RAISE EXCEPTION 'ad_grain_delete_window: unknown grain %', p_grain;
  END IF;

  -- p_org is never a caller-supplied claim: the service passes
  -- req.user.organisation_id. It is still the only tenant boundary here, since
  -- service_role bypasses RLS.
  EXECUTE format(
    'DELETE FROM public.%I WHERE organisation_id = $1 AND provider = $2 AND customer_id = ANY($3)', tbl)
    USING p_org, prov, p_customer_ids;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.ad_grain_upsert_chunk(
  p_org uuid, p_grain text, p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tbl text; prov text; cols text; upd text; sel text; n integer;
BEGIN
  tbl  := public._ad_grain_table(p_grain);
  prov := public._ad_grain_provider(p_grain);
  IF tbl IS NULL OR prov IS NULL THEN
    RAISE EXCEPTION 'ad_grain_upsert_chunk: unknown grain %', p_grain;
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at');

  SELECT string_agg(format('%I = EXCLUDED.%I', column_name, column_name), ', ')
    INTO upd FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at','organisation_id',
                             'provider','customer_id','parent_id','entity_id','metric_date');

  SELECT string_agg(
           CASE WHEN is_nullable = 'NO' AND column_default IS NOT NULL
                THEN format('COALESCE(%I, %s) AS %I', column_name, column_default, column_name)
                ELSE quote_ident(column_name) END,
           ', ' ORDER BY ordinal_position)
    INTO sel FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at');

  -- The org and provider predicates inside the CTE are not decoration: rows
  -- arrive as caller-built JSON, and without them a row naming another
  -- organisation would be inserted verbatim.
  EXECUTE format($q$
    WITH src AS (
      SELECT DISTINCT ON (provider, customer_id, parent_id, entity_id, metric_date) %4$s
        FROM jsonb_populate_recordset(NULL::public.%1$I, $2)
       WHERE metric_date IS NOT NULL AND entity_id IS NOT NULL
         AND parent_id IS NOT NULL AND organisation_id = $1
         AND provider = $3
       ORDER BY provider, customer_id, parent_id, entity_id, metric_date
    )
    INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM src
    ON CONFLICT (organisation_id, provider, customer_id, parent_id, entity_id, metric_date)
    DO UPDATE SET %3$s
  $q$, tbl, cols, upd, sel) USING p_org, p_rows, prov;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

-- Background-worker functions. A browser JWT must never reach them: both write,
-- and one deletes.
REVOKE ALL ON FUNCTION public.ad_grain_delete_window(uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_delete_window(uuid, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.ad_grain_upsert_chunk(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_upsert_chunk(uuid, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

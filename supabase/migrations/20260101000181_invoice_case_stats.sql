-- ============================================================================
-- invoice_case_stats — the real case fee AND the real case volume, aggregated
-- in SQL so nothing is truncated, scoped to a practice and a window.
--
-- ============================================================================
-- WHY. `invoice_case_rollup` (000042) returns ONE ROW PER INVOICE and the
-- caller classifies them in Node. PostgREST caps a set-returning function at
-- 1000 rows exactly as it caps a table read, and that function has no ORDER BY,
-- so the workbench has been reading an ARBITRARY 1,000 of this organisation's
-- 8,816 invoices — 11% of them — and reporting the mean of whatever landed in
-- the slice as "the case fee from real Dentally invoices".
--
-- Measured at the point this was written, Full Arch over twelve months:
--
--     what the page said        11 invoices,  mean £7,785.06
--     what the data holds      163 invoices,  mean £6,028.06
--
-- A 29% overstatement of the one figure on that page that claimed to be
-- measured, presented beside a sample size that made it look well-founded.
-- Every figure downstream — net profit, margin, annual profit, target price —
-- inherited it.
--
-- ============================================================================
-- THE RULES STILL LIVE IN JAVASCRIPT. formulas.TREATMENT_CASE_RULES is the one
-- definition of what counts as a full arch, it is unit-tested against real
-- catalogue names, and duplicating those patterns here would be a second
-- definition free to drift from it. They are PASSED IN as jsonb instead:
--
--   [{"key":"fullarch","match":"all[ -]?on|full[ -]?arch","not":null}, ...]
--
-- so the aggregation happens where the rows are and the classification stays
-- where it is tested.
--
-- ============================================================================
-- WHAT IT ADDS BEYOND A BIGGER READ:
--   * p_practice — invoice_items carries practice_id on 43,962 of 43,963 rows,
--     and the fee genuinely differs by site (£4,221 at Bexleyheath against
--     £6,617 at Barnet, a 57% spread). An org-wide mean describes no practice.
--   * p_until — the workbench had a start date and no end, so it could never
--     answer "what did this look like last quarter".
--   * sample_size AND months_covered — so the caller can report REAL VOLUME.
--     The workbench's throughput was a hardcoded 1 surgery x 2 cases a month;
--     this organisation actually invoiced 163 full arches in a year.
--
-- MULTI-TENANT: p_org is filtered inside the function and is the only tenant
-- key. SECURITY DEFINER with the standard revoke: anon and authenticated get
-- nothing, service_role executes. (000042 granted EXECUTE to `authenticated`,
-- which is not repeated here.)
--
-- Idempotent + additive. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invoice_case_stats(
  p_org      uuid,
  p_since    date,
  p_until    date DEFAULT NULL,
  p_practice uuid DEFAULT NULL,
  p_rules    jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  key            text,
  sample_size    bigint,
  fee_pence      bigint,
  total_pence    bigint,
  first_invoiced date,
  last_invoiced  date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH inv AS (
    -- One row per invoice: its treatment names and its total. Grouping here
    -- rather than in the caller is the whole point — a case is billed across
    -- many lines, and the honest fee is the INVOICE total.
    SELECT ii.pms_invoice_id,
           array_agg(coalesce(ii.treatment_name, '')) AS names,
           coalesce(sum(ii.fee_pence), 0)::bigint     AS total_pence,
           min(ii.invoiced_on)                        AS invoiced_on
      FROM invoice_items ii
     WHERE ii.organisation_id = p_org
       AND ii.pms_invoice_id IS NOT NULL
       AND ii.invoiced_on >= p_since
       AND (p_until IS NULL OR ii.invoiced_on <= p_until)
       AND (p_practice IS NULL OR ii.practice_id = p_practice)
     GROUP BY ii.pms_invoice_id
  ),
  rules AS (
    SELECT r->>'key' AS key, r->>'match' AS match_re, r->>'not' AS not_re
      FROM jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) r
  )
  SELECT rl.key,
         count(*)::bigint,
         -- The mean INVOICE total, which is the case fee. Rounded to whole
         -- pence: money is an integer everywhere in this system.
         round(avg(i.total_pence))::bigint,
         sum(i.total_pence)::bigint,
         min(i.invoiced_on),
         max(i.invoiced_on)
    FROM rules rl
    JOIN inv i
      ON i.total_pence > 0
     AND EXISTS (
           SELECT 1 FROM unnest(i.names) AS nm
            WHERE nm ~* rl.match_re
              AND (rl.not_re IS NULL OR NOT (nm ~* rl.not_re))
         )
   GROUP BY rl.key;
$fn$;

REVOKE ALL ON FUNCTION public.invoice_case_stats(uuid, date, date, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_case_stats(uuid, date, date, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.invoice_case_stats(uuid, date, date, uuid, jsonb) IS
  'Mean invoice total (the case fee) and invoice COUNT per treatment category, '
  'aggregated in SQL so a 1000-row PostgREST cap cannot truncate it — the '
  'per-invoice predecessor read an arbitrary 1,000 of 8,816 invoices and '
  'overstated the Full Arch fee by 29%. Match rules are passed in as jsonb so '
  'formulas.TREATMENT_CASE_RULES stays the single definition. Scopes by '
  'practice and by an inclusive [p_since, p_until] window.';

-- The window + practice predicate this function filters on.
CREATE INDEX IF NOT EXISTS invoice_items_org_invoiced_practice_idx
  ON public.invoice_items (organisation_id, invoiced_on, practice_id)
  WHERE pms_invoice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

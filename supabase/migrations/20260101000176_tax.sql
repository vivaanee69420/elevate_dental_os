-- ===========================================================================
-- UK tax: per-organisation settings, per-tax-year rates, and the VAT liability
-- mapping.
--
-- THREE TABLES, AND THE SPLIT IS THE POINT.
--
-- 1. tax_rates is GLOBAL, not org-scoped. HMRC's rates are the same for every
--    tenant, and copying them per org would let two sub-accounts disagree about
--    the law. Keyed by regime + tax year so a figure is never a constant in
--    application code: rates change every April, and a hardcoded rate goes
--    silently wrong the following spring while still rendering confidently.
--    Pattern follows the LMS module library, which is also global reference
--    data with no organisation_id.
--
-- 2. tax_settings is per ORG, because each sub-account is its own legal entity.
--    Entity type decides the whole regime — a limited company pays Corporation
--    Tax, a sole trader or partnership pays Income Tax and Class 4 NIC — so
--    this cannot be a group-level setting.
--
-- 3. vat_treatment_liability is per org and EXPLICIT, with no default.
--
-- WHY THERE IS NO DEFAULT LIABILITY. Dental care by a registered professional
-- is EXEMPT under VATA 1994 Sch 9 Grp 7 (not zero-rated: input VAT on those
-- costs is irrecoverable, which is why practices sit in partial exemption).
-- Dental prostheses are exempt too, in the hands of a registered dentist or a
-- dental technician (VATHLT2450).
--
-- But cosmetic dentistry is NOT automatically standard-rated. HMRC VATHLT2480
-- treats it as a single supply of exempt healthcare where it forms part of a
-- course of dental treatment, states that "it is rare for dental work to be
-- done purely for cosmetic reasons", and requires each case to be considered
-- on its own facts. The same whitening is exempt beside a treatment plan and
-- standard-rated sold on its own — no name rule can tell them apart, so the
-- practice states it and unmapped revenue is reported AS unmapped.
--
-- Sources (fetched September 2026):
--   https://www.gov.uk/corporation-tax-rates
--   https://www.gov.uk/guidance/corporation-tax-marginal-relief
--   https://www.gov.uk/how-vat-works/vat-thresholds
--   https://www.gov.uk/guidance/health-professionals-pharmaceutical-products-and-vat-notice-70157
--   https://www.gov.uk/hmrc-internal-manuals/vat-health/vathlt2450
--   https://www.gov.uk/hmrc-internal-manuals/vat-health/vathlt2480
--   https://www.gov.uk/guidance/partial-exemption-vat-notice-706
-- ===========================================================================

-- ── 1. rates, by regime and tax year ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_rates (
  regime      text NOT NULL,          -- 'corporation_tax' | 'vat' | 'income_tax' | 'nic'
  tax_year    text NOT NULL,          -- 'FY2026' for CT financial years, '2026-27' for tax years
  starts_on   date NOT NULL,
  ends_on     date,                   -- NULL = still current; a rate with no end has not been superseded
  rates       jsonb NOT NULL,         -- regime-specific; integer pence for money, percent for rates
  source_url  text,                   -- the HMRC page the figures came from, so they can be re-checked
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (regime, tax_year)
);

COMMENT ON TABLE public.tax_rates IS
  'HMRC rates and thresholds by regime and tax year. Global reference data: identical for every tenant. Money in integer pence.';

-- ── 2. per-organisation tax settings ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_settings (
  organisation_id      uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- The fork in the road: Corporation Tax vs Income Tax + Class 4 NIC.
  -- NULL means "not told yet", which the app must render as unknown rather
  -- than assuming the commoner case and quoting the wrong regime.
  entity_type          text CHECK (entity_type IN ('limited_company', 'sole_trader', 'partnership', 'llp')),
  vat_registered       boolean NOT NULL DEFAULT false,
  vat_number           text,
  vat_scheme           text CHECK (vat_scheme IN ('standard', 'cash', 'flat_rate', 'annual')),
  vat_stagger          smallint CHECK (vat_stagger BETWEEN 1 AND 3),  -- which quarter-end group
  -- Prices as quoted to patients. A practice listing "Whitening £300" is
  -- quoting VAT-INCLUSIVE, and charging 20% on top would overstate the
  -- liability by a fifth.
  prices_include_vat   boolean NOT NULL DEFAULT true,
  -- Accounting period end (day/month). CT is due 9 months + 1 day after it,
  -- the return 12 months after — two different dates.
  year_end_day         smallint CHECK (year_end_day BETWEEN 1 AND 31),
  year_end_month       smallint CHECK (year_end_month BETWEEN 1 AND 12),
  -- CT limits are DIVIDED by the number of associated companies. A group of
  -- five practice companies has a GBP 10,000 lower limit, not 50,000, which
  -- changes the band. Defaults to 1 = the company itself.
  associated_companies smallint NOT NULL DEFAULT 1 CHECK (associated_companies >= 1),
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 3. VAT liability per treatment, explicit ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.vat_treatment_liability (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- The invoice line description as it arrives from the PMS. Practices name
  -- their own treatments, so this is the tenant's own vocabulary, never a
  -- shared code list.
  description     text NOT NULL,
  liability       text NOT NULL CHECK (liability IN ('exempt', 'standard', 'outside_scope')),
  -- Free text for the reason, because HMRC requires each cosmetic case to be
  -- justified on its own facts and the practice will need that reasoning at
  -- an inspection.
  note            text,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, description)
);

CREATE INDEX IF NOT EXISTS idx_vat_treatment_liability_org
  ON public.vat_treatment_liability (organisation_id, liability);

ALTER TABLE public.tax_rates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_treatment_liability ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tax_rates               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tax_settings            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vat_treatment_liability FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.tax_rates               TO service_role;
GRANT ALL ON public.tax_settings            TO service_role;
GRANT ALL ON public.vat_treatment_liability TO service_role;

-- ── seed: figures verified against HMRC, September 2026 ────────────────────
-- ON CONFLICT DO NOTHING so re-applying never silently overwrites a rate an
-- operator has corrected by hand.
INSERT INTO public.tax_rates (regime, tax_year, starts_on, ends_on, rates, source_url) VALUES
  ('corporation_tax', 'FY2026', '2026-04-01', NULL, jsonb_build_object(
      'smallProfitsRatePct', 19,
      'mainRatePct', 25,
      'lowerLimitPence', 5000000,          -- GBP 50,000
      'upperLimitPence', 25000000,         -- GBP 250,000
      'marginalReliefFraction', jsonb_build_array(3, 200)
   ), 'https://www.gov.uk/corporation-tax-rates'),

  ('vat', '2026-27', '2026-04-01', NULL, jsonb_build_object(
      'standardRatePct', 20,
      'reducedRatePct', 5,
      'registrationThresholdPence', 9000000,   -- GBP 90,000 taxable turnover, rolling 12 months
      'deregistrationThresholdPence', 8800000, -- GBP 88,000
      -- Partial exemption de minimis (VAT Notice 706): BOTH tests must pass —
      -- exempt input tax no more than GBP 625/month on average AND no more
      -- than 50% of total input tax.
      'deMinimisMonthlyPence', 62500,
      'deMinimisSharePct', 50
   ), 'https://www.gov.uk/how-vat-works/vat-thresholds')
ON CONFLICT (regime, tax_year) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── revenue by treatment, for the VAT split ────────────────────────────────
-- An RPC because invoice_items is 50k rows for one org and PostgREST truncates
-- a table read at 1000 IN SILENCE. This collapses to one row per treatment
-- name (730 for the largest org today), which the repository still pages.
--
-- plpgsql + RETURN QUERY EXECUTE ... USING, never LANGUAGE sql: a SECURITY
-- DEFINER sql function with SET search_path is never inlined, so the planner
-- sees p_org as UNKNOWN and picks a generic plan — measured at 11.1s against
-- 55ms for the same query planned with the value.
--
-- p_org is a PARAMETER, never a session value: it is the tenant boundary, and
-- the caller passes req.user.organisation_id which it never takes from a body.
CREATE OR REPLACE FUNCTION public.tax_revenue_by_treatment(
  p_org uuid, p_since date, p_until date, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (treatment_name text, fee_pence bigint, line_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT ii.treatment_name,
           SUM(ii.fee_pence)::bigint,
           COUNT(*)::bigint
      FROM public.invoice_items ii
     WHERE ii.organisation_id = $1
       AND ii.invoiced_on >= $2
       AND ii.invoiced_on <= $3          -- INCLUSIVE, matching every other
                                          -- date-window reader in this codebase
       AND ($4 IS NULL OR ii.practice_id = $4)
     GROUP BY ii.treatment_name
     ORDER BY SUM(ii.fee_pence) DESC, ii.treatment_name
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$$;

REVOKE ALL ON FUNCTION public.tax_revenue_by_treatment(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tax_revenue_by_treatment(uuid, date, date, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

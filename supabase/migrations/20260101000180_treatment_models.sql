-- ============================================================================
-- treatment_models — the owner's own treatment economics, saved.
--
-- WHY THIS EXISTS. The Treatment Economics Workbench has been a calculator with
-- no memory since it shipped: `workbench-api.ts` says so in its own header —
-- "no persistence yet". The model lives in React state, is POSTed to a pure
-- compute endpoint, and is gone on refresh. An owner could spend ten minutes
-- entering their real lab bill, component costs and clinician split, close the
-- tab, and have nothing.
--
-- The three models it opens with (Full Arch, Single Implant, Invisalign) are
-- hardcoded in formulas.js as DEFAULT_SERVICE_MODELS and are identical for
-- every tenant. They stay exactly where they are: this table holds an
-- ORGANISATION'S DEPARTURES from them, plus any treatment it invents.
--
-- ============================================================================
-- THE COSTS HERE CANNOT COME FROM A FEED, WHICH IS THE POINT.
--
-- Dentally sends what the PATIENT PAID and never what the work COST — no
-- supplier price, no lab invoice, no component cost. QuickBooks has costs but
-- only at company level, never per case. So lab_bill_pence, the component
-- table, surgery_run_cost_pence and utilities_pence are owner knowledge and
-- exist nowhere else in this system. Losing them on a page refresh was losing
-- the only copy.
--
-- price_pence is the exception and is seeded, not invented: the workbench reads
-- a real mean case fee from Dentally invoices (treatmentFeeBenchmarks). An
-- owner may still override it here, which is why it is stored.
--
-- ============================================================================
-- `key` AND WHAT IT MEANS.
--   * A row whose key is 'fullarch' / 'implant' / 'invisalign' OVERRIDES that
--     built-in. Deleting the row restores the default — that is the whole
--     "reset" mechanism, no flags and no second code path.
--   * Any other key is a treatment this organisation invented. is_custom marks
--     it so the API can refuse to "reset" something that has no default to fall
--     back to, and would simply vanish.
--
-- MULTI-TENANT: organisation_id on every row, part of the unique key, and every
-- read is filtered by it. serviceClient bypasses RLS, so that explicit filter
-- IS the isolation (see CLAUDE.md). RLS on with no policy: anon/authenticated
-- get nothing, service_role bypasses.
--
-- Idempotent + additive. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.treatment_models (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  -- Stable slug. Matches a DEFAULT_SERVICE_MODELS key to override it, or is a
  -- new slug for a treatment this organisation invented.
  key                     text NOT NULL,
  label                   text NOT NULL,
  -- Whether a "case" or a single "implant" is the unit the economics are per.
  unit                    text NOT NULL DEFAULT 'case',

  -- Money, integer pence throughout (project rule 2 — never floats).
  price_pence             bigint NOT NULL DEFAULT 0,
  cbct_pence              bigint NOT NULL DEFAULT 0,
  utilities_pence         bigint NOT NULL DEFAULT 0,
  surgery_run_cost_pence  bigint NOT NULL DEFAULT 0,
  lab_bill_pence          bigint NOT NULL DEFAULT 0,

  -- Percentages, stored as whole numbers (40 = 40%), matching the compute.
  marketing_pct           numeric(6,2) NOT NULL DEFAULT 0,
  lab_margin_pct          numeric(6,2) NOT NULL DEFAULT 0,
  dentist_pct             numeric(6,2) NOT NULL DEFAULT 0,
  target_margin_pct       numeric(6,2) NOT NULL DEFAULT 0,

  -- Throughput.
  surgeries               integer NOT NULL DEFAULT 1,
  cases_per_surgery       integer NOT NULL DEFAULT 1,
  implants_per_patient    integer NOT NULL DEFAULT 1,

  -- The lab / implant parts table: [{ name, qty, retailPence, costPence }].
  -- JSONB rather than a child table on purpose. These rows have no identity of
  -- their own, are never queried across treatments, are always read and written
  -- as one list, and are short. A child table would buy referential integrity
  -- nobody needs and cost a join on every read.
  components              jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- False = an override of a built-in (deleting restores the default).
  -- True  = this organisation's own treatment (deleting removes it for good).
  is_custom               boolean NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT treatment_models_org_key_key UNIQUE (organisation_id, key),

  -- A slug, not free text: it addresses a row in the API path.
  CONSTRAINT treatment_models_key_shape CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,48}$'),
  CONSTRAINT treatment_models_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  CONSTRAINT treatment_models_unit_chk CHECK (unit IN ('case', 'implant')),

  -- Percentages are percentages. A dentist_pct of 4000 would not error
  -- anywhere downstream, it would just quietly report a catastrophic loss.
  CONSTRAINT treatment_models_pct_range CHECK (
    marketing_pct     BETWEEN 0 AND 100 AND
    lab_margin_pct    BETWEEN 0 AND 100 AND
    dentist_pct       BETWEEN 0 AND 100 AND
    target_margin_pct BETWEEN 0 AND 100
  ),
  -- Money never negative; a negative cost would read as income.
  CONSTRAINT treatment_models_money_positive CHECK (
    price_pence >= 0 AND cbct_pence >= 0 AND utilities_pence >= 0 AND
    surgery_run_cost_pence >= 0 AND lab_bill_pence >= 0
  ),
  -- Throughput divides into per-case figures, so zero is a division by zero
  -- and the cap stops a fat finger producing a fantasy annual profit.
  CONSTRAINT treatment_models_throughput CHECK (
    surgeries BETWEEN 1 AND 100 AND
    cases_per_surgery BETWEEN 1 AND 1000 AND
    implants_per_patient BETWEEN 1 AND 100
  ),
  -- The components column is a LIST. A bare object or a string here would
  -- reach the compute and be iterated as though it were rows.
  CONSTRAINT treatment_models_components_array CHECK (jsonb_typeof(components) = 'array')
);

CREATE INDEX IF NOT EXISTS treatment_models_org_idx
  ON public.treatment_models (organisation_id);

ALTER TABLE public.treatment_models ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.treatment_models IS
  'Per-organisation treatment economics for the Treatment Economics Workbench. '
  'A row keyed to a DEFAULT_SERVICE_MODELS slug OVERRIDES that built-in and '
  'deleting it restores the default; any other key is a treatment the '
  'organisation invented (is_custom). Lab, component and surgery costs exist '
  'in no feed — Dentally sends patient fees only and QuickBooks is company-level '
  '— so these rows are the only copy of them.';

-- updated_at maintained in the database rather than by every caller: a service
-- that forgets it makes the column silently useless.
CREATE OR REPLACE FUNCTION public.treatment_models_touch()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS treatment_models_touch_trg ON public.treatment_models;
CREATE TRIGGER treatment_models_touch_trg
  BEFORE UPDATE ON public.treatment_models
  FOR EACH ROW EXECUTE FUNCTION public.treatment_models_touch();

NOTIFY pgrst, 'reload schema';

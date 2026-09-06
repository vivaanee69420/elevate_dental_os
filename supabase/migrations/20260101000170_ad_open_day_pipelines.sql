-- ===========================================================================
-- ad_open_day_pipelines — which GHL pipelines feed which open day.
--
-- Spend comes from ad_open_day_campaigns; LEADS come from here. Every Facebook
-- lead reaches this system through GoHighLevel, so the pipeline is the
-- authority on which event a lead belongs to. Measured on live data, 237 of an
-- open day's 432 leads carry no Meta attribution at all and are invisible to a
-- Meta-attributed pool.
--
-- The primary key is the partition guarantee, exactly as on the campaign
-- table: a pipeline belongs to at most ONE open day, so "always-on" is exactly
-- "not mapped to an event".
--
-- integration_account_id is in the key because GHL pipeline ids are unique
-- only within a Location, and the same pipeline NAME exists in several
-- subaccounts ("2. Facebook Ads Leads" appears three times for this org).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.ad_open_day_pipelines (
  organisation_id        uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  open_day_id            uuid NOT NULL,
  integration_account_id uuid NOT NULL,
  ghl_pipeline_id        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, integration_account_id, ghl_pipeline_id),
  FOREIGN KEY (organisation_id, open_day_id)
    REFERENCES public.ad_open_days (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ad_open_day_pipelines_event
  ON public.ad_open_day_pipelines (open_day_id);

ALTER TABLE public.ad_open_day_pipelines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_open_day_pipelines FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_open_day_pipelines TO service_role;

NOTIFY pgrst, 'reload schema';

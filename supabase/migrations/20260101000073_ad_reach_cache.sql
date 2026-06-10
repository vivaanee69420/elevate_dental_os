-- Per-window reach/frequency cache for live Meta queries.
--
-- Reach is deduplicated unique people over a window and cannot be summed from
-- the daily ad_metrics rows (see migration 000072). The marketing read paths
-- need the EXACT figure for whatever window the user is viewing (this month, a
-- custom range, ...), which only Meta can answer when queried for that exact
-- window (level=account, no time_increment). To avoid hitting the Graph API on
-- every page load, each (account, window) result is cached here with a fetched_at
-- timestamp; lib/integrations/meta-reach.js serves a cache hit within the TTL
-- and otherwise re-queries Meta and upserts.
--
-- One row per (organisation, provider, account, window). Org-isolated the same
-- way as ad_metrics (serviceClient + explicit organisation_id filter).

CREATE TABLE IF NOT EXISTS public.ad_reach_cache (
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider        TEXT        NOT NULL,
  customer_id     TEXT        NOT NULL,
  window_start    DATE        NOT NULL,
  window_end      DATE        NOT NULL,
  reach           BIGINT,
  frequency       NUMERIC,
  impressions     BIGINT,
  spend_pence     BIGINT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, provider, customer_id, window_start, window_end)
);

NOTIFY pgrst, 'reload schema';

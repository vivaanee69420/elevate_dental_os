-- ============================================================================
-- google_clicks — the click behind a lead, captured from Google's click_view.
--
-- WHY THIS TABLE EXISTS. Migration 000165 ties a Google lead to a CAMPAIGN, by
-- matching the campaign NAME CallRail stamps on a call, or the gad_campaignid
-- GoHighLevel recovers from the landing-page URL. Its header states plainly
-- that ad-grain attribution is not reachable "until it is built", and carries
-- the gclid through so the lookup has somewhere to land. This is that lookup.
--
-- ============================================================================
-- MEASURED AGAINST THE LIVE API BEFORE A LINE OF THIS WAS WRITTEN.
-- Probe: customers 6110644137 / 9010336897 / 6846708190, 2026-08-31, 159
-- clicks. Same discipline as google-ads-deep-sync.js's metric table — guessing
-- that one cost a real pull.
--
--   SELECTABLE on click_view:  click_view.gclid, click_view.ad_group_ad,
--     click_view.keyword, click_view.keyword_info.text, click_view.page_number,
--     click_view.campaign_location_target, click_view.area_of_interest.city,
--     plus attributed campaign.* and ad_group.* .
--   REJECTED (UNRECOGNIZED_FIELD): click_view.gbraid, click_view.wbraid.
--
--   WHAT COMES BACK, BY CAMPAIGN TYPE:
--                      clicks   ad group   ad    keyword
--       SEARCH            70       70      70      70
--       PERFORMANCE_MAX   89        0       0       0
--
-- So a Search click resolves to the individual ad and the bid keyword, every
-- time, and a Performance Max click resolves to the campaign and stops there.
-- That is not a gap in this code and it is not something a later version fixes:
-- PMax has no ad groups and no ads, it has asset groups. Reporting it as
-- missing data would be reporting Google's product as a defect — the same
-- judgement 000165 already made about PMax having no keywords.
--
-- THE '0' SENTINEL, which is the trap in this feed. A PMax click does not omit
-- ad_group — it returns `ad_group: { id: '0' }`. Stored raw, every PMax click
-- would carry a real-looking ad group id of 0, every one of them would collide
-- into a single fictional ad group, and a drill-down would confidently show 89
-- clicks against a thing that does not exist. The sync normalises '0' to NULL
-- and the CHECK below is the second line of defence.
--
-- ============================================================================
-- THIS TABLE ACCUMULATES. IT IS NEVER REPLACED. Note that this is the exact
-- OPPOSITE of the convention in 000148's deep-grain tables, which wipe and
-- reinsert a rolling 92-day window on every sync, and the difference is not
-- stylistic:
--
--   * ad_metrics and the deep-grain tables hold data Google will re-serve on
--     demand, for any window, forever. Replacing is safe there and keeps the
--     tables from growing without bound.
--   * click_view retains 90 DAYS. Once a click ages out, Google will never
--     hand it back. A row here is the ONLY copy that will ever exist.
--
-- So this table is an archive that outlives its source. A click captured today
-- still names its ad in five years. The corollary is unavoidable and worth
-- stating where someone will read it: the clock starts the day the sync first
-- runs. Leads whose clicks are already older than 90 days at that moment are
-- permanently unresolvable at ad grain. Nothing built later recovers them.
--
-- Volume is small — this org runs ~160 clicks/day across three accounts, so
-- ~58k rows/year — and unbounded growth is the point, not an oversight.
--
-- ============================================================================
-- WHAT IS DELIBERATELY NOT HERE.
--
-- No practice_id. The deep-grain tables carry one because their rows describe
-- SPEND, which belongs to the account that spent it. A click's practice is a
-- fact about the LEAD it produced, and the ledger already resolves that from
-- the lead's own routing. A second practice column here would be a second
-- answer to one question, free to disagree with the first — the asymmetry
-- documented in facebook-report.service.js, and not one to reproduce.
--
-- No gbraid/wbraid column. Not selectable (probed above), so iOS/privacy
-- clicks that carry gbraid instead of a gclid cannot be looked up by any route
-- this API offers. They stay unattributed and are counted as such rather than
-- guessed at.
--
-- MULTI-TENANT: every row carries organisation_id. serviceClient bypasses RLS,
-- so the explicit organisation_id filter IS the isolation (see CLAUDE.md).
-- RLS enabled with no policy: anon/authenticated get nothing, service_role
-- bypasses. Idempotent + additive. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.google_clicks (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id     text NOT NULL,
  gclid           text NOT NULL,
  click_date      date NOT NULL,
  campaign_id     text,
  campaign_name   text,
  -- Google's own word for what kind of campaign this was (SEARCH,
  -- PERFORMANCE_MAX, DISPLAY…). Stored so "why has this click no ad?" is
  -- answerable from the row itself, rather than inferred from a campaign name
  -- that happens to contain "PMAX" — which is a naming convention of one
  -- advertiser, not a fact about the campaign.
  channel_type    text,
  ad_group_id     text,
  ad_id           text,
  keyword_id      text,
  keyword_text    text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- The identity. A gclid is globally unique and belongs to exactly one click,
  -- so this is a natural key, not a synthesised one — no normalisation
  -- required and none of the hazards of 000149's content hash.
  CONSTRAINT google_clicks_org_gclid_key UNIQUE (organisation_id, gclid),

  -- The '0' sentinel, refused at the boundary. See the header.
  CONSTRAINT google_clicks_no_zero_ids CHECK (
    ad_group_id <> '0' AND ad_id <> '0' AND keyword_id <> '0' AND campaign_id <> '0'
  ),

  -- An ad or a keyword without the ad group it sits in would be an orphan the
  -- ledger cannot place in the hierarchy. Google never sends one without the
  -- other; this says so out loud.
  CONSTRAINT google_clicks_ad_needs_group CHECK (
    (ad_id IS NULL AND keyword_id IS NULL) OR ad_group_id IS NOT NULL
  )
);

-- The ledger joins leads to clicks on (organisation_id, gclid); the UNIQUE
-- constraint above already covers that exactly, so no second index for it.

-- Sync bookkeeping: "what is the newest click I hold for this account", which
-- is how the nightly run decides where to resume.
CREATE INDEX IF NOT EXISTS google_clicks_org_customer_date_idx
  ON public.google_clicks (organisation_id, customer_id, click_date DESC);

ALTER TABLE public.google_clicks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.google_clicks IS
  'One row per Google Ads click, keyed by gclid, from the click_view resource. '
  'ACCUMULATES AND IS NEVER REPLACED: click_view retains only 90 days, so each '
  'row is the only copy that will ever exist. Joined to leads by gclid to give '
  'ad-group / ad / keyword attribution. PMax clicks carry campaign only.';

-- ---------------------------------------------------------------------------
-- Chunked writer, same shape as ad_grain_upsert_chunk (000160): one statement
-- per chunk instead of one per row, which is what keeps a 90-day backfill from
-- becoming 14,000 round trips.
--
-- ON CONFLICT DO NOTHING, never DO UPDATE. A click is immutable — it happened,
-- at a moment, on one ad — so a re-pull of the same day returns byte-identical
-- facts and there is nothing to update. This also makes the nightly overlap
-- window free: re-fetching days we already hold costs one no-op statement.
--
-- The consequence, stated because it is not obvious: if a column is ever ADDED
-- to this table, re-running the sync will NOT backfill it on rows already
-- present. That would need a deliberate one-off, and it is only possible at all
-- inside Google's 90-day window.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.google_clicks_upsert_chunk(p_org uuid, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE inserted integer;
BEGIN
  WITH src AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      customer_id text, gclid text, click_date date,
      campaign_id text, campaign_name text, channel_type text,
      ad_group_id text, ad_id text, keyword_id text, keyword_text text
    )
  ),
  ins AS (
    INSERT INTO public.google_clicks (
      organisation_id, customer_id, gclid, click_date,
      campaign_id, campaign_name, channel_type,
      ad_group_id, ad_id, keyword_id, keyword_text
    )
    -- p_org, never a value from the payload: the org is the caller's, and a
    -- row that could name its own tenant is a cross-org write waiting to
    -- happen (see docs/ISOLATION_AUDIT.md).
    SELECT p_org, s.customer_id, s.gclid, s.click_date,
           nullif(s.campaign_id, '0'), s.campaign_name, s.channel_type,
           nullif(s.ad_group_id, '0'), nullif(s.ad_id, '0'),
           nullif(s.keyword_id, '0'), s.keyword_text
      FROM src s
     WHERE s.gclid IS NOT NULL AND s.gclid <> '' AND s.click_date IS NOT NULL
    ON CONFLICT (organisation_id, gclid) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO inserted FROM ins;
  RETURN inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.google_clicks_upsert_chunk(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_clicks_upsert_chunk(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Coverage, for the Integrations reconciliation panel and for answering "is
-- this working" without a hand-written query. Counts the org's clicks and how
-- many reach each grain, over a window.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.google_clicks_coverage(
  p_org uuid, p_since date, p_until date
) RETURNS TABLE (
  channel_type text, clicks bigint, with_ad_group bigint, with_ad bigint, with_keyword bigint,
  first_click date, last_click date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(c.channel_type, 'UNKNOWN'),
         count(*)::bigint,
         count(c.ad_group_id)::bigint,
         count(c.ad_id)::bigint,
         count(c.keyword_id)::bigint,
         min(c.click_date), max(c.click_date)
    FROM public.google_clicks c
   WHERE c.organisation_id = p_org
     AND c.click_date >= p_since AND c.click_date <= p_until
   GROUP BY coalesce(c.channel_type, 'UNKNOWN')
   ORDER BY 2 DESC;
$fn$;

REVOKE ALL ON FUNCTION public.google_clicks_coverage(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_clicks_coverage(uuid, date, date) TO service_role;

NOTIFY pgrst, 'reload schema';

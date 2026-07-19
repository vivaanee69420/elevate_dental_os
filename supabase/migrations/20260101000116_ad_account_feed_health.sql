-- ============================================================================
-- ad_account_feed_health — per (provider, customer_id) feed staleness for the
-- ad-attribution mapping-health endpoint.
--
-- WHY THIS EXISTS (real incident, do not lose this in a later refactor):
-- Plan4growth's Meta Ads feed stopped delivering on 2025-12-17 — 214 days
-- stale, zero Meta spend in the whole of 2026 as of this writing. Every one
-- of its four Meta accounts is correctly mapped to a practice, so the
-- existing /mapping-health response reports them as healthy: mapping
-- completeness and feed health are different questions, and until now only
-- the first was answered. The page's cost metrics correctly read "Not
-- reporting" (the incompleteSpendAcross guard in ad-attribution.service.js
-- refuses to divide Google-only spend across Google+Meta leads), but nothing
-- told the operator WHY — this function is what makes the dead feed visible.
--
-- `ad_accounts.period_synced_at` / `period_window_end` MUST NOT be used for
-- this, and this function deliberately ignores them. Verified against live
-- data: the same Meta accounts show `period_synced_at = 2026-06-19` while
-- their last actual metric row is `2025-12-17` — those columns record that a
-- sync RAN and the window it ASKED for, not what came back. One account
-- (`GM - FTS`, customer_id `1060844431253899`) shows a clean sync through
-- June 2026 and has ZERO metric rows ever; trusting period_synced_at would
-- report that dead feed as healthy, which is the exact failure this function
-- exists to prevent. The only trustworthy signal is the metrics actually
-- landed in `ad_metrics`.
--
-- An account with no ad_metrics rows at all simply does not appear in the
-- result set — the calling service treats a missing entry as "never
-- reported", a different and worse state than "stale", so this function must
-- not synthesize a row (e.g. via a LEFT JOIN to ad_accounts) for it.
--
-- days_stale is computed here in SQL, not recomputed from a JS `Date` in the
-- service — that keeps the wall clock out of JavaScript entirely, so the
-- service stays a pure mapping and its tests are deterministic regardless of
-- when they run.
--
-- SECURITY DEFINER with a pinned search_path, and p_org is applied as a
-- filter INSIDE the function — the caller cannot widen it. Matches
-- ad_channel_pipeline_lead_counts (migration 000115) and the other org-scoped
-- RPCs in this schema.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
drop function if exists public.ad_account_feed_health(uuid);

create or replace function public.ad_account_feed_health(p_org uuid)
returns table (
  provider          text,
  customer_id       text,
  last_metric_date  date,
  days_stale        integer,
  metric_rows       bigint,
  spend_pence       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select m.provider,
         m.customer_id,
         max(m.metric_date) as last_metric_date,
         (current_date - max(m.metric_date))::integer as days_stale,
         count(*)::bigint as metric_rows,
         coalesce(sum(m.spend_pence), 0)::bigint as spend_pence
  from public.ad_metrics m
  where m.organisation_id = p_org
  group by m.provider, m.customer_id;
$$;

grant execute on function public.ad_account_feed_health(uuid) to service_role, authenticated;

-- Reload PostgREST cache after applying:
NOTIFY pgrst, 'reload schema';

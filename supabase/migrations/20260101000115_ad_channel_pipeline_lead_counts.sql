-- ============================================================================
-- ad_channel_pipeline_lead_counts — lead volume per (subaccount, pipeline) for
-- the ad-attribution settings screen.
--
-- WHY THIS EXISTS: the settings payload needs a lead count beside every
-- pipeline so the operator can tell a busy pipeline from a dormant one (this
-- organisation has 113 pipelines across 7 subaccounts, most of them empty).
-- The first implementation did that by paging every lead row through PostgREST
-- and counting in JavaScript. At 20,509 leads that is 21 sequential round trips
-- on EVERY config load — including the refetch after each single click — which
-- made the screen feel broken: the click had in fact saved, but the refreshed
-- state arrived seconds later.
--
-- Counting in SQL turns that into one round trip.
--
-- Keyed on (integration_account_id, ghl_pipeline_id), NOT pipeline id alone:
-- GoHighLevel pipeline ids are only unique within a Location, so the same id
-- can appear under two subaccounts meaning two different things. Collapsing
-- them would cross-attribute one practice's volume to another.
--
-- Distinct from lead_pipeline_counts (migration 000111), which groups by
-- pipeline id only and is scoped to a single account per call — that shape
-- serves the Pipeline board, and using it here would need one call per
-- subaccount plus a client-side merge.
--
-- SECURITY DEFINER with a pinned search_path, and p_org is applied as a filter
-- inside the function — the caller cannot widen it. Matches the other
-- org-scoped RPCs in this schema.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
create or replace function public.ad_channel_pipeline_lead_counts(p_org uuid)
returns table (
  integration_account_id uuid,
  ghl_pipeline_id        text,
  lead_count             bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select l.integration_account_id,
         l.ghl_pipeline_id,
         count(*)::bigint as lead_count
  from public.leads l
  where l.organisation_id = p_org
    and l.integration_account_id is not null
    and l.ghl_pipeline_id is not null
  group by l.integration_account_id, l.ghl_pipeline_id;
$$;

-- Supports the grouped count above (and the per-pipeline lead reads that share
-- the same access pattern).
create index if not exists leads_org_account_pipeline_idx
  on public.leads (organisation_id, integration_account_id, ghl_pipeline_id);

-- Reload PostgREST cache after applying:
NOTIFY pgrst, 'reload schema';

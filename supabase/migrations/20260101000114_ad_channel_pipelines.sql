-- ============================================================================
-- ad_channel_pipelines — the explicit GoHighLevel pipeline -> ad channel map
-- behind the /ad-performance page.
--
-- WHY THIS EXISTS: channel was previously inferred by a regular expression on
-- the pipeline name (lead-attribution.service.js classifyChannel). On live data
-- that misfires badly — the three highest-volume pipelines are named
-- "Open Day Archive - IMPLANTS" (1122 leads), "dental implants open days
-- archive" (990) and "Implants Open Days Archive" (873), none of which match
-- /google|facebook/, while the pipelines that DO match hold 33 and 112 leads.
-- The regex therefore classifies the volume as 'other' and the rounding error
-- as the answer. The operator sets this map by hand instead.
--
-- ABSENCE OF A ROW MEANS UNASSIGNED. There is deliberately no 'unassigned'
-- channel value: representing it would require writing a row for every pipeline
-- merely to say nothing about it, and would make a newly created GHL pipeline
-- indistinguishable from a deliberately excluded one.
--
-- channel uses the same vocabulary as ad_metrics.provider ('google_ads',
-- 'meta_ads') so spend and leads join without a translation layer.
--
-- Every row carries organisation_id (rule 3); repositories filter on it
-- explicitly — the serviceClient path they use has NO automatic isolation.
--
-- RLS is enabled with no policies, matching the other Emergent-era tables: the
-- repositories read via serviceClient (which bypasses RLS), and nothing reaches
-- this table over the tenantClient path.
--
-- Idempotent + additive; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
create table if not exists public.ad_channel_pipelines (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete cascade,
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  ghl_pipeline_id        text not null,
  pipeline_name          text,
  channel                text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organisation_id, integration_account_id, ghl_pipeline_id),
  constraint ad_channel_pipelines_channel_chk
    check (channel in ('google_ads', 'meta_ads'))
);

-- The hot read: the whole map for one org, on every performance request.
create index if not exists ad_channel_pipelines_org_idx
  on public.ad_channel_pipelines (organisation_id);

drop trigger if exists ad_channel_pipelines_updated_at on public.ad_channel_pipelines;
create trigger ad_channel_pipelines_updated_at
  before update on public.ad_channel_pipelines
  for each row execute function set_updated_at();

alter table public.ad_channel_pipelines enable row level security;

-- Reload PostgREST cache after applying:
NOTIFY pgrst, 'reload schema';

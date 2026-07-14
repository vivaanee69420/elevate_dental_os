-- ============================================================================
-- 000111 — lead_pipeline_counts
--
-- Lead counts per GoHighLevel pipeline, so the Pipeline screen can order its
-- selector by activity (busiest pipeline first) instead of landing the user on
-- whichever pipeline GHL happens to return first — often an empty one.
--
-- Must be an aggregate RPC, not a client-side count: an org can hold tens of
-- thousands of leads and PostgREST caps plain reads at 1000 rows (db-max-rows),
-- which would silently under-count.
--
-- p_account null = every subaccount ("All subaccounts" view).
-- Idempotent.
-- ============================================================================

create or replace function public.lead_pipeline_counts(
  p_org uuid,
  p_account uuid default null
)
returns table (
  ghl_pipeline_id text,
  lead_count bigint,
  value_pence bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.ghl_pipeline_id::text,
    count(*)::bigint,
    coalesce(sum(l.estimated_value_pence), 0)::bigint
  from public.leads l
  where l.organisation_id = p_org
    and l.ghl_pipeline_id is not null
    and (p_account is null or l.integration_account_id = p_account)
  group by l.ghl_pipeline_id;
$$;

comment on function public.lead_pipeline_counts(uuid, uuid) is
  'Lead count + estimated value per GHL pipeline, org-scoped, optionally scoped to one subaccount.';

grant execute on function public.lead_pipeline_counts(uuid, uuid) to authenticated, service_role;

-- Supports the group-by above (org + account are the hot filters).
create index if not exists idx_leads_org_account_pipeline
  on public.leads (organisation_id, integration_account_id, ghl_pipeline_id);

notify pgrst, 'reload schema';

-- ============================================================================
-- 000183 — crm_pipeline_stage_summary takes a date window
--
-- The Pipeline board gains a created-at filter. The window has to reach the
-- AGGREGATE, not just the card list: the column headers are computed here, and
-- filtering the cards while leaving the counts alone would put the headers
-- back out of step with the cards beneath them — the exact defect 000180 was
-- written to remove, reintroduced through the front door.
--
-- Both bounds are INCLUSIVE, matching the `.gte`/`.lte` the card list uses.
-- A half-open aggregate beside a closed list disagrees on the last day of
-- every range, which is the quietest possible way to be wrong.
--
-- DROP AND RECREATE, not CREATE OR REPLACE. Postgres identifies a function by
-- (name, argument types), so adding two parameters would leave the old 3-arg
-- version in place alongside the new one. Two functions of the same name is
-- how a later migration ends up amending the wrong copy — the trap that has
-- already silently reverted a fix in this repository once.
-- ============================================================================

drop function if exists public.crm_pipeline_stage_summary(uuid, text, uuid);

create function public.crm_pipeline_stage_summary(
  p_org uuid,
  p_pipeline text,
  p_account uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  stage_id text,
  lead_count bigint,
  valued_count bigint,
  value_pence bigint,
  open_count bigint,
  open_valued_count bigint,
  open_value_pence bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    select
      coalesce(l.ghl_pipeline_stage_id, '')::text                              as stage_id,
      count(*)::bigint                                                          as lead_count,
      count(*) filter (where coalesce(l.estimated_value_pence, 0) > 0)::bigint  as valued_count,
      coalesce(sum(l.estimated_value_pence), 0)::bigint                         as value_pence,
      count(*) filter (
        where l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
      )::bigint                                                                 as open_count,
      count(*) filter (
        where l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
          and coalesce(l.estimated_value_pence, 0) > 0
      )::bigint                                                                 as open_valued_count,
      coalesce(sum(l.estimated_value_pence) filter (
        where l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
      ), 0)::bigint                                                             as open_value_pence
    from public.leads l
    where l.organisation_id = $1
      and l.ghl_pipeline_id = $2
      and ($3::uuid is null or l.integration_account_id = $3)
      and ($4::timestamptz is null or l.created_at >= $4)
      and ($5::timestamptz is null or l.created_at <= $5)
    group by 1
  $q$ using p_org, p_pipeline, p_account, p_since, p_until;
end;
$fn$;

comment on function public.crm_pipeline_stage_summary(uuid, text, uuid, timestamptz, timestamptz) is
  'Per-stage lead counts and estimated value for one GHL pipeline, org-scoped, '
  'over an inclusive created-at window. valued_count distinguishes zero value '
  'from unrecorded value.';

revoke all on function public.crm_pipeline_stage_summary(uuid, text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.crm_pipeline_stage_summary(uuid, text, uuid, timestamptz, timestamptz) to service_role;

-- Supports the windowed group-by: org + pipeline first (the hot filters), then
-- created_at for the range scan.
create index if not exists idx_leads_org_pipeline_created
  on public.leads (organisation_id, ghl_pipeline_id, created_at desc);

notify pgrst, 'reload schema';

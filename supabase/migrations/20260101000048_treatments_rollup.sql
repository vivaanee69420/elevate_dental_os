-- Org-wide treatment rollup for the Business Hub funnel KPIs.
-- treatment_plans rows are not practice-attributed (practice_id is null on the
-- Dentally feed), so this aggregates at the org level in a single row. 37k+ rows
-- per org => must sum in Postgres, never in Node (PostgREST 1000-row read cap).
-- started        = plans whose start_date falls in the window
-- completed      = plans marked completed with completed_at in the window
-- closed_value_pence = private treatment value of those completed plans
create or replace function public.treatments_rollup_by_org(p_org uuid, p_since timestamptz)
returns table(started bigint, completed bigint, closed_value_pence bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where start_date >= p_since::date)::bigint,
    count(*) filter (where completed and completed_at >= p_since)::bigint,
    coalesce(sum(private_value_pence) filter (
      where completed and completed_at >= p_since and private_value_pence > 0
    ), 0)::bigint
  from public.treatment_plans
  where organisation_id = p_org;
$$;

grant execute on function public.treatments_rollup_by_org(uuid, timestamptz) to service_role, authenticated;

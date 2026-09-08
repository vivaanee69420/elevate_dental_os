-- ============================================================================
-- 000182 — Elevate CRM Enquiries
--
-- The Enquiries screen was 100% MOCK: buildEnquiries() over a hardcoded LEADS
-- array in features/crm/data.ts, rendering invented patient names, treatments,
-- values, payment plans and consultation dates to a live tenant.
--
-- WHAT THIS PAGE DELIBERATELY DOES NOT HAVE, and why. Three columns the mock
-- showed have no honest source, so they are gone rather than faked:
--
--   Treatment   The mock read leads.treatment. That column is NOT a treatment:
--               it is GoHighLevel's raw opportunity name, and on live data it
--               carries patient names, emails and phone numbers (3,201 of this
--               group's leads). The honest source is Dentally's treatment-plan
--               invoice lines, but a lead's own contact resolves to one for
--               only 152 of 23,031 leads — 0.7% — because a GHL lead and a
--               Dentally patient are separate contact records, bridged by the
--               email/phone match that today exists only in the ad-attribution
--               path. A column that is empty 99.3% of the time is worse than
--               no column.
--   Consultation date   leads.expected_close_date is 0% populated on BOTH
--               organisations. There is nothing to show.
--   Payment plan        No source at all.
--
-- What IS real: who enquired, which pipeline stage they sit in, what the
-- enquiry is estimated to be worth (on the 22.5% that carry a value), where it
-- came from, which practice, and how long it has been waiting. That last one
-- is the point of the page - an enquiry nobody has moved in three weeks is the
-- thing worth surfacing.
--
-- Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- One page of enquiries, filtered and counted in SQL.
--
-- total_count is a window function over the FULL matching set, so the screen
-- can say "50 of 12,690" instead of counting the rows it was handed — the
-- error this whole branch exists to remove.
-- ----------------------------------------------------------------------------
create or replace function public.crm_enquiries(
  p_org uuid,
  p_account uuid default null,
  p_search text default null,
  p_stage text default null,
  p_valued_only boolean default false,
  p_open_only boolean default true,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  lead_id uuid,
  created_at timestamptz,
  contact_first_name text,
  contact_last_name text,
  contact_email text,
  stage_name text,
  status text,
  estimated_value_pence bigint,
  source text,
  practice_name text,
  age_days int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with scoped as (
      select
        l.id, l.created_at, l.contact_id, l.practice_id,
        l.ghl_stage_name, l.status, l.estimated_value_pence, l.source
      from public.leads l
      where l.organisation_id = $1
        and ($2::uuid is null or l.integration_account_id = $2)
        and ($6::boolean is not true
             or l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend'))
        and ($4::text is null or l.ghl_stage_name = $4)
        and ($5::boolean is not true or coalesce(l.estimated_value_pence, 0) > 0)
    ),
    named as (
      select
        s.*,
        ct.first_name, ct.last_name, ct.email,
        pr.name as practice_name
      -- Explicit org-scoped joins, never PostgREST embeds: an embed resolves
      -- the FK with no org predicate under the service client.
      from scoped s
      left join public.contacts  ct on ct.id = s.contact_id  and ct.organisation_id = $1
      left join public.practices pr on pr.id = s.practice_id and pr.organisation_id = $1
    ),
    matched as (
      select * from named n
      where $3::text is null or $3 = ''
         or (coalesce(n.first_name, '') || ' ' || coalesce(n.last_name, '')) ilike '%' || $3 || '%'
         or coalesce(n.email, '')  ilike '%' || $3 || '%'
         or coalesce(n.source, '') ilike '%' || $3 || '%'
         or coalesce(n.ghl_stage_name, '') ilike '%' || $3 || '%'
    )
    select
      m.id, m.created_at, m.first_name, m.last_name, m.email,
      m.ghl_stage_name, m.status,
      m.estimated_value_pence::bigint, m.source, m.practice_name,
      -- Whole days waiting, in London terms, so "3 days" means three dates.
      (london_day(now()) - london_day(m.created_at))::int as age_days,
      count(*) over ()::bigint as total_count
    from matched m
    -- id breaks ties: created_at alone is not unique, and a non-unique sort key
    -- makes OFFSET paging drop and repeat rows between pages.
    order by m.created_at desc, m.id asc
    limit $7 offset $8
  $q$ using p_org, p_account, p_search, p_stage, p_valued_only, p_open_only,
            p_limit, p_offset;
end;
$fn$;

comment on function public.crm_enquiries(uuid, uuid, text, text, boolean, boolean, int, int) is
  'One page of CRM enquiries with the full matching count, org-scoped. '
  'Carries no treatment column: see the migration header for why.';

revoke all on function public.crm_enquiries(uuid, uuid, text, text, boolean, boolean, int, int) from public, anon, authenticated;
grant execute on function public.crm_enquiries(uuid, uuid, text, text, boolean, boolean, int, int) to service_role;

-- ----------------------------------------------------------------------------
-- Headline figures, over the whole population rather than the page.
--
-- valued_count travels with value_pence on purpose. Only 22.5% of this group's
-- leads carry an estimated value, so a total presented alone reads as the worth
-- of every enquiry rather than of the minority that has a number.
-- ----------------------------------------------------------------------------
create or replace function public.crm_enquiries_summary(
  p_org uuid,
  p_account uuid default null
)
returns table (
  open_count bigint,
  valued_count bigint,
  value_pence bigint,
  stale_count bigint,
  oldest_age_days int
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with open_leads as (
      select l.created_at, l.estimated_value_pence
      from public.leads l
      where l.organisation_id = $1
        and ($2::uuid is null or l.integration_account_id = $2)
        and l.status not in ('not_proceeding', 'treatment_completed', 'failed_to_attend')
    )
    select
      count(*)::bigint                                                          as open_count,
      count(*) filter (where coalesce(estimated_value_pence, 0) > 0)::bigint    as valued_count,
      coalesce(sum(estimated_value_pence), 0)::bigint                           as value_pence,
      -- "Stale" is 21+ days with no movement. A fixed threshold beats a
      -- configurable one nobody sets, and the screen states the number of days
      -- rather than just the word.
      count(*) filter (where london_day(created_at) <= london_day(now()) - 21)::bigint as stale_count,
      coalesce(max(london_day(now()) - london_day(created_at)), 0)::int         as oldest_age_days
    from open_leads
  $q$ using p_org, p_account;
end;
$fn$;

comment on function public.crm_enquiries_summary(uuid, uuid) is
  'Open enquiry totals: count, how many carry a value, that value, how many are '
  '21+ days old, and the oldest. Org-scoped.';

revoke all on function public.crm_enquiries_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_enquiries_summary(uuid, uuid) to service_role;

-- The stage filter and the created_at ordering are the hot paths here.
create index if not exists idx_leads_org_stage_created
  on public.leads (organisation_id, ghl_stage_name, created_at desc);

notify pgrst, 'reload schema';

-- ============================================================================
-- Data Room: derived-column views + practice summary RPCs (Phase 1 of
-- docs/superpowers/specs/2026-08-27-etl-pipeline-rehearsal-org-and-analyst-data-room-design.md)
--
-- Views live in `public` because PostgREST exposes only that schema to the
-- supabase-js repository. They select the whole base row (`t.*`) so the
-- registry allowlist keeps working unchanged, plus the derived columns the
-- analyst needs. Rules are the dashboard's: 000076 (patient-present
-- appointments; completed = occurred; no_show = DNA), 000099 (treatment
-- activity = completed and not base_chart), 000103 (practitioner via
-- associates.pms_external_id = pms_practitioner_id), 000087 (GHL won/lost),
-- 000108 (settled cash), 000077 (new patients = Dentally registration date),
-- monthlyFinancial.service bucketsByPeriod (synced-over-manual precedence).
-- Idempotent. API roles stay locked out (000129); service_role reads.
-- ============================================================================

-- ---------------------------------------------------------------- Dentally
create or replace view public.data_room_dentally_patients
with (security_invoker = true) as
select c.*,
       encode(sha256(convert_to(c.organisation_id::text || ':' || coalesce(c.pms_external_id, c.id::text), 'UTF8')), 'hex') as patient_key,
       extract(year from c.date_of_birth)::int as birth_year,
       case
         when length(upper(regexp_replace(coalesce(c.postcode, ''), '\s+', '', 'g'))) >= 5
         then left(upper(regexp_replace(c.postcode, '\s+', '', 'g')), length(upper(regexp_replace(c.postcode, '\s+', '', 'g'))) - 3)
       end as postcode_district
from public.contacts c;

create or replace view public.data_room_dentally_appointments
with (security_invoker = true) as
select a.*,
       (a.pms_patient_id is not null)                                              as is_patient_appointment,
       (a.pms_patient_id is not null and a.status = 'completed')                   as occurred,
       (a.pms_patient_id is not null and a.status = 'no_show')                     as dna,
       (a.status = 'cancelled')                                                    as cancelled,
       round(extract(epoch from (a.ends_at - a.starts_at)) / 60)::int              as duration_mins,
       pr.full_name                                                                as practitioner_name
from public.appointments a
left join lateral (
  select x.full_name from public.associates x
  where x.organisation_id = a.organisation_id and x.pms_external_id = a.pms_practitioner_id
  limit 1
) pr on true;

create or replace view public.data_room_dentally_payments
with (security_invoker = true) as
select p.*, (p.status = 'settled') as is_settled
from public.payments p;

create or replace view public.data_room_dentally_invoice_items
with (security_invoker = true) as
select ii.*,
       (ii.fee_pence * coalesce(ii.quantity, 1))::bigint as fee_total_pence,
       pr.full_name                                     as practitioner_name
from public.invoice_items ii
left join lateral (
  select x.full_name from public.associates x
  where x.organisation_id = ii.organisation_id and x.pms_external_id = ii.pms_practitioner_id
  limit 1
) pr on true;

create or replace view public.data_room_dentally_treatment_items
with (security_invoker = true) as
select ti.*,
       (ti.completed is true and ti.base_chart is false) as counts_as_activity,
       pr.full_name                                      as practitioner_name
from public.dentally_treatment_items ti
left join lateral (
  select x.full_name from public.associates x
  where x.organisation_id = ti.organisation_id and x.pms_external_id = ti.pms_practitioner_id
  limit 1
) pr on true;

-- ------------------------------------------------------------- GoHighLevel
create or replace view public.data_room_gohighlevel_contacts
with (security_invoker = true) as
select c.*,
       encode(sha256(convert_to(c.organisation_id::text || ':' || coalesce(c.ghl_contact_id, c.id::text), 'UTF8')), 'hex') as contact_key
from public.contacts c;

create or replace view public.data_room_gohighlevel_opportunities
with (security_invoker = true) as
select l.*,
       pl.pipeline_name,
       case
         when l.status in ('treatment_started', 'treatment_completed') then 'won'
         when l.status in ('not_proceeding', 'failed_to_attend')      then 'lost'
         else 'open'
       end as outcome
from public.leads l
left join lateral (
  select p ->> 'name' as pipeline_name
  from public.integration_accounts ia
  cross join lateral jsonb_array_elements(coalesce(ia.config -> 'pipelines', '[]'::jsonb)) p
  where ia.id = l.integration_account_id and p ->> 'id' = l.ghl_pipeline_id
  limit 1
) pl on true;

-- ---------------------------------------------------------------- Ads
create or replace view public.data_room_ad_metrics
with (security_invoker = true) as
select m.*,
       pr.name as practice_name,
       case when coalesce(m.conversions, 0) > 0
            then round(m.spend_pence::numeric / m.conversions)::bigint end as cpl_pence
from public.ad_metrics m
left join lateral (
  select aa.practice_id from public.ad_accounts aa
  where aa.organisation_id = m.organisation_id and aa.provider = m.provider and aa.customer_id = m.customer_id
  limit 1
) acc on true
left join public.practices pr on pr.id = acc.practice_id;

revoke all on public.data_room_dentally_patients, public.data_room_dentally_appointments,
              public.data_room_dentally_payments, public.data_room_dentally_invoice_items,
              public.data_room_dentally_treatment_items, public.data_room_gohighlevel_contacts,
              public.data_room_gohighlevel_opportunities, public.data_room_ad_metrics
  from public, anon, authenticated;
grant select on public.data_room_dentally_patients, public.data_room_dentally_appointments,
                public.data_room_dentally_payments, public.data_room_dentally_invoice_items,
                public.data_room_dentally_treatment_items, public.data_room_gohighlevel_contacts,
                public.data_room_gohighlevel_opportunities, public.data_room_ad_metrics
  to service_role;

-- ---------------------------------------------------------------- Summaries
drop function if exists public.data_room_practice_day(uuid, timestamptz, timestamptz, uuid);
create or replace function public.data_room_practice_day(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid default null
)
returns table(
  id text, practice_id uuid, practice_name text, day date,
  appointments bigint, occurred bigint, dna bigint, cancelled bigint, new_patients bigint,
  treatment_items bigint, treatment_items_pence bigint, billed_pence bigint, settled_pence bigint,
  leads_new bigint, leads_won bigint, ad_spend_pence bigint
)
language sql stable security definer set search_path = public as $$
  with since_d as (select (p_since at time zone 'Europe/London')::date as d),
       until_d as (select (p_until at time zone 'Europe/London')::date as d),
  m as (
    -- appointments: patient-present rows only (000076); status decides occurred / DNA
    select a.practice_id, (a.starts_at at time zone 'Europe/London')::date as day,
           count(*) filter (where a.pms_patient_id is not null)::bigint                            as appointments,
           count(*) filter (where a.pms_patient_id is not null and a.status = 'completed')::bigint as occurred,
           count(*) filter (where a.pms_patient_id is not null and a.status = 'no_show')::bigint   as dna,
           count(*) filter (where a.status = 'cancelled')::bigint                                  as cancelled,
           0::bigint as new_patients, 0::bigint as treatment_items, 0::bigint as treatment_items_pence,
           0::bigint as billed_pence, 0::bigint as settled_pence, 0::bigint as leads_new,
           0::bigint as leads_won, 0::bigint as ad_spend_pence
    from appointments a
    where a.organisation_id = p_org and a.source = 'dentally'
      and a.starts_at >= p_since and a.starts_at < p_until
    group by 1, 2
    union all
    -- new patients: Dentally registration date (000077)
    select c.practice_id, (c.pms_registered_at at time zone 'Europe/London')::date,
           0, 0, 0, 0, count(*)::bigint, 0, 0, 0, 0, 0, 0, 0
    from contacts c
    where c.organisation_id = p_org and c.type = 'patient' and c.pms_registered_at is not null
      and c.pms_registered_at >= p_since and c.pms_registered_at < p_until
    group by 1, 2
    union all
    -- treatment activity: completed and not base_chart (000099)
    select ti.practice_id, (ti.completed_at at time zone 'Europe/London')::date,
           0, 0, 0, 0, 0, count(*)::bigint, coalesce(sum(ti.price_pence), 0)::bigint, 0, 0, 0, 0, 0
    from dentally_treatment_items ti
    where ti.organisation_id = p_org and ti.completed is true and ti.base_chart is false
      and ti.completed_at >= p_since and ti.completed_at < p_until
    group by 1, 2
    union all
    -- billed production: invoice lines (000074 basis, all lines)
    select ii.practice_id, ii.invoiced_on,
           0, 0, 0, 0, 0, 0, 0, coalesce(sum(ii.fee_pence * coalesce(ii.quantity, 1)), 0)::bigint, 0, 0, 0, 0
    from invoice_items ii, since_d, until_d
    where ii.organisation_id = p_org and ii.source = 'dentally'
      and ii.invoiced_on >= since_d.d and ii.invoiced_on < until_d.d
    group by 1, 2
    union all
    -- settled cash (000108)
    select p.practice_id, (p.processed_at at time zone 'Europe/London')::date,
           0, 0, 0, 0, 0, 0, 0, 0, coalesce(sum(p.amount_pence), 0)::bigint, 0, 0, 0
    from payments p
    where p.organisation_id = p_org and p.status = 'settled'
      and p.processed_at >= p_since and p.processed_at < p_until
    group by 1, 2
    union all
    -- leads created in window; won = treatment_started | treatment_completed (000087)
    select l.practice_id, (l.created_at at time zone 'Europe/London')::date,
           0, 0, 0, 0, 0, 0, 0, 0, 0, count(*)::bigint,
           count(*) filter (where l.status in ('treatment_started', 'treatment_completed'))::bigint, 0
    from leads l
    where l.organisation_id = p_org and l.created_at >= p_since and l.created_at < p_until
    group by 1, 2
    union all
    -- ad spend attributed through ad_accounts.practice_id
    select aa.practice_id, am.metric_date,
           0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, coalesce(sum(am.spend_pence), 0)::bigint
    from ad_metrics am
    join ad_accounts aa on aa.organisation_id = am.organisation_id and aa.provider = am.provider
                       and aa.customer_id = am.customer_id
    cross join since_d cross join until_d
    where am.organisation_id = p_org and am.metric_date >= since_d.d and am.metric_date < until_d.d
    group by 1, 2
  )
  select coalesce(m.practice_id::text, 'unassigned') || ':' || m.day::text as id,
         m.practice_id, pr.name as practice_name, m.day,
         sum(m.appointments)::bigint, sum(m.occurred)::bigint, sum(m.dna)::bigint, sum(m.cancelled)::bigint,
         sum(m.new_patients)::bigint, sum(m.treatment_items)::bigint, sum(m.treatment_items_pence)::bigint,
         sum(m.billed_pence)::bigint, sum(m.settled_pence)::bigint, sum(m.leads_new)::bigint,
         sum(m.leads_won)::bigint, sum(m.ad_spend_pence)::bigint
  from m
  left join practices pr on pr.id = m.practice_id
  where p_practice is null or m.practice_id = p_practice
  group by m.practice_id, pr.name, m.day
  order by m.day, pr.name nulls last;
$$;

drop function if exists public.data_room_practice_month(uuid, timestamptz, timestamptz, uuid);
create or replace function public.data_room_practice_month(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid default null
)
returns table(
  id text, practice_id uuid, practice_name text, month date,
  appointments bigint, occurred bigint, dna bigint, cancelled bigint, new_patients bigint,
  treatment_items bigint, treatment_items_pence bigint, billed_pence bigint, settled_pence bigint,
  leads_new bigint, leads_won bigint, ad_spend_pence bigint,
  dna_pct numeric, avg_fee_pence bigint, cpl_pence bigint,
  financial_revenue_pence bigint, financial_costs_pence bigint
)
language sql stable security definer set search_path = public as $$
  with d as (
    select practice_id, date_trunc('month', day)::date as month,
           sum(appointments) as appointments, sum(occurred) as occurred, sum(dna) as dna,
           sum(cancelled) as cancelled, sum(new_patients) as new_patients,
           sum(treatment_items) as treatment_items, sum(treatment_items_pence) as treatment_items_pence,
           sum(billed_pence) as billed_pence, sum(settled_pence) as settled_pence,
           sum(leads_new) as leads_new, sum(leads_won) as leads_won, sum(ad_spend_pence) as ad_spend_pence
    from data_room_practice_day(p_org, p_since, p_until, p_practice)
    group by 1, 2
  ),
  fin_cell as (
    -- synced-over-manual precedence per period + bucket (monthlyFinancial.service bucketsByPeriod)
    select practice_id, to_date(period, 'YYYY-MM') as month, dental_bucket,
           bool_or(source <> 'manual') as has_synced,
           coalesce(sum(amount_pence) filter (where source <> 'manual'), 0)::bigint as synced_pence,
           coalesce(sum(amount_pence) filter (where source = 'manual'), 0)::bigint as manual_pence
    from monthly_financials
    where organisation_id = p_org and accounting_method = 'accrual' and dental_bucket is not null
      and to_date(period, 'YYYY-MM') >= date_trunc('month', (p_since at time zone 'Europe/London'))::date
      and to_date(period, 'YYYY-MM') <  (p_until at time zone 'Europe/London')::date
      and (p_practice is null or practice_id = p_practice)
    group by 1, 2, 3
  ),
  fin as (
    select practice_id, month,
           sum(case when dental_bucket = 'revenue'
                    then (case when has_synced then synced_pence else manual_pence end) else 0 end)::bigint as revenue_pence,
           -- costs exclude 'tax' (below-the-line) — same as the P&L statement
           sum(case when dental_bucket in ('associates', 'staff', 'lab', 'materials', 'overhead', 'other')
                    then (case when has_synced then synced_pence else manual_pence end) else 0 end)::bigint as costs_pence
    from fin_cell
    group by 1, 2
  )
  select coalesce(coalesce(d.practice_id, fin.practice_id)::text, 'unassigned') || ':' || to_char(coalesce(d.month, fin.month), 'YYYY-MM') as id,
         coalesce(d.practice_id, fin.practice_id) as practice_id,
         pr.name as practice_name,
         coalesce(d.month, fin.month) as month,
         coalesce(d.appointments, 0)::bigint, coalesce(d.occurred, 0)::bigint, coalesce(d.dna, 0)::bigint,
         coalesce(d.cancelled, 0)::bigint, coalesce(d.new_patients, 0)::bigint,
         coalesce(d.treatment_items, 0)::bigint, coalesce(d.treatment_items_pence, 0)::bigint,
         coalesce(d.billed_pence, 0)::bigint, coalesce(d.settled_pence, 0)::bigint,
         coalesce(d.leads_new, 0)::bigint, coalesce(d.leads_won, 0)::bigint, coalesce(d.ad_spend_pence, 0)::bigint,
         round(100.0 * coalesce(d.dna, 0) / nullif(coalesce(d.occurred, 0) + coalesce(d.dna, 0), 0), 1) as dna_pct,
         (coalesce(d.treatment_items_pence, 0) / nullif(d.treatment_items, 0))::bigint            as avg_fee_pence,
         (coalesce(d.ad_spend_pence, 0) / nullif(d.leads_new, 0))::bigint                          as cpl_pence,
         coalesce(fin.revenue_pence, 0)::bigint, coalesce(fin.costs_pence, 0)::bigint
  from d
  full outer join fin on fin.practice_id is not distinct from d.practice_id and fin.month = d.month
  left join practices pr on pr.id = coalesce(d.practice_id, fin.practice_id)
  order by 4, 3 nulls last;
$$;

revoke execute on function public.data_room_practice_day(uuid, timestamptz, timestamptz, uuid)   from public, anon, authenticated;
revoke execute on function public.data_room_practice_month(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant  execute on function public.data_room_practice_day(uuid, timestamptz, timestamptz, uuid)   to service_role;
grant  execute on function public.data_room_practice_month(uuid, timestamptz, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';

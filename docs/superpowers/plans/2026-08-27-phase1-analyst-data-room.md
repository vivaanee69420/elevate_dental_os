# Phase 1 — Analyst-ready Data Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before 1 September 2026 the data analyst can open the Data Room and get rows per practice with the app's business rules already applied (occurred / DNA / patient key / practitioner / won-lost…), practice-per-day and practice-per-month summary datasets that reconcile to the dashboard cards, Excel *and* CSV export, a column dictionary, and a "data as of" badge — on the existing organisation's data, with no change to how data is ingested.

**Architecture:** Derived columns come from thin `public.data_room_*` SQL views over the existing tables (PostgREST only exposes `public`, so the supabase-js repository reads the view exactly as it reads a table today). Summaries are two `security definer` RPCs (`data_room_practice_day`, `data_room_practice_month`) served through the registry's existing "derived dataset" path. Excel export streams an `exceljs` workbook, one worksheet per practice, through the same PII gate and audit as CSV. The registry gains a dictionary (unit + description per column) that feeds both the UI drawer and a generated Markdown file.

**Tech Stack:** Node 20 ESM (`backend/`, Express, Zod, supabase-js, vitest), Postgres 15 on Supabase (views, SQL functions), `exceljs` (new dependency, streaming `WorkbookWriter`), Next.js 14 App Router + React Query + Tailwind (`frontend/`).

**Spec:** `docs/superpowers/specs/2026-08-27-etl-pipeline-rehearsal-org-and-analyst-data-room-design.md` (Phase 1 section) — builds on `docs/superpowers/specs/2026-08-25-data-room-design.md`.

## Global Constraints

- Work on branch `feat/data-room` (current). Commit after every task; do not push unless the owner asks.
- Backend is **native ESM**: `import`/`export`, relative imports carry `.js`. Never `require`. Namespace-import convention for converted files (`import * as supabase_1 from "../lib/supabase.js"`) — follow the file you are editing.
- **Tenant isolation**: every repository query carries `.eq('organisation_id', orgId)`; every RPC takes `p_org` and filters on it. `orgId` always comes from `req.user`, never from the request.
- **PII gate is unchanged**: columns in `PII_COLUMNS` are selected only when `role === 'owner' && query.pii === true`. Derived columns `patient_key`, `contact_key`, `birth_year`, `postcode_district`, `practitioner_name` are **not** PII. `FORBIDDEN_COLUMNS` (`notes`, `pms_patient`, `body`…) never appear in a registry column list.
- **RPC idiom (mandatory)**: every new function is `security definer`, `set search_path = public`, `revoke execute … from public, anon, authenticated; grant execute … to service_role;`. Every new view: `revoke all … from anon, authenticated; grant select … to service_role;`. End the migration with `notify pgrst, 'reload schema';`.
- Money is **integer pence** everywhere; Excel adds a `_gbp` neighbour column formatted `£#,##0.00`, it never replaces the pence column.
- British English in all UI and descriptions (organisation, practise/practice, colour). No emojis. Light theme only.
- Migration file: `supabase/migrations/20260101000131_data_room_derived_and_summaries.sql`, idempotent (`create or replace`). No table changes → `db/01_schema.sql` is not touched.
- The `supabase` CLI is **not installed** on the dev machine. The migration is applied to the hosted project `mkfhpzjbijbachoonytt` via the Supabase MCP `apply_migration` tool (views + functions only, additive). Then `NOTIFY pgrst, 'reload schema';`.
- Frontend: stop any running `next dev` before `npm run build` (shared `.next`). Frontend has no test framework — gate is `npm run typecheck && npm run lint && npm run build`.
- Backend gate per task: `npx vitest run test/data-room-*.test.mjs`; before the final commit `npm test && npm run lint && npm run typecheck`.
- `docs/API.md` must document every new endpoint (project rule).

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260101000131_data_room_derived_and_summaries.sql` | **Create.** 8 `public.data_room_*` views (derived columns) + 2 summary RPCs + grants |
| `scripts/data-room-reconcile.sql` | **Create.** SQL that asserts the summary RPC equals the dashboard rules on live data |
| `backend/src/lib/data-room/dictionary.js` | **Create.** `inferUnit(col)`, `COLUMN_DOCS`, `DATASET_COLUMN_DOCS`, `docFor(ds, col)` |
| `backend/src/lib/data-room/registry.js` | **Modify.** view tables, derived columns, `summaries` source, docs merge, client shape, validation |
| `backend/src/lib/data-room/xlsx.js` | **Create.** exceljs workbook helper: sheet naming, column typing, row writing |
| `backend/src/repositories/data-room.repository.js` | **Modify.** `rpcRows`, `practices`, `freshness`, `practiceNull` filter |
| `backend/src/services/data-room.service.js` | **Modify.** RPC datasets in `page`/`streamCsv`, `freshness`, `prepareExport` + `writeXlsx` |
| `backend/src/controllers/data-room.controller.js` | **Modify.** `freshness`, `exportXlsx` |
| `backend/src/routes/data-room.routes.js` | **Modify.** `GET /freshness`, `GET /:source/:dataset/export.xlsx` |
| `backend/scripts/data-room-dictionary.js` | **Create.** Generates `docs/DATA_ROOM_DICTIONARY.md` from the registry |
| `backend/package.json` | **Modify.** `exceljs` dependency, `data-room:dictionary` script |
| `backend/test/data-room-dictionary.test.mjs` | **Create.** |
| `backend/test/data-room-xlsx.test.mjs` | **Create.** |
| `backend/test/data-room-{registry,repository,service,routes}.test.mjs` | **Modify.** |
| `frontend/features/data-room/api.ts`, `hooks.ts` | **Modify.** types, `summaries` source, xlsx URL, freshness |
| `frontend/features/data-room/components/DataRoomScreen.tsx` | **Modify.** export split, freshness badge, dictionary button, derived tag |
| `frontend/features/data-room/components/DictionaryDrawer.tsx` | **Create.** |
| `frontend/app/(dashboard)/data-summaries/page.tsx` | **Create.** |
| `frontend/lib/nav.ts`, `frontend/lib/permissions.ts` | **Modify.** `data-summaries` route |
| `docs/API.md`, `docs/DATA_ROOM_DICTIONARY.md`, `CLAUDE.md` | **Modify / generate.** |

---

### Task 1: Migration — derived-column views and summary RPCs

**Files:**
- Create: `supabase/migrations/20260101000131_data_room_derived_and_summaries.sql`
- Create: `scripts/data-room-reconcile.sql`

**Interfaces:**
- Produces views (all `select <table>.*` plus the derived columns named here): `data_room_dentally_patients` (+`patient_key text`, `birth_year int`, `postcode_district text`), `data_room_dentally_appointments` (+`is_patient_appointment bool`, `occurred bool`, `dna bool`, `cancelled bool`, `duration_mins int`, `practitioner_name text`), `data_room_dentally_payments` (+`is_settled bool`), `data_room_dentally_invoice_items` (+`fee_total_pence bigint`, `practitioner_name text`), `data_room_dentally_treatment_items` (+`counts_as_activity bool`, `practitioner_name text`), `data_room_gohighlevel_contacts` (+`contact_key text`), `data_room_gohighlevel_opportunities` (+`pipeline_name text`, `outcome text` ∈ `won|lost|open`), `data_room_ad_metrics` (+`practice_name text`, `cpl_pence bigint`).
- Produces RPCs `data_room_practice_day(p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid default null)` and `data_room_practice_month(…same…)` — column lists in the SQL below; both return an `id text` column (`<practice_id|unassigned>:<day|YYYY-MM>`) the UI uses as row key.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Write the reconciliation script**

`scripts/data-room-reconcile.sql` — run with `:org` replaced by the organisation UUID; every row must show `ok = true`.

```sql
-- Data Room summaries must equal the dashboard rules. Replace :org, :since, :until.
with win as (select :'org'::uuid as org, :'since'::timestamptz as since, :'until'::timestamptz as until),
pm as (
  select practice_id, sum(occurred) as occurred, sum(dna) as dna, sum(settled_pence) as settled_pence,
         sum(treatment_items) as treatment_items, sum(treatment_items_pence) as treatment_items_pence
  from win, data_room_practice_month(win.org, win.since, win.until, null) group by 1
),
ref as (
  select a.practice_id,
         count(*) filter (where a.pms_patient_id is not null and a.status = 'completed') as occurred,
         count(*) filter (where a.pms_patient_id is not null and a.status = 'no_show')   as dna
  from win, appointments a
  where a.organisation_id = win.org and a.source = 'dentally' and a.starts_at >= win.since and a.starts_at < win.until
  group by 1
),
cash as (
  select p.practice_id, sum(p.amount_pence) as settled_pence
  from win, payments p
  where p.organisation_id = win.org and p.status = 'settled' and p.processed_at >= win.since and p.processed_at < win.until
  group by 1
),
act as (
  select ti.practice_id, count(*) as n, sum(ti.price_pence) as pence
  from win, dentally_treatment_items ti
  where ti.organisation_id = win.org and ti.completed and not ti.base_chart
    and ti.completed_at >= win.since and ti.completed_at < win.until
  group by 1
)
select pm.practice_id,
       pm.occurred = coalesce(ref.occurred, 0)                    as occurred_ok,
       pm.dna = coalesce(ref.dna, 0)                              as dna_ok,
       pm.settled_pence = coalesce(cash.settled_pence, 0)         as settled_ok,
       pm.treatment_items = coalesce(act.n, 0)                    as activity_ok,
       pm.treatment_items_pence = coalesce(act.pence, 0)          as activity_pence_ok,
       (pm.occurred = coalesce(ref.occurred, 0) and pm.dna = coalesce(ref.dna, 0)
        and pm.settled_pence = coalesce(cash.settled_pence, 0)
        and pm.treatment_items = coalesce(act.n, 0)
        and pm.treatment_items_pence = coalesce(act.pence, 0))    as ok
from pm
left join ref  on ref.practice_id  is not distinct from pm.practice_id
left join cash on cash.practice_id is not distinct from pm.practice_id
left join act  on act.practice_id  is not distinct from pm.practice_id
order by 1;
```

- [ ] **Step 3: Apply on hosted via the Supabase MCP**

Call `mcp__claude_ai_Supabase__apply_migration` with `project_id: "mkfhpzjbijbachoonytt"`, `name: "20260101000131_data_room_derived_and_summaries"`, `query: <file contents>`. Then `execute_sql` with `notify pgrst, 'reload schema';`.

Expected: no error. Verify with `execute_sql`:

```sql
select table_name from information_schema.views where table_schema = 'public' and table_name like 'data_room_%' order by 1;
-- 8 rows
select proname from pg_proc where proname in ('data_room_practice_day','data_room_practice_month');
-- 2 rows
```

- [ ] **Step 4: Run the reconciliation on live data**

`execute_sql` with the script body, substituting the Plan4growth organisation id (`select id from organisations order by created_at limit 1` if unknown), `since = '2026-05-01T00:00:00+01:00'`, `until = '2026-06-01T00:00:00+01:00'`. Expected: every row `ok = true`; the Ashford row shows `appointments = 801` — patient-present rows of ANY status, the 000076 rule (golden number, memory `appointments-occurred-rollup`); `occurred` (completed only) is lower.

Also sanity-check a view:

```sql
select count(*) filter (where is_patient_appointment) as appointments, count(*) filter (where occurred) as occurred, count(*) filter (where dna) as dna
from data_room_dentally_appointments
where organisation_id = '<org>' and practice_id = '<ashford>' and starts_at >= '2026-05-01T00:00:00+01:00' and starts_at < '2026-06-01T00:00:00+01:00';
-- appointments = 801
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000131_data_room_derived_and_summaries.sql scripts/data-room-reconcile.sql
git commit -m "feat(data-room): derived-column views + practice day/month summary RPCs (000131)"
```

---

### Task 2: Column dictionary module

**Files:**
- Create: `backend/src/lib/data-room/dictionary.js`
- Test: `backend/test/data-room-dictionary.test.mjs`

**Interfaces:**
- Produces `inferUnit(col: string): Unit` where `Unit = 'id'|'hash'|'pence'|'count'|'number'|'percent'|'minutes'|'flag'|'date'|'timestamptz'|'text'`; `COLUMN_DOCS: Record<col, { description: string, unit?: Unit }>`; `DATASET_COLUMN_DOCS: Record<'<source>/<key>', Record<col, { description, unit? }>>`; `docFor(ds, col): { unit: Unit, description: string }` (description `''` when unknown — the registry validator turns that into a problem).

- [ ] **Step 1: Write the failing test**

`backend/test/data-room-dictionary.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { inferUnit, docFor, COLUMN_DOCS } from '../src/lib/data-room/dictionary.js';
import { DATASETS } from '../src/lib/data-room/registry.js';

describe('inferUnit', () => {
  it('maps by suffix/prefix', () => {
    expect(inferUnit('spend_pence')).toBe('pence');
    expect(inferUnit('created_at')).toBe('timestamptz');
    expect(inferUnit('invoiced_on')).toBe('date');
    expect(inferUnit('metric_date')).toBe('date');
    expect(inferUnit('practice_id')).toBe('id');
    expect(inferUnit('id')).toBe('id');
    expect(inferUnit('patient_key')).toBe('hash');
    expect(inferUnit('is_settled')).toBe('flag');
    expect(inferUnit('dna_pct')).toBe('percent');
    expect(inferUnit('treatment_name')).toBe('text');
  });
});

describe('docFor', () => {
  it('uses the dataset override before the global doc', () => {
    const ds = { source: 'dentally', key: 'appointments' };
    expect(docFor(ds, 'status').description).toMatch(/scheduled|completed|no_show/);
    expect(docFor({ source: 'gohighlevel', key: 'opportunities' }, 'status').description).toMatch(/pipeline|stage/i);
  });
  it('lets a doc override the inferred unit', () => {
    expect(docFor({ source: 'dentally', key: 'treatment_items' }, 'duration').unit).toBe('minutes');
    expect(docFor({ source: 'emergent', key: 'daily_cashups' }, 'chair_utilisation').unit).toBe('percent');
  });
  it('returns an empty description for an unknown column (validator catches it)', () => {
    expect(docFor({ source: 'dentally', key: 'patients' }, 'no_such_column')).toEqual({ unit: 'text', description: '' });
  });
  it('documents every column of every registered dataset', () => {
    const missing = [];
    for (const ds of DATASETS) for (const c of ds.columns) if (!docFor(ds, c.col).description) missing.push(`${ds.source}/${ds.key}.${c.col}`);
    expect(missing).toEqual([]);
  });
  it('every global doc is British English and ends with a full stop', () => {
    for (const [col, d] of Object.entries(COLUMN_DOCS)) {
      expect(d.description, col).toMatch(/\.$/);
      expect(d.description, col).not.toMatch(/\b(organization|color|optimize)\b/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/data-room-dictionary.test.mjs`
Expected: FAIL — `Failed to resolve import "../src/lib/data-room/dictionary.js"`.

- [ ] **Step 3: Write the module**

`backend/src/lib/data-room/dictionary.js`:

```js
// backend/src/lib/data-room/dictionary.js
// ============================================================================
// Data Room column dictionary — the human-readable meaning + unit of every
// column the analyst can see. Pure data. The registry merges these into its
// column entries at load; validateRegistry() fails the suite if any listed
// column has no description, so a new column cannot ship undocumented.
//
//   inferUnit(col)          unit from the naming convention (pence/_at/_on…)
//   COLUMN_DOCS             global doc per column name (shared across datasets)
//   DATASET_COLUMN_DOCS     '<source>/<key>' -> col -> doc, overrides the global
//   docFor(ds, col)         { unit, description } ('' description when unknown)
// ============================================================================

const COUNT_COLS = new Set([
    'quantity', 'impressions', 'clicks', 'conversions', 'reach', 'appointments', 'occurred', 'dna',
    'cancelled', 'new_patients', 'treatment_items', 'leads_new', 'leads_won', 'treatments_accepted',
    'tx_plans_given', 'num_bookings', 'num_new_leads', 'num_follow_ups', 'num_attended', 'total_chairs',
    'chairs_used', 'reviews_collected', 'before_after_pictures', 'video_testimonials',
    'practice_plan_signups', 'refunds', 'detail_patient_rows_count', 'period_reach', 'period_impressions',
    'period_clicks', 'period_conversions', 'source_google', 'source_facebook', 'source_walk_in',
    'source_friends_family', 'source_wl_website', 'source_dentist_referral', 'source_instagram',
    'source_youtube', 'source_other', 'uda_target', 'uoa_target',
]);
const FLAG_COLS = new Set([
    'marketing_consent', 'sms_consent', 'paid', 'nhs_charge', 'invoice_paid', 'completed', 'base_chart',
    'charged', 'appear_on_invoice', 'active', 'is_selected', 'occurred', 'dna', 'cancelled',
]);
const DATE_COLS = new Set(['day', 'month', 'period_month', 'metric_date', 'period_window_start', 'period_window_end']);

export function inferUnit(col) {
    if (col === 'id' || col.endsWith('_id')) return 'id';
    if (col.endsWith('_key')) return 'hash';
    if (col.endsWith('_pence')) return 'pence';
    if (col.endsWith('_pct')) return 'percent';
    if (col.endsWith('_at')) return 'timestamptz';
    if (col.endsWith('_on') || col.endsWith('_date') || DATE_COLS.has(col)) return 'date';
    if (col.startsWith('is_') || FLAG_COLS.has(col)) return 'flag';
    if (COUNT_COLS.has(col)) return 'count';
    return 'text';
}

const d = (description, unit) => (unit ? { description, unit } : { description });

export const COLUMN_DOCS = {
    // identifiers
    id: d('Elevate row id (UUID). Stable across syncs.'),
    practice_id: d('Elevate practice the row is attributed to. Null = not attributed to a site.'),
    primary_practice_id: d('Home practice of the practitioner (Dentally site).'),
    contact_id: d('Elevate contact (patient or lead) the row belongs to. Join to Patients / Contacts.'),
    associate_id: d('Elevate practitioner row. Join to Practitioners.'),
    lead_id: d('Elevate opportunity the message belongs to. Join to Opportunities.'),
    integration_account_id: d('Connected sub-account (GoHighLevel location) the row came from. Join to Subaccounts.'),
    pms_external_id: d('The record id in Dentally (practice management system).'),
    pms_patient_id: d('Dentally patient id. Null on diary blocks (lunch, admin) — not a patient appointment.'),
    pms_practitioner_id: d('Dentally practitioner (user) id who delivered the item. Join Practitioners.pms_external_id.'),
    pms_user_id: d('Dentally login user id of the practitioner.'),
    pms_invoice_id: d('Dentally invoice id the line sits on.'),
    external_id: d('Record id in the source system.'),
    external_account_id: d('GoHighLevel location id of the sub-account.'),
    treatment_plan_id: d('Dentally treatment plan id the item belongs to.'),
    treatment_appointment_id: d('Dentally appointment id the item was delivered in.'),
    customer_id: d('Ads account id (Google Ads customer id / Meta ad account id).'),
    campaign_id: d('Ads campaign id in the provider.'),
    ghl_contact_id: d('GoHighLevel contact id.'),
    ghl_opportunity_id: d('GoHighLevel opportunity id.'),
    ghl_pipeline_id: d('GoHighLevel pipeline id. Join Pipelines.pipeline_id for the name.'),
    ghl_pipeline_stage_id: d('GoHighLevel stage id within the pipeline.'),
    ghl_event_id: d('GoHighLevel calendar event id.'),
    ghl_calendar_id: d('GoHighLevel calendar id.'),
    pipeline_id: d('GoHighLevel pipeline id.'),
    stage_id: d('GoHighLevel stage id.'),
    business_id: d('Emergent business (site) id. Mapped to practice_id by the owner.'),
    // hashes / derived keys
    patient_key: d('Pseudonymous patient key: SHA-256 of organisation + Dentally patient id. Same patient = same key; not reversible.', 'hash'),
    contact_key: d('Pseudonymous contact key: SHA-256 of organisation + GoHighLevel contact id.', 'hash'),
    // people (PII-gated where flagged in the registry)
    first_name: d('Patient / contact first name. PII — owner only.'),
    last_name: d('Patient / contact last name. PII — owner only.'),
    email: d('Email address. PII — owner only (staff contact details are not gated).'),
    phone: d('Telephone number. PII — owner only (staff contact details are not gated).'),
    date_of_birth: d('Date of birth. PII — owner only.', 'date'),
    address: d('Postal address. PII — owner only.'),
    postcode: d('Full postcode. PII — owner only.'),
    patient_name: d('Patient name as printed on the invoice / record. PII — owner only.'),
    full_name: d('Full name (staff / practitioner — business contact, not patient data).'),
    birth_year: d('Year of birth (derived from date of birth). Use for age bands.', 'number'),
    postcode_district: d('Outward postcode (e.g. DA6) derived from the full postcode.'),
    // patients
    marketing_consent: d('Patient has consented to marketing contact.'),
    sms_consent: d('Patient has consented to SMS.'),
    next_recall_date: d('Next recall due date in Dentally.'),
    last_visit_date: d('Date of the last attended visit in Dentally.'),
    pms_registered_at: d('When the patient registered in Dentally. The dashboard\'s "new patient" date.'),
    type: d('Contact type: patient | lead.'),
    source: d('System the row was synced from (dentally, gohighlevel, xero, quickbooks, manual…).'),
    // appointments
    starts_at: d('Appointment start (UTC instant; shown in London time in the UI).'),
    ends_at: d('Appointment end.'),
    status: d('Row status in the source system.'),
    appointment_type: d('Dentally appointment reason / type.'),
    is_patient_appointment: d('True when a patient is attached (Dentally "With patients" view). Diary blocks are false.'),
    occurred: d('Patient appointment with status completed — the dashboard\'s "Appointments occurred".'),
    dna: d('Patient appointment marked did-not-attend (no_show).'),
    cancelled: d('Appointment cancelled.'),
    duration_mins: d('Booked length in minutes (ends_at − starts_at).', 'minutes'),
    practitioner_name: d('Practitioner name resolved from pms_practitioner_id.'),
    // money / invoices
    amount_pence: d('Amount in pence (£ = pence ÷ 100).'),
    amount_outstanding_pence: d('Unpaid balance on the invoice in pence.'),
    method: d('Payment method (card, cash, bank transfer, finance…).'),
    processed_at: d('When the payment was taken.'),
    is_settled: d('Payment status settled — counted as cash collected.'),
    dated_on: d('Invoice date.'),
    due_on: d('Invoice due date.'),
    paid: d('Invoice fully paid.'),
    treatment: d('Treatment name / category.'),
    treatment_name: d('Treatment or item name as recorded.'),
    unit_price_pence: d('Unit price of the invoice line in pence.'),
    fee_pence: d('Line fee in pence (per unit).'),
    fee_total_pence: d('fee_pence × quantity — the billed value of the line.'),
    quantity: d('Units on the line.'),
    nhs_charge: d('Line is an NHS patient charge.'),
    invoiced_on: d('Date the line was invoiced. The dashboard\'s "billed" date.'),
    invoice_paid: d('The invoice this line sits on is fully paid.'),
    // treatment plans / items
    private_value_pence: d('Private fee value of the plan in pence.'),
    nhs_uda_value: d('NHS UDAs on the plan.', 'number'),
    nhs_completed_uda_value: d('NHS UDAs completed on the plan.', 'number'),
    completed: d('Plan / item marked completed.'),
    completed_at: d('When the item was completed — the Practitioner Activity date.'),
    start_date: d('Plan start date.'),
    end_date: d('Plan end date.'),
    price_pence: d('Item price in pence.'),
    duration: d('Item duration in minutes.', 'minutes'),
    base_chart: d('Charting-only item (existing condition), excluded from activity.'),
    charged: d('Item has been charged.'),
    appear_on_invoice: d('Item appears on an invoice.'),
    counts_as_activity: d('completed and not base_chart — the Practitioner Activity rule.'),
    // practitioners / staff
    gdc_number: d('GDC registration number.'),
    nhs_number: d('NHS performer number.'),
    dentally_role: d('Role in Dentally (dentist, hygienist, therapist…).'),
    specialty: d('Clinical specialty.'),
    active: d('Currently active in the source system.'),
    uda_target: d('Annual UDA target.'),
    uoa_target: d('Annual UOA target.'),
    role: d('Elevate role.'),
    pms_role: d('Role in Dentally.'),
    title: d('Title / job title.'),
    last_login_at: d('Last login in Dentally.'),
    // ads
    name: d('Display name.'),
    currency: d('Account currency (ISO code).'),
    is_selected: d('Account included in Elevate reporting.'),
    campaign_name: d('Campaign name in the provider.'),
    metric_date: d('Reporting day (provider account timezone).'),
    spend_pence: d('Spend in pence.'),
    impressions: d('Impressions.'),
    clicks: d('Clicks.'),
    conversions: d('Provider-reported conversions (leads). No individual lead records are supplied.'),
    campaign_status: d('Campaign status in the provider.'),
    objective: d('Campaign objective.'),
    reach: d('Unique people reached (Meta).'),
    frequency: d('Average impressions per person (Meta).', 'number'),
    practice_name: d('Practice name resolved from practice_id (ads: via the ad account mapping).'),
    cpl_pence: d('Cost per lead in pence: spend ÷ conversions (null when no conversions).'),
    period_reach: d('Reach over the account\'s synced window (Meta).'),
    period_frequency: d('Frequency over the synced window (Meta).', 'number'),
    period_impressions: d('Impressions over the synced window.'),
    period_clicks: d('Clicks over the synced window.'),
    period_spend_pence: d('Spend over the synced window in pence.'),
    period_conversions: d('Conversions over the synced window.'),
    period_window_start: d('Start of the synced window.'),
    period_window_end: d('End of the synced window.'),
    period_synced_at: d('When the window figures were last pulled.'),
    // gohighlevel
    label: d('Owner-given label of the sub-account.'),
    last_sync_at: d('Last successful sync of this sub-account.'),
    pipeline_name: d('GoHighLevel pipeline name.'),
    stage_name: d('GoHighLevel stage name.'),
    ghl_stage_name: d('Stage name at sync time.'),
    estimated_value_pence: d('Opportunity value in pence.'),
    outcome: d('won (treatment started/completed) | lost (not proceeding / failed to attend) | open.'),
    channel: d('Message channel (sms, email, call, whatsapp…).'),
    direction: d('inbound | outbound.'),
    delivery_status: d('Provider delivery status.'),
    subject: d('Message subject. PII — owner only.'),
    body: d('Message text. PII — owner only.'),
    calendar_name: d('GoHighLevel calendar name.'),
    // emergent
    accepted_date: d('Date the treatment was accepted.'),
    value_pence: d('Accepted treatment value in pence.'),
    ext_source: d('Lead source recorded in Emergent.'),
    ext_campaign: d('Campaign recorded in Emergent.'),
    business_name: d('Emergent business (site) name.'),
    cashup_date: d('Cash-up day.'),
    treatments_accepted: d('Treatments accepted that day (count).'),
    tx_plans_given: d('Treatment plans given (count).'),
    tx_plan_given_value_pence: d('Value of treatment plans given in pence.'),
    cash_up_money_taken_pence: d('Money taken per the manager cash-up in pence.'),
    num_bookings: d('Bookings made.'),
    num_new_leads: d('New leads.'),
    num_follow_ups: d('Follow-ups made.'),
    num_attended: d('Patients attended.'),
    total_chairs: d('Chairs available.'),
    chairs_used: d('Chairs used.'),
    chair_utilisation: d('Chairs used ÷ chairs available, per cent.', 'percent'),
    reviews_collected: d('Reviews collected.'),
    before_after_pictures: d('Before/after photo sets taken.'),
    video_testimonials: d('Video testimonials recorded.'),
    practice_plan_signups: d('Practice plan sign-ups.'),
    total_refunds_pence: d('Refunds in pence.'),
    source_google: d('Leads from Google (count).'),
    source_facebook: d('Leads from Facebook (count).'),
    source_walk_in: d('Walk-in leads (count).'),
    source_friends_family: d('Friends & family referrals (count).'),
    source_wl_website: d('Website leads (count).'),
    source_dentist_referral: d('Dentist referrals (count).'),
    source_instagram: d('Instagram leads (count).'),
    source_youtube: d('YouTube leads (count).'),
    source_other: d('Other-source leads (count).'),
    custom_sources: d('Additional sources as JSON.'),
    refunds: d('Refund count.'),
    appointment_booked_for: d('Appointments booked for (free text from the cash-up).'),
    detail_patient_rows_count: d('Patient rows on the detailed cash-up.'),
    detail_patient_money_total_pence: d('Sum of the detailed patient rows in pence.'),
    variance_manager_vs_detail: d('Manager total minus detailed rows total, pence.', 'number'),
    emergent_created_at: d('Created in Emergent.'),
    emergent_created_by: d('Created by (Emergent user).'),
    period_month: d('Accounting month.'),
    revenue_pence: d('Revenue in pence.'),
    gross_profit_pence: d('Gross profit in pence.'),
    net_profit_pence: d('Net profit in pence.'),
    total_cost_of_sales_pence: d('Cost of sales in pence.'),
    total_operating_expenses_pence: d('Operating expenses in pence.'),
    cash_collected_pence: d('Cash collected in pence.'),
    tx_accepted_amount_pence: d('Treatment accepted amount in pence.'),
    bank_balance_pence: d('Bank balance at month end in pence.'),
    average_wait_time: d('Average wait time (as reported).', 'number'),
    principal_fees_pence: d('Principal fees in pence.'),
    hygienist_therapist_pence: d('Hygienist / therapist cost in pence.'),
    lab_fees_pence: d('Lab fees in pence.'),
    materials_pence: d('Materials in pence.'),
    sedation_services_pence: d('Sedation services in pence.'),
    advertising_marketing_pence: d('Advertising and marketing in pence.'),
    bank_charges_pence: d('Bank charges in pence.'),
    business_rates_rent_pence: d('Business rates and rent in pence.'),
    salaries_staff_cost_pence: d('Salaries and staff cost in pence.'),
    telephone_wifi_pence: d('Telephone and wifi in pence.'),
    utilities_pence: d('Utilities in pence.'),
    insurance_pence: d('Insurance in pence.'),
    management_fees_pence: d('Management fees in pence.'),
    subscriptions_pence: d('Subscriptions in pence.'),
    it_expenses_pence: d('IT expenses in pence.'),
    card_machine_charges_pence: d('Card machine charges in pence.'),
    custom_lines: d('Additional P&L lines as JSON.'),
    last_updated_at: d('Last updated in Emergent.'),
    last_updated_by: d('Last updated by (Emergent user).'),
    created_at: d('When the row was created in Elevate.'),
    updated_at: d('When the row was last updated in Elevate.'),
    // summaries
    day: d('Calendar day (Europe/London).'),
    month: d('Calendar month (first day, Europe/London).'),
    appointments: d('Patient appointments in the period (any status).'),
    new_patients: d('Patients whose Dentally registration date falls in the period.'),
    treatment_items: d('Completed treatment items (Practitioner Activity rule).'),
    treatment_items_pence: d('Value of completed treatment items in pence.'),
    billed_pence: d('Invoice lines billed in pence (fee × quantity).'),
    settled_pence: d('Settled payments in pence — cash collected.'),
    leads_new: d('GoHighLevel opportunities created in the period.'),
    leads_won: d('Of those, opportunities now at treatment started/completed.'),
    ad_spend_pence: d('Google + Meta spend attributed to the practice in pence.'),
    dna_pct: d('DNA ÷ (occurred + DNA) × 100.'),
    avg_fee_pence: d('treatment_items_pence ÷ treatment_items.'),
    financial_revenue_pence: d('Accounting revenue (Xero/QuickBooks, accrual) for the month; manual rows only where no synced row exists.'),
    financial_costs_pence: d('Accounting costs (associates, staff, lab, materials, overhead, other; tax excluded) for the month.'),
};

export const DATASET_COLUMN_DOCS = {
    'dentally/appointments': {
        status: d('scheduled | confirmed | in_progress | completed | cancelled | no_show (Dentally state mapped).'),
    },
    'dentally/payments': {
        status: d('settled | pending | failed | refunded. Only settled counts as cash collected.'),
    },
    'dentally/practitioners': {
        email: d('Work email (staff contact, not patient data).'),
    },
    'dentally/staff': {
        email: d('Work email (staff contact, not patient data).'),
        phone: d('Work phone (staff contact, not patient data).'),
    },
    'gohighlevel/opportunities': {
        status: d('Elevate pipeline stage mapped from the GoHighLevel stage (new_lead … treatment_started, not_proceeding…).'),
    },
    'gohighlevel/subaccounts': {
        status: d('active | failed | disconnected — sync health of the sub-account.'),
    },
    'gohighlevel/appointments': {
        status: d('GoHighLevel booking status (confirmed, cancelled, showed, noshow…).'),
        title: d('Booking title.'),
    },
    'google-ads/accounts': { status: d('Account status in Google Ads.') },
    'meta-ads/accounts': { status: d('Account status in Meta.') },
    'emergent/treatments_accepted': {
        status: d('Emergent record status.'),
        practitioner_name: d('Practitioner as recorded in Emergent.'),
    },
    'summaries/practice_day': {
        practice_id: d('Practice the day\'s figures belong to. Null = rows not attributed to a site.'),
    },
    'summaries/practice_month': {
        practice_id: d('Practice the month\'s figures belong to. Null = org-level accounting rows / unattributed.'),
    },
};

export function docFor(ds, col) {
    const override = DATASET_COLUMN_DOCS[`${ds.source}/${ds.key}`]?.[col];
    const base = COLUMN_DOCS[col];
    const doc = override ?? base;
    return { unit: doc?.unit ?? inferUnit(col), description: doc?.description ?? '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/data-room-dictionary.test.mjs`
Expected: PASS (the "documents every column" case passes because the registry does not yet list the summary columns; Task 3 keeps it green by adding docs above for them already).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/data-room/dictionary.js backend/test/data-room-dictionary.test.mjs
git commit -m "feat(data-room): column dictionary (unit + description per column)"
```

---

### Task 3: Registry — derived columns, view tables, summaries source, client shape

**Files:**
- Modify: `backend/src/lib/data-room/registry.js`
- Test: `backend/test/data-room-registry.test.mjs`

**Interfaces:**
- Registry column entries become `{ col, pii?: true, derived?: true, unit, description }` (docs merged at load).
- Dataset entries may carry `derived: 'rpc'` + `rpc: '<function name>'`; `table` then equals the rpc name (validator needs a string).
- `registryForClient()` returns `{ sources: [{ key, label, description, datasets: [{ key, label, roster, summary, columns: [{ col, pii, derived, unit, description }] }] }] }`.
- `validateRegistry()` additionally reports `<id>: undocumented column <col>` and `<id>: rpc dataset must name its function`.
- New source key `summaries`; datasets `summaries/practice_day` (`dateCol: 'day'`, `dateType: 'date'`) and `summaries/practice_month` (`dateCol: 'month'`, `dateType: 'date'`).

- [ ] **Step 1: Write the failing tests** (append to `backend/test/data-room-registry.test.mjs`)

```js
import { registryForClient, getDataset, validateRegistry, DATASETS, SOURCES } from '../src/lib/data-room/registry.js';

describe('derived columns + views', () => {
  it('dentally/appointments reads the view and exposes the rule columns', () => {
    const ds = getDataset('dentally', 'appointments');
    expect(ds.table).toBe('data_room_dentally_appointments');
    const derived = ds.columns.filter((c) => c.derived).map((c) => c.col);
    expect(derived).toEqual(['is_patient_appointment', 'occurred', 'dna', 'cancelled', 'duration_mins', 'practitioner_name']);
    expect(ds.columns.find((c) => c.col === 'occurred')).toMatchObject({ derived: true, unit: 'flag' });
  });
  it('patients gets a pseudonymous key that is NOT pii', () => {
    const ds = getDataset('dentally', 'patients');
    expect(ds.table).toBe('data_room_dentally_patients');
    expect(ds.columns.find((c) => c.col === 'patient_key')).toMatchObject({ derived: true, pii: undefined, unit: 'hash' });
    expect(ds.columns.map((c) => c.col)).toEqual(expect.arrayContaining(['birth_year', 'postcode_district']));
  });
  it('opportunities exposes pipeline_name + outcome; both ads datasets read data_room_ad_metrics', () => {
    expect(getDataset('gohighlevel', 'opportunities').columns.map((c) => c.col)).toEqual(expect.arrayContaining(['pipeline_name', 'outcome']));
    expect(getDataset('google-ads', 'campaign_daily').table).toBe('data_room_ad_metrics');
    expect(getDataset('meta-ads', 'campaign_daily').table).toBe('data_room_ad_metrics');
    expect(getDataset('google-ads', 'campaign_daily').where).toEqual({ provider: 'google_ads' });
  });
  it('every column carries a unit and a description', () => {
    for (const ds of DATASETS) for (const c of ds.columns) {
      expect(c.unit, `${ds.source}/${ds.key}.${c.col}`).toBeTruthy();
      expect(c.description, `${ds.source}/${ds.key}.${c.col}`).toBeTruthy();
    }
  });
});

describe('summaries source', () => {
  it('registers practice_day and practice_month as rpc datasets', () => {
    expect(SOURCES.map((s) => s.key)).toContain('summaries');
    const day = getDataset('summaries', 'practice_day');
    expect(day).toMatchObject({ derived: 'rpc', rpc: 'data_room_practice_day', dateCol: 'day', dateType: 'date' });
    const month = getDataset('summaries', 'practice_month');
    expect(month).toMatchObject({ derived: 'rpc', rpc: 'data_room_practice_month', dateCol: 'month', dateType: 'date' });
    expect(month.columns.map((c) => c.col)).toEqual(expect.arrayContaining(['dna_pct', 'financial_revenue_pence']));
  });
  it('client shape flags summary datasets and derived columns', () => {
    const src = registryForClient().sources.find((s) => s.key === 'summaries');
    expect(src.datasets.map((d) => d.summary)).toEqual([true, true]);
    const appt = registryForClient().sources.find((s) => s.key === 'dentally').datasets.find((d) => d.key === 'appointments');
    expect(appt.summary).toBe(false);
    expect(appt.columns.find((c) => c.col === 'occurred')).toEqual({ col: 'occurred', pii: false, derived: true, unit: 'flag', description: expect.stringMatching(/completed/) });
  });
  it('validateRegistry still returns []', () => {
    expect(validateRegistry()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/data-room-registry.test.mjs`
Expected: FAIL — `ds.table` is `'appointments'`, no `derived` columns, `summaries` source missing.

- [ ] **Step 3: Edit the registry**

In `backend/src/lib/data-room/registry.js`:

(a) Add the import and a `dv` helper next to `c`/`pii`:

```js
import { docFor } from './dictionary.js';

const c = (col) => ({ col });
const pii = (col) => ({ col, pii: true });
const dv = (col) => ({ col, derived: true }); // computed in the data_room_* view / RPC
const cols = (...names) => names.map((n) => (typeof n === 'string' ? c(n) : n));
```

(b) Add the `summaries` source to `SOURCES`:

```js
    { key: 'summaries', label: 'Summaries', description: 'Practice-level KPIs per day and per month, computed with the same rules as the dashboard cards: patient appointments, occurred, DNA, new patients, treatment activity, billed and settled money, leads, ad spend and (monthly) accounting revenue and costs.' },
```

(c) Change these dataset entries (only the lines shown change):

```js
    // dentally/patients
    source: 'dentally', key: 'patients', label: 'Patients', table: 'data_room_dentally_patients',
    …
            'pms_registered_at', 'created_at', dv('patient_key'), dv('birth_year'), dv('postcode_district')),

    // dentally/appointments
    source: 'dentally', key: 'appointments', label: 'Appointments', table: 'data_room_dentally_appointments',
    …
            'pms_patient_id', 'pms_practitioner_id', 'starts_at', 'ends_at', 'status', 'appointment_type',
            dv('is_patient_appointment'), dv('occurred'), dv('dna'), dv('cancelled'), dv('duration_mins'), dv('practitioner_name')),

    // dentally/payments
    source: 'dentally', key: 'payments', label: 'Payments', table: 'data_room_dentally_payments',
    …
            'status', 'processed_at', dv('is_settled')),

    // dentally/invoice_items
    source: 'dentally', key: 'invoice_items', label: 'Invoice items', table: 'data_room_dentally_invoice_items',
    …
            'unit_price_pence', 'fee_pence', 'quantity', 'nhs_charge', 'invoiced_on', 'invoice_paid',
            dv('fee_total_pence'), dv('practitioner_name')),

    // dentally/treatment_items
    source: 'dentally', key: 'treatment_items', label: 'Treatment items', table: 'data_room_dentally_treatment_items',
    …
            'base_chart', 'charged', 'appear_on_invoice', dv('counts_as_activity'), dv('practitioner_name')),

    // google-ads/campaign_daily  and  meta-ads/campaign_daily
    … table: 'data_room_ad_metrics',
    …
            'impressions', 'clicks', 'conversions', 'campaign_status', 'objective', dv('practice_name'), dv('cpl_pence')),
    // (meta keeps 'reach', 'frequency' before 'campaign_status')

    // gohighlevel/contacts
    source: 'gohighlevel', key: 'contacts', label: 'Contacts', table: 'data_room_gohighlevel_contacts',
    …
            pii('last_name'), pii('email'), pii('phone'), 'created_at', dv('contact_key')),

    // gohighlevel/opportunities
    source: 'gohighlevel', key: 'opportunities', label: 'Opportunities', table: 'data_room_gohighlevel_opportunities',
    …
            'status', 'created_at', 'updated_at', dv('pipeline_name'), dv('outcome')),
```

(d) Append the two summary datasets at the end of `DATASETS`:

```js
    // --------------------------------------------------------------- Summaries
    {
        source: 'summaries', key: 'practice_day', label: 'Practice by day', table: 'data_room_practice_day',
        derived: 'rpc', rpc: 'data_room_practice_day',
        practice: { col: 'practice_id' }, dateCol: 'day', dateType: 'date',
        columns: cols('id', 'practice_id', 'practice_name', 'day', 'appointments', 'occurred', 'dna', 'cancelled',
            'new_patients', 'treatment_items', 'treatment_items_pence', 'billed_pence', 'settled_pence',
            'leads_new', 'leads_won', 'ad_spend_pence'),
    },
    {
        source: 'summaries', key: 'practice_month', label: 'Practice by month', table: 'data_room_practice_month',
        derived: 'rpc', rpc: 'data_room_practice_month',
        practice: { col: 'practice_id' }, dateCol: 'month', dateType: 'date',
        columns: cols('id', 'practice_id', 'practice_name', 'month', 'appointments', 'occurred', 'dna', 'cancelled',
            'new_patients', 'treatment_items', 'treatment_items_pence', 'billed_pence', 'settled_pence',
            'leads_new', 'leads_won', 'ad_spend_pence', 'dna_pct', 'avg_fee_pence', 'cpl_pence',
            'financial_revenue_pence', 'financial_costs_pence'),
    },
];

// Merge unit + description into every column entry once, at load.
for (const ds of DATASETS) {
    ds.columns = ds.columns.map((col) => ({ ...col, ...docFor(ds, col.col) }));
}
```

(e) Replace `registryForClient()`:

```js
export function registryForClient() {
    return {
        sources: SOURCES.map((s) => ({
            key: s.key,
            label: s.label,
            description: s.description,
            datasets: DATASETS.filter((d) => d.source === s.key).map((d) => ({
                key: d.key,
                label: d.label,
                roster: d.dateCol === null,
                summary: d.derived === 'rpc',
                columns: d.columns.map((c) => ({
                    col: c.col, pii: c.pii === true, derived: c.derived === true, unit: c.unit, description: c.description,
                })),
            })),
        })),
    };
}
```

(f) In `validateRegistry()`, inside the `for (const d of DATASETS)` loop after the `organisation_id` check, add:

```js
        if (d.derived === 'rpc' && typeof d.rpc !== 'string') problems.push(`${id}: rpc dataset must name its function`);
        for (const col of d.columns || []) {
            if (!col.description) problems.push(`${id}: undocumented column ${col.col}`);
        }
```

Also update the file header comment: `table` may be a `data_room_*` view; `derived` accepts `'ghl_pipelines' | 'rpc'`; `rpc` names the function; columns carry `derived/unit/description`.

- [ ] **Step 4: Run the registry + dictionary + repository tests**

Run: `cd backend && npx vitest run test/data-room-registry.test.mjs test/data-room-dictionary.test.mjs test/data-room-repository.test.mjs`
Expected: registry + dictionary PASS. The repository test `always scopes by organisation_id and applies the static where` FAILS on the `select` string (new derived columns and view name). Fix that assertion to:

```js
    expect(q.table).toBe('data_room_dentally_appointments');
    expect(q.select).toBe('id,practice_id,contact_id,associate_id,pms_external_id,pms_patient_id,pms_practitioner_id,starts_at,ends_at,status,appointment_type,is_patient_appointment,occurred,dna,cancelled,duration_mins,practitioner_name');
```

Re-run; all three files PASS. Then run the full data-room set: `npx vitest run test/data-room-*.test.mjs` — the service test `strips PII columns for an analyst` still passes (it only checks absence of `first_name` and presence of `pms_external_id`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/data-room/registry.js backend/test/data-room-registry.test.mjs backend/test/data-room-repository.test.mjs
git commit -m "feat(data-room): derived columns via data_room_* views, summaries source, documented registry"
```

---

### Task 4: Repository — `rpcRows`, `practices`, `practiceNull`, `freshness`

**Files:**
- Modify: `backend/src/repositories/data-room.repository.js`
- Test: `backend/test/data-room-repository.test.mjs`

**Interfaces:**
- `rpcRows(orgId, fn, { since, until, practiceId }) → Promise<Row[]>` — calls `serviceClient.rpc(fn, { p_org, p_since, p_until, p_practice })`.
- `practices(orgId) → Promise<{ id, name }[]>` ordered by name.
- `applyFilters` honours `filters.practiceNull === true` → `q.is(ds.practice.col, null)` (direct-column datasets only).
- `freshness(orgId) → Promise<{ integrations: { provider, status, last_sync_at }[], accounts: { provider, label, status, last_sync_at }[] }>`.

- [ ] **Step 1: Write the failing tests** (append to `backend/test/data-room-repository.test.mjs`)

```js
describe('rpcRows()', () => {
  it('calls the named function with p_org always set and p_practice null for scope=all', async () => {
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = () => ({ data: [{ id: 'x:2026-08-01', practice_id: PRACTICE, day: '2026-08-01', occurred: 3 }], error: null });
    const rows = await dataRoomRepository.rpcRows(ORG, 'data_room_practice_day', { since: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z', practiceId: null });
    expect(rows).toHaveLength(1);
    expect(supaRec.rpcCalls[0]).toEqual({ fn: 'data_room_practice_day', params: { p_org: ORG, p_since: '2026-08-01T00:00:00.000Z', p_until: '2026-09-01T00:00:00.000Z', p_practice: null } });
    supaRec.rpcProvider = undefined;
  });
  it('throws on an rpc error', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(dataRoomRepository.rpcRows(ORG, 'data_room_practice_day', { since: 'a', until: 'b', practiceId: null })).rejects.toThrow('boom');
    supaRec.rpcProvider = undefined;
  });
});

describe('practices() + practiceNull filter', () => {
  it('lists org practices ordered by name', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: PRACTICE, name: 'Ashford' }], error: null });
    const out = await dataRoomRepository.practices(ORG);
    expect(out).toEqual([{ id: PRACTICE, name: 'Ashford' }]);
    expect(supaRec.last.table).toBe('practices');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.order).toEqual({ col: 'name', opts: { ascending: true } });
  });
  it('practiceNull filters IS NULL on the practice column', async () => {
    const ds = getDataset('dentally', 'appointments');
    await dataRoomRepository.page(ORG, ds, { ...NONE, practiceNull: true }, { after: null, limit: 10 });
    expect(supaRec.last.iss).toContainEqual({ col: 'practice_id', val: null });
  });
});

describe('freshness()', () => {
  it('reads integrations and integration_accounts for the org only', async () => {
    const seen = [];
    supaRec.resultProvider = (q) => { seen.push(q); return { data: [], error: null }; };
    await dataRoomRepository.freshness(ORG);
    expect(seen.map((q) => q.table).sort()).toEqual(['integration_accounts', 'integrations']);
    for (const q of seen) expect(q.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/data-room-repository.test.mjs`
Expected: FAIL — `dataRoomRepository.rpcRows is not a function`, etc.

- [ ] **Step 3: Implement**

In `backend/src/repositories/data-room.repository.js`:

In `applyFilters`, change the practice block to:

```js
    if (ds.practice.col) {
        if (filters.practiceNull) q = q.is(ds.practice.col, null);
        else if (filters.practiceId) q = q.eq(ds.practice.col, filters.practiceId);
    } else if (filters.practiceKeys) {
        q = q.in(ds.practice.via.col, filters.practiceKeys);
    }
```

Add to the exported object (after `pipelineRows`):

```js
    /** Summary dataset rows from a data_room_* RPC. p_org is always the caller's org. */
    async rpcRows(orgId, fn, { since, until, practiceId }) {
        const { data, error } = await supabase_1.serviceClient.rpc(fn, {
            p_org: orgId, p_since: since, p_until: until, p_practice: practiceId ?? null,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },

    /** Practices of the org, for one-worksheet-per-practice exports. */
    async practices(orgId) {
        const { data, error } = await supabase_1.serviceClient.from('practices').select('id,name')
            .eq('organisation_id', orgId)
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    /** Sync timestamps per provider (+ per GHL/QBO account) for the "data as of" badge. */
    async freshness(orgId) {
        const [ints, accs] = await Promise.all([
            supabase_1.serviceClient.from('integrations').select('provider,status,last_sync_at').eq('organisation_id', orgId),
            supabase_1.serviceClient.from('integration_accounts').select('provider,label,status,last_sync_at').eq('organisation_id', orgId),
        ]);
        if (ints.error) throw new Error(ints.error.message);
        if (accs.error) throw new Error(accs.error.message);
        return { integrations: ints.data ?? [], accounts: accs.data ?? [] };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/data-room-repository.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/data-room.repository.js backend/test/data-room-repository.test.mjs
git commit -m "feat(data-room): repository rpcRows/practices/freshness + practiceNull filter"
```

---

### Task 5: Service — RPC datasets in page/CSV, window fix, freshness

**Files:**
- Modify: `backend/src/services/data-room.service.js`
- Test: `backend/test/data-room-service.test.mjs`

**Interfaces:**
- `derivedRows(orgId, ds, query)` handles `ds.derived === 'rpc'`: validates the window, resolves `practiceId` from `query.scope`, calls `dataRoomRepository.rpcRows(orgId, ds.rpc, { since, until, practiceId })`.
- `streamCsv` diff `since/until` come from `window(ds, query)` (no longer from `prepared.filters`, which does not exist for derived datasets).
- `exportFilename(ds, query, ext = 'csv')`.
- `freshness(user) → { sources: { [sourceKey]: { last_sync_at: string|null, status: string|null, accounts?: [{ label, status, last_sync_at }] } }, as_of: string|null }` where `sourceKey ∈ dentally|google-ads|meta-ads|gohighlevel|emergent|summaries`.

- [ ] **Step 1: Write the failing tests** (append to `backend/test/data-room-service.test.mjs`; also add `rpcRows: vi.fn(async () => [])`, `practices: vi.fn(async () => [])`, `freshness: vi.fn(async () => ({ integrations: [], accounts: [] }))` to the `vi.mock` factory and reset them in `beforeEach`)

```js
describe('summaries (rpc datasets)', () => {
  it('page() calls the rpc with the validated window and practice, pages by offset', async () => {
    repo.rpcRows.mockResolvedValue([{ id: 'p:2026-08-01', occurred: 1 }, { id: 'p:2026-08-02', occurred: 2 }, { id: 'p:2026-08-03', occurred: 3 }]);
    const out = await dataRoomService.page(analyst, 'summaries', 'practice_day', { ...WIN, scope: PRACTICE, page: 2, limit: 2 });
    expect(repo.rpcRows).toHaveBeenCalledWith(ORG, 'data_room_practice_day', { since: WIN.since, until: WIN.until, practiceId: PRACTICE });
    expect(out).toEqual({ rows: [{ id: 'p:2026-08-03', occurred: 3 }], next_cursor: null, total: 3 });
  });
  it('page() 400s without a window', async () => {
    await expect(dataRoomService.page(analyst, 'summaries', 'practice_month', { ...WIN, since: undefined, until: undefined }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(repo.rpcRows).not.toHaveBeenCalled();
  });
  it('streamCsv() writes rpc rows once and audits the validated window', async () => {
    repo.rpcRows.mockResolvedValue([{ id: 'p:2026-08-01', practice_id: PRACTICE, practice_name: 'Ashford', day: '2026-08-01', occurred: 5 }]);
    const chunks = [];
    const sink = { write: (s) => chunks.push(s), end: vi.fn() };
    const out = await dataRoomService.streamCsv(analyst, 'summaries', 'practice_day', WIN, sink, { isAborted: () => false });
    expect(out).toEqual({ rows: 1 });
    expect(chunks.join('')).toContain('Ashford');
    expect(repo.logExport.mock.calls[0][2]).toMatchObject({ source: 'summaries', dataset: 'practice_day', since: WIN.since, until: WIN.until, rows: 1 });
  });
});

describe('freshness()', () => {
  it('maps providers to source keys and takes the latest GHL account sync', async () => {
    repo.freshness.mockResolvedValue({
      integrations: [
        { provider: 'dentally', status: 'active', last_sync_at: '2026-08-27T03:10:00.000Z' },
        { provider: 'google_ads', status: 'active', last_sync_at: '2026-08-27T02:50:00.000Z' },
        { provider: 'gohighlevel', status: 'active', last_sync_at: null },
      ],
      accounts: [
        { provider: 'gohighlevel', label: 'Ashford', status: 'active', last_sync_at: '2026-08-26T22:05:00.000Z' },
        { provider: 'gohighlevel', label: 'Bexley', status: 'failed', last_sync_at: '2026-08-25T22:05:00.000Z' },
      ],
    });
    const out = await dataRoomService.freshness(analyst);
    expect(out.sources.dentally).toEqual({ last_sync_at: '2026-08-27T03:10:00.000Z', status: 'active' });
    expect(out.sources['google-ads'].last_sync_at).toBe('2026-08-27T02:50:00.000Z');
    expect(out.sources['meta-ads']).toEqual({ last_sync_at: null, status: null });
    expect(out.sources.gohighlevel.last_sync_at).toBe('2026-08-26T22:05:00.000Z');
    expect(out.sources.gohighlevel.accounts).toHaveLength(2);
    expect(out.sources.summaries.last_sync_at).toBe('2026-08-27T03:10:00.000Z');
    expect(out.as_of).toBe('2026-08-27T03:10:00.000Z');
    expect(repo.freshness).toHaveBeenCalledWith(ORG);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/data-room-service.test.mjs`
Expected: FAIL — `Unknown derived dataset rpc` (500), `dataRoomService.freshness is not a function`.

- [ ] **Step 3: Implement**

In `backend/src/services/data-room.service.js`:

Replace `derivedRows`:

```js
/** Derived datasets live in memory; page them by numeric offset. */
async function derivedRows(orgId, ds, query) {
    if (ds.derived === 'ghl_pipelines') {
        const practiceId = query.scope === 'all' ? null : query.scope;
        return dataRoomRepository.pipelineRows(orgId, practiceId);
    }
    if (ds.derived === 'rpc') {
        const win = window(ds, query);
        const practiceId = query.scope === 'all' ? null : query.scope;
        return dataRoomRepository.rpcRows(orgId, ds.rpc, { since: win.since, until: win.until, practiceId });
    }
    throw new AppError(`Unknown derived dataset ${ds.derived}`, 500);
}
```

Change `exportFilename`:

```js
    exportFilename(ds, query, ext = 'csv') {
        const base = `${ds.source}-${ds.key}`;
        if (!ds.dateCol) return `${base}_${londonDate(new Date().toISOString())}.${ext}`;
        const lastDay = londonDate(new Date(new Date(query.until).getTime() - 1).toISOString());
        return `${base}_${londonDate(query.since)}_${lastDay}.${ext}`;
    },
```

In `streamCsv`, replace the `prepared`/`diff` block with:

```js
        const win = window(ds, query); // validates before the first byte
        const prepared = ds.derived
            ? { derived: await derivedRows(orgId, ds, query) }
            : await buildFilters(orgId, ds, query);

        const diff = {
            source: ds.source, dataset: ds.key, scope: query.scope,
            since: win.since, until: win.until,
            pii: includePii, rows: 0,
        };
```

Add `freshness` to the exported object:

```js
    async freshness(user) {
        const { integrations, accounts } = await dataRoomRepository.freshness(user.organisation_id);
        const PROVIDER_TO_SOURCE = { dentally: 'dentally', google_ads: 'google-ads', meta_ads: 'meta-ads', gohighlevel: 'gohighlevel', emergent: 'emergent' };
        const sources = {};
        for (const key of ['dentally', 'google-ads', 'meta-ads', 'gohighlevel', 'emergent']) sources[key] = { last_sync_at: null, status: null };
        for (const i of integrations) {
            const key = PROVIDER_TO_SOURCE[i.provider];
            if (!key) continue;
            sources[key] = { last_sync_at: i.last_sync_at ?? null, status: i.status ?? null };
        }
        const ghlAccounts = accounts.filter((a) => a.provider === 'gohighlevel')
            .map((a) => ({ label: a.label ?? null, status: a.status ?? null, last_sync_at: a.last_sync_at ?? null }));
        if (ghlAccounts.length) {
            const latest = ghlAccounts.map((a) => a.last_sync_at).filter(Boolean).sort().at(-1) ?? null;
            sources.gohighlevel = { ...sources.gohighlevel, last_sync_at: latest ?? sources.gohighlevel.last_sync_at, accounts: ghlAccounts };
        }
        const all = Object.values(sources).map((s) => s.last_sync_at).filter(Boolean).sort();
        const asOf = all.at(-1) ?? null;
        sources.summaries = { last_sync_at: asOf, status: asOf ? 'active' : null };
        return { sources, as_of: asOf };
    },
```

Update the file header comment to mention rpc datasets and freshness.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/data-room-service.test.mjs`
Expected: PASS (all existing cases too — the `since/until` values in the audit diff are unchanged for table datasets because `window()` returns the same ISO strings `buildFilters` used).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/data-room.service.js backend/test/data-room-service.test.mjs
git commit -m "feat(data-room): summaries via rpc datasets, freshness, ext-aware export filename"
```

---

### Task 6: Excel export — `exceljs` helper, service, controller, route

**Files:**
- Modify: `backend/package.json` (dependency)
- Create: `backend/src/lib/data-room/xlsx.js`
- Modify: `backend/src/services/data-room.service.js`
- Modify: `backend/src/controllers/data-room.controller.js`
- Modify: `backend/src/routes/data-room.routes.js`
- Test: `backend/test/data-room-xlsx.test.mjs`, `backend/test/data-room-routes.test.mjs`

**Interfaces:**
- `lib/data-room/xlsx.js`: `sheetName(raw: string, used: Set<string>): string` (Excel-safe, ≤31 chars, unique), `openWorkbook(stream): { addSheet(name, columns): Sheet, finish(): Promise<void> }` where `columns = [{ col, unit }]` and `Sheet.addRow(row: object): void`, `Sheet.commit(): void`. Money columns (`unit === 'pence'`) get a neighbour `<col>_gbp` numeric column with `numFmt '£#,##0.00'`; `date`/`timestamptz` become `Date` cells; `flag` becomes `TRUE/FALSE` booleans; objects become JSON text.
- `dataRoomService.prepareExport(user, source, key, query) → Plan` (throws 400/403/404/413 before any byte) and `dataRoomService.writeXlsx(plan, stream, meta) → { rows }`; `XLSX_ROW_CAP = 500_000`.
- Route `GET /api/data-room/:source/:dataset/export.xlsx` (same query params as CSV) → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<source>-<dataset>_<since>_<until>.xlsx"`.
- Audit row identical to CSV plus `format: 'xlsx'`.

- [ ] **Step 1: Add the dependency**

Run: `cd backend && npm install exceljs@^4.4.0`
Expected: `package.json` `dependencies` gains `"exceljs": "^4.4.0"`; `package-lock.json` updated.

- [ ] **Step 2: Write the failing helper test**

`backend/test/data-room-xlsx.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import './setup.js';
import { sheetName, openWorkbook } from '../src/lib/data-room/xlsx.js';

async function collect(stream) {
  const bufs = [];
  for await (const b of stream) bufs.push(b);
  return Buffer.concat(bufs);
}

describe('sheetName', () => {
  it('strips forbidden characters, truncates to 31 and de-duplicates', () => {
    const used = new Set();
    expect(sheetName('Ashford: Main [Street] / Surgery?*', used)).toBe('Ashford Main Street  Surgery');
    expect(sheetName('Ashford: Main [Street] / Surgery?*', used)).toBe('Ashford Main Street  Surgery (2)');
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31);
    expect(sheetName('', used)).toBe('Sheet');
  });
});

describe('openWorkbook', () => {
  it('writes one sheet per addSheet with typed cells and a £ neighbour for pence columns', async () => {
    const out = new PassThrough();
    const done = collect(out);
    const wb = openWorkbook(out);
    const s = wb.addSheet('Ashford', [
      { col: 'id', unit: 'id' }, { col: 'starts_at', unit: 'timestamptz' }, { col: 'invoiced_on', unit: 'date' },
      { col: 'fee_pence', unit: 'pence' }, { col: 'occurred', unit: 'flag' }, { col: 'meta', unit: 'text' },
    ]);
    s.addRow({ id: 'r1', starts_at: '2026-08-01T09:30:00.000Z', invoiced_on: '2026-08-01', fee_pence: 12345, occurred: true, meta: { a: 1 } });
    s.commit();
    const t = wb.addSheet('Bexley', [{ col: 'id', unit: 'id' }]);
    t.addRow({ id: 'r2' });
    t.commit();
    await wb.finish();

    const buf = await done;
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buf);
    expect(read.worksheets.map((w) => w.name)).toEqual(['Ashford', 'Bexley']);
    const ws = read.getWorksheet('Ashford');
    expect(ws.getRow(1).values.slice(1)).toEqual(['id', 'starts_at', 'invoiced_on', 'fee_pence', 'fee_gbp', 'occurred', 'meta']);
    const r = ws.getRow(2);
    expect(r.getCell(2).value).toBeInstanceOf(Date);
    expect(r.getCell(3).value).toBeInstanceOf(Date);
    expect(r.getCell(4).value).toBe(12345);
    expect(r.getCell(5).value).toBe(123.45);
    expect(r.getCell(5).numFmt).toBe('£#,##0.00');
    expect(r.getCell(6).value).toBe(true);
    expect(r.getCell(7).value).toBe('{"a":1}');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run test/data-room-xlsx.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/data-room/xlsx.js`.

- [ ] **Step 4: Write the helper**

`backend/src/lib/data-room/xlsx.js`:

```js
// backend/src/lib/data-room/xlsx.js
// ============================================================================
// Data Room Excel writer — a thin wrapper over exceljs's streaming
// WorkbookWriter. One worksheet per addSheet(); rows are committed as they
// are written so memory stays flat for large exports. No I/O of its own: the
// caller hands in the writable (Express `res` in prod, a PassThrough in
// tests). Cell typing follows the dictionary unit:
//   pence       -> integer cell + a `<col>_gbp` neighbour (£#,##0.00)
//   date        -> Date (midnight UTC)      timestamptz -> Date
//   flag        -> boolean                  object      -> JSON text
// ============================================================================
import ExcelJS from 'exceljs';

const FORBIDDEN = /[\[\]:*?/\\]/g;

/** Excel-safe, <=31 chars, unique within `used` (mutated). */
export function sheetName(raw, used) {
    let base = String(raw ?? '').replace(FORBIDDEN, '').trim().slice(0, 31) || 'Sheet';
    let name = base;
    let n = 2;
    while (used.has(name)) {
        const suffix = ` (${n++})`;
        name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name);
    return name;
}

function cell(unit, v) {
    if (v === null || v === undefined) return null;
    switch (unit) {
        case 'date':
        case 'timestamptz': {
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? String(v) : d;
        }
        case 'flag': return typeof v === 'boolean' ? v : String(v);
        default:
            if (typeof v === 'object') return JSON.stringify(v);
            return v;
    }
}

export function openWorkbook(stream) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const used = new Set();
    return {
        addSheet(name, columns) {
            const ws = workbook.addWorksheet(sheetName(name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
            const header = [];
            const plan = []; // { key, unit, gbpOf? }
            for (const c of columns) {
                header.push(c.col);
                plan.push({ key: c.col, unit: c.unit });
                if (c.unit === 'pence') {
                    const gbp = c.col.endsWith('_pence') ? c.col.slice(0, -6) + '_gbp' : c.col + '_gbp';
                    header.push(gbp);
                    plan.push({ key: c.col, unit: 'gbp' });
                }
            }
            ws.columns = header.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
            ws.getRow(1).font = { bold: true };
            ws.getRow(1).commit();
            return {
                addRow(row) {
                    const values = plan.map((p) => {
                        if (p.unit === 'gbp') {
                            const v = row[p.key];
                            return typeof v === 'number' ? v / 100 : null;
                        }
                        return cell(p.unit, row[p.key]);
                    });
                    const r = ws.addRow(values);
                    plan.forEach((p, i) => { if (p.unit === 'gbp') r.getCell(i + 1).numFmt = '£#,##0.00'; });
                    r.commit();
                },
                commit() { ws.commit(); },
            };
        },
        async finish() { await workbook.commit(); },
    };
}
```

- [ ] **Step 5: Run the helper test**

Run: `cd backend && npx vitest run test/data-room-xlsx.test.mjs`
Expected: PASS. (If `sheetName('Ashford: Main [Street] / Surgery?*')` yields a double space differently from the expectation, fix the expectation to the actual — the rule is "forbidden characters removed", spacing is incidental.)

- [ ] **Step 6: Write the failing service tests** (append to `backend/test/data-room-service.test.mjs`)

```js
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

async function readWorkbook(stream) {
  const bufs = [];
  for await (const b of stream) bufs.push(b);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(bufs));
  return wb;
}

describe('xlsx export', () => {
  it('prepareExport() enforces the PII gate, the window and the row cap before any byte', async () => {
    await expect(dataRoomService.prepareExport(analyst, 'dentally', 'patients', { ...WIN, pii: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(dataRoomService.prepareExport(owner, 'dentally', 'appointments', { ...WIN, since: undefined, until: undefined })).rejects.toMatchObject({ statusCode: 400 });
    repo.count.mockResolvedValue(500_001);
    await expect(dataRoomService.prepareExport(owner, 'dentally', 'appointments', WIN)).rejects.toMatchObject({ statusCode: 413 });
  });
  it('writeXlsx() with scope=all writes one worksheet per practice plus Unassigned, and audits format=xlsx', async () => {
    repo.practices.mockResolvedValue([{ id: PRACTICE, name: 'Ashford' }, { id: '33333333-3333-4333-8333-333333333333', name: 'Bexleyheath' }]);
    repo.count.mockResolvedValue(3);
    repo.page.mockImplementation(async (orgId, ds, filters) => {
      if (filters.practiceNull) return [{ id: 'u1', practice_id: null, starts_at: '2026-08-03T09:00:00.000Z', status: 'completed' }];
      if (filters.practiceId === PRACTICE) return [{ id: 'a1', practice_id: PRACTICE, starts_at: '2026-08-01T09:00:00.000Z', status: 'completed' }];
      return [];
    });
    const plan = await dataRoomService.prepareExport(analyst, 'dentally', 'appointments', WIN);
    const out = new PassThrough();
    const reading = readWorkbook(out);
    const res = await dataRoomService.writeXlsx(plan, out, { isAborted: () => false, ip: '1.1.1.1', userAgent: 'vitest' });
    const wb = await reading;
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Ashford', 'Bexleyheath', 'Unassigned']);
    expect(wb.getWorksheet('Ashford').rowCount).toBe(2);
    expect(wb.getWorksheet('Ashford').getRow(1).values).not.toContain('first_name');
    expect(res).toEqual({ rows: 2 });
    expect(repo.logExport.mock.calls[0][2]).toMatchObject({ source: 'dentally', dataset: 'appointments', format: 'xlsx', rows: 2, pii: false });
  });
  it('writeXlsx() with a practice scope writes a single sheet named after the practice', async () => {
    repo.practices.mockResolvedValue([{ id: PRACTICE, name: 'Ashford' }]);
    repo.count.mockResolvedValue(1);
    repo.page.mockResolvedValue([{ id: 'a1', practice_id: PRACTICE, starts_at: '2026-08-01T09:00:00.000Z', status: 'completed' }]);
    const plan = await dataRoomService.prepareExport(owner, 'dentally', 'appointments', { ...WIN, scope: PRACTICE });
    const out = new PassThrough();
    const reading = readWorkbook(out);
    await dataRoomService.writeXlsx(plan, out, { isAborted: () => false });
    const wb = await reading;
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Ashford']);
  });
  it('writeXlsx() for an rpc dataset writes one "All practices" sheet', async () => {
    repo.rpcRows.mockResolvedValue([{ id: 'p:2026-08-01', practice_id: PRACTICE, practice_name: 'Ashford', day: '2026-08-01', occurred: 4, settled_pence: 1000 }]);
    const plan = await dataRoomService.prepareExport(analyst, 'summaries', 'practice_day', WIN);
    const out = new PassThrough();
    const reading = readWorkbook(out);
    await dataRoomService.writeXlsx(plan, out, { isAborted: () => false });
    const wb = await reading;
    expect(wb.worksheets.map((w) => w.name)).toEqual(['All practices']);
    expect(wb.getWorksheet('All practices').getRow(1).values).toContain('settled_gbp');
  });
});
```

- [ ] **Step 7: Run to verify they fail**

Run: `cd backend && npx vitest run test/data-room-service.test.mjs`
Expected: FAIL — `dataRoomService.prepareExport is not a function`.

- [ ] **Step 8: Implement in the service**

Add near the top of `backend/src/services/data-room.service.js`:

```js
import { openWorkbook } from '../lib/data-room/xlsx.js';

export const XLSX_ROW_CAP = 500_000; // Excel holds 1,048,576 rows; stay well under and keep files openable
```

Add a helper (after `lastCursor`):

```js
/** Registry columns (name + unit) for the selected column names, in order. */
function typedColumns(ds, cols) {
    const byName = new Map(ds.columns.map((c) => [c.col, c]));
    return cols.map((name) => ({ col: name, unit: byName.get(name)?.unit ?? 'text' }));
}

/** All rows for a filter set, in keyset batches, handed to `onBatch`. Returns rows written. */
async function eachBatch(orgId, ds, filters, cols, isAborted, onBatch) {
    let after = null;
    let n = 0;
    for (;;) {
        if (isAborted()) return { n, aborted: true };
        const batch = await dataRoomRepository.page(orgId, ds, filters, { after, limit: EXPORT_BATCH, columns: cols });
        if (batch.length === 0) break;
        onBatch(batch);
        n += batch.length;
        if (batch.length < EXPORT_BATCH) break;
        after = decodeCursor(lastCursor(ds, batch));
    }
    return { n, aborted: false };
}
```

Add to the exported object:

```js
    /**
     * Validate an Excel export and decide its worksheets BEFORE any byte is
     * written (so failures still answer JSON). Throws 400/403/404/413.
     */
    async prepareExport(user, source, key, query) {
        const ds = resolve(source, key);
        const includePii = assertPii(user, query.pii);
        const cols = columnNames(ds, includePii);
        const orgId = user.organisation_id;
        const win = window(ds, query);
        const plan = { ds, cols, typed: typedColumns(ds, cols), orgId, userId: user.id, query, win, includePii, sheets: [] };

        if (ds.derived) {
            plan.derived = await derivedRows(orgId, ds, query);
            if (plan.derived.length > XLSX_ROW_CAP) throw new AppError(`Export too large for Excel (${plan.derived.length} rows). Narrow the period or use CSV.`, 413);
            plan.sheets.push({ name: 'All practices', derived: true });
            return plan;
        }

        const { filters, empty } = await buildFilters(orgId, ds, query);
        plan.filters = filters;
        plan.empty = empty;
        if (!empty) {
            const total = await dataRoomRepository.count(orgId, ds, filters);
            if (total > XLSX_ROW_CAP) throw new AppError(`Export too large for Excel (${total} rows). Narrow the period or use CSV.`, 413);
        }
        const practices = await dataRoomRepository.practices(orgId);
        if (query.scope === 'all' && ds.practice.col) {
            for (const p of practices) plan.sheets.push({ name: p.name, filters: { ...filters, practiceId: p.id } });
            plan.sheets.push({ name: 'Unassigned', filters: { ...filters, practiceId: null, practiceNull: true } });
        } else if (query.scope !== 'all') {
            const p = practices.find((x) => x.id === query.scope);
            plan.sheets.push({ name: p?.name ?? 'Practice', filters });
        } else {
            plan.sheets.push({ name: 'All practices', filters });
        }
        return plan;
    },

    /** Stream the prepared workbook to `stream`. Always writes ONE audit row. */
    async writeXlsx(plan, stream, meta) {
        const { ds, cols, typed, orgId, userId, query, win, includePii } = plan;
        const diff = {
            source: ds.source, dataset: ds.key, scope: query.scope,
            since: win.since, until: win.until, pii: includePii, format: 'xlsx', rows: 0,
        };
        const audit = async (aborted) => {
            const d = aborted ? { ...diff, aborted: true } : diff;
            await dataRoomRepository.logExport(orgId, userId, d, { ip: meta.ip, userAgent: meta.userAgent });
        };
        const wb = openWorkbook(stream);
        try {
            for (const sheet of plan.sheets) {
                const ws = wb.addSheet(sheet.name, typed);
                if (sheet.derived) {
                    for (const row of plan.derived) ws.addRow(row);
                    diff.rows += plan.derived.length;
                } else if (!plan.empty) {
                    const { n, aborted } = await eachBatch(orgId, ds, sheet.filters, cols, meta.isAborted, (batch) => {
                        for (const row of batch) ws.addRow(row);
                    });
                    diff.rows += n;
                    if (aborted) { ws.commit(); await wb.finish(); await audit(true); return { rows: diff.rows }; }
                }
                ws.commit();
            }
            await wb.finish();
        } catch (err) {
            await audit(true);
            throw err;
        }
        await audit(false);
        return { rows: diff.rows };
    },
```

Also refactor `streamCsv`'s inner loop to use `eachBatch` (same behaviour, one implementation):

```js
            } else if (!prepared.empty) {
                const { n, aborted } = await eachBatch(orgId, ds, prepared.filters, cols, meta.isAborted, (batch) => {
                    sink.write(rowsToCsv(cols, batch));
                });
                diff.rows = n;
                if (aborted) { await audit(true); sink.end(); return { rows: diff.rows }; }
            }
```

- [ ] **Step 9: Run the service tests**

Run: `cd backend && npx vitest run test/data-room-service.test.mjs`
Expected: PASS.

- [ ] **Step 10: Controller + route + route test**

In `backend/src/controllers/data-room.controller.js` add:

```js
    async freshness(req, res) {
        res.json(await dataRoomService.freshness(req.user));
    },

    async exportXlsx(req, res) {
        const { source, dataset } = data_room_model_1.dataRoomParamsSchema.parse(req.params);
        const query = data_room_model_1.dataRoomQuerySchema.parse(req.query);
        // Everything that can fail with a JSON status happens here, before headers.
        const plan = await dataRoomService.prepareExport(req.user, source, dataset, query);

        let aborted = false;
        req.on('close', () => { if (!res.writableEnded) aborted = true; });

        res.status(200);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${dataRoomService.exportFilename(plan.ds, query, 'xlsx')}"`);
        res.setHeader('Cache-Control', 'no-store');
        try {
            await dataRoomService.writeXlsx(plan, res, {
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                isAborted: () => aborted,
            });
        } catch (err) {
            req.log?.error({ err }, 'Data Room xlsx export failed mid-stream');
            res.end();
        }
    },
```

In `backend/src/routes/data-room.routes.js` (static route before the params route):

```js
router.get('/datasets', gate, (0, async_handler_1.asyncHandler)(dataRoomController.datasets));
router.get('/freshness', gate, (0, async_handler_1.asyncHandler)(dataRoomController.freshness));
router.get('/:source/:dataset/export.csv', gate, (0, async_handler_1.asyncHandler)(dataRoomController.exportCsv));
router.get('/:source/:dataset/export.xlsx', gate, (0, async_handler_1.asyncHandler)(dataRoomController.exportXlsx));
router.get('/:source/:dataset', gate, (0, async_handler_1.asyncHandler)(dataRoomController.page));
```

In `backend/test/data-room-routes.test.mjs` extend the `vi.mock` factory with:

```js
    freshness: vi.fn(async () => ({ sources: { dentally: { last_sync_at: '2026-08-27T03:10:00.000Z', status: 'active' } }, as_of: '2026-08-27T03:10:00.000Z' })),
    prepareExport: vi.fn(async (user, source, dataset, query) => {
      if (query.pii && user.role !== 'owner') throw new AppError('PII export is owner-only', 403);
      return { ds: { source, key: dataset, dateCol: 'starts_at' }, query };
    }),
    writeXlsx: vi.fn(async (plan, stream) => { stream.write('PK'); stream.end(); return { rows: 1 }; }),
```

and add cases (using the file's existing request helper and role headers):

```js
  it('GET /freshness passes for analyst and owner', async () => {
    for (const role of ['analyst', 'owner']) {
      const r = await get('/api/data-room/freshness', role);
      expect(r.status).toBe(200);
      expect((await r.json()).as_of).toBe('2026-08-27T03:10:00.000Z');
    }
  });
  it('GET export.xlsx sets the spreadsheet headers and streams', async () => {
    const r = await get('/api/data-room/dentally/appointments/export.xlsx?since=2026-08-01T00:00:00Z&until=2026-09-01T00:00:00Z', 'analyst');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/spreadsheetml/);
    expect(r.headers.get('content-disposition')).toMatch(/\.xlsx"$/);
    expect(await r.text()).toBe('PK');
  });
  it('GET export.xlsx answers JSON 403 when prepare rejects (no headers sent)', async () => {
    const r = await get('/api/data-room/dentally/patients/export.xlsx?since=2026-08-01T00:00:00Z&until=2026-09-01T00:00:00Z&pii=1', 'analyst');
    expect(r.status).toBe(403);
    expect(r.headers.get('content-type')).toMatch(/json/);
  });
```

(`get(path, role)` is the helper already defined at line 71 of that file — `fetch` against the test server with an `x-test-role` header; it returns a WHATWG `Response`, hence `r.headers.get(...)`, `r.json()`, `r.text()`.)

Run: `cd backend && npx vitest run test/data-room-routes.test.mjs test/data-room-service.test.mjs test/data-room-xlsx.test.mjs`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/lib/data-room/xlsx.js backend/src/services/data-room.service.js backend/src/controllers/data-room.controller.js backend/src/routes/data-room.routes.js backend/test/data-room-xlsx.test.mjs backend/test/data-room-service.test.mjs backend/test/data-room-routes.test.mjs
git commit -m "feat(data-room): Excel export (one worksheet per practice) + freshness endpoint"
```

---

### Task 7: Dictionary generator + `docs/DATA_ROOM_DICTIONARY.md`

**Files:**
- Create: `backend/scripts/data-room-dictionary.js`
- Modify: `backend/package.json` (script)
- Generate: `docs/DATA_ROOM_DICTIONARY.md`

**Interfaces:**
- `npm run data-room:dictionary` (from `backend/`) writes `../docs/DATA_ROOM_DICTIONARY.md` deterministically from `SOURCES`/`DATASETS`; exits non-zero if `validateRegistry()` reports problems.

- [ ] **Step 1: Write the script**

`backend/scripts/data-room-dictionary.js`:

```js
#!/usr/bin/env node
// Generates docs/DATA_ROOM_DICTIONARY.md from the Data Room registry so the
// analyst has an offline copy of every dataset and column. Deterministic;
// re-run after any registry change and commit the result.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SOURCES, DATASETS, validateRegistry } from '../src/lib/data-room/registry.js';

const problems = validateRegistry();
if (problems.length) {
    console.error('Registry problems:\n - ' + problems.join('\n - '));
    process.exit(1);
}

const UNIT_LABEL = {
    id: 'id', hash: 'hash', pence: 'pence (integer; £ = ÷100)', count: 'count', number: 'number', percent: '%',
    minutes: 'minutes', flag: 'yes/no', date: 'date', timestamptz: 'timestamp (UTC)', text: 'text',
};

const lines = [];
lines.push('# Data Room dictionary');
lines.push('');
lines.push('Generated by `npm run data-room:dictionary` (backend). Do not edit by hand.');
lines.push('');
lines.push('All money is integer pence. Timestamps are UTC instants (the UI shows London time). "PII" columns are withheld from every role except an owner who explicitly requests them. "Derived" columns are computed from the row by the rules noted in each description.');
lines.push('');
lines.push('## How the numbers are defined');
lines.push('');
lines.push('- **Patient appointment**: a Dentally appointment with a patient attached (`pms_patient_id` not null). Diary blocks (lunch, admin) are excluded, matching Dentally\'s "With patients" view.');
lines.push('- **Occurred**: patient appointment with status `completed`. **DNA**: status `no_show`. `dna_pct = dna ÷ (occurred + dna)`.');
lines.push('- **New patient**: Dentally registration date (`pms_registered_at`) falls in the period.');
lines.push('- **Treatment activity**: treatment items with `completed = true` and `base_chart = false`, dated on `completed_at`, attributed to the practitioner\'s home site.');
lines.push('- **Billed**: invoice lines by `invoiced_on`, `fee_pence × quantity`. **Settled**: payments with status `settled` by `processed_at`.');
lines.push('- **Leads**: GoHighLevel opportunities by `created_at`; **won** = now at `treatment_started` or `treatment_completed`; **lost** = `not_proceeding` or `failed_to_attend`.');
lines.push('- **Ad spend**: Google + Meta daily spend attributed to a practice through the ad-account → practice mapping.');
lines.push('- **Accounting revenue / costs** (monthly): Xero/QuickBooks accrual rows; a manual row counts only where no synced row exists for that month and bucket. Costs = associates + staff + lab + materials + overhead + other (tax excluded).');
lines.push('');
for (const s of SOURCES) {
    lines.push(`## ${s.label} (\`${s.key}\`)`);
    lines.push('');
    lines.push(s.description);
    lines.push('');
    for (const d of DATASETS.filter((x) => x.source === s.key)) {
        const kind = d.derived === 'rpc' ? 'summary' : d.dateCol === null ? 'roster (not date-filtered)' : `dated on \`${d.dateCol}\``;
        lines.push(`### ${d.label} (\`${s.key}/${d.key}\`) — ${kind}`);
        lines.push('');
        lines.push('| Column | Unit | PII | Derived | Description |');
        lines.push('|---|---|---|---|---|');
        for (const c of d.columns) {
            lines.push(`| \`${c.col}\` | ${UNIT_LABEL[c.unit] ?? c.unit} | ${c.pii ? 'yes' : ''} | ${c.derived ? 'yes' : ''} | ${c.description.replace(/\|/g, '\\|')} |`);
        }
        lines.push('');
    }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../docs/DATA_ROOM_DICTIONARY.md');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out}`);
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json` `scripts`: `"data-room:dictionary": "node scripts/data-room-dictionary.js"`.

- [ ] **Step 3: Generate and inspect**

Run: `cd backend && npm run data-room:dictionary && head -40 ../docs/DATA_ROOM_DICTIONARY.md`
Expected: `wrote …/docs/DATA_ROOM_DICTIONARY.md`; the file opens with the "How the numbers are defined" section and lists 6 sources / 29 datasets.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/data-room-dictionary.js backend/package.json docs/DATA_ROOM_DICTIONARY.md
git commit -m "docs(data-room): generated column dictionary + generator script"
```

---

### Task 8: Frontend — types, Excel export button, freshness badge

**Files:**
- Modify: `frontend/features/data-room/api.ts`
- Modify: `frontend/features/data-room/hooks.ts`
- Modify: `frontend/features/data-room/components/DataRoomScreen.tsx`

**Interfaces:**
- `DataRoomSourceKey` gains `'summaries'`; `DataRoomColumn = { col, pii, derived, unit, description }`; `DataRoomDataset` gains `summary: boolean`.
- `dataRoomExportUrl(source, dataset, params, format: 'csv' | 'xlsx' = 'csv')`.
- `fetchDataRoomFreshness(): Promise<DataRoomFreshness>` with `DataRoomFreshness = { sources: Record<string, { last_sync_at: string | null; status: string | null; accounts?: { label: string | null; status: string | null; last_sync_at: string | null }[] }>; as_of: string | null }`; hook `useDataRoomFreshness()`.

- [ ] **Step 1: `api.ts`**

Replace the type block and add the freshness fetcher:

```ts
export type DataRoomSourceKey = 'dentally' | 'google-ads' | 'meta-ads' | 'gohighlevel' | 'emergent' | 'summaries';

export type DataRoomUnit = 'id' | 'hash' | 'pence' | 'count' | 'number' | 'percent' | 'minutes' | 'flag' | 'date' | 'timestamptz' | 'text';
export interface DataRoomColumn { col: string; pii: boolean; derived: boolean; unit: DataRoomUnit; description: string }
export interface DataRoomDataset { key: string; label: string; roster: boolean; summary: boolean; columns: DataRoomColumn[] }
export interface DataRoomSource { key: DataRoomSourceKey; label: string; description: string; datasets: DataRoomDataset[] }
export interface DataRoomRegistry { sources: DataRoomSource[] }

export interface DataRoomSourceFreshness {
  last_sync_at: string | null;
  status: string | null;
  accounts?: { label: string | null; status: string | null; last_sync_at: string | null }[];
}
export interface DataRoomFreshness { sources: Record<string, DataRoomSourceFreshness>; as_of: string | null }
```

and

```ts
export function fetchDataRoomFreshness(): Promise<DataRoomFreshness> {
  return api<DataRoomFreshness>('/api/data-room/freshness');
}

/** Same-origin download href — the browser streams the file to disk. */
export function dataRoomExportUrl(
  source: DataRoomSourceKey,
  dataset: string,
  params: DataRoomParams,
  format: 'csv' | 'xlsx' = 'csv',
): string {
  return `${PROXY}/api/data-room/${source}/${dataset}/export.${format}?${qs(params)}`;
}
```

- [ ] **Step 2: `hooks.ts`**

```ts
import { fetchDataRoomFreshness, fetchDataRoomPage, fetchDataRoomRegistry, type DataRoomParams, type DataRoomSourceKey } from './api';

export function useDataRoomFreshness() {
  return useQuery({ queryKey: ['data-room-freshness'], queryFn: fetchDataRoomFreshness, staleTime: 60_000 });
}
```

- [ ] **Step 3: `DataRoomScreen.tsx`**

Imports: add `useDataRoomFreshness` to the hooks import.

Add after `const { data: me } = useMe();`:

```tsx
  const { data: fresh } = useDataRoomFreshness();
  const srcFresh = fresh?.sources[source];
  const asOf = srcFresh?.last_sync_at ?? fresh?.as_of ?? null;
```

Replace the single `Export CSV` anchor with a split control and the freshness badge; the toolbar block becomes:

```tsx
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-[13px] text-ink-muted">
              {q.isLoading ? 'Counting…' : `${total.toLocaleString('en-GB')} rows`}
              {active.roster ? ' · current list — not date-filtered' : ` · ${win.label}`}
            </span>
            <span
              className="text-[12px] px-2 py-0.5 rounded-lg border border-border bg-card text-ink-muted"
              title={srcFresh?.accounts?.length ? srcFresh.accounts.map((a) => `${a.label ?? 'account'}: ${a.last_sync_at ? new Date(a.last_sync_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'never'} (${a.status ?? 'unknown'})`).join('\n') : undefined}
            >
              {asOf ? `Data as of ${new Date(asOf).toLocaleString('en-GB', { timeZone: 'Europe/London' })}` : 'Not yet synced'}
              {srcFresh?.status === 'failed' ? ' · last sync failed' : ''}
            </span>
            {isOwner && hasPii && (
              <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
                <input type="checkbox" checked={pii} onChange={(e) => setPii(e.target.checked)} />
                Include patient PII
              </label>
            )}
            {!isOwner && hasPii && (
              <span className="text-[12px] text-ink-muted">Patient identifiers are withheld — rows join on contact and PMS ids.</span>
            )}
            <div className="ml-auto inline-flex rounded-xl shadow-panel-sm overflow-hidden">
              <a
                href={dataRoomExportUrl(source, active.key, queryParams, 'csv')}
                download
                className="inline-flex items-center bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700 border-r border-white/20"
              >
                Export CSV
              </a>
              <a
                href={dataRoomExportUrl(source, active.key, queryParams, 'xlsx')}
                download
                title={queryParams.scope === 'all' ? 'One worksheet per practice' : 'One worksheet'}
                className="inline-flex items-center bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700"
              >
                Export Excel
              </a>
            </div>
          </div>
```

Also update `formatCell` so percent and minutes render sensibly:

```tsx
function formatCell(col: string, v: unknown, unit?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if ((unit === 'pence' || col.endsWith('_pence')) && typeof v === 'number') return formatPence(v);
  if (unit === 'percent' && typeof v === 'number') return `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
  if (unit === 'minutes' && typeof v === 'number') return `${v} min`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && ISO_TS.test(v)) {
    return new Date(v).toLocaleString('en-GB', { timeZone: 'Europe/London' });
  }
  return String(v);
}
```

and in the `columns` memo pass the unit: `render: (row: DataRoomRow) => <span className="whitespace-nowrap">{formatCell(c.col, row[c.col], c.unit)}</span>`; align right when `c.unit === 'pence' || c.unit === 'count' || c.unit === 'percent'`.

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/data-room/api.ts frontend/features/data-room/hooks.ts frontend/features/data-room/components/DataRoomScreen.tsx
git commit -m "feat(data-room): Excel export button, data-as-of badge, unit-aware cell formatting"
```

---

### Task 9: Frontend — dictionary drawer + derived-column tag

**Files:**
- Create: `frontend/features/data-room/components/DictionaryDrawer.tsx`
- Modify: `frontend/features/data-room/components/DataRoomScreen.tsx`

**Interfaces:**
- `<DictionaryDrawer open dataset={DataRoomDataset} sourceLabel onClose />` — right-hand panel listing every column (name, unit, PII, derived, description) of the active dataset, plus a link to the "How the numbers are defined" notes.

- [ ] **Step 1: Write the drawer**

`frontend/features/data-room/components/DictionaryDrawer.tsx`:

```tsx
'use client';

// Data Room dictionary — a slide-in panel explaining every column of the
// active dataset. Content comes from the API registry (unit + description),
// so it is always in step with what the table shows. No dark mode.

import { useEffect } from 'react';
import type { DataRoomDataset } from '../api';

const UNIT_LABEL: Record<string, string> = {
  id: 'id', hash: 'hash', pence: 'pence (£ = ÷100)', count: 'count', number: 'number', percent: '%',
  minutes: 'minutes', flag: 'yes / no', date: 'date', timestamptz: 'timestamp', text: 'text',
};

const RULES: [string, string][] = [
  ['Patient appointment', 'A Dentally appointment with a patient attached. Diary blocks (lunch, admin) are excluded — matches Dentally\'s "With patients" view.'],
  ['Occurred / DNA', 'Patient appointment with status completed / no_show. DNA % = DNA ÷ (occurred + DNA).'],
  ['New patient', 'Dentally registration date falls in the period.'],
  ['Treatment activity', 'Items completed and not base-chart, dated on completed_at, attributed to the practitioner\'s home site.'],
  ['Billed / Settled', 'Invoice lines by invoiced_on (fee × quantity) / payments with status settled by processed_at.'],
  ['Leads won / lost', 'GoHighLevel opportunities by created date; won = treatment started or completed; lost = not proceeding or failed to attend.'],
  ['Accounting revenue / costs', 'Xero or QuickBooks accrual rows per month; manual rows count only where nothing was synced. Costs exclude tax.'],
];

export default function DictionaryDrawer({
  open, dataset, sourceLabel, onClose,
}: { open: boolean; dataset: DataRoomDataset | null; sourceLabel: string; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !dataset) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Column dictionary">
      <button type="button" aria-label="Close dictionary" onClick={onClose} className="absolute inset-0 bg-black/20" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-card border-l border-border shadow-panel overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">Dictionary · {sourceLabel} / {dataset.label}</div>
            <div className="text-[12px] text-ink-muted">
              {dataset.summary ? 'Summary dataset — one row per practice per period.' : dataset.roster ? 'Current list — not date-filtered.' : 'One row per source record.'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto text-[13px] text-ink-muted hover:text-ink">Close</button>
        </div>

        <div className="px-5 py-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">Column</th>
                <th className="py-1.5 pr-3 font-medium">Unit</th>
                <th className="py-1.5 pr-3 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {dataset.columns.map((c) => (
                <tr key={c.col} className="border-t border-border align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <code className="text-[12px]">{c.col}</code>
                    {c.derived && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-brand">derived</span>}
                    {c.pii && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-muted">PII</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-muted">{UNIT_LABEL[c.unit] ?? c.unit}</td>
                  <td className="py-2 pr-3 text-ink">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">How the numbers are defined</h3>
          <dl className="text-[13px]">
            {RULES.map(([k, v]) => (
              <div key={k} className="py-1.5 border-t border-border">
                <dt className="font-medium text-ink">{k}</dt>
                <dd className="text-ink-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the screen**

In `DataRoomScreen.tsx`:

```tsx
import DictionaryDrawer from './DictionaryDrawer';
…
  const [dict, setDict] = useState(false);
```

In the toolbar, before the export split control:

```tsx
            <button
              type="button"
              onClick={() => setDict(true)}
              className="text-[13px] px-3 py-1.5 rounded-xl border border-border bg-card text-ink hover:border-brand-200"
            >
              Dictionary
            </button>
```

Derived columns get a header tag — in the `columns` memo:

```tsx
        header: c.derived ? `${c.col} ·` : c.col,
```

(`Column.header` is typed `string` in `components/ui/DataTable.tsx`, so the trailing ` ·` is the visible "derived" marker; the drawer explains it.)

After the closing `</>` of `{active && (…)}` add:

```tsx
      <DictionaryDrawer open={dict} dataset={active} sourceLabel={src.label} onClose={() => setDict(false)} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/data-room/components/DictionaryDrawer.tsx frontend/features/data-room/components/DataRoomScreen.tsx
git commit -m "feat(data-room): column dictionary drawer + derived-column marker"
```

---

### Task 10: Frontend — Summaries page, nav, permissions

**Files:**
- Create: `frontend/app/(dashboard)/data-summaries/page.tsx`
- Modify: `frontend/lib/nav.ts`
- Modify: `frontend/lib/permissions.ts`

**Interfaces:**
- Route id `data-summaries` → `/data-summaries`, permission `data.export`, member of `DATA_ROOM_ROUTES` (so the analyst lock/nav treat it as Data Room).

- [ ] **Step 1: Page**

`frontend/app/(dashboard)/data-summaries/page.tsx`:

```tsx
import DataRoomScreen from '@/features/data-room/components/DataRoomScreen';

export default function Page() {
  return <DataRoomScreen source="summaries" />;
}
```

- [ ] **Step 2: Nav**

In `frontend/lib/nav.ts`, the Data Room section becomes:

```ts
  { label: 'Data Room', items: [
    { id: 'data-summaries', label: 'Summaries', isNew: true },
    { id: 'data-dentally', label: 'Dentally', isNew: true },
    { id: 'data-google-ads', label: 'Google Ads', isNew: true },
    { id: 'data-meta-ads', label: 'Meta Ads', isNew: true },
    { id: 'data-gohighlevel', label: 'GoHighLevel', isNew: true },
    { id: 'data-emergent', label: 'Emergent', isNew: true },
  ]},
```

- [ ] **Step 3: Permissions**

In `frontend/lib/permissions.ts` add `'data-summaries': 'data.export',` to the route→permission map next to the other `data-*` entries, and add `'data-summaries'` to the `DATA_ROOM_ROUTES` array (line ~149).

- [ ] **Step 4: Verify in the browser (dev)**

Run: `cd frontend && npm run dev` (backend `npm run dev` too). Log in as the owner; open `/data-summaries`: pills "Practice by day" / "Practice by month"; rows per practice for the selected period; Export CSV / Export Excel download; Dictionary drawer opens; "Data as of" badge shows. Open `/data-dentally` → Appointments: `occurred`, `dna`, `practitioner_name` columns present with the ` ·` marker. Stop the dev server afterwards.

- [ ] **Step 5: Typecheck, lint, build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: clean build (stop `next dev` first — shared `.next`).

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(dashboard)/data-summaries/page.tsx" frontend/lib/nav.ts frontend/lib/permissions.ts
git commit -m "feat(data-room): Summaries page (practice by day / month) in the Data Room nav"
```

---

### Task 11: Documentation + final verification

**Files:**
- Modify: `docs/API.md` (Data Room section)
- Modify: `CLAUDE.md` (current-state entry)
- Regenerate: `docs/DATA_ROOM_DICTIONARY.md` (no-op if unchanged)

- [ ] **Step 1: `docs/API.md`**

In the `## Data Room (`/api/data-room/*`)` section:

Update the `GET /api/data-room/datasets` line to: `Registry for the UI. { sources: [{ key, label, description, datasets: [{ key, label, roster, summary, columns: [{ col, pii, derived, unit, description }] }] }] }. Sources: summaries, dentally, google-ads, meta-ads, gohighlevel, emergent. unit ∈ id|hash|pence|count|number|percent|minutes|flag|date|timestamptz|text.`

Add after it:

```markdown
### `GET /api/data-room/freshness`

"Data as of" for the badge. `{ sources: { dentally|google-ads|meta-ads|gohighlevel|emergent|summaries: { last_sync_at, status, accounts?: [{ label, status, last_sync_at }] } }, as_of }` — `last_sync_at` from `integrations` (GoHighLevel: latest across `integration_accounts`, which are listed under `accounts`); `summaries.last_sync_at = as_of` = the latest of all sources.
```

Under the page endpoint add a paragraph:

```markdown
**Derived columns** (`derived: true` in the registry) are computed in `public.data_room_*` views (migration `…000131`): appointments `is_patient_appointment / occurred / dna / cancelled / duration_mins / practitioner_name`, patients `patient_key / birth_year / postcode_district`, payments `is_settled`, invoice_items `fee_total_pence / practitioner_name`, treatment_items `counts_as_activity / practitioner_name`, GHL contacts `contact_key`, opportunities `pipeline_name / outcome`, ads `practice_name / cpl_pence`. **Summary datasets** (`summaries/practice_day`, `summaries/practice_month`; `summary: true`) come from RPCs `data_room_practice_day` / `data_room_practice_month` (service_role only), require `since`/`until`, page by offset, and carry `id = "<practice_id|unassigned>:<day|YYYY-MM>"`.
```

Add after the CSV endpoint:

```markdown
### `GET /api/data-room/:source/:dataset/export.xlsx?scope&since&until&pii`

Same filters and PII gate as CSV. Streams an `.xlsx` workbook (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<source>-<dataset>_<since>_<until>.xlsx"`). `scope=all` on a practice-column dataset → one worksheet per practice (+ "Unassigned"); a practice scope → one worksheet named after it; `via`/summary datasets → "All practices". Header row bold + frozen; pence columns keep their integer value and gain a `<name>_gbp` neighbour formatted `£#,##0.00`; dates/timestamps are real Excel dates (UTC). Row cap 500 000 → `413 { error: "Export too large for Excel (N rows). Narrow the period or use CSV." }` before any byte. Audited like CSV with `format: 'xlsx'`.
```

- [ ] **Step 2: `CLAUDE.md`**

Append to the "Current state" list:

```markdown
- **Data Room — analyst-ready (Phase 1 of the ETL/rehearsal-org spec, SHIPPED on `feat/data-room`)**: derived-column views `public.data_room_*` + summary RPCs `data_room_practice_day/month` (migration `000131`, applied on hosted, `NOTIFY pgrst` run) give the analyst the dashboard's rules in the rows (`occurred`/`dna`/`patient_key`/`practitioner_name`/`outcome`…) and a new `summaries` source (practice by day / month, reconciles to `appointments_rollup_by_practice` + settled receipts — check with `scripts/data-room-reconcile.sql`). Excel export (`export.xlsx`, `exceljs`, one worksheet per practice, `_gbp` neighbour columns, 500k row cap), `GET /api/data-room/freshness` badge, column dictionary (`lib/data-room/dictionary.js` → drawer in the UI + generated `docs/DATA_ROOM_DICTIONARY.md` via `npm run data-room:dictionary`; `validateRegistry()` fails on any undocumented column). Spec: `docs/superpowers/specs/2026-08-27-etl-pipeline-rehearsal-org-and-analyst-data-room-design.md`; Phases 2–3 (etl_runs ledger, runner, rehearsal org) not started.
```

- [ ] **Step 3: Full verification**

Run:

```bash
cd backend && npm test && npm run lint && npm run typecheck && npm run data-room:dictionary && git status --short docs/DATA_ROOM_DICTIONARY.md
cd ../frontend && npm run typecheck && npm run lint && npm run build
```

Expected: backend suite green (≈1500 + the new cases), lint 0 errors, dictionary regenerated with no diff, frontend clean.

- [ ] **Step 4: Commit**

```bash
git add docs/API.md CLAUDE.md docs/DATA_ROOM_DICTIONARY.md
git commit -m "docs(data-room): API entries for summaries/xlsx/freshness; CLAUDE.md state"
```

Then tell the owner the branch is ready to push/merge and that the analyst can be invited from Team → role `analyst`.

---

## Self-review against the spec (Phase 1)

| Spec 1.x requirement | Task |
|---|---|
| Derived columns for appointments / patients / treatment_items / invoice_items / payments / opportunities / contacts / ads | 1 (views), 3 (registry) — treatment_plans deferred per spec |
| Views in `public`, `security_invoker`, service_role only | 1 |
| Summary datasets `practice_day` / `practice_month` via RPCs with the revoke idiom; offset paging; full export | 1, 3, 5 |
| Reconciliation to `appointments_rollup_by_practice` / settled receipts | 1 (Step 4 + `scripts/data-room-reconcile.sql`) |
| Excel export: same gate/filters/filename, one tab per practice, bold frozen header, pence + `£` neighbour, real dates, 500k cap → 413, audited | 6 |
| Split CSV/Excel button, `exportUrl(…, format)` | 8 |
| Registry `description` + `unit`; `/datasets` returns them | 2, 3 |
| Dictionary drawer + "How the numbers are defined" | 9 |
| Freshness badge from `integrations.last_sync_at` (GHL: latest account) | 4, 5, 6 (route), 8 |
| `docs/DATA_ROOM_DICTIONARY.md` generated by `npm run data-room:dictionary` | 7 |
| Analyst onboarding (no code) | Task 11 closing note |
| `docs/API.md` updated | 11 |

Type/name consistency checked: `rpcRows(orgId, fn, { since, until, practiceId })` (Tasks 4 → 5 → 6), `practices(orgId)` (4 → 6), `filters.practiceNull` (4 → 6), `exportFilename(ds, query, ext)` (5 → 6), `prepareExport`/`writeXlsx` (6 service → 6 controller → 6 route test), `DataRoomColumn.unit/description/derived` (3 → 8 → 9), `summary` flag (3 → 8/9), source key `summaries` (3 → 5 → 8 → 10).

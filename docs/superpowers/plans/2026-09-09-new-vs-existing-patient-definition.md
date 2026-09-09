# One Definition of "Existing Patient" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nine different answers to "is this person an existing patient" with one shared function, so the Facebook and Google reports stop contradicting each other and every patient-count screen answers the same question.

**Architecture:** One `SECURITY DEFINER` function, `patient_first_activity(p_org)`, returns the earliest date we really saw each patient — first completed appointment, completed non-charting treatment item, settled payment, or paid invoice. Lead-scoped functions read it as "is that date on or after this lead's own London day"; patient-scoped functions read it as "does that date fall in this window". One definition, two readings.

**Tech Stack:** Postgres 15 / Supabase (hosted project `mkfhpzjbijbachoonytt`), migrations in `supabase/migrations/`, backend Node ESM + vitest, frontend Next.js 14 + TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-09-new-vs-existing-patient-definition-design.md` — read it first; this plan argues from it and does not repeat its measurements.

## Global Constraints

- **Tenant isolation is the explicit predicate.** Repositories run on `serviceClient`, which bypasses RLS. Every read carries `organisation_id = p_org`. `p_org` comes from `req.user.organisation_id` or the server-resolved `req.agencyOrgId` — **never** a body, query param or payload field.
- **No PostgREST embeds** (`contact:contacts(...)`) on the service client — an embed resolves the FK as a join with no org predicate.
- **Every RPC gets the revoke idiom**, verbatim: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;`
- **`LANGUAGE sql` + `SECURITY DEFINER` + `SET search_path` never inlines**, so the body is planned with `p_org` UNKNOWN and picks a generic plan (measured elsewhere in this repo at 11.1s vs 55ms). Every new or rewritten function in this plan is `LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`.
- **PostgREST truncates at 1000 rows**, set-returning functions included. Page on a unique key and stop on an **empty** page, never a short one.
- **Money is integer pence.** British English in UI copy. No emojis. No dark mode.
- **Null is not zero.** A rate or cost over a zero denominator is `null`, rendered as an em dash.
- **Nothing is applied to hosted without the owner confirming that exact statement**, and never a `DROP`/`DELETE`/`TRUNCATE`/unqualified `UPDATE` without confirmation. After any hosted DDL: `NOTIFY pgrst, 'reload schema';`
- **`supabase` CLI is not installed on this machine**, so there is no local `db reset` to test migrations against. SQL correctness is established by measured before/after on hosted plus the vitest suite. Task 8 covers this explicitly.
- **Shared working tree.** Another session may hold this checkout: check `HEAD` before committing, stage named paths, never `git add -A`, never rewrite shared history.
- **Migration numbering:** next free is `20260101000191`. Amend from the **last** migration that defines a function, never the first that names it — or better, from `pg_get_functiondef` on hosted, which is what is actually running.

---

### Task 1: The shared definition — index and `patient_first_activity`

**Files:**
- Create: `supabase/migrations/20260101000191_patient_first_activity.sql`
- Test: measured on hosted (see Step 4); no vitest — this task adds no JS

**Interfaces:**
- Consumes: nothing
- Produces: `public.patient_first_activity(p_org uuid) RETURNS TABLE (contact_id uuid, first_activity_at timestamptz)` — every later task reads exactly this signature.

**This function is called only from inside other SQL functions, never over PostgREST.** It returns 15,819 rows for the agency organisation today, and PostgREST truncates a set-returning function at 1000 rows in silence exactly as it does a table. If a repository is ever pointed at it directly, that read must be paged on `contact_id` and stop on an **empty** page, never a short one. No repository in this plan calls it.

- [ ] **Step 1: Measure the cost before the index, so the after-number means something**

Run via the Supabase MCP against `mkfhpzjbijbachoonytt`:

```sql
explain (analyze, buffers)
select t.contact_id, min(t.completed_at)
from public.dentally_treatment_items t
where t.organisation_id = (select id from public.organisations where is_agency limit 1)
  and t.completed and not t.base_chart and t.contact_id is not null
group by t.contact_id;
```

Expected: a scan discarding ~209,543 rows, ~500 ms. Record the actual number in the migration header.

- [ ] **Step 2: Write the migration**

```sql
-- One definition of "when did we first really see this patient".
--
-- Nine functions answered "is this person an existing patient" nine ways, and
-- the Facebook and Google reports contradicted each other on it: Facebook asked
-- "any appointment before the WINDOW", Google "any appointment before this
-- LEAD's own day", so widening a date range flipped people between new and
-- existing on one page and could not on the other. Neither filtered appointment
-- status, so one cancelled appointment marked someone existing while that same
-- row was excluded from counting as a booking a few lines away.
--
-- Owner's rule (2026-09-09): existing if they have an attended appointment, a
-- completed treatment, or a settled payment / paid invoice before the cut-off.
-- New is the absence of all four. Existing wins on any single signal.
--
-- plpgsql + RETURN QUERY EXECUTE, not LANGUAGE sql: a SECURITY DEFINER sql
-- function with SET search_path never inlines, so its body is planned with
-- p_org UNKNOWN and takes a generic plan. That has already cost this database
-- 11.1s against 55ms on another function.
--
-- The index is a precondition, not a follow-up. Without it the aggregate costs
-- 699ms / 96,904 buffers for one organisation, 500ms of it discarding 209,543
-- treatment-item rows the existing partial index (organisation_id, practice_id,
-- completed_at) cannot serve for a contact_id lookup.

create index if not exists idx_dentally_treatment_items_org_contact_completed
  on public.dentally_treatment_items (organisation_id, contact_id, completed_at)
  where completed is true and base_chart is false;

create or replace function public.patient_first_activity(p_org uuid)
returns table (contact_id uuid, first_activity_at timestamptz)
language plpgsql stable security definer set search_path = public as $fn$
begin
  return query execute $q$
    select x.contact_id, min(x.ts) as first_activity_at
    from (
      -- Attended, not merely booked: status = 'completed' only. in_progress
      -- exists but holds 20 rows group-wide and is an unresolved state.
      select a.contact_id, a.starts_at as ts
        from appointments a
       where a.organisation_id = $1
         and a.status = 'completed'
         and a.contact_id is not null
      union all
      -- base_chart rows are tooth/surface charting entries Dentally itself
      -- excludes from the Practitioner Activity report.
      select t.contact_id, t.completed_at
        from dentally_treatment_items t
       where t.organisation_id = $1
         and t.completed and not t.base_chart
         and t.contact_id is not null and t.completed_at is not null
      union all
      -- 'settled' and 'pending' are the only statuses this database holds.
      select p.contact_id, p.processed_at
        from payments p
       where p.organisation_id = $1
         and p.status = 'settled'
         and p.contact_id is not null and p.processed_at is not null
      union all
      -- dated_on is the INVOICE date, not the date it was paid: an invoice
      -- raised in March and settled in June dates this person from March.
      -- invoices carries no settlement date; the payment signal above covers
      -- the same person correctly wherever a linked payment row exists.
      select i.contact_id, i.dated_on::timestamptz
        from invoices i
       where i.organisation_id = $1
         and i.paid
         and i.contact_id is not null and i.dated_on is not null
    ) x
    group by x.contact_id
  $q$ using p_org;
end;
$fn$;

revoke all on function public.patient_first_activity(uuid) from public, anon, authenticated;
grant execute on function public.patient_first_activity(uuid) to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 3: Verify it returns what the spec measured**

```sql
select count(*) as contacts_with_activity
from public.patient_first_activity(
  (select id from public.organisations where is_agency limit 1));
```

Expected: **15819**. A different number means the rule drifted from what §5 of the spec measured — stop and reconcile before going further.

- [ ] **Step 4: Verify isolation and grants, by running them not reading them**

```sql
select has_function_privilege('anon','public.patient_first_activity(uuid)','EXECUTE')          as anon,
       has_function_privilege('authenticated','public.patient_first_activity(uuid)','EXECUTE') as authenticated,
       has_function_privilege('service_role','public.patient_first_activity(uuid)','EXECUTE')  as service_role,
       (select count(*) from public.patient_first_activity(
          (select id from public.organisations where not is_agency
            and name <> 'developer' limit 1)))                                                 as other_org_rows;
```

Expected: `anon` false, `authenticated` false, `service_role` true. `other_org_rows` must be the other tenant's own count and must not equal 15819 — proof `p_org` actually scopes the read.

- [ ] **Step 5: Re-measure the cost with the index in place**

Re-run Step 1's `EXPLAIN`, then time the whole function:

```sql
explain (analyze, buffers)
select * from public.patient_first_activity(
  (select id from public.organisations where is_agency limit 1));
```

Expected: an index scan on `idx_dentally_treatment_items_org_contact_completed`, total well under the 699 ms baseline. **If it is still over ~200 ms, stop and report** — the fallback is a stamped `contacts.first_activity_at` maintained at the sync write choke points plus a restamp RPC, the pattern already used for `ad_metrics.practice_id`, and that is a different plan.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260101000191_patient_first_activity.sql
ggshield secret scan pre-commit
git commit -m "feat(db): one definition of when we first saw a patient"
```

---

### Task 2: Family A — `ad_lead_conversions`, the root definition

**Files:**
- Create: `supabase/migrations/20260101000192_new_patient_rule_family_a.sql`
- Reference: `supabase/migrations/20260101000156_ad_meta_funnel.sql` (last migration that defines this function)

**Interfaces:**
- Consumes: `patient_first_activity(uuid)` from Task 1
- Produces: `ad_lead_conversions` with an unchanged `RETURNS TABLE` signature. **The column list must not change** — `ad_meta_funnel`, `ad_campaign_funnel` and `ad_meta_lead_ledger` all select from it by name and would need recreating if it did.

- [ ] **Step 1: Pull the live definition, not the repo file**

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ad_lead_conversions';
```

Copy it verbatim into the new migration. Change **only** the `prior_visit` CTE. Everything else stays byte-identical — a stale copy has already silently reverted a later fix in this repo.

- [ ] **Step 2: Replace the `prior_visit` CTE**

Old — any appointment, any status, before the window start:

```sql
    prior_visit AS (
      SELECT DISTINCT pr.lead_id
      FROM (SELECT DISTINCT lead_id, patient_id FROM matched) pr
      WHERE EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.organisation_id = $1
           AND a.contact_id = pr.patient_id
           AND a.starts_at < $2
      )
    ),
```

New — any real activity, before this lead's own London day:

```sql
    -- Existing = attended, treated, or paid BEFORE this lead's own enquiry day.
    -- The cut-off travels with the person, so their status cannot change when
    -- the reporting window moves. $2 (the window start) is deliberately no
    -- longer consulted here.
    prior_visit AS (
      SELECT DISTINCT pr.lead_id
      FROM (SELECT DISTINCT lead_id, patient_id FROM matched) pr
      JOIN lead_contacts lc ON lc.id = pr.lead_id
      JOIN patient_first_activity($1) fa ON fa.contact_id = pr.patient_id
      WHERE fa.first_activity_at < london_day_start(lc.first_lead_at)
    ),
```

`is_new_patient` at the SELECT keeps its existing form — `(agg.lead_id IS NOT NULL AND pv.lead_id IS NULL)` — so a lead that never converted is still not counted as a new patient.

- [ ] **Step 3: Apply to hosted after the owner confirms the statement, then measure**

```sql
with org as (select id from public.organisations where is_agency limit 1)
select count(*) filter (where converted)      as converted,
       count(*) filter (where is_new_patient) as new_patients
from org o, lateral public.ad_lead_conversions(
  o.id, timestamptz '2026-06-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01', null);
```

Expected: `converted` **743** (unchanged — this task does not touch matching), `new_patients` **627** (was 572). Any other pair means the predicate is wrong; do not proceed.

- [ ] **Step 4: Prove the instability is gone**

Run the same count for `2026-04-01 → 2026-09-01`, then for `2026-06-01 → 2026-09-01`, and compare the new-patient verdict for the **overlapping** leads:

```sql
with org as (select id from public.organisations where is_agency limit 1),
wide as (select contact_id, is_new_patient from org o, lateral public.ad_lead_conversions(
           o.id, timestamptz '2026-04-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01', null)),
narrow as (select contact_id, is_new_patient from org o, lateral public.ad_lead_conversions(
           o.id, timestamptz '2026-06-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01', null))
select count(*) as leads_in_both,
       count(*) filter (where w.is_new_patient <> n.is_new_patient) as verdict_changed
from wide w join narrow n on n.contact_id = w.contact_id;
```

Expected: `verdict_changed` = **0**. This is the whole point of the change; before it, this number was non-zero.

- [ ] **Step 5: Run the backend suite**

Run: `cd backend && npm test`
Expected: PASS. Tests asserting `is_new_patient` shapes are mocked at the `.rpc()` boundary and should not move; if any fails, it encoded the old rule and its expectation needs updating with a comment saying why.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260101000192_new_patient_rule_family_a.sql
ggshield secret scan pre-commit
git commit -m "fix(marketing): a Facebook lead's patient status no longer moves with the window"
```

---

### Task 3: Family A — `ad_google_lead_ledger`

**Files:**
- Modify: `supabase/migrations/20260101000192_new_patient_rule_family_a.sql` (append)
- Reference: `supabase/migrations/20260101000178_google_lead_ad_attribution.sql` (last defining migration)

**Interfaces:**
- Consumes: `patient_first_activity(uuid)`
- Produces: `ad_google_lead_ledger` with an unchanged signature — `ad_account_marketing` selects `is_new_patient` from it by name.

- [ ] **Step 1: Replace the `is_new_patient` derivation**

This body is built with `format()`, so the org is interpolated as `%1$L`. Old:

```sql
      SELECT pi.phone10,
             NOT EXISTS (
               SELECT 1 FROM appointments pa
                WHERE pa.organisation_id = %1$L
                  AND pa.contact_id = ANY(pi.ids)
                  AND pa.starts_at < pi.lead_day_start
             ) AS is_new_patient
        FROM patient_ids pi
```

New:

```sql
      -- Same cut-off as before (this lead's own London day) but now the full
      -- rule: attended, treated or paid, not merely "had an appointment row".
      SELECT pi.phone10,
             NOT EXISTS (
               SELECT 1 FROM patient_first_activity(%1$L) fa
                WHERE fa.contact_id = ANY(pi.ids)
                  AND fa.first_activity_at < pi.lead_day_start
             ) AS is_new_patient
        FROM patient_ids pi
```

- [ ] **Step 2: Measure before and after on the same window**

Capture the current figure **before** applying:

```sql
with org as (select id from public.organisations where is_agency limit 1)
select count(*) filter (where is_new_patient) as new_patients
from org o, lateral public.ad_google_lead_ledger(
  o.id, timestamptz '2026-06-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01');
```

Record both numbers. Google moves **less** than Facebook — its cut-off was already per-lead, so only the attended/treated/paid widening applies. A large move here means something else changed and needs explaining before it ships.

- [ ] **Step 3: Verify grants survived the rewrite**

```sql
select has_function_privilege('anon','public.ad_google_lead_ledger(uuid,timestamptz,timestamptz,integer)','EXECUTE') as anon,
       has_function_privilege('service_role','public.ad_google_lead_ledger(uuid,timestamptz,timestamptz,integer)','EXECUTE') as service_role;
```

Expected: `anon` false, `service_role` true. A `CREATE OR REPLACE` keeps grants; a `DROP`/`CREATE` does not, which is exactly how an RPC ends up anon-callable.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000192_new_patient_rule_family_a.sql
ggshield secret scan pre-commit
git commit -m "fix(marketing): Google's new-patient test uses the shared rule"
```

---

### Task 4: Family A — `marketing_monthly_rollup`

**Files:**
- Modify: `supabase/migrations/20260101000192_new_patient_rule_family_a.sql` (append)
- Reference: `supabase/migrations/20260101000143_marketing_monthly_rollup.sql`

**Interfaces:**
- Consumes: `patient_first_activity(uuid)`
- Produces: unchanged `RETURNS TABLE (month date, channel text, leads bigint, patients bigint, new_patients bigint, spend_pence bigint)`

This function was misfiled as patient-scoped in the first draft of the spec. It is lead-scoped — it carries its own per-month `prior_visit` — so it takes the per-lead cut-off like the rest of Family A.

- [ ] **Step 1: Carry the lead's own timestamp into `lead_months`**

`lead_months` currently projects `month` but not the underlying lead time, so there is nothing to take a per-lead day from. Add one column to its select list, immediately after the `month` line:

```sql
             date_trunc('month', l.created_at AT TIME ZONE 'Europe/London')::date AS month,
             l.created_at AS lead_at,
```

The `DISTINCT ON (c.id, date_trunc('month', ...))` with `ORDER BY c.id, date_trunc(...), l.created_at` already picks the **earliest** lead in each month, so `lead_at` is that month's first enquiry for that person — the right anchor.

- [ ] **Step 2: Replace the `prior_visit` CTE**

Old — any appointment before the start of the month:

```sql
    prior_visit AS (
      SELECT DISTINCT lm.id AS lead_id, lm.month
      FROM lead_months lm
      JOIN pairs pr ON pr.lead_id = lm.id
      WHERE EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.organisation_id = $1 AND a.contact_id = pr.patient_id
           AND a.starts_at < (lm.month::timestamp AT TIME ZONE 'Europe/London')
      )
    ),
```

New — real activity before the lead's own day:

```sql
    -- Per-lead cut-off, matching ad_lead_conversions. A month boundary made a
    -- person's status depend on which month the row landed in rather than on
    -- what had actually happened to them by the time they enquired.
    prior_visit AS (
      SELECT DISTINCT lm.id AS lead_id, lm.month
      FROM lead_months lm
      JOIN pairs pr ON pr.lead_id = lm.id
      JOIN patient_first_activity($1) fa ON fa.contact_id = pr.patient_id
      WHERE fa.first_activity_at < london_day_start(lm.lead_at)
    ),
```

- [ ] **Step 3: Measure before and after**

```sql
with org as (select id from public.organisations where is_agency limit 1)
select month, channel, leads, patients, new_patients
from org o, lateral public.marketing_monthly_rollup(
  o.id, timestamptz '2026-06-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01', null)
order by month, channel;
```

Run before applying and after. `leads` and `patients` must be **identical** — only `new_patients` may move. If `leads` changes, the added `lead_at` column altered the `DISTINCT ON` grouping and the change is wrong.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000192_new_patient_rule_family_a.sql
ggshield secret scan pre-commit
git commit -m "fix(marketing): monthly rollup uses the per-lead cut-off"
```

---

### Task 5: Family B — the three registration-based functions

**Files:**
- Create: `supabase/migrations/20260101000193_new_patient_rule_family_b.sql`
- Reference: `20260101000163_london_window_convention.sql` (`growth_practice_performance`), `20260101000077_new_patients_by_plan.sql` (`org_new_patients_registered_by_practice`), `20260101000131_data_room_derived_and_summaries.sql` (`data_room_practice_day`)

**Interfaces:**
- Consumes: `patient_first_activity(uuid)`
- Produces: all three keep their exact current `RETURNS TABLE` signatures. `data_room_practice_month` sums `data_room_practice_day` and needs no edit of its own.

- [ ] **Step 1: `growth_practice_performance` — replace the `pat` CTE**

Old:

```sql
  pat as (
    select c.practice_id, count(*)::bigint as n
    from public.contacts c
    where c.organisation_id = p_org and c.type = 'patient'
      and c.pms_registered_at is not null
      and c.pms_registered_at >= p_since
      and (p_until is null or c.pms_registered_at < p_until)
      and (p_practice is null or c.practice_id = p_practice)
    group by c.practice_id
  ),
```

New:

```sql
  -- New = first REAL activity lands in the window, not a registration date.
  -- 125 people registered in Aug 2026 without yet attending, being treated or
  -- paying; a registration is an intention, not an acquisition.
  pat as (
    select c.practice_id, count(*)::bigint as n
    from public.contacts c
    join public.patient_first_activity(p_org) fa on fa.contact_id = c.id
    where c.organisation_id = p_org and c.type = 'patient'
      and fa.first_activity_at >= p_since
      and (p_until is null or fa.first_activity_at < p_until)
      and (p_practice is null or c.practice_id = p_practice)
    group by c.practice_id
  ),
```

- [ ] **Step 2: `org_new_patients_registered_by_practice` — same substitution**

Old predicate:

```sql
    and c.pms_registered_at is not null
    and c.pms_registered_at >= p_since
    and (p_until is null or c.pms_registered_at < p_until)
```

New — join the shared function and test its date instead:

```sql
    and exists (
      select 1 from public.patient_first_activity(p_org) fa
       where fa.contact_id = c.id
         and fa.first_activity_at >= p_since
         and (p_until is null or fa.first_activity_at < p_until)
    )
```

- [ ] **Step 3: `data_room_practice_day` — same substitution, keeping the London day bucket**

Old:

```sql
    select c.practice_id, (c.pms_registered_at at time zone 'Europe/London')::date,
           ...
    where c.organisation_id = p_org and c.type = 'patient' and c.pms_registered_at is not null
      and c.pms_registered_at >= p_since and c.pms_registered_at < p_until
```

New:

```sql
    select c.practice_id, (fa.first_activity_at at time zone 'Europe/London')::date,
           ...
    from public.contacts c
    join public.patient_first_activity(p_org) fa on fa.contact_id = c.id
    where c.organisation_id = p_org and c.type = 'patient'
      and fa.first_activity_at >= p_since and fa.first_activity_at < p_until
```

Keep the rest of the SELECT list exactly as it is — the day bucket must stay a London date, not a UTC one.

- [ ] **Step 4: Measure the 12-month shift and check it against the spec**

```sql
with org as (select id from public.organisations where is_agency limit 1),
months as (select generate_series(date '2025-09-01', date '2026-08-01', interval '1 month')::date as m)
select to_char(m, 'Mon YYYY') as month,
       (select sum(new_patients) from org o, lateral public.growth_practice_performance(
          o.id, (m::timestamp at time zone 'Europe/London'),
          ((m + interval '1 month')::timestamp at time zone 'Europe/London'), null)) as new_patients
from months order by m;
```

Expected, matching §5.2 of the spec: 347, 313, 359, 238, 433, 298, 331, 359, 229, 282, 339, 262. A month off by more than a row or two means the London boundary or the join grain is wrong.

- [ ] **Step 5: Verify `data_room_practice_month` still reconciles to its day function**

```sql
with org as (select id from public.organisations where is_agency limit 1)
select (select sum(new_patients) from org o, lateral public.data_room_practice_day(
          o.id, timestamptz '2026-08-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01', null)) as by_day,
       (select sum(new_patients) from org o, lateral public.data_room_practice_month(
          o.id, timestamptz '2026-08-01 00:00:00+01', timestamptz '2026-09-01 00:00:00+01', null)) as by_month;
```

Expected: the two are equal. They are the same rows at two grains; if they disagree the month function is not summing the day function.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260101000193_new_patient_rule_family_b.sql
ggshield secret scan pre-commit
git commit -m "fix(growth): a new patient is one we actually treated, not one who registered"
```

---

### Task 6: Family B — the two functions with their own rules

**Files:**
- Modify: `supabase/migrations/20260101000193_new_patient_rule_family_b.sql` (append)
- Reference: live `pg_get_functiondef` for `org_new_patients_count` and `health_patient_actuals`

**Interfaces:**
- Consumes: `patient_first_activity(uuid)`
- Produces: `org_new_patients_count` returns `bigint` as now; `health_patient_actuals` returns `json` with the same keys as now.

These two never used registration date the way the other three did, so their edits differ. Do not copy Task 5's substitution into them blindly.

- [ ] **Step 1: `org_new_patients_count` — drop the coalesce, use the shared date**

It currently anchors on `coalesce(c.pms_registered_at, first appointment of ANY status)` — a third rule again. Replace the two CTEs:

```sql
  with anchors as (
    select c.practice_id, fa.first_activity_at as anchor
    from public.contacts c
    join public.patient_first_activity(p_org) fa on fa.contact_id = c.id
    where c.organisation_id = p_org and c.type = 'patient'
      and (p_practice is null or c.practice_id = p_practice)
  )
  select count(*)::bigint
  from anchors
  where anchor is not null
    and anchor >= p_since
    and (p_until is null or anchor < p_until);
```

The `first_appt` CTE is deleted outright — it selected appointments of any status, which is precisely the rule being retired.

- [ ] **Step 2: `health_patient_actuals` — replace the `first_appt` / `new_pat` pair**

This one feeds the `new_patients_month` tile and is a **12-month count divided by 12**, not a month. Keep that shape; change only what counts as first contact:

```sql
  new_pat AS (
    SELECT COUNT(*)::numeric AS c
    FROM patient_first_activity(p_org) fa, ref
    WHERE fa.first_activity_at::date >  ref.d - INTERVAL '12 months'
      AND fa.first_activity_at::date <= ref.d
  ),
```

Leave `active`, `prior`, `recent`, `retained`, `recall_due` and `recall_met` **untouched** — they use the `appt` CTE for retention and recall, which are different questions and out of scope. Only `new_pat` moves off it.

- [ ] **Step 3: Measure the tile before and after**

```sql
select (public.health_patient_actuals(
  (select id from public.organisations where is_agency limit 1)))->>'new_patients_month' as tile;
```

Expected: **341** before, **314** after (spec §5.2.1). Also confirm `retention_12mo` and `recall_compliance` are **unchanged** — if either moves, the edit reached past `new_pat`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000193_new_patient_rule_family_b.sql
ggshield secret scan pre-commit
git commit -m "fix(health): new-patients tile counts real activity, not any appointment row"
```

---

### Task 7: Application layer — copy, dictionary and tests

**Files:**
- Modify: `backend/src/lib/data-room/dictionary.js` (the `new_patients` column description)
- Modify: `backend/src/lib/health-metrics.js:27` (the `new_patients_month` label/description)
- Modify: `frontend/features/growth/components/PatientsScreen.tsx` (the on-screen definition)
- Modify: `frontend/features/overview/components/BusinessHubScreen.tsx` (the new-patients tile caption)
- Create: `backend/test/patient-first-activity.test.mjs`
- Regenerate: `docs/DATA_ROOM_DICTIONARY.md`

**Interfaces:**
- Consumes: nothing new — the repositories already read `new_patients` / `is_new_patient` by name and need no change.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test for the shared rule as the app states it**

The SQL cannot be unit-tested here (no local Supabase), so this test pins the **stated definition** the UI and dictionary must carry, so a future edit cannot quietly reword it:

```javascript
// The one sentence every surface must agree on. If the rule changes, this
// test and the spec change together — not one screen at a time, which is how
// nine different definitions grew here in the first place.
import { describe, it, expect } from 'vitest';
import { COLUMN_DOCS, docFor } from '../src/lib/data-room/dictionary.js';

const NEW_PATIENT_RULE =
  'Patients whose first attended appointment, completed treatment or settled '
  + 'payment falls in the period.';

describe('new-patient definition', () => {
  it('is stated in the data-room dictionary', () => {
    expect(COLUMN_DOCS.new_patients.description).toBe(NEW_PATIENT_RULE);
  });

  it('reaches the summaries datasets through docFor', () => {
    // docFor takes the dataset OBJECT, not strings, and merges the global doc
    // with any per-dataset override — so an override could silently reintroduce
    // the old wording for one dataset while COLUMN_DOCS looked correct.
    const ds = { source: 'summaries', key: 'practice_month' };
    expect(docFor(ds, 'new_patients').description).toBe(NEW_PATIENT_RULE);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run test/patient-first-activity.test.mjs`
Expected: FAIL — the dictionary still describes the registration-date rule.

- [ ] **Step 3: Update the dictionary entry to that exact sentence**

In `backend/src/lib/data-room/dictionary.js`, `COLUMN_DOCS.new_patients` currently reads:

```javascript
    new_patients: d('Patients whose Dentally registration date falls in the period.'),
```

Replace it with:

```javascript
    new_patients: d('Patients whose first attended appointment, completed treatment or settled payment falls in the period.'),
```

Then check `DATASET_COLUMN_DOCS` for a per-dataset `new_patients` override — an override wins over the global, so one left behind would keep the old wording on that dataset alone.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx vitest run test/patient-first-activity.test.mjs`
Expected: PASS.

- [ ] **Step 5: Update the two frontend captions and the health-metric label**

Use this exact sentence in both places, so the screens and the dictionary cannot drift:

```
First attended appointment, completed treatment or settled payment in the period.
```

In `backend/src/lib/health-metrics.js:27`, the `new_patients_month` entry keeps its label `'New patients per month'` and its target of `220` — only its description changes to the sentence above. **Do not change the target**: it was set against the old definition, and revisiting it is the owner's decision, explicitly out of scope.

British English throughout (organisation, centre), no emojis.

- [ ] **Step 6: Regenerate the dictionary and run everything**

```bash
cd backend && npm run data-room:dictionary && npm test && npm run lint && npm run typecheck
cd ../frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all pass. `validateRegistry()` fails on any undocumented column, so a stale dictionary is caught here. The frontend build's `/forgot-password` prerender failure is pre-existing (no Supabase env at build time) and is not a regression — everything else must be clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/data-room/dictionary.js backend/src/lib/health-metrics.js \
        backend/test/patient-first-activity.test.mjs docs/DATA_ROOM_DICTIONARY.md \
        frontend/features/growth/components/PatientsScreen.tsx \
        frontend/features/overview/components/BusinessHubScreen.tsx
ggshield secret scan pre-commit
git commit -m "docs(patients): every surface states the same new-patient rule"
```

---

### Task 8: Apply, verify, and report the shift

**Files:**
- Modify: `CLAUDE.md` (working-log entry)
- Create: nothing

**Interfaces:**
- Consumes: everything above
- Produces: the before/after report promised to the owner

- [ ] **Step 1: Confirm each statement with the owner before it touches hosted**

Show the exact SQL for `20260101000191`, `…192` and `…193`. Nothing is applied without that confirmation, and no `DROP` runs without confirmation of that specific statement.

- [ ] **Step 2: Apply, then reload the schema cache**

Apply in order 191 → 192 → 193 via the Supabase MCP `apply_migration`, then:

```sql
notify pgrst, 'reload schema';
```

- [ ] **Step 3: Sweep every RPC name in the codebase against `pg_proc`**

```bash
cd backend && grep -rho "\.rpc('[a-z_]*'" src | sed "s/.*'\(.*\)'/\1/" | sort -u
```

Check each name exists in `pg_proc`. Code has shipped in this repo calling a function that was never applied; the hosted ledger's `version` values are apply-time timestamps, so a gap is only visible by **name**.

- [ ] **Step 4: Verify grants across every function touched**

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('patient_first_activity','ad_lead_conversions','ad_google_lead_ledger',
                    'marketing_monthly_rollup','growth_practice_performance',
                    'org_new_patients_count','org_new_patients_registered_by_practice',
                    'data_room_practice_day','data_room_practice_month')
order by p.proname;
```

Expected: `anon` and `authenticated` false on every row, `service_role` true. `health_patient_actuals` is deliberately absent — it is not `SECURITY DEFINER` today and this work does not change that.

- [ ] **Step 5: Confirm a second tenant is unaffected**

Run Task 5's 12-month query against a non-agency organisation. Expected: its own figures, and no error — an org with no Dentally data must return empty, never a confident zero dressed as a real count.

- [ ] **Step 6: Re-measure everything the spec predicted and report it**

Produce the owner's promised table: Family A 572 → 627; the 12-month Family B series; the `new_patients_month` tile 341 → 314. State any figure that came out differently and why, rather than reporting the prediction.

- [ ] **Step 7: Update the working log and commit**

Add a `CLAUDE.md` entry recording what shipped, which migrations are applied on hosted, and the measured before/after. Then:

```bash
git add CLAUDE.md
ggshield secret scan pre-commit
git commit -m "docs: record the new-patient definition change and its measured effect"
```

---

## Out of scope

- Changing the `new_patients_month` target of 220.
- Contact deduplication.
- Backfilling the missing `contact_id` on 13.6% of treatment items, 13% of settled payments and 21% of paid invoices.
- Making `health_patient_actuals` `SECURITY DEFINER` like its peers.
- The `TO PUBLIC` RLS policy targeting on the `000130` policies.

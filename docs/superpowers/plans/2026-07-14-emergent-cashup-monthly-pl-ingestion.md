# Emergent Daily Cash-Up + Monthly P&L Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Emergent's Daily Cash-Up and Monthly P&L feeds (first-time backfill via pull endpoints, then real-time webhooks) into two new storage tables, losslessly and idempotently.

**Architecture:** Extend the existing Emergent connector (`emergent-sync.js`) and webhook service (`webhook.service.js`) — no new provider, no new webhook route. Pure mappers convert the byte-identical pull/webhook payloads to typed pence/int columns plus JSONB for custom fields. Two new repositories upsert on a deterministic `(org, business_id, date|month)` key. The embedded `patients[]` array reuses the existing `treatment_accepted` path via the unchanged `external_id`, so it never double-counts against the per-patient `treatment.accepted` events.

**Tech Stack:** Node ESM (backend, `"type":"module"`), Supabase Postgres, vitest. Money = integer pence.

## Global Constraints

- Backend is **native ESM**: `import`/`export`, relative imports carry `.js`, no `require`/`module.exports`. (copied from CLAUDE.md)
- **Money is integer pence**; convert decimal pounds with `Math.round(Number(x) * 100)`. Never floats in storage. (rule 2)
- **Tenant isolation (rule 3):** repos use `serviceClient` + an explicit `.eq('organisation_id', orgId)` on every query. The webhook uses ONLY the org resolved from the signed token, never a body field.
- Migrations are **idempotent** (`create table if not exists`, `add column if not exists`), numbered after the latest (`000109`) → this is **`000110`**. After any hosted DDL run `NOTIFY pgrst, 'reload schema';`.
- British English in any user-facing copy (rule 4).
- Follow the converted-ESM file conventions: `export const`/`export function`, namespace imports keep their local var.
- Commit after each task. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run tests with `cd backend && npx vitest run <file>`.

## File Structure

- `supabase/migrations/20260101000110_emergent_cashup_monthly_pl.sql` — **create**: two tables + `treatment_accepted` enrichment columns. Idempotent.
- `db/01_schema.sql` — **modify**: mirror the new tables (unmanaged source copy).
- `backend/src/lib/integrations/emergent-sync.js` — **modify**: `poundsToPence`, extract `resolvePracticeFromMaps`, enrich `mapRecord`, add `mapCashup`/`mapMonthlyPl`, `cashupExternalId`/`monthlyPlExternalId`, `fetchCashups`/`fetchMonthlyPl`, extend `syncOrg`.
- `backend/src/repositories/emergent-daily-cashup.repository.js` — **create**: `upsert`, `listByOrg`.
- `backend/src/repositories/emergent-monthly-pl.repository.js` — **create**: `upsert`, `listByOrg`.
- `backend/src/services/webhook.service.js` — **modify**: dispatch `daily_cashup.saved` + `monthly_pl.saved`.
- `backend/test/emergent-pounds-to-pence.test.mjs` — **create** (Task 2).
- `backend/test/emergent-map-record.test.mjs` — **modify** (Task 3, add enrichment assertions).
- `backend/test/emergent-map-cashup.test.mjs` — **create** (Task 4).
- `backend/test/emergent-map-monthly-pl.test.mjs` — **create** (Task 5).
- `backend/test/emergent-cashup-repos.test.mjs` — **create** (Task 6).
- `backend/test/emergent-sync-pull.test.mjs` — **create** (Task 7).
- `backend/test/emergent-webhook-cashup-pl.test.mjs` — **create** (Task 8).
- `docs/API.md`, `treatmentaccepted.md` — **modify** (Task 9).

---

### Task 1: Migration `000110` — tables + `treatment_accepted` enrichment

**Files:**
- Create: `supabase/migrations/20260101000110_emergent_cashup_monthly_pl.sql`

**Interfaces:**
- Produces: tables `emergent_daily_cashup`, `emergent_monthly_pl`; new columns `treatment_accepted.{phone,email,quantity,ext_source,ext_campaign}`. Later tasks write these exact column names.

Migrations do not follow the write-test-first cycle; the deliverable is the idempotent file, verified by applying it and querying the columns exist.

- [ ] **Step 1: Write the migration file**

```sql
-- Emergent Daily Cash-Up + Monthly P&L storage. Sourced from the Emergent ops
-- app (pull endpoints + webhooks). Idempotent, additive-only, re-appliable.
-- After applying on hosted run: NOTIFY pgrst, 'reload schema';
--
-- Money is integer pence (pounds * 100, rounded). Known fields are typed
-- columns; custom (extra="allow") fields land in *_jsonb so a CEO-added form
-- field survives with no migration.

create table if not exists public.emergent_daily_cashup (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations(id) on delete cascade,
  business_id                     text not null,
  business_name                   text,
  practice_id                     uuid references public.practices(id) on delete set null,
  cashup_date                     date not null,
  external_id                     text not null,
  treatments_accepted             int,
  tx_plans_given                  int,
  tx_plan_given_value_pence       bigint,
  cash_up_money_taken_pence       bigint,
  num_bookings                    int,
  num_new_leads                   int,
  num_follow_ups                  int,
  num_attended                    int,
  total_chairs                    int,
  chairs_used                     int,
  chair_utilisation               numeric(6,2),
  reviews_collected               int,
  before_after_pictures           int,
  video_testimonials              int,
  practice_plan_signups           int,
  total_refunds_pence             bigint,
  source_google                   int default 0,
  source_facebook                 int default 0,
  source_walk_in                  int default 0,
  source_friends_family           int default 0,
  source_wl_website               int default 0,
  source_dentist_referral         int default 0,
  source_instagram                int default 0,
  source_youtube                  int default 0,
  source_other                    int default 0,
  custom_sources                  jsonb not null default '{}'::jsonb,
  refunds                         jsonb not null default '[]'::jsonb,
  appointment_booked_for          text,
  crm_system_notes                text,
  detail_patient_rows_count       int,
  detail_patient_money_total_pence bigint,
  variance_manager_vs_detail      numeric,
  emergent_created_at             timestamptz,
  emergent_created_by             text,
  raw                             jsonb,
  synced_at                       timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (organisation_id, business_id, cashup_date)
);
create index if not exists emergent_daily_cashup_org_date_idx
  on public.emergent_daily_cashup (organisation_id, cashup_date);
alter table public.emergent_daily_cashup enable row level security;

create table if not exists public.emergent_monthly_pl (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations(id) on delete cascade,
  business_id                     text not null,
  business_name                   text,
  practice_id                     uuid references public.practices(id) on delete set null,
  period_month                    date not null,
  external_id                     text not null,
  notes                           text,
  revenue_pence                   bigint,
  gross_profit_pence              bigint,
  net_profit_pence                bigint,
  total_cost_of_sales_pence       bigint,
  total_operating_expenses_pence  bigint,
  cash_collected_pence            bigint,
  tx_accepted_amount_pence        bigint,
  bank_balance_pence              bigint,
  average_wait_time               numeric,
  principal_fees_pence            bigint,
  hygienist_therapist_pence       bigint,
  lab_fees_pence                  bigint,
  materials_pence                 bigint,
  sedation_services_pence         bigint,
  advertising_marketing_pence     bigint,
  bank_charges_pence              bigint,
  business_rates_rent_pence       bigint,
  salaries_staff_cost_pence       bigint,
  telephone_wifi_pence            bigint,
  utilities_pence                 bigint,
  insurance_pence                 bigint,
  management_fees_pence           bigint,
  subscriptions_pence             bigint,
  it_expenses_pence               bigint,
  card_machine_charges_pence      bigint,
  custom_lines                    jsonb not null default '{}'::jsonb,
  line_notes                      jsonb not null default '{}'::jsonb,
  raw                             jsonb,
  emergent_created_at             timestamptz,
  emergent_created_by             text,
  last_updated_at                 timestamptz,
  last_updated_by                 text,
  last_updated_by_email           text,
  synced_at                       timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (organisation_id, business_id, period_month)
);
create index if not exists emergent_monthly_pl_org_month_idx
  on public.emergent_monthly_pl (organisation_id, period_month);
alter table public.emergent_monthly_pl enable row level security;

-- Enrich treatment_accepted: persist fields previously dropped into raw.
alter table public.treatment_accepted add column if not exists phone        text;
alter table public.treatment_accepted add column if not exists email        text;
alter table public.treatment_accepted add column if not exists quantity     int;
alter table public.treatment_accepted add column if not exists ext_source   text;
alter table public.treatment_accepted add column if not exists ext_campaign text;
```

- [ ] **Step 2: Apply and verify the columns exist**

Apply via the Supabase MCP `apply_migration` (hosted) or `supabase db reset` from the repo root (local), then verify:

Run (hosted, via MCP `execute_sql`, or local `psql`):
```sql
select count(*) from information_schema.columns
where table_name = 'emergent_daily_cashup' and column_name = 'cash_up_money_taken_pence';
select count(*) from information_schema.columns
where table_name = 'treatment_accepted' and column_name = 'ext_campaign';
```
Expected: each returns `1`. Then run `NOTIFY pgrst, 'reload schema';` on hosted.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000110_emergent_cashup_monthly_pl.sql
git commit -m "feat(emergent): 000110 daily cash-up + monthly P&L tables + treatment_accepted enrichment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `poundsToPence` money helper

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js`
- Test: `backend/test/emergent-pounds-to-pence.test.mjs`

**Interfaces:**
- Produces: `export function poundsToPence(x): number` — decimal pounds → integer pence, `null`/`undefined`/`''` → 0.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/emergent-pounds-to-pence.test.mjs
import { describe, it, expect } from 'vitest';
const { poundsToPence } = await import('../src/lib/integrations/emergent-sync.js');

describe('poundsToPence', () => {
  it('converts pounds (int/float) to integer pence', () => {
    expect(poundsToPence(4500)).toBe(450000);
    expect(poundsToPence(4500.0)).toBe(450000);
    expect(poundsToPence(1850.5)).toBe(185050);
    expect(poundsToPence(50)).toBe(5000);
  });
  it('rounds to the nearest penny', () => {
    expect(poundsToPence(12.345)).toBe(1235);
    expect(poundsToPence(12.344)).toBe(1234);
  });
  it('treats null/undefined/empty as 0', () => {
    expect(poundsToPence(null)).toBe(0);
    expect(poundsToPence(undefined)).toBe(0);
    expect(poundsToPence('')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-pounds-to-pence.test.mjs`
Expected: FAIL — `poundsToPence is not a function`.

- [ ] **Step 3: Add the helper**

In `backend/src/lib/integrations/emergent-sync.js`, after the `externalId` function, add:
```javascript
// Decimal pounds -> integer pence (rule 2). null/undefined/'' -> 0.
export function poundsToPence(x) {
    return Math.round(Number(x || 0) * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-pounds-to-pence.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/emergent-sync.js backend/test/emergent-pounds-to-pence.test.mjs
git commit -m "feat(emergent): poundsToPence money helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extract practice resolution + enrich `mapRecord`

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js` (`mapRecord`)
- Test: `backend/test/emergent-map-record.test.mjs` (add cases)

**Interfaces:**
- Produces: `resolvePracticeFromMaps(businessId, businessName, maps): uuid|null` (module-internal, used by all three mappers). `mapRecord` output now also carries `phone`, `email`, `quantity`, `ext_source`, `ext_campaign`.
- Consumes: existing `resolvePractice` (fuzzy) and the `maps` shape `{ explicit: Map, fuzzy: Map }`.

- [ ] **Step 1: Add the enrichment assertions to the existing test**

Append to `backend/test/emergent-map-record.test.mjs` inside the `describe('emergent mapRecord', …)` block:
```javascript
  it('persists phone, email, quantity, source and campaign (previously raw-only)', () => {
    const r = mapRecord(
      { ...REC, phone: '07700 900 111', email: 'a@b.com', quantity: 2, source: 'Google', campaign: 'PPC-Aug' },
      ORG,
    );
    expect(r.phone).toBe('07700 900 111');
    expect(r.email).toBe('a@b.com');
    expect(r.quantity).toBe(2);
    expect(r.ext_source).toBe('Google');
    expect(r.ext_campaign).toBe('PPC-Aug');
  });
  it('defaults quantity to 1 and coerces empty source/campaign to null', () => {
    const r = mapRecord({ ...REC, quantity: undefined, source: '', campaign: '' }, ORG);
    expect(r.quantity).toBe(1);
    expect(r.ext_source).toBeNull();
    expect(r.ext_campaign).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-map-record.test.mjs`
Expected: FAIL — `r.phone` is `undefined`.

- [ ] **Step 3: Extract the resolver and enrich `mapRecord`**

In `emergent-sync.js`, add above `mapRecord`:
```javascript
// Shared practice resolution: explicit map (by business_id) wins even when its
// value is null (owner intentionally unmapped); otherwise fuzzy business_name.
export function resolvePracticeFromMaps(businessId, businessName, maps = null) {
    const explicit = maps && maps.explicit instanceof Map ? maps.explicit : null;
    const fuzzy = maps instanceof Map ? maps : (maps && maps.fuzzy instanceof Map ? maps.fuzzy : null);
    if (explicit && explicit.has(String(businessId))) return explicit.get(String(businessId));
    if (fuzzy) return resolvePractice(businessName, fuzzy);
    return null;
}
```
Then replace the practice-resolution lines inside `mapRecord` (the `const explicit = …` through the `if (explicit …) … else if (fuzzy) …` block) with:
```javascript
    const practiceId = resolvePracticeFromMaps(rec.business_id, rec.business_name, maps);
```
and extend the returned object (add these keys alongside the existing ones):
```javascript
        quantity: rec.quantity == null ? 1 : Number(rec.quantity),
        phone: empty(rec.phone),
        email: empty(rec.email),
        ext_source: empty(rec.source),
        ext_campaign: empty(rec.campaign),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-map-record.test.mjs`
Expected: PASS (all existing cases still green — behaviour of `value_pence`/`external_id`/`practice_id` unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/emergent-sync.js backend/test/emergent-map-record.test.mjs
git commit -m "feat(emergent): enrich mapRecord (phone/email/quantity/source/campaign) + shared practice resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `mapCashup` — daily cash-up mapper

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js`
- Test: `backend/test/emergent-map-cashup.test.mjs`

**Interfaces:**
- Produces: `cashupExternalId(data): string`; `mapCashup(data, orgId, maps): { row, patients }` where `row` is an `emergent_daily_cashup` row and `patients` is an array of `treatment_accepted` rows (via `mapRecord`).
- Consumes: `poundsToPence`, `resolvePracticeFromMaps`, `mapRecord`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/emergent-map-cashup.test.mjs
import { describe, it, expect } from 'vitest';
const { mapCashup, cashupExternalId } = await import('../src/lib/integrations/emergent-sync.js');

const ORG = '00000000-0000-0000-0000-000000000001';
const DATA = {
  id: 'biz1_2026-08-20', business_id: 'biz1', business_name: 'Ashford', date: '2026-08-20',
  treatments_accepted: 2, num_treatment_accepted: 2,
  tx_plans_given: 3, total_tx_plan_given_value: 12000.0,
  cash_up_money_taken: 1850.0,
  num_bookings: 6, num_new_leads: 9, num_follow_ups: 4, num_attended: 8,
  chair_utilisation: 85.5, total_chairs: 5, chairs_used: 4,
  reviews_collected: 4, before_after_pictures: 3, video_testimonials: 2, practice_plan_signups: 1,
  total_refunds: 50.0,
  refunds: [{ amount: 50, reason: 'Cancelled scale & polish', patient_name: 'J. Bloggs' }],
  source_google: 3, source_facebook: 2, source_walk_in: 1, source_referred: 2,
  appointment_booked_for: 'Follow-up next week', crm_system_notes: 'All entered in Nexus',
  patients: [{
    patient_name: 'Sarah Wong', phone: '07700 900 111', email: 'sarah@ex.com',
    treatment_accepted: 'Invisalign', amount: 4500, quantity: 1,
    source: 'Google', campaign: 'PPC-Aug', dentist: 'Dr Jones', comments: 'Signed today',
  }],
  detail_patient_rows_count: 1, detail_patient_money_total: 4500.0, variance_manager_vs_detail: 1,
  created_at: '2026-07-14T12:01:07.746418+00:00', created_by: 'user-1',
};

describe('mapCashup', () => {
  it('maps money fields to integer pence', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.cash_up_money_taken_pence).toBe(185000);
    expect(row.tx_plan_given_value_pence).toBe(1200000);
    expect(row.total_refunds_pence).toBe(5000);
    expect(row.detail_patient_money_total_pence).toBe(450000);
  });
  it('maps counts and chair utilisation', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.treatments_accepted).toBe(2);
    expect(row.num_attended).toBe(8);
    expect(row.chair_utilisation).toBe(85.5);
    expect(row.organisation_id).toBe(ORG);
    expect(row.cashup_date).toBe('2026-08-20');
  });
  it('splits known source_* into columns and custom sources into custom_sources', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.source_google).toBe(3);
    expect(row.source_facebook).toBe(2);
    expect(row.source_walk_in).toBe(1);
    expect(row.source_youtube).toBe(0);
    expect(row.custom_sources).toEqual({ referred: 2 });
  });
  it('normalises refunds to pence', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.refunds).toEqual([{ amount_pence: 5000, reason: 'Cancelled scale & polish', patient_name: 'J. Bloggs' }]);
  });
  it('derives external_id from business_id + date, stable across re-saves', () => {
    expect(mapCashup(DATA, ORG).row.external_id).toBe(cashupExternalId(DATA));
    expect(mapCashup(DATA, ORG).row.external_id).toBe(mapCashup({ ...DATA }, ORG).row.external_id);
  });
  it('maps patients[] into treatment_accepted rows (same external_id path)', () => {
    const { patients } = mapCashup(DATA, ORG);
    expect(patients).toHaveLength(1);
    expect(patients[0].value_pence).toBe(450000);
    expect(patients[0].phone).toBe('07700 900 111');
    expect(patients[0].business_id).toBe('biz1');
    expect(patients[0].accepted_date).toBe('2026-08-20');
    expect(patients[0].organisation_id).toBe(ORG);
  });
  it('stores variance verbatim and keeps the full raw payload', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.variance_manager_vs_detail).toBe(1);
    expect(row.raw).toBe(DATA);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-map-cashup.test.mjs`
Expected: FAIL — `mapCashup is not a function`.

- [ ] **Step 3: Implement `cashupExternalId` + `mapCashup`**

In `emergent-sync.js` add:
```javascript
const KNOWN_SOURCES = [
    'google', 'facebook', 'walk_in', 'friends_family', 'wl_website',
    'dentist_referral', 'instagram', 'youtube', 'other',
];

export function cashupExternalId(data) {
    return `${data.business_id}_${data.date}`;
}

// Map one daily_cashup payload -> { row (emergent_daily_cashup), patients
// (treatment_accepted rows via mapRecord) }. Money -> pence. Known source_*
// keys become typed columns; anything else lands in custom_sources.
export function mapCashup(data, orgId, maps = null) {
    const empty = (s) => (s == null || String(s).trim() === '' ? null : String(s));
    const practiceId = resolvePracticeFromMaps(data.business_id, data.business_name, maps);

    const sourceCols = {
        source_google: 0, source_facebook: 0, source_walk_in: 0, source_friends_family: 0,
        source_wl_website: 0, source_dentist_referral: 0, source_instagram: 0,
        source_youtube: 0, source_other: 0,
    };
    const custom_sources = {};
    for (const [k, v] of Object.entries(data)) {
        const m = /^source_(.+)$/.exec(k);
        if (!m) continue;
        const key = m[1];
        if (KNOWN_SOURCES.includes(key)) sourceCols[`source_${key}`] = Number(v || 0);
        else custom_sources[key] = Number(v || 0);
    }

    const refunds = Array.isArray(data.refunds)
        ? data.refunds.map((r) => ({
            amount_pence: poundsToPence(r.amount),
            reason: r.reason ?? null,
            patient_name: r.patient_name ?? null,
        }))
        : [];

    const row = {
        organisation_id: orgId,
        business_id: data.business_id == null ? null : String(data.business_id),
        business_name: empty(data.business_name),
        practice_id: practiceId,
        cashup_date: data.date ?? null,
        external_id: cashupExternalId(data),
        treatments_accepted: Number(data.treatments_accepted ?? data.num_treatment_accepted ?? 0),
        tx_plans_given: Number(data.tx_plans_given || 0),
        tx_plan_given_value_pence: poundsToPence(data.total_tx_plan_given_value),
        cash_up_money_taken_pence: poundsToPence(data.cash_up_money_taken),
        num_bookings: Number(data.num_bookings || 0),
        num_new_leads: Number(data.num_new_leads || 0),
        num_follow_ups: Number(data.num_follow_ups || 0),
        num_attended: Number(data.num_attended || 0),
        total_chairs: Number(data.total_chairs || 0),
        chairs_used: Number(data.chairs_used || 0),
        chair_utilisation: data.chair_utilisation == null ? null : Number(data.chair_utilisation),
        reviews_collected: Number(data.reviews_collected || 0),
        before_after_pictures: Number(data.before_after_pictures || 0),
        video_testimonials: Number(data.video_testimonials || 0),
        practice_plan_signups: Number(data.practice_plan_signups || 0),
        total_refunds_pence: poundsToPence(data.total_refunds),
        ...sourceCols,
        custom_sources,
        refunds,
        appointment_booked_for: empty(data.appointment_booked_for),
        crm_system_notes: empty(data.crm_system_notes),
        detail_patient_rows_count: Number(data.detail_patient_rows_count || 0),
        detail_patient_money_total_pence: poundsToPence(data.detail_patient_money_total),
        variance_manager_vs_detail: data.variance_manager_vs_detail == null ? null : Number(data.variance_manager_vs_detail),
        emergent_created_at: data.created_at ?? null,
        emergent_created_by: data.created_by == null ? null : String(data.created_by),
        raw: data,
    };

    const patients = Array.isArray(data.patients)
        ? data.patients.map((p) => mapRecord(
            { ...p, business_id: data.business_id, business_name: data.business_name, date: data.date },
            orgId, maps,
        ))
        : [];

    return { row, patients };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-map-cashup.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/emergent-sync.js backend/test/emergent-map-cashup.test.mjs
git commit -m "feat(emergent): mapCashup daily cash-up mapper (+ patients dedup path)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `mapMonthlyPl` — monthly P&L mapper

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js`
- Test: `backend/test/emergent-map-monthly-pl.test.mjs`

**Interfaces:**
- Produces: `monthlyPlExternalId(data): string`; `mapMonthlyPl(data, orgId, maps): row` (an `emergent_monthly_pl` row). Known lines → typed pence columns; unknown numeric lines → `custom_lines`; `*_notes` → `line_notes`.
- Consumes: `poundsToPence`, `resolvePracticeFromMaps`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/emergent-map-monthly-pl.test.mjs
import { describe, it, expect } from 'vitest';
const { mapMonthlyPl, monthlyPlExternalId } = await import('../src/lib/integrations/emergent-sync.js');

const ORG = '00000000-0000-0000-0000-000000000001';
const DATA = {
  id: 'biz1_2026-08-01', business_id: 'biz1', business_name: 'Ashford', date: '2026-08-01',
  notes: 'Busy summer month',
  revenue: 95000, gross_profit: 60400.0, net_profit: 21220.0,
  total_cost_of_sales: 34600.0, total_operating_expenses: 39180.0,
  cash_collected: 88500, tx_accepted_amount: 81000, bank_balance: 52400, average_wait_time: 11,
  principal_fees: 18000, principal_fees_notes: '3 associates',
  hygienist_therapist: 6500, lab_fees: 4200, materials: 5100, sedation_services: 800,
  advertising_marketing: 7500, advertising_marketing_notes: 'Meta + Google',
  bank_charges: 150, business_rates_rent: 5200, salaries_staff_cost: 21000, telephone_wifi: 180,
  utilities: 1300, insurance: 850, management_fees: 2000, subscriptions: 420, it_expenses: 300,
  card_machine_charges: 280,
  locum_cover: 1750, // custom line a CEO added (extra="allow")
  created_at: '2026-07-14T12:01:07.914529+00:00', created_by: 'user-1',
  last_updated_at: '2026-07-14T12:01:07.913839+00:00', last_updated_by: 'user-1',
  last_updated_by_email: 'demo@dental.com',
};

describe('mapMonthlyPl', () => {
  it('maps headline roll-ups to pence', () => {
    const r = mapMonthlyPl(DATA, ORG);
    expect(r.revenue_pence).toBe(9500000);
    expect(r.net_profit_pence).toBe(2122000);
    expect(r.total_cost_of_sales_pence).toBe(3460000);
    expect(r.cash_collected_pence).toBe(8850000);
    expect(r.bank_balance_pence).toBe(5240000);
  });
  it('keeps average_wait_time as a non-money numeric', () => {
    expect(mapMonthlyPl(DATA, ORG).average_wait_time).toBe(11);
  });
  it('maps known cost-of-sales and opex lines to typed pence columns', () => {
    const r = mapMonthlyPl(DATA, ORG);
    expect(r.principal_fees_pence).toBe(1800000);
    expect(r.materials_pence).toBe(510000);
    expect(r.advertising_marketing_pence).toBe(750000);
    expect(r.card_machine_charges_pence).toBe(28000);
  });
  it('routes an unknown line into custom_lines (pence) and never loses it', () => {
    expect(mapMonthlyPl(DATA, ORG).custom_lines).toEqual({ locum_cover: 175000 });
  });
  it('collects every *_notes into line_notes keyed by line', () => {
    expect(mapMonthlyPl(DATA, ORG).line_notes).toEqual({
      principal_fees: '3 associates', advertising_marketing: 'Meta + Google',
    });
  });
  it('maps keys, month and audit fields', () => {
    const r = mapMonthlyPl(DATA, ORG);
    expect(r.organisation_id).toBe(ORG);
    expect(r.period_month).toBe('2026-08-01');
    expect(r.external_id).toBe(monthlyPlExternalId(DATA));
    expect(r.notes).toBe('Busy summer month');
    expect(r.last_updated_by_email).toBe('demo@dental.com');
    expect(r.raw).toBe(DATA);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-map-monthly-pl.test.mjs`
Expected: FAIL — `mapMonthlyPl is not a function`.

- [ ] **Step 3: Implement `monthlyPlExternalId` + `mapMonthlyPl`**

In `emergent-sync.js` add:
```javascript
// Headline roll-ups (payload key -> row column), all money -> pence.
const PL_HEADLINE = {
    revenue: 'revenue_pence',
    gross_profit: 'gross_profit_pence',
    net_profit: 'net_profit_pence',
    total_cost_of_sales: 'total_cost_of_sales_pence',
    total_operating_expenses: 'total_operating_expenses_pence',
    cash_collected: 'cash_collected_pence',
    tx_accepted_amount: 'tx_accepted_amount_pence',
    bank_balance: 'bank_balance_pence',
};
// Known cost-of-sales + opex line items -> their typed pence column.
const PL_KNOWN_LINES = [
    'principal_fees', 'hygienist_therapist', 'lab_fees', 'materials', 'sedation_services',
    'advertising_marketing', 'bank_charges', 'business_rates_rent', 'salaries_staff_cost',
    'telephone_wifi', 'utilities', 'insurance', 'management_fees', 'subscriptions',
    'it_expenses', 'card_machine_charges',
];
// Non-money / meta keys that must NOT be treated as custom money lines.
const PL_META = new Set([
    'id', 'business_id', 'business_name', 'date', 'notes', 'average_wait_time',
    'created_at', 'created_by', 'last_updated_at', 'last_updated_by', 'last_updated_by_email',
]);

export function monthlyPlExternalId(data) {
    return `${data.business_id}_${data.date}`;
}

// Map one monthly_pl payload -> emergent_monthly_pl row. Known lines become
// typed pence columns; any other numeric line lands in custom_lines (pence) so
// CEO-added lines survive; every *_notes lands in line_notes.
export function mapMonthlyPl(data, orgId, maps = null) {
    const empty = (s) => (s == null || String(s).trim() === '' ? null : String(s));
    const practiceId = resolvePracticeFromMaps(data.business_id, data.business_name, maps);

    const row = {
        organisation_id: orgId,
        business_id: data.business_id == null ? null : String(data.business_id),
        business_name: empty(data.business_name),
        practice_id: practiceId,
        period_month: data.date ?? null,
        external_id: monthlyPlExternalId(data),
        notes: empty(data.notes),
        average_wait_time: data.average_wait_time == null ? null : Number(data.average_wait_time),
        custom_lines: {},
        line_notes: {},
        raw: data,
        emergent_created_at: data.created_at ?? null,
        emergent_created_by: data.created_by == null ? null : String(data.created_by),
        last_updated_at: data.last_updated_at ?? null,
        last_updated_by: data.last_updated_by == null ? null : String(data.last_updated_by),
        last_updated_by_email: empty(data.last_updated_by_email),
    };
    for (const [key, col] of Object.entries(PL_HEADLINE)) row[col] = poundsToPence(data[key]);
    for (const line of PL_KNOWN_LINES) row[`${line}_pence`] = poundsToPence(data[line]);

    const known = new Set(PL_KNOWN_LINES);
    for (const [k, v] of Object.entries(data)) {
        if (k.endsWith('_notes')) {
            const base = k.slice(0, -'_notes'.length);
            if (v != null && String(v).trim() !== '') row.line_notes[base] = v;
            continue;
        }
        if (k in PL_HEADLINE || known.has(k) || PL_META.has(k)) continue;
        if (typeof v === 'number') row.custom_lines[k] = poundsToPence(v);
    }
    return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-map-monthly-pl.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/emergent-sync.js backend/test/emergent-map-monthly-pl.test.mjs
git commit -m "feat(emergent): mapMonthlyPl monthly P&L mapper (typed lines + custom_lines/line_notes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Repositories for the two tables

**Files:**
- Create: `backend/src/repositories/emergent-daily-cashup.repository.js`
- Create: `backend/src/repositories/emergent-monthly-pl.repository.js`
- Test: `backend/test/emergent-cashup-repos.test.mjs`

**Interfaces:**
- Produces: `emergentDailyCashupRepository.upsert(row)` (onConflict `organisation_id,business_id,cashup_date`), `.listByOrg(orgId, {since, until, limit})`. `emergentMonthlyPlRepository.upsert(row)` (onConflict `organisation_id,business_id,period_month`), `.listByOrg(orgId, {sinceMonth, untilMonth, limit})`.
- Consumes: the `supaRec` test harness (`test/setup.js`).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/emergent-cashup-repos.test.mjs
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const ORG = '00000000-0000-0000-0000-000000000001';
let cashupRepo, plRepo;
beforeEach(async () => {
  supaRec.resultProvider = () => ({ data: [{ id: 'x' }], error: null });
  ({ emergentDailyCashupRepository: cashupRepo } = await import('../src/repositories/emergent-daily-cashup.repository.js'));
  ({ emergentMonthlyPlRepository: plRepo } = await import('../src/repositories/emergent-monthly-pl.repository.js'));
});

describe('emergent daily cash-up repo', () => {
  it('upserts on (organisation_id, business_id, cashup_date)', async () => {
    supaRec.resultProvider = () => ({ data: { id: 'x' }, error: null });
    await cashupRepo.upsert({ organisation_id: ORG, business_id: 'b', cashup_date: '2026-08-20' });
    expect(supaRec.last.table).toBe('emergent_daily_cashup');
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,business_id,cashup_date');
  });
  it('listByOrg filters by organisation_id (rule 3)', async () => {
    await cashupRepo.listByOrg(ORG, { since: '2026-08-01', until: '2026-08-31' });
    expect(supaRec.last.table).toBe('emergent_daily_cashup');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
});

describe('emergent monthly P&L repo', () => {
  it('upserts on (organisation_id, business_id, period_month)', async () => {
    supaRec.resultProvider = () => ({ data: { id: 'x' }, error: null });
    await plRepo.upsert({ organisation_id: ORG, business_id: 'b', period_month: '2026-08-01' });
    expect(supaRec.last.table).toBe('emergent_monthly_pl');
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,business_id,period_month');
  });
  it('listByOrg filters by organisation_id (rule 3)', async () => {
    await plRepo.listByOrg(ORG, {});
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-cashup-repos.test.mjs`
Expected: FAIL — cannot import the repositories.

- [ ] **Step 3: Implement the repositories**

`backend/src/repositories/emergent-daily-cashup.repository.js`:
```javascript
// Emergent daily cash-up repository. serviceClient path -> explicit
// organisation_id filter on every query (rule 3). Money is integer pence.
import * as supabase_1 from "../lib/supabase.js";

const SAFE_COLS =
  'id, organisation_id, business_id, business_name, practice_id, cashup_date, external_id, ' +
  'treatments_accepted, tx_plans_given, tx_plan_given_value_pence, cash_up_money_taken_pence, ' +
  'num_bookings, num_new_leads, num_follow_ups, num_attended, total_chairs, chairs_used, ' +
  'chair_utilisation, reviews_collected, before_after_pictures, video_testimonials, ' +
  'practice_plan_signups, total_refunds_pence, source_google, source_facebook, source_walk_in, ' +
  'source_friends_family, source_wl_website, source_dentist_referral, source_instagram, ' +
  'source_youtube, source_other, custom_sources, refunds, appointment_booked_for, ' +
  'crm_system_notes, detail_patient_rows_count, detail_patient_money_total_pence, ' +
  'variance_manager_vs_detail, synced_at, updated_at';

export const emergentDailyCashupRepository = {
    async upsert(row) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .upsert({ ...row, updated_at: new Date().toISOString() },
                { onConflict: 'organisation_id,business_id,cashup_date' })
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    async listByOrg(orgId, { since = null, until = null, limit = 500 } = {}) {
        let q = supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .order('cashup_date', { ascending: false })
            .limit(limit);
        if (since) q = q.gte('cashup_date', since);
        if (until) q = q.lte('cashup_date', until);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
```

`backend/src/repositories/emergent-monthly-pl.repository.js`:
```javascript
// Emergent monthly P&L repository. serviceClient path -> explicit
// organisation_id filter on every query (rule 3). Money is integer pence.
import * as supabase_1 from "../lib/supabase.js";

const SAFE_COLS =
  'id, organisation_id, business_id, business_name, practice_id, period_month, external_id, ' +
  'notes, revenue_pence, gross_profit_pence, net_profit_pence, total_cost_of_sales_pence, ' +
  'total_operating_expenses_pence, cash_collected_pence, tx_accepted_amount_pence, ' +
  'bank_balance_pence, average_wait_time, principal_fees_pence, hygienist_therapist_pence, ' +
  'lab_fees_pence, materials_pence, sedation_services_pence, advertising_marketing_pence, ' +
  'bank_charges_pence, business_rates_rent_pence, salaries_staff_cost_pence, telephone_wifi_pence, ' +
  'utilities_pence, insurance_pence, management_fees_pence, subscriptions_pence, it_expenses_pence, ' +
  'card_machine_charges_pence, custom_lines, line_notes, synced_at, updated_at';

export const emergentMonthlyPlRepository = {
    async upsert(row) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_monthly_pl')
            .upsert({ ...row, updated_at: new Date().toISOString() },
                { onConflict: 'organisation_id,business_id,period_month' })
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    async listByOrg(orgId, { sinceMonth = null, untilMonth = null, limit = 500 } = {}) {
        let q = supabase_1.serviceClient
            .from('emergent_monthly_pl')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .order('period_month', { ascending: false })
            .limit(limit);
        if (sinceMonth) q = q.gte('period_month', sinceMonth);
        if (untilMonth) q = q.lte('period_month', untilMonth);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-cashup-repos.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/emergent-daily-cashup.repository.js backend/src/repositories/emergent-monthly-pl.repository.js backend/test/emergent-cashup-repos.test.mjs
git commit -m "feat(emergent): daily cash-up + monthly P&L repositories (org-scoped upsert)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Pull / backfill — `fetchCashups`, `fetchMonthlyPl`, extend `syncOrg`

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js`
- Test: `backend/test/emergent-sync-pull.test.mjs`

**Interfaces:**
- Produces: `fetchCashups(baseUrl, apiKey, startDate, endDate): Promise<sheet[]>`, `fetchMonthlyPl(baseUrl, apiKey, startMonth, endMonth): Promise<month[]>` (exported for testing). `syncOrg` now also pulls + upserts cash-ups and monthly P&L.
- Consumes: `mapCashup`, `mapMonthlyPl`, the two new repositories, `treatmentAcceptedRepository.upsert`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/emergent-sync-pull.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCashups, fetchMonthlyPl } = await import('../src/lib/integrations/emergent-sync.js');

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('emergent pull endpoints', () => {
  it('fetchCashups calls /api/public/daily-cashups with the window and returns sheets[]', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ count: 1, sheets: [{ business_id: 'b', date: '2026-08-20' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchCashups('https://api.test/', 'key123', '2026-08-01', '2026-08-31');
    expect(rows).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/api/public/daily-cashups');
    expect(url).toContain('start_date=2026-08-01');
    expect(url).toContain('end_date=2026-08-31');
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('key123');
  });
  it('fetchMonthlyPl calls /api/public/monthly-pl and returns months[]', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ count: 1, months: [{ business_id: 'b', date: '2026-08-01' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchMonthlyPl('https://api.test/', 'key123', '2026-06-01', '2026-08-01');
    expect(rows).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/public/monthly-pl');
    expect(fetchMock.mock.calls[0][0]).toContain('start_month=2026-06-01');
  });
  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' })));
    await expect(fetchCashups('https://api.test/', 'k', '2026-08-01', '2026-08-31')).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-sync-pull.test.mjs`
Expected: FAIL — `fetchCashups is not a function`.

- [ ] **Step 3: Implement the fetchers and extend `syncOrg`**

In `emergent-sync.js` add the endpoint constants near the top (beside `ENDPOINT`):
```javascript
const CASHUP_ENDPOINT = '/api/public/daily-cashups';
const MONTHLY_PL_ENDPOINT = '/api/public/monthly-pl';
```
Add the fetchers (beside `fetchRecords`):
```javascript
async function emergentGetJson(url, apiKey) {
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Emergent API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
}

// Pull daily cash-up sheets in [startDate, endDate] (YYYY-MM-DD).
export async function fetchCashups(baseUrl, apiKey, startDate, endDate) {
    const base = baseUrl.replace(/\/+$/, '');
    const url = `${base}${CASHUP_ENDPOINT}?start_date=${encodeURIComponent(startDate)}`
        + `&end_date=${encodeURIComponent(endDate)}&limit=1000`;
    const json = await emergentGetJson(url, apiKey);
    return Array.isArray(json?.sheets) ? json.sheets : [];
}

// Pull monthly P&L rows in [startMonth, endMonth] (YYYY-MM-01).
export async function fetchMonthlyPl(baseUrl, apiKey, startMonth, endMonth) {
    const base = baseUrl.replace(/\/+$/, '');
    const url = `${base}${MONTHLY_PL_ENDPOINT}?start_month=${encodeURIComponent(startMonth)}`
        + `&end_month=${encodeURIComponent(endMonth)}&limit=1000`;
    const json = await emergentGetJson(url, apiKey);
    return Array.isArray(json?.months) ? json.months : [];
}
```
Add the repository imports at the top of the file (beside the existing `treatmentAcceptedRepository` import):
```javascript
import { emergentDailyCashupRepository } from "../../repositories/emergent-daily-cashup.repository.js";
import { emergentMonthlyPlRepository } from "../../repositories/emergent-monthly-pl.repository.js";
```
In `syncOrg`, inside the existing `try` block, AFTER the treatments loop that calls `integrationRepository.setSyncTime` — insert the two new pulls just before `setSyncTime` (so a failure still marks failed via the existing catch). Replace the tail of the try:
```javascript
        let synced = 0;
        for (const rec of records) {
            await treatmentAcceptedRepository.upsert(mapRecord(rec, orgId, maps));
            synced += 1;
        }

        const today = new Date().toISOString().slice(0, 10);
        const startMonth = `${startDate.slice(0, 7)}-01`;
        const [cashups, plRows] = await Promise.all([
            fetchCashups(baseUrl, apiKey, startDate, today),
            fetchMonthlyPl(baseUrl, apiKey, startMonth, `${today.slice(0, 7)}-01`),
        ]);
        await emergentPracticeMapRepository.discover(
            orgId,
            cashups.map((r) => ({ business_id: r.business_id, business_name: r.business_name })),
        );
        for (const sheet of cashups) {
            const { row, patients } = mapCashup(sheet, orgId, maps);
            await emergentDailyCashupRepository.upsert(row);
            for (const p of patients) await treatmentAcceptedRepository.upsert(p);
        }
        for (const plRow of plRows) {
            await emergentMonthlyPlRepository.upsert(mapMonthlyPl(plRow, orgId, maps));
        }

        await integrationRepository.setSyncTime(orgId, PROVIDER);
        return { synced, cashups: cashups.length, monthlyPl: plRows.length };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-sync-pull.test.mjs`
Expected: PASS. Then run the full emergent suite to confirm no regression:
`cd backend && npx vitest run test/emergent-map-record.test.mjs test/emergent-map-cashup.test.mjs test/emergent-map-monthly-pl.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/emergent-sync.js backend/test/emergent-sync-pull.test.mjs
git commit -m "feat(emergent): backfill pull for daily cash-up + monthly P&L in syncOrg

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Webhook dispatch for the two new events

**Files:**
- Modify: `backend/src/services/webhook.service.js` (`emergent` method)
- Test: `backend/test/emergent-webhook-cashup-pl.test.mjs`

**Interfaces:**
- Consumes: `mapCashup`, `mapMonthlyPl` (from `emergent-sync.js`), `emergentDailyCashupRepository.upsert`, `emergentMonthlyPlRepository.upsert`, `treatmentAcceptedRepository.upsert`.
- Produces: `webhookService.emergent` handles `daily_cashup.saved` (upsert cash-up row + each patient into `treatment_accepted`) and `monthly_pl.saved` (upsert P&L row). Existing `treatment.*` behaviour unchanged.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/emergent-webhook-cashup-pl.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const taUpsert = vi.fn(async (row) => row);
const cashupUpsert = vi.fn(async (row) => row);
const plUpsert = vi.fn(async (row) => row);
const discover = vi.fn(async () => {});
const getByProvider = vi.fn();
const setSyncTime = vi.fn(async () => {});
const recordWebhookResult = vi.fn(async () => {});
const loadResolution = vi.fn(async () => ({ explicit: new Map(), fuzzy: new Map() }));

vi.mock('../src/repositories/treatment-accepted.repository.js', () => ({
  treatmentAcceptedRepository: { upsert: taUpsert, deleteByExternalId: vi.fn() },
}));
vi.mock('../src/repositories/emergent-daily-cashup.repository.js', () => ({
  emergentDailyCashupRepository: { upsert: cashupUpsert },
}));
vi.mock('../src/repositories/emergent-monthly-pl.repository.js', () => ({
  emergentMonthlyPlRepository: { upsert: plUpsert },
}));
vi.mock('../src/repositories/emergent-practice-map.repository.js', () => ({
  emergentPracticeMapRepository: { discover, resolutionMap: vi.fn(async () => new Map()) },
}));
vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { getByProvider, setSyncTime, recordWebhookResult },
}));
vi.mock('../src/lib/integrations/emergent-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadResolution };
});

const SECRET = 'whsec_test_123';
const ORG = '00000000-0000-0000-0000-000000000001';
const sign = (buf) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');

let token, webhookService;
beforeEach(async () => {
  vi.clearAllMocks();
  process.env.OAUTH_STATE_SECRET ||= 'test-oauth-state-secret';
  const { signWebhookToken } = await import('../src/lib/webhook-token.js');
  token = signWebhookToken(ORG);
  getByProvider.mockResolvedValue({ status: 'active', config: { webhook_secret: SECRET } });
  ({ webhookService } = await import('../src/services/webhook.service.js'));
});

const CASHUP = {
  business_id: 'biz1', business_name: 'Ashford', date: '2026-08-20',
  cash_up_money_taken: 1850.0, source_google: 3,
  patients: [{ patient_name: 'Sarah Wong', treatment_accepted: 'Invisalign', amount: 4500, source: 'Google' }],
};
const PL = {
  business_id: 'biz1', business_name: 'Ashford', date: '2026-08-01',
  revenue: 95000, net_profit: 21220.0,
};

it('daily_cashup.saved upserts the cash-up row + each patient into treatment_accepted', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'daily_cashup.saved', data: CASHUP }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'daily_cashup.saved');
  expect(res.received).toBe(true);
  expect(cashupUpsert).toHaveBeenCalledTimes(1);
  expect(cashupUpsert.mock.calls[0][0].organisation_id).toBe(ORG);
  expect(cashupUpsert.mock.calls[0][0].cash_up_money_taken_pence).toBe(185000);
  expect(taUpsert).toHaveBeenCalledTimes(1);
  expect(taUpsert.mock.calls[0][0].value_pence).toBe(450000);
});

it('monthly_pl.saved upserts the P&L row', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'monthly_pl.saved', data: PL }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'monthly_pl.saved');
  expect(res.received).toBe(true);
  expect(plUpsert).toHaveBeenCalledTimes(1);
  expect(plUpsert.mock.calls[0][0].revenue_pence).toBe(9500000);
  expect(plUpsert.mock.calls[0][0].organisation_id).toBe(ORG);
});

it('a bad signature rejects (401) and writes nothing', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'daily_cashup.saved', data: CASHUP }));
  await expect(webhookService.emergent(token, raw, 'sha256=deadbeef', 'daily_cashup.saved'))
    .rejects.toMatchObject({ statusCode: 401 });
  expect(cashupUpsert).not.toHaveBeenCalled();
});

it('acks (200, not 5xx) when the cash-up upsert throws', async () => {
  cashupUpsert.mockRejectedValueOnce(new Error('deadlock'));
  const raw = Buffer.from(JSON.stringify({ event: 'daily_cashup.saved', data: CASHUP }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'daily_cashup.saved');
  expect(res).toMatchObject({ received: true, error: true });
});

it('scopes to the token org even if the body smuggles another organisation_id', async () => {
  const raw = Buffer.from(JSON.stringify({
    event: 'monthly_pl.saved', data: { ...PL, organisation_id: 'attacker-org' },
  }));
  await webhookService.emergent(token, raw, sign(raw), 'monthly_pl.saved');
  expect(plUpsert.mock.calls[0][0].organisation_id).toBe(ORG);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/emergent-webhook-cashup-pl.test.mjs`
Expected: FAIL — `cashupUpsert` not called (events fall through to `ignored`).

- [ ] **Step 3: Wire the dispatch in `webhook.service.js`**

Add imports at the top of `webhook.service.js` (beside the existing emergent imports):
```javascript
import { emergentDailyCashupRepository } from "../repositories/emergent-daily-cashup.repository.js";
import { emergentMonthlyPlRepository } from "../repositories/emergent-monthly-pl.repository.js";
import { mapCashup as mapEmergentCashup, mapMonthlyPl as mapEmergentMonthlyPl } from "../lib/integrations/emergent-sync.js";
```
In the `emergent` method, inside the `try` block, BEFORE the existing `if (action === 'deleted')` line, add:
```javascript
            if (event === 'daily_cashup.saved') {
                const maps = await loadEmergentResolution(orgId);
                const { row, patients } = mapEmergentCashup(data, orgId, maps);
                await emergentDailyCashupRepository.upsert(row);
                for (const p of patients) await treatmentAcceptedRepository.upsert(p);
                await integrationRepository.setSyncTime(orgId, 'emergent');
                return { received: true, event, processed: true, patients: patients.length };
            }
            if (event === 'monthly_pl.saved') {
                const maps = await loadEmergentResolution(orgId);
                await emergentMonthlyPlRepository.upsert(mapEmergentMonthlyPl(data, orgId, maps));
                await integrationRepository.setSyncTime(orgId, 'emergent');
                return { received: true, event, processed: true };
            }
```
(The existing business `discover` call above these lines already runs for all events, so the two new events also register their business.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/emergent-webhook-cashup-pl.test.mjs`
Expected: PASS. Then run the existing webhook suite to confirm no regression:
`cd backend && npx vitest run test/emergent-webhook.test.mjs`
Expected: PASS (treatment.* behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/webhook.service.js backend/test/emergent-webhook-cashup-pl.test.mjs
git commit -m "feat(emergent): webhook dispatch for daily_cashup.saved + monthly_pl.saved

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Sync unmanaged schema copy + docs

**Files:**
- Modify: `db/01_schema.sql`
- Modify: `docs/API.md`
- Modify: `treatmentaccepted.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Mirror the two tables into `db/01_schema.sql`**

Append the `create table` statements for `emergent_daily_cashup` and `emergent_monthly_pl` (copied verbatim from the `000110` migration, without the `if not exists` guards is fine — match the surrounding file's style) and the five `treatment_accepted` columns to `db/01_schema.sql`, so the unmanaged source copy stays in sync (per CLAUDE.md).

- [ ] **Step 2: Document the webhook events + pull endpoints**

In `docs/API.md`, under the Emergent/webhooks section, add: the two new webhook events (`daily_cashup.saved`, `monthly_pl.saved`) with their signature scheme (`sha256=` HMAC over the raw body, per-org `webhook_secret`), and the two pull endpoints (`GET /api/public/daily-cashups`, `GET /api/public/monthly-pl`) used by the nightly backfill. In `treatmentaccepted.md`, note the enrichment columns and that `patients[]` from `daily_cashup.saved` converge on `treatment_accepted` via the shared `external_id`.

- [ ] **Step 3: Run the full emergent test suite**

Run: `cd backend && npx vitest run test/emergent-pounds-to-pence.test.mjs test/emergent-map-record.test.mjs test/emergent-map-cashup.test.mjs test/emergent-map-monthly-pl.test.mjs test/emergent-cashup-repos.test.mjs test/emergent-sync-pull.test.mjs test/emergent-webhook.test.mjs test/emergent-webhook-cashup-pl.test.mjs`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add db/01_schema.sql docs/API.md treatmentaccepted.md
git commit -m "docs(emergent): schema copy + API docs for cash-up/monthly-pl ingestion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Rollout (after all tasks)

1. Apply migration `000110` on hosted (Supabase MCP), then `NOTIFY pgrst, 'reload schema';`.
2. Ensure Emergent granted the new scopes (`daily-cashup.read`, `monthly-pl.read`) to the org's existing API key.
3. Trigger a manual `full` backfill for the GM org (`POST /api/integrations/emergent/sync`), then verify row counts against the Emergent `/summary` endpoints.
4. Confirm live `daily_cashup.saved` / `monthly_pl.saved` deliveries land (owner keeps the webhook signing secret set).

Then proceed to spec #2 (the Cockpit).

## Notes carried forward

- `variance_manager_vs_detail` semantics unconfirmed — stored verbatim; the cockpit spec decides how to surface it.
- Custom P&L lines cannot be bucketed into cost-of-sales vs opex from the flat webhook payload (no marker); they live in a single `custom_lines` map. Headline totals (`total_cost_of_sales`, `total_operating_expenses`) are provided directly, so bucketing is not needed for roll-ups.
- `treatment_accepted.phone`/`email` are intentionally NOT added to the repo `SAFE_COLS` (PII stays out of list responses).
```

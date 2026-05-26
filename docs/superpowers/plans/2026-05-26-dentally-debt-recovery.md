# Dentally Debt Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the Debt Recovery page off real Dentally invoice data instead of the hardcoded `DEBTORS` mock.

**Architecture:** Pull Dentally `/v1/invoices` into a new `invoices` table via the existing connector pattern (paginate → map → idempotent upsert). Expose `GET /api/debt` (route→controller→service→repo) that aggregates unpaid invoices into aged bands + KPIs. Rewire `DebtScreen` with React Query.

**Tech Stack:** Node ESM (Express), Supabase (Postgres + RLS), Vitest, Next.js 14 App Router, React Query, Zod.

---

## File Structure

**Backend — create:**
- `supabase/migrations/20260101000027_invoices.sql` — patient `invoices` table + unique index.
- `backend/src/models/debt.model.js` — Zod query schema.
- `backend/src/repositories/debt.repository.js` — unpaid-invoice query, org-scoped.
- `backend/src/services/debt.service.js` — aging + band aggregation (pure helpers + `list`).
- `backend/src/controllers/debt.controller.js` — HTTP shape.
- `backend/src/routes/debt.routes.js` — Express router.
- `backend/test/debt.service.test.mjs` — aging/band/KPI unit tests.
- `backend/test/debt.repository.test.mjs` — org-scope + filter assertions.

**Backend — modify:**
- `backend/src/lib/integrations/dentally-sync.js` — add `invoiceRow`, `pullInvoices`, wire into `syncOneOrg`, `applyWebhookEvent`, progress phases, `__test`.
- `backend/src/app.js` — import + mount `/api/debt`.
- `backend/test/dentally-sync.test.mjs` — add `invoiceRow` cases.
- `db/01_schema.sql` — add `invoices` table (unmanaged source copy, keep in sync).
- `docs/API.md` — document `GET /api/debt`.

**Frontend — create:**
- `frontend/features/intelligence/debt-api.ts` — `useDebt` hook + `formatPenceCompact`.

**Frontend — modify:**
- `frontend/features/intelligence/components/DebtScreen.tsx` — fetch via `useDebt`, remove mock import.
- `frontend/features/intelligence/data.ts` — remove `DEBTORS` + `Debtor` (after verifying no other importers).

---

## Task 1: Migration — `invoices` table

**Files:**
- Create: `supabase/migrations/20260101000027_invoices.sql`
- Modify: `db/01_schema.sql`

- [ ] **Step 1: Confirm the migration number is unused**

Run: `ls supabase/migrations/ | tail -3`
Expected: highest is `20260101000026_*`. If a higher number exists, bump this file's prefix accordingly and keep the rest identical.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260101000027_invoices.sql`:

```sql
-- 20260101000027_invoices.sql
-- Patient invoices synced from Dentally /v1/invoices. Distinct from lab_invoices
-- (lab-supplier bills). Powers the Debt Recovery page: unpaid invoices
-- (amount_outstanding_pence > 0) are the debtors, aged by due_on/dated_on.
-- Idempotent.

CREATE TABLE IF NOT EXISTS invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id               uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  contact_id                uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source                    text NOT NULL DEFAULT 'dentally',
  external_id               text,
  amount_pence              integer NOT NULL DEFAULT 0,
  amount_outstanding_pence  integer NOT NULL DEFAULT 0,
  dated_on                  date,
  due_on                    date,
  paid                      boolean NOT NULL DEFAULT false,
  treatment                 text,
  patient_name              text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Idempotent upsert arbiter (mirrors uq_payments_src_ext).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_src_ext
  ON invoices(organisation_id, source, external_id);

CREATE INDEX IF NOT EXISTS idx_invoices_org_practice
  ON invoices(organisation_id, practice_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Org-isolation policy mirroring the other business tables. Repos use
-- serviceClient + explicit organisation_id filters (see CLAUDE.md), but the RLS
-- policy is the hard boundary for any tenantClient path.
DROP POLICY IF EXISTS invoices_org_isolation ON invoices;
CREATE POLICY invoices_org_isolation ON invoices
  USING (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid);
```

Note: match the FK target names to the existing schema. Verify with
`grep -n "create table" db/01_schema.sql | grep -i -E "organisation|practice|contact"` —
if the parent table is `organisations`/`practices`/`contacts`, the references above are correct. If the RLS policies in `02_rls.sql` use a different JWT claim path or a helper (e.g. a `current_org()` function), copy that exact predicate instead of `auth.jwt()`.

- [ ] **Step 3: Add the same table to the unmanaged source copy**

Append the `CREATE TABLE invoices …` block (without the `IF NOT EXISTS` is fine to match file style; keep consistent with neighbours) to `db/01_schema.sql` near the `payments` / `lab_invoices` definitions so the source copy stays in sync.

- [ ] **Step 4: Apply locally and verify**

Run: `supabase db reset` (from repo root)
Expected: completes without error; `invoices` table created. If `supabase` is not running locally, skip and note that the migration applies on next reset; do NOT block the rest of the plan on a local DB.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000027_invoices.sql db/01_schema.sql
git commit -m "feat(debt): invoices table for Dentally patient invoices"
```

---

## Task 2: Connector — sync Dentally invoices

**Files:**
- Modify: `backend/src/lib/integrations/dentally-sync.js`
- Test: `backend/test/dentally-sync.test.mjs`

- [ ] **Step 1: Write the failing mapper test**

In `backend/test/dentally-sync.test.mjs`, change the import line
`const { syncOneOrg, bootstrapOnConnect, __test } = await import(...)` to also pull `invoiceRow`:

```js
const { syncOneOrg, bootstrapOnConnect, invoiceRow, __test } = await import('../src/lib/integrations/dentally-sync.js');
```

Then add this describe block after the `dentally mappers` block:

```js
describe('invoiceRow', () => {
  const siteMap = new Map([['site-1', 'prac-1']]);
  const contactMap = new Map([['pat-1', 'contact-1']]);

  it('maps a Dentally invoice to an invoices row', () => {
    const row = invoiceRow('org-1', {
      id: 'inv-1', site_id: 'site-1', patient_id: 'pat-1',
      amount: 100, amount_outstanding: 40, dated_on: '2026-01-01',
      due_on: '2026-01-31', paid: false,
      invoice_items: [{ treatment: 'Implant' }], patient_name: 'R Sutton',
    }, siteMap, contactMap);
    expect(row).toMatchObject({
      organisation_id: 'org-1', source: 'dentally', external_id: 'inv-1',
      practice_id: 'prac-1', contact_id: 'contact-1',
      amount_pence: 10000, amount_outstanding_pence: 4000,
      dated_on: '2026-01-01', due_on: '2026-01-31', paid: false,
      treatment: 'Implant', patient_name: 'R Sutton',
    });
  });

  it('returns null when the site maps to no practice (practice_id is NOT NULL)', () => {
    expect(invoiceRow('org-1', { id: 'x', site_id: 'unknown' }, siteMap, contactMap)).toBeNull();
  });

  it('summarises multiple invoice items as "Multiple items"', () => {
    const row = invoiceRow('org-1', {
      id: 'inv-2', site_id: 'site-1', invoice_items: [{ treatment: 'A' }, { treatment: 'B' }],
    }, siteMap, contactMap);
    expect(row.treatment).toBe('Multiple items');
  });

  it('leaves contact_id null for an unknown patient', () => {
    const row = invoiceRow('org-1', { id: 'inv-3', site_id: 'site-1', patient_id: 'ghost' }, siteMap, contactMap);
    expect(row.contact_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/dentally-sync.test.mjs -t invoiceRow`
Expected: FAIL — `invoiceRow is not a function` (not yet exported).

- [ ] **Step 3: Add the row builder + treatment helper**

In `backend/src/lib/integrations/dentally-sync.js`, after `paymentRow` (around line 403), add:

```js
// Summarise an invoice's line items into a single treatment label for the debt
// table. >1 item -> "Multiple items"; else the first item's treatment name.
function invoiceTreatment(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    if (items.length > 1) return 'Multiple items';
    const it = items[0];
    return it?.treatment ?? it?.name ?? it?.description ?? null;
}

export function invoiceRow(orgId, inv, siteMap, contactMap) {
    const practiceId = siteMap.get(String(inv.site_id));
    if (!practiceId) return null; // invoices.practice_id is NOT NULL
    return {
        organisation_id: orgId,
        source: 'dentally',
        external_id: String(inv.id),
        practice_id: practiceId,
        contact_id: contactMap.get(String(inv.patient_id)) ?? null,
        // UAT: Dentally money units are ambiguous (docs say `amount` is "integer";
        // the payments path treats it as pounds-decimal). Use toPence for
        // consistency; verify pence-vs-pounds against the sandbox during UAT.
        amount_pence: toPence(inv.amount),
        amount_outstanding_pence: toPence(inv.amount_outstanding),
        dated_on: inv.dated_on ?? null,
        due_on: inv.due_on ?? null,
        paid: inv.paid === true,
        treatment: invoiceTreatment(inv.invoice_items),
        patient_name: inv.patient_name ?? null,
    };
}
```

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `cd backend && npx vitest run test/dentally-sync.test.mjs -t invoiceRow`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the pull function**

After `pullPayments` (around line 460), add:

```js
async function pullInvoices(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages) {
    const remote = await fetchAllPages(base, '/invoices', auth, params, onPage, maxPages);
    const rows = [];
    let skipped = 0;
    for (const inv of remote) {
        const row = invoiceRow(orgId, inv, siteMap, contactMap);
        if (!row) { skipped++; continue; } // invoices.practice_id is NOT NULL
        rows.push(row);
    }
    const synced = await upsertChunked('invoices', rows, 'organisation_id,source,external_id');
    return { synced, skipped };
}
```

- [ ] **Step 6: Wire invoices into `syncOneOrg`**

In `syncOneOrg`:

1. Add the invoices window params after `const payParams = { updated_since: since };`:
```js
    const invoiceParams = { updated_since: since };
```

2. Change `const PHASES = ['patients', 'appointments', 'payments'];` to:
```js
    const PHASES = ['patients', 'appointments', 'payments', 'invoices'];
```

3. Change the page-count probe block to include invoices:
```js
    const [patientPages, apptPages, payPages, invoicePages] = await Promise.all([
        fetchPageCount(base, '/patients', auth, patientParams, maxPages),
        fetchPageCount(base, '/appointments', auth, apptParams, maxPages),
        fetchPageCount(base, '/payments', auth, payParams, maxPages),
        fetchPageCount(base, '/invoices', auth, invoiceParams, maxPages),
    ]);
    const phaseTotals = [patientPages, apptPages, payPages, invoicePages];
```

4. After the `const pays = await pullPayments(...)` line, add:
```js
        const invoices = await pullInvoices(orgId, base, auth, invoiceParams, siteMap, contactMap, reporter(3), maxPages);
```

5. In the success `return { … }` object, add:
```js
            invoices: invoices.synced,
```
and add `(invoices.skipped ?? 0)` into the `skipped_unmatched_practice` sum:
```js
            skipped_unmatched_practice: (appts.skipped ?? 0) + (pays.skipped ?? 0) + (invoices.skipped ?? 0),
```

- [ ] **Step 7: Wire invoices into `applyWebhookEvent`**

In `applyWebhookEvent`, after the `payment` branch (before `return { ignored: resourceType };`), add:

```js
    if (resourceType === 'invoice') {
        const row = invoiceRow(orgId, record, siteMap, contactMap);
        if (!row) return { skipped: 'unmatched_practice' };
        await upsertChunked('invoices', [row], 'organisation_id,source,external_id');
        return { table: 'invoices', applied: 1 };
    }
```

(`siteMap` and `contactMap` are already loaded above the payment branch — confirm `contactMap` is in scope there; it is loaded right after the patient branch.)

- [ ] **Step 8: Add `invoiceRow`/`invoiceTreatment` to the test export**

Append to the `__test` object at the bottom of the file: `invoiceTreatment`. (`invoiceRow` is already a top-level export.)

```js
export const __test = { fetchAllPages, fetchPageCount, weightedPct, reportPct, isOpenAppointment, mapAppointmentStatus, mapPaymentStatus, mapPaymentMethod, toPence, authHeader, invoiceTreatment };
```

- [ ] **Step 9: Run the full connector suite**

Run: `cd backend && npx vitest run test/dentally-sync.test.mjs test/dentally-webhook.test.mjs test/dentally-sync-progress.test.mjs`
Expected: PASS. If the progress test asserts a fixed number of phases or `phaseTotals.length === 3`, update that expectation to 4 (the only intended behaviour change). Read the failure before editing.

- [ ] **Step 10: Commit**

```bash
git add backend/src/lib/integrations/dentally-sync.js backend/test/dentally-sync.test.mjs
git commit -m "feat(debt): sync Dentally invoices into invoices table"
```

---

## Task 3: Backend slice — `GET /api/debt`

**Files:**
- Create: `backend/src/models/debt.model.js`, `backend/src/repositories/debt.repository.js`, `backend/src/services/debt.service.js`, `backend/src/controllers/debt.controller.js`, `backend/src/routes/debt.routes.js`
- Test: `backend/test/debt.service.test.mjs`, `backend/test/debt.repository.test.mjs`
- Modify: `backend/src/app.js`

- [ ] **Step 1: Write the failing service test**

Create `backend/test/debt.service.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { ageDays, bandKey, buildDebtView } from '../src/services/debt.service.js';

const NOW = new Date('2026-05-26T00:00:00.000Z').getTime();

describe('ageDays', () => {
  it('ages from due_on when present', () => {
    expect(ageDays({ due_on: '2026-04-26', dated_on: '2026-01-01' }, NOW)).toBe(30);
  });
  it('falls back to dated_on when due_on is null', () => {
    expect(ageDays({ due_on: null, dated_on: '2026-04-26' }, NOW)).toBe(30);
  });
  it('clamps not-yet-due invoices to 0', () => {
    expect(ageDays({ due_on: '2026-06-30' }, NOW)).toBe(0);
  });
  it('returns 0 when no date at all', () => {
    expect(ageDays({}, NOW)).toBe(0);
  });
});

describe('bandKey', () => {
  it('maps boundaries', () => {
    expect(bandKey(0)).toBe('0-30');
    expect(bandKey(30)).toBe('0-30');
    expect(bandKey(31)).toBe('31-60');
    expect(bandKey(60)).toBe('31-60');
    expect(bandKey(90)).toBe('61-90');
    expect(bandKey(91)).toBe('91-120');
    expect(bandKey(120)).toBe('91-120');
    expect(bandKey(121)).toBe('120+');
  });
});

describe('buildDebtView', () => {
  const rows = [
    { amount_outstanding_pence: 425000, due_on: '2025-12-01', treatment: 'All-on-4',
      patient_name: 'R Sutton', practice: { name: 'Warwick Lodge' }, contact: null },           // ~176d -> 120+
    { amount_outstanding_pence: 180000, due_on: '2026-04-26', treatment: 'Invisalign',
      patient_name: null, contact: { first_name: 'S', last_name: 'Patel' },
      practice: { name: 'Ashford' } },                                                          // 30d -> 0-30
  ];
  const view = buildDebtView(rows, NOW);

  it('sums outstanding across all rows', () => {
    expect(view.outstanding_pence).toBe(605000);
  });
  it('sums 90+ overdue only', () => {
    expect(view.overdue90_pence).toBe(425000);
  });
  it('returns 5 bands with correct counts', () => {
    expect(view.bands.map((b) => b.key)).toEqual(['0-30', '31-60', '61-90', '91-120', '120+']);
    expect(view.bands.find((b) => b.key === '120+').count).toBe(1);
    expect(view.bands.find((b) => b.key === '0-30').count).toBe(1);
  });
  it('resolves name from contact, else patient_name, else Unknown', () => {
    expect(view.debtors.find((d) => d.amount_pence === 180000).name).toBe('S Patel');
    expect(view.debtors.find((d) => d.amount_pence === 425000).name).toBe('R Sutton');
    expect(buildDebtView([{ amount_outstanding_pence: 100 }], NOW).debtors[0].name).toBe('Unknown patient');
  });
  it('sorts debtors oldest-first', () => {
    expect(view.debtors[0].amount_pence).toBe(425000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/debt.service.test.mjs`
Expected: FAIL — cannot import from `debt.service.js` (file does not exist).

- [ ] **Step 3: Write the service**

Create `backend/src/services/debt.service.js`:

```js
// ============================================================================
// Debt service — aggregates unpaid Dentally invoices into aged bands + KPIs for
// the Debt Recovery page. Money is integer pence throughout.
// ============================================================================
import * as debt_repository_1 from "../repositories/debt.repository.js";

const BANDS = ['0-30', '31-60', '61-90', '91-120', '120+'];
const DAY_MS = 86400000;

// Days overdue from due_on (true overdue semantics), falling back to dated_on.
// Not-yet-due / undated invoices clamp to 0 (count as current).
export function ageDays(inv, now = Date.now()) {
    const ref = inv.due_on ?? inv.dated_on;
    if (!ref) return 0;
    const ms = now - new Date(ref).getTime();
    return Math.max(0, Math.floor(ms / DAY_MS));
}

export function bandKey(age) {
    if (age <= 30) return '0-30';
    if (age <= 60) return '31-60';
    if (age <= 90) return '61-90';
    if (age <= 120) return '91-120';
    return '120+';
}

// Pure transform: raw unpaid-invoice rows -> the Debt Recovery view model.
export function buildDebtView(rows, now = Date.now()) {
    const bands = new Map(BANDS.map((k) => [k, { key: k, label: `${k} days`, count: 0, total_pence: 0 }]));
    let outstanding_pence = 0;
    let overdue90_pence = 0;
    const debtors = (rows ?? []).map((r) => {
        const amount_pence = r.amount_outstanding_pence ?? 0;
        const age_days = ageDays(r, now);
        const b = bands.get(bandKey(age_days));
        b.count++;
        b.total_pence += amount_pence;
        outstanding_pence += amount_pence;
        if (age_days >= 91) overdue90_pence += amount_pence;
        const name = [r.contact?.first_name, r.contact?.last_name].filter(Boolean).join(' ').trim()
            || r.patient_name || 'Unknown patient';
        return { name, practice: r.practice?.name ?? null, treatment: r.treatment ?? null, amount_pence, age_days };
    }).sort((a, b) => b.age_days - a.age_days);
    return { outstanding_pence, overdue90_pence, bands: [...bands.values()], debtors };
}

export const debtService = {
    async list(orgId, { practiceId = null } = {}) {
        const rows = await debt_repository_1.debtRepository.listUnpaid(orgId, { practiceId });
        return buildDebtView(rows);
    },
};
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `cd backend && npx vitest run test/debt.service.test.mjs`
Expected: PASS. (`debtRepository` is imported but not exercised by these pure-function tests; the import resolves once Task 3 Step 6 creates the repo. If the import fails first, do Step 6 before re-running — both files are part of this task.)

- [ ] **Step 5: Write the failing repository test**

Create `backend/test/debt.repository.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const repo = (await import('../src/repositories/debt.repository.js')).debtRepository;
const ORG_A = 'org-aaaaaaaa';
const PRACTICE_1 = 'prac-11111111';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('debt repository — listUnpaid', () => {
  it('queries invoices scoped to the org with outstanding > 0', async () => {
    await repo.listUnpaid(ORG_A, {});
    expect(supaRec.last.table).toBe('invoices');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
    expect(supaRec.last.gtes).toContainEqual({ col: 'amount_outstanding_pence', val: 1 });
  });

  it('adds practice_id eq when provided', async () => {
    await repo.listUnpaid(ORG_A, { practiceId: PRACTICE_1 });
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE_1 });
  });

  it('omits practice_id eq when absent', async () => {
    await repo.listUnpaid(ORG_A, {});
    expect(supaRec.last.eqs.some((e) => e.col === 'practice_id')).toBe(false);
  });
});
```

- [ ] **Step 6: Write the repository**

Create `backend/src/repositories/debt.repository.js`:

```js
// ============================================================================
// Debt repository — Supabase data access for the debt domain. Returns unpaid
// invoice rows with contact + practice names joined. Org isolation is manual
// (serviceClient path) — the explicit .eq('organisation_id', orgId) is required.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const debtRepository = {
    async listUnpaid(orgId, { practiceId = null } = {}) {
        let query = supabase_1.serviceClient
            .from('invoices')
            .select('id, amount_outstanding_pence, dated_on, due_on, treatment, patient_name, practice:practices(name), contact:contacts(first_name, last_name)')
            .eq('organisation_id', orgId)
            // outstanding > 0 == debt. Use gte(...,1) — amount is integer pence,
            // and the test harness models gte (not gt).
            .gte('amount_outstanding_pence', 1);
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query.order('due_on', { ascending: true, nullsFirst: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
```

- [ ] **Step 7: Run the repository test to verify it passes**

Run: `cd backend && npx vitest run test/debt.repository.test.mjs`
Expected: PASS (3 tests). Re-run the service test too: `npx vitest run test/debt.service.test.mjs` — PASS.

- [ ] **Step 8: Write the model, controller, route**

Create `backend/src/models/debt.model.js`:

```js
// ============================================================================
// Debt model — Zod schema for the debt domain query.
// ============================================================================
import * as zod_1 from "zod";
export const debtListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
});
```

Create `backend/src/controllers/debt.controller.js`:

```js
import * as debt_service_1 from "../services/debt.service.js";
import * as debt_model_1 from "../models/debt.model.js";
export const debtController = {
    async list(req, res) {
        const q = debt_model_1.debtListQuerySchema.parse(req.query);
        res.json(await debt_service_1.debtService.list(req.user.organisation_id, { practiceId: q.practice_id ?? null }));
    },
};
```

Create `backend/src/routes/debt.routes.js`:

```js
// ============================================================================
// Debt routes — Express Router. Mounted at /api/debt (auth + audit upstream).
// No route-level role gate — matches payments.routes.js. Finance/Reception
// visibility is enforced at the frontend nav layer.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as debt_controller_1 from "../controllers/debt.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(debt_controller_1.debtController.list));
export default router;
```

- [ ] **Step 9: Mount the route in `app.js`**

In `backend/src/app.js`, add the import next to the other route imports (after line 48):

```js
import * as debt_routes_1 from "./routes/debt.routes.js";
```

And add the mount next to `/payments` (after line 188):

```js
    api.use('/debt', debt_routes_1.default);
```

- [ ] **Step 10: Verify syntax + run the backend suite**

Run: `cd backend && npm run typecheck && npx vitest run test/debt.service.test.mjs test/debt.repository.test.mjs`
Expected: typecheck (node --check) passes; tests PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/models/debt.model.js backend/src/repositories/debt.repository.js \
  backend/src/services/debt.service.js backend/src/controllers/debt.controller.js \
  backend/src/routes/debt.routes.js backend/src/app.js \
  backend/test/debt.service.test.mjs backend/test/debt.repository.test.mjs
git commit -m "feat(debt): GET /api/debt — aged unpaid-invoice aggregation"
```

---

## Task 4: Frontend — wire `DebtScreen` to `/api/debt`

**Files:**
- Create: `frontend/features/intelligence/debt-api.ts`
- Modify: `frontend/features/intelligence/components/DebtScreen.tsx`, `frontend/features/intelligence/data.ts`

- [ ] **Step 1: Create the data hook**

Create `frontend/features/intelligence/debt-api.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type DebtBand = { key: string; label: string; count: number; total_pence: number };
export type DebtorRow = {
  name: string;
  practice: string | null;
  treatment: string | null;
  amount_pence: number;
  age_days: number;
};
export type DebtView = {
  outstanding_pence: number;
  overdue90_pence: number;
  bands: DebtBand[];
  debtors: DebtorRow[];
};

export function useDebt(practiceId?: string) {
  return useQuery({
    queryKey: ['debt', practiceId ?? 'all'],
    queryFn: () => api<DebtView>(`/api/debt${practiceId ? `?practice_id=${practiceId}` : ''}`),
    staleTime: 60_000,
  });
}

// Compact £ from pence: >=1M -> "£1.2M", >=1k -> "£124k", else "£840".
export function formatPenceCompact(pence: number): string {
  const n = (pence || 0) / 100;
  if (Math.abs(n) >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '£' + Math.round(n / 1_000) + 'k';
  return '£' + Math.round(n);
}
```

- [ ] **Step 2: Rewrite `DebtScreen.tsx` to consume the hook**

Replace the entire contents of `frontend/features/intelligence/components/DebtScreen.tsx` with:

```tsx
'use client';
// Debt Recovery — aged debtors from real Dentally invoices via /api/debt.
// (No emoji on the bulk-reminders button — project rule 7.)
//
// Note: "Active payment plans" and "Recovered TTM" KPIs have no Dentally data
// source yet (payment-plan/recovery feeds are out of scope) — left static.

import { Card } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { useDebt, formatPenceCompact, type DebtBand } from '../debt-api';

// Band key -> chip/accent colour, mirroring the prototype thresholds.
const BAND_COLOUR: Record<string, string> = {
  '0-30': '#10B981',
  '31-60': '#0E7C7B',
  '61-90': '#F59E0B',
  '91-120': '#EF4444',
  '120+': '#EF4444',
};

/** Age-band -> chip colour, mirroring the prototype's thresholds. */
function ageChip(age: number): string {
  if (age > 90) return 'chip-rose';
  if (age > 60) return 'chip-amber';
  if (age > 30) return 'chip-purple';
  return 'chip-blue';
}

/** One KPI tile with optional sub-line. */
function DebtKpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {sub && <div className={`kpi-delta ${tone ?? ''}`.trim()}>{sub}</div>}
    </div>
  );
}

/** Debt Recovery page. */
export default function DebtScreen() {
  const { data, isLoading, isError, error } = useDebt();

  if (isLoading) {
    return (
      <div className="container mx-auto" style={{ maxWidth: 1500 }}>
        <p className="text-sm text-ink-muted">Loading debt recovery…</p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="container mx-auto" style={{ maxWidth: 1500 }}>
        <p className="text-sm text-ink-muted">
          Could not load debt data: {(error as Error)?.message ?? 'unknown error'}
        </p>
      </div>
    );
  }

  const bands: DebtBand[] = data?.bands ?? [];
  const debtors = [...(data?.debtors ?? [])].sort((a, b) => b.age_days - a.age_days);

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Debt Recovery</h1>
        <p className="text-sm text-ink-muted mt-1">
          Aged debtors &middot; payment plans &middot; write-offs &middot; live from Dentally
        </p>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}
      >
        <DebtKpi label="Outstanding" value={formatPenceCompact(data?.outstanding_pence ?? 0)} />
        <DebtKpi
          label="90+ days overdue"
          value={formatPenceCompact(data?.overdue90_pence ?? 0)}
          sub="Highest risk"
          tone="down"
        />
        <DebtKpi label="Active payment plans" value="12" sub="£28k/mo" tone="up" />
        <DebtKpi label="Recovered TTM" value="£42k" sub="86% success" tone="up" />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 16 }}>
          Aged debtors
        </h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {bands.map((b) => (
            <div
              key={b.key}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 14,
                textAlign: 'center',
              }}
            >
              <div className="text-ink-muted uppercase" style={{ fontSize: 11 }}>
                {b.label}
              </div>
              <div
                className="display font-semibold"
                style={{ fontSize: 22, color: BAND_COLOUR[b.key] ?? '#0E7C7B', margin: '8px 0' }}
              >
                {formatPenceCompact(b.total_pence)}
              </div>
              <div className="text-ink-muted" style={{ fontSize: 11 }}>
                {b.count} {b.count === 1 ? 'debtor' : 'debtors'}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="card overflow-hidden">
        <div
          className="flex justify-between"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Outstanding debtors
          </h2>
          <button className="btn btn-ghost" style={{ fontSize: 12 }}>
            Bulk reminders
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Practice</th>
              <th>Treatment</th>
              <th className="right">Amount</th>
              <th className="right">Age</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {debtors.length === 0 && (
              <tr>
                <td colSpan={6} className="text-ink-muted" style={{ padding: '20px', textAlign: 'center' }}>
                  No outstanding debtors.
                </td>
              </tr>
            )}
            {debtors.map((d, i) => (
              <tr key={`${d.name}-${i}`}>
                <td>
                  <strong>{d.name}</strong>
                </td>
                <td className="text-ink-muted" style={{ fontSize: 12 }}>
                  {d.practice ?? '—'}
                </td>
                <td className="text-ink-muted" style={{ fontSize: 12 }}>
                  {d.treatment ?? '—'}
                </td>
                <td className="right" style={{ fontWeight: 700 }}>
                  {formatPence(d.amount_pence)}
                </td>
                <td className="right">
                  <span className={`chip ${ageChip(d.age_days)}`}>{d.age_days}d</span>
                </td>
                <td>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                    Plan
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                    Remind
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify no other module imports the mock, then remove it**

Run: `cd frontend && grep -rn "DEBTORS\|type Debtor\b\|: Debtor" features app components | grep -v "debt-api\|DebtScreen"`
Expected: no matches outside the files we changed. If matches exist, leave `DEBTORS`/`Debtor` in `data.ts` and skip this step (note it). Otherwise delete the `Debtor` interface (lines ~104-111) and the `DEBTORS` array (lines ~113-123) from `frontend/features/intelligence/data.ts`. Leave `formatPoundsCompact` (still used by other intelligence screens — verify with `grep -rn formatPoundsCompact features`).

- [ ] **Step 4: Typecheck + lint the frontend**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors. Fix any unused-import warnings introduced (e.g. removing the `formatPounds` import from `@/features/_mock` in DebtScreen — it is no longer used).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/intelligence/debt-api.ts \
  frontend/features/intelligence/components/DebtScreen.tsx \
  frontend/features/intelligence/data.ts
git commit -m "feat(debt): wire Debt Recovery screen to /api/debt"
```

---

## Task 5: Docs + full verification

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Document the endpoint**

In `docs/API.md`, add an entry under the appropriate section (near payments):

```markdown
### GET /api/debt

Aged debt recovery view from unpaid Dentally invoices. Auth required; org-scoped.

Query: `practice_id` (uuid, optional) — filter to one practice.

Response:
```json
{
  "outstanding_pence": 605000,
  "overdue90_pence": 425000,
  "bands": [{ "key": "0-30", "label": "0-30 days", "count": 1, "total_pence": 180000 }],
  "debtors": [{ "name": "R Sutton", "practice": "Warwick Lodge", "treatment": "All-on-4", "amount_pence": 425000, "age_days": 176 }]
}
```
```

- [ ] **Step 2: Run the entire backend suite + frontend checks**

Run: `cd backend && npm test`
Expected: all PASS (existing ~224 + the new debt/invoice tests).

Run: `cd frontend && npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/API.md
git commit -m "docs(debt): document GET /api/debt endpoint"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Migration `invoices` table → Task 1 ✓
- Connector `invoiceRow`/`pullInvoices`/syncOneOrg/webhook/progress → Task 2 ✓
- Backend slice route→controller→service→repo, no role gate (matches payments), org-scoped → Task 3 ✓
- Aging off due_on→dated_on, bands, KPIs → Task 3 service ✓
- Frontend React Query rewire, UI unchanged, pence display, empty/error states → Task 4 ✓
- Money in pence, British English, rule 7 (no emoji) → Tasks 3-4 ✓
- API.md update → Task 5 ✓
- UAT money-unit caveat → Task 2 Step 3 comment ✓
- Out-of-scope (accounts, drill-down, chase actions, payment-plan KPIs) → noted, KPIs left static ✓

**Placeholder scan:** none — every code step has full content.

**Type consistency:** `invoiceRow`, `pullInvoices`, `buildDebtView`, `ageDays`, `bandKey`, `debtRepository.listUnpaid`, `debtService.list`, `useDebt`, `DebtView`/`DebtBand`/`DebtorRow`, `formatPenceCompact` — names used consistently across backend, tests, and frontend. Response shape (`outstanding_pence`/`overdue90_pence`/`bands`/`debtors`) matches between service, controller, API.md, and the frontend types.

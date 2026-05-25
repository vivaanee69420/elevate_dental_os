# Per-Practice Data Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-page practice tabs so a user can view one practice's data (Finance, Payments, Contacts, Overview) in isolation or all practices consolidated, where "practice" = a `practices` row mapped to a Dentally site via `pms_site_id`.

**Architecture:** Tabs are generated dynamically from `GET /api/practices`. The selected `practice_id` is a per-page React `useState` (null = All) passed into each domain's hooks → added to the React Query key → forwarded as `?practice_id=` to the backend, which adds `.eq('practice_id', id)` only when present (org-wide otherwise). Synced rows already carry `practice_id` (Dentally sync resolves `site_id → practice_id`), so filtering stored rows IS filtering by the Dentally site link — no live Dentally call.

**Tech Stack:** Express (native ESM) + Supabase (`serviceClient`, manual `organisation_id` scoping) backend; Next.js 14 + React Query + Zod; vitest (backend only — frontend has no test framework).

---

## Design Decisions (read first)

1. **The org `business_health` baseline is org-level only** — there is no per-practice baseline. So per-practice **Finance** uses **real per-practice data only** (`monthly_financials` actuals + settled `payments`, both carry `practice_id`), never the org baseline projection. "All practices" (no `practice_id`) keeps the existing baseline+actuals behaviour byte-for-byte.
2. **Cashflow stays group-level.** The 13-week forecast is an org run-rate projection with no honest per-practice source. The Cashflow view does NOT get a practice tab in this slice. (Flagged for the user; revisit later if a per-practice forecast source appears.)
3. **Contacts backend is already done** — `contact.model` has `practice_id`, `contact.repository.list` filters on it. Contacts is frontend-only here.
4. **Overview/Business Hub backend is already done** — `analyticsService.businessHub` already returns `group` totals + a `practices[]` array (one rollup row per practice). The per-practice view selects from that array client-side; no backend change.
5. **"All" = param omitted** at every hop → unchanged consolidated path; null/unassigned rows fold into All only. No "Unassigned" tab.
6. Every backend read keeps its mandatory `.eq('organisation_id', orgId)`. A `practice_id` from another org returns zero rows (never cross-org data).

## File Structure

**Backend (modify):**
- `src/models/payment.model.js` — add `practice_id` to `paymentListQuerySchema`.
- `src/repositories/payment.repository.js` — `list` + `summary` accept optional `practiceId`.
- `src/services/payment.service.js` — thread `practiceId`.
- `src/controllers/payment.controller.js` — read `practice_id` for `summary`.
- `src/models/analytics.model.js` — add optional `practice_id` to `seriesQuerySchema` + `financialQuerySchema`.
- `src/services/analytics.service.js` — `_actualsBundle`, `pl`, `financeSeries`, `financial` accept `practiceId`.
- `src/controllers/analytics.controller.js` — pass `practiceId` through.
- `docs/API.md` — document the new param.

**Frontend (create):**
- `frontend/features/practices/hooks.ts` — re-export `usePractices`.
- `frontend/features/practices/PracticeTabs.tsx` — shared controlled tab strip.

**Frontend (modify):**
- finance: `api.ts`, `hooks.ts`, `components/ProfitScreen.tsx`, `components/ManualPLModal.tsx`, the Financial screen.
- payments: `api.ts`, `hooks.ts`, `components/PaymentsScreen.tsx`.
- contacts: `api.ts`, `hooks.ts`, the contacts list screen.
- overview: `components/BusinessHubScreen.tsx`.

---

## Phase 0 — Foundation: practices slice + PracticeTabs

### Task 0.1: `usePractices` re-export slice

**Files:**
- Create: `frontend/features/practices/hooks.ts`

- [ ] **Step 1: Create the re-export**

`usePractices` already exists in `frontend/features/integrations/hooks.ts` (`useQuery({ queryKey: ['practices'], queryFn: listPractices })`, returns `{ practices: [{ id, name, pms_site_id }] }`). Expose it from a neutral slice so domain screens don't import from `integrations`:

```ts
// frontend/features/practices/hooks.ts
// Practices are the Dentally-site-mapped entities (Integrations → Dentally
// practice mapping). Re-exported here so any domain screen can drive its
// PracticeTabs without depending on the integrations feature.
export { usePractices } from '@/features/integrations/hooks';
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes (no new errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/features/practices/hooks.ts
git commit -m "feat(practices): shared usePractices slice for practice tabs"
```

### Task 0.2: `PracticeTabs` component

**Files:**
- Create: `frontend/features/practices/PracticeTabs.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/features/practices/PracticeTabs.tsx
'use client';
// Per-page practice filter. value=null => "All practices" (org-wide). Renders
// nothing when the org has 0-1 practices (no point in a single tab). Tabs are
// built dynamically from GET /api/practices.
import { usePractices } from './hooks';

interface Props {
  value: string | null;
  onChange: (practiceId: string | null) => void;
}

export default function PracticeTabs({ value, onChange }: Props) {
  const { data } = usePractices();
  const practices: { id: string; name: string }[] = data?.practices ?? [];
  if (practices.length <= 1) return null;

  const tab = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: active ? '#0E7C7B' : 'white',
    color: active ? 'white' : 'var(--ink)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button style={tab(value === null)} onClick={() => onChange(null)}>
        All practices
      </button>
      {practices.map((p) => (
        <button key={p.id} style={tab(value === p.id)} onClick={() => onChange(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/practices/PracticeTabs.tsx
git commit -m "feat(practices): PracticeTabs controlled tab strip"
```

---

## Phase 1 — Payments per-practice

### Task 1.1: Payments repository accepts practiceId (TDD)

**Files:**
- Modify: `backend/src/repositories/payment.repository.js`
- Test: `backend/test/payments-practice.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

```js
// backend/test/payments-practice.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const repo = (await import('../src/repositories/payment.repository.js')).paymentRepository;
const ORG_A = 'org-aaaaaaaa';
const PRACTICE_1 = 'prac-11111111';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null, count: 0 });
});

describe('payment repository — practice filter', () => {
  it('list adds practice_id eq when provided', async () => {
    await repo.list(ORG_A, { practice_id: PRACTICE_1 });
    expect(supaRec.last.table).toBe('payments');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE_1 });
  });

  it('list omits practice_id eq when absent', async () => {
    await repo.list(ORG_A, {});
    expect(supaRec.last.eqs.some((e) => e.col === 'practice_id')).toBe(false);
  });

  it('summary adds practice_id eq when provided', async () => {
    await repo.summary(ORG_A, PRACTICE_1);
    expect(supaRec.last.table).toBe('payments');
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE_1 });
  });

  it('summary omits practice_id eq when absent', async () => {
    await repo.summary(ORG_A);
    expect(supaRec.last.eqs.some((e) => e.col === 'practice_id')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/payments-practice.test.mjs`
Expected: FAIL — `summary` ignores the 2nd arg; `list` has no `practice_id` branch.

- [ ] **Step 3: Implement**

In `payment.repository.js`, `list`: after the `q.status`/`q.since` branches add:

```js
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
```

Change `summary` to accept and apply `practiceId`:

```js
    async summary(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('payments')
            .select('amount_pence, status, processed_at, created_at')
            .eq('organisation_id', orgId);
        if (practiceId)
            query = query.eq('practice_id', practiceId);
        const { data, error } = await query.limit(20000);
        if (error)
            throw new Error(error.message);
        const now = Date.now();
        const within = (iso, ms) => iso && now - new Date(iso).getTime() <= ms;
        const out = { today: 0, week: 0, month: 0, outstanding: 0 };
        for (const p of data ?? []) {
            const when = p.processed_at ?? p.created_at;
            if (p.status === 'settled') {
                if (within(when, 86400000)) out.today += p.amount_pence || 0;
                if (within(when, 7 * 86400000)) out.week += p.amount_pence || 0;
                if (within(when, 30 * 86400000)) out.month += p.amount_pence || 0;
            } else if (p.status === 'pending') {
                out.outstanding += p.amount_pence || 0;
            }
        }
        return out;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/payments-practice.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/payment.repository.js backend/test/payments-practice.test.mjs
git commit -m "feat(payments): repository practice_id filter on list + summary"
```

### Task 1.2: Payments model + service + controller thread practiceId

**Files:**
- Modify: `backend/src/models/payment.model.js`, `backend/src/services/payment.service.js`, `backend/src/controllers/payment.controller.js`

- [ ] **Step 1: Add practice_id to the list query schema**

In `payment.model.js`, inside `paymentListQuerySchema` add:

```js
    practice_id: zod_1.z.string().uuid().optional(),
```

- [ ] **Step 2: Thread practiceId in the service summary**

In `payment.service.js` change `summary`:

```js
    async summary(orgId, practiceId) {
        return payment_repository_1.paymentRepository.summary(orgId, practiceId);
    },
```

(`list` already forwards the whole `q`, which now includes `practice_id` — no change needed there.)

- [ ] **Step 3: Read practice_id in the controller summary**

In `payment.controller.js` change `summary`:

```js
    async summary(req, res) {
        const practiceId = req.query.practice_id || undefined;
        res.json(await payment_service_1.paymentService.summary(req.user.organisation_id, practiceId));
    },
```

- [ ] **Step 4: Run the full payments + existing suites**

Run: `cd backend && npx vitest run test/payments-practice.test.mjs`
Expected: PASS. Then `npx vitest run` — Expected: all green (no regressions).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/payment.model.js backend/src/services/payment.service.js backend/src/controllers/payment.controller.js
git commit -m "feat(payments): thread practice_id through model/service/controller"
```

### Task 1.3: Payments frontend — api + hooks + tab

**Files:**
- Modify: `frontend/features/payments/api.ts`, `frontend/features/payments/hooks.ts`, `frontend/features/payments/components/PaymentsScreen.tsx`

- [ ] **Step 1: api accepts practiceId**

In `payments/api.ts` change `listPayments` and `getPaymentSummary`:

```ts
export function listPayments(page = 1, limit = 25, practiceId?: string | null) {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  return api<PaymentsPage>(`/api/payments?page=${page}&limit=${limit}${pp}`);
}

export function getPaymentSummary(practiceId?: string | null) {
  const pp = practiceId ? `?practice_id=${practiceId}` : '';
  return api<PaymentSummary>(`/api/payments/summary${pp}`);
}
```

- [ ] **Step 2: hooks accept practiceId (and key on it)**

In `payments/hooks.ts` change `usePayments` and `usePaymentSummary`:

```ts
export function usePayments(page = 1, limit = 25, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['payments', page, limit, practiceId],
    queryFn: () => listPayments(page, limit, practiceId),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentSummary(practiceId: string | null = null) {
  return useQuery({
    queryKey: ['payment-summary', practiceId],
    queryFn: () => getPaymentSummary(practiceId),
  });
}
```

- [ ] **Step 3: Wire the tab into PaymentsScreen**

In `PaymentsScreen.tsx`: add the import `import PracticeTabs from '@/features/practices/PracticeTabs';`. Add state and reset page on change, and pass `practiceId` to the hooks:

```tsx
  const [page, setPage] = useState(1);
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const { data, isFetching } = usePayments(page, PAGE_SIZE, practiceId);
  const { data: summary } = usePaymentSummary(practiceId);
```

Render `<PracticeTabs value={practiceId} onChange={(id) => { setPracticeId(id); setPage(1); }} />` immediately under the `<PageHeader … />` line.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/payments/
git commit -m "feat(payments): per-practice tab on payments screen"
```

---

## Phase 2 — Contacts per-practice (frontend only)

### Task 2.1: Contacts api + hook accept practiceId

**Files:**
- Modify: `frontend/features/contacts/api.ts`, `frontend/features/contacts/hooks.ts`

- [ ] **Step 1: api forwards practice_id**

```ts
// frontend/features/contacts/api.ts
import { api } from '@/lib/api';

export function listContacts(search: string, practiceId?: string | null) {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  return api(`/api/contacts?search=${encodeURIComponent(search)}&limit=200${pp}`);
}
```

- [ ] **Step 2: hook keys on + passes practiceId**

```ts
// frontend/features/contacts/hooks.ts
import { useQuery } from '@tanstack/react-query';
import { listContacts } from './api';

export function useContacts(search: string, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['contacts', search, practiceId],
    queryFn: () => listContacts(search, practiceId),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes (existing callers use the default `practiceId = null`).

- [ ] **Step 4: Commit**

```bash
git add frontend/features/contacts/api.ts frontend/features/contacts/hooks.ts
git commit -m "feat(contacts): contacts api/hook accept practiceId"
```

### Task 2.2: Wire the tab into the contacts screen

**Files:**
- Modify: the contacts list screen under `frontend/features/contacts/components/` (the component calling `useContacts`)

- [ ] **Step 1: Find the screen**

Run: `cd frontend && grep -rl "useContacts" features/contacts/components`
Open that file.

- [ ] **Step 2: Add tab + state**

Add `import PracticeTabs from '@/features/practices/PracticeTabs';`. Add `const [practiceId, setPracticeId] = useState<string | null>(null);` alongside the existing search state, change the `useContacts(search)` call to `useContacts(search, practiceId)`, and render `<PracticeTabs value={practiceId} onChange={setPracticeId} />` above the contacts table/list. (If the file is not `'use client'` and lacks `useState`, add `import { useState } from 'react';` and the `'use client'` directive — the component already uses a React Query hook so it is a client component.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/contacts/components/
git commit -m "feat(contacts): per-practice tab on contacts screen"
```

---

## Phase 3 — Overview / Business Hub per-practice (frontend only)

### Task 3.1: Practice tab on the Business Hub screen

**Files:**
- Modify: `frontend/features/overview/components/BusinessHubScreen.tsx`

Backend already returns `{ group: {...}, practices: [{ practiceId, name, revenuePence, appointments, completed, noShows, noShowRate, leads, conversionRate, chairs }, ...] }`. No backend change.

- [ ] **Step 1: Inspect the screen**

Run: `cd frontend && sed -n '1,140p' features/overview/components/BusinessHubScreen.tsx`
Identify where it reads the hub data (the `group` object drives the headline metric cards) and where `practices` is rendered (the comparison table).

- [ ] **Step 2: Add tab + selection**

Add `import PracticeTabs from '@/features/practices/PracticeTabs';` and `import { useState } from 'react';` (if not present). Add:

```tsx
  const [practiceId, setPracticeId] = useState<string | null>(null);
```

Render `<PracticeTabs value={practiceId} onChange={setPracticeId} />` under the page header.

Derive the metrics object the headline cards read from. Given the hub response is in scope as e.g. `hub` with `hub.group` and `hub.practices`, compute:

```tsx
  const selected = practiceId
    ? (hub?.practices ?? []).find((p: any) => p.practiceId === practiceId)
    : null;
  // When a practice is selected, headline cards show that practice's row;
  // otherwise the group totals (unchanged). practiceId values come from
  // GET /api/practices (PracticeTabs) and match hub.practices[].practiceId.
  const view = selected ?? hub?.group;
```

Point the headline metric cards at `view` (e.g. `view?.revenuePence`, `view?.noShowRate`, `view?.conversionRate` — use the exact field names already read from `group`, which are identical on each `practices[]` row except `group` also has `revenueTargetPence`/`practices` count). When `selected` is set, hide/guard the group-only fields (`revenueTargetPence`, group `practices` count) — render them only when `practiceId === null`.

When a practice is selected, the comparison table may either stay (showing all practices for context) or filter to the selected row; keep it showing all rows for context (no change needed).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/overview/components/BusinessHubScreen.tsx
git commit -m "feat(overview): per-practice tab on Business Hub"
```

---

## Phase 4 — Finance per-practice (actuals-only)

### Task 4.1: `_actualsBundle` accepts practiceId (TDD)

**Files:**
- Modify: `backend/src/services/analytics.service.js`
- Test: `backend/test/finance-practice.test.mjs` (create)

`allForOrg` already returns `practice_id` per row. Filtering happens in JS inside `_actualsBundle`, so tests assert via output (the harness's `supaRec.last` only records the last of several Promise.all queries, so do NOT assert `.eq` here).

- [ ] **Step 1: Write the failing test**

```js
// backend/test/finance-practice.test.mjs
// Per-practice finance = actuals-only (monthly_financials filtered by
// practice_id). The org baseline is org-level and is NOT projected per practice.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const ORG_A = 'org-aaaaaaaa';
const P1 = 'prac-11111111';
const P2 = 'prac-22222222';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

// monthly_financials rows for two practices + a baseline for the org.
const withRows = (rows) => (q) =>
  q.table === 'monthly_financials'
    ? { data: rows, error: null }
    : { data: { baseline: { revenue: 1_200_000, cost_staff: 18 } }, error: null };

const ROWS = [
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 5_000_000, source: 'manual', practice_id: P1 },
  { period: '2026-01', dental_bucket: 'staff', amount_pence: 1_000_000, source: 'manual', practice_id: P1 },
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 9_000_000, source: 'manual', practice_id: P2 },
];

describe('_actualsBundle — practice filter', () => {
  it('sums only the requested practice rows', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const b = await svc._actualsBundle(ORG_A, P1);
    expect(b.annual.revenue).toBe(5_000_000);
    expect(b.annual.staff).toBe(1_000_000);
  });

  it('no practiceId => org-wide (all rows)', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const b = await svc._actualsBundle(ORG_A);
    expect(b.annual.revenue).toBe(14_000_000);
  });
});

describe('pl — per practice = actuals only, no baseline projection', () => {
  it('returns the practice actuals (basis=actuals)', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.pl(ORG_A, { practiceId: P1 });
    expect(r.basis).toBe('actuals');
    expect(r.revenue).toBe(5_000_000);
    expect(r.totalCosts).toBe(1_000_000);
  });

  it('practice with no actuals => error, never the org baseline', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.pl(ORG_A, { practiceId: 'prac-empty' });
    expect(r).toEqual({ error: 'No data for this practice' });
  });
});

describe('financeSeries — per practice = actuals only', () => {
  it('emits only the practice actual months (basis=actuals)', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.financeSeries(ORG_A, { months: 12, now, practiceId: P1 });
    expect(r.basis).toBe('actuals');
    expect(r.months).toHaveLength(1);
    expect(r.months[0]).toMatchObject({ month: '2026-01', revenue: 5_000_000, staffCosts: 1_000_000 });
  });

  it('practice with no actuals => empty months', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.financeSeries(ORG_A, { months: 12, now, practiceId: 'prac-empty' });
    expect(r).toEqual({ basis: 'actuals', months: [] });
  });
});

describe('financial — per practice margins from actuals', () => {
  it('computes margins from the practice actuals', async () => {
    supaRec.resultProvider = withRows([
      { period: '2026-01', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'manual', practice_id: P1 },
      { period: '2026-01', dental_bucket: 'lab', amount_pence: 2_000_000, source: 'manual', practice_id: P1 },
    ]);
    const r = await svc.financial(ORG_A, { dsoDays: 45, payableDays: 30, practiceId: P1 });
    expect(r.ratios.find((x) => x.key === 'grossMarginPct')).toMatchObject({ value: 80 });
  });

  it('practice with no actuals => error', async () => {
    supaRec.resultProvider = withRows(ROWS);
    const r = await svc.financial(ORG_A, { practiceId: 'prac-empty' });
    expect(r).toEqual({ error: 'No data for this practice' });
  });
});

describe('regression — org-wide finance unchanged', () => {
  it('financeSeries with no practiceId still projects the baseline', async () => {
    const now = () => new Date(2026, 4, 15);
    supaRec.resultProvider = (q) =>
      q.table === 'monthly_financials'
        ? { data: [], error: null }
        : { data: { baseline: { revenue: 1_200_000, cost_staff: 18 } }, error: null };
    const r = await svc.financeSeries(ORG_A, { months: 12, now });
    expect(r.basis).toBe('baseline-projection');
    expect(r.months).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/finance-practice.test.mjs`
Expected: FAIL — `_actualsBundle` takes no 2nd arg; `pl`/`financeSeries`/`financial` take no `practiceId`.

- [ ] **Step 3: Implement — `_actualsBundle` filter**

In `analytics.service.js` change `_actualsBundle`:

```js
    async _actualsBundle(orgId, practiceId = null) {
        const all = await monthlyFinancial_repository_1.monthlyFinancialRepository.allForOrg(orgId);
        const rows = practiceId
            ? (Array.isArray(all) ? all : []).filter((r) => r.practice_id === practiceId)
            : all;
        const byPeriod = bucketsByPeriod(rows);
        const periods = [...byPeriod.keys()].sort();
        const recent = periods.slice(-12);
        const annual = {};
        for (const p of recent) {
            for (const [k, v] of Object.entries(byPeriod.get(p))) {
                annual[k] = (annual[k] || 0) + v;
            }
        }
        return { byPeriod, annual, hasAny: periods.length > 0, periodsCovered: recent.length };
    },
```

- [ ] **Step 4: Implement — `pl` practice branch**

Change `pl(orgId)` to `pl(orgId, { practiceId = null } = {})`. Pass `practiceId` to `_actualsBundle`, and when `practiceId` is set, return actuals or the error — never fall through to the baseline:

```js
    async pl(orgId, { practiceId = null } = {}) {
        const actuals = await this._actualsBundle(orgId, practiceId);
        if (actuals.hasAny && (actuals.annual.revenue || 0) > 0) {
            return {
                ...(0, formulas_1.calculatePL)(plInputFromBuckets(actuals.annual)),
                basis: 'actuals',
                periodsCovered: actuals.periodsCovered,
            };
        }
        if (practiceId)
            return { error: 'No data for this practice' };
        // org-wide: unchanged baseline fallback
        const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
        const b = health?.baseline;
        if (!b?.revenue)
            return { error: 'No baseline set' };
        const revenuePence = b.revenue * 100;
        const result = (0, formulas_1.calculatePL)({
            revenue: revenuePence,
            costs: {
                associates: Math.round(revenuePence * (b.cost_associates || 0) / 100),
                lab: Math.round(revenuePence * (b.cost_lab || 0) / 100),
                materials: Math.round(revenuePence * (b.cost_materials || 0) / 100),
                staff: Math.round(revenuePence * (b.cost_staff || 0) / 100),
                property: Math.round(revenuePence * (b.cost_property || 0) / 100),
                marketing: Math.round(revenuePence * (b.cost_marketing || 0) / 100),
                other: Math.round(revenuePence * (b.cost_other || 0) / 100),
            },
        });
        return result;
    },
```

- [ ] **Step 5: Implement — `financeSeries` practice branch**

Change the signature to `financeSeries(orgId, { months = 12, now = () => new Date(), practiceId = null } = {})`. Pass `practiceId` to `_actualsBundle`, and short-circuit to actuals-only when `practiceId` is set (before the baseline projection). Replace the start of the method body:

```js
    async financeSeries(orgId, { months = 12, now = () => new Date(), practiceId = null } = {}) {
        const [health, actuals] = await Promise.all([
            practiceId ? Promise.resolve(null) : analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            this._actualsBundle(orgId, practiceId),
        ]);
        // Per practice: actuals only (the org baseline is not per-practice).
        if (practiceId) {
            const periods = [...actuals.byPeriod.keys()].sort().slice(-months);
            return {
                basis: 'actuals',
                months: periods.map((p) => financeSeriesRowFromBuckets(p, actuals.byPeriod.get(p))),
            };
        }
        const b = health?.baseline;
        // ... rest of the existing method unchanged ...
```

(Leave everything after `const b = health?.baseline;` exactly as it is today.)

- [ ] **Step 6: Implement — `financial` practice branch**

Change the signature to `financial(orgId, { dsoDays = 45, payableDays = 30, practiceId = null } = {})`. Pass `practiceId` to `_actualsBundle`, and when `practiceId` is set with no actuals, return the practice error. Replace the head of the method:

```js
    async financial(orgId, { dsoDays = 45, payableDays = 30, practiceId = null } = {}) {
        const [health, actuals] = await Promise.all([
            practiceId ? Promise.resolve(null) : analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            this._actualsBundle(orgId, practiceId),
        ]);
        const b = health?.baseline;
        const useActuals = actuals.hasAny && (actuals.annual.revenue || 0) > 0;
        if (practiceId && !useActuals)
            return { error: 'No data for this practice' };
        if (!useActuals && !b?.revenue)
            return { error: 'No baseline set' };
        // ... rest of the existing method unchanged ...
```

(Everything from `let revenuePence, costs;` onward stays as-is.)

- [ ] **Step 7: Run tests**

Run: `cd backend && npx vitest run test/finance-practice.test.mjs test/monthly-financial.test.mjs test/analytics.test.mjs`
Expected: PASS (new practice tests + the existing actuals/regression suites unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/analytics.service.js backend/test/finance-practice.test.mjs
git commit -m "feat(finance): per-practice actuals path for pl/financeSeries/financial"
```

### Task 4.2: Analytics model + controller pass practiceId

**Files:**
- Modify: `backend/src/models/analytics.model.js`, `backend/src/controllers/analytics.controller.js`

- [ ] **Step 1: Add practice_id to the query schemas**

In `analytics.model.js`, add `practice_id: zod_1.z.string().uuid().optional(),` to BOTH `seriesQuerySchema` and `financialQuerySchema`.

- [ ] **Step 2: Pass practiceId through the controller**

In `analytics.controller.js` update `financeSeries`, `financial`, and `pl`:

```js
    async financeSeries(req, res) {
        const q = analytics_model_1.seriesQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.financeSeries(req.user.organisation_id, { months: q.months, practiceId: q.practice_id }));
    },
    async financial(req, res) {
        const q = analytics_model_1.financialQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.financial(req.user.organisation_id, { dsoDays: q.dsoDays, payableDays: q.payableDays, practiceId: q.practice_id }));
    },
    async pl(req, res) {
        const practiceId = req.query.practice_id || undefined;
        res.json(await analytics_service_1.analyticsService.pl(req.user.organisation_id, { practiceId }));
    },
```

(Leave `cashflow` unchanged — group-only by decision.)

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/analytics.model.js backend/src/controllers/analytics.controller.js
git commit -m "feat(finance): analytics endpoints accept practice_id"
```

### Task 4.3: Finance frontend — api + hooks accept practiceId

**Files:**
- Modify: `frontend/features/finance/api.ts`, `frontend/features/finance/hooks.ts`

- [ ] **Step 1: api functions append practice_id**

In `finance/api.ts`:

```ts
export async function getFinanceSeries(practiceId?: string | null): Promise<{
  error?: string;
  basis?: 'actuals' | 'mixed' | 'baseline-projection';
  months: FinanceMonth[];
}> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(`/api/analytics/finance-series?months=12${pp}`);
  if (r?.error) return { error: r.error, months: [] };
  return {
    basis: r.basis,
    months: (r.months ?? []).map((m: any) => ({
      month: m.month,
      revenue: p(m.revenue),
      associate_pay: p(m.associatePay),
      staff_costs: p(m.staffCosts),
      lab_materials: p(m.labMaterials),
      opex: p(m.opex),
      profit: p(m.profit),
    })),
  };
}
```

And `getFinancial`:

```ts
export async function getFinancial(
  dsoDays = 45,
  payableDays = 30,
  practiceId?: string | null,
): Promise<{
  error?: string;
  basis?: string;
  assumptions: { dsoDays: number; payableDays: number };
  ratios: FinancialRatio[];
  balanceSheet: Record<string, { value: number; estimated: boolean }>;
}> {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const r = await api(
    `/api/analytics/financial?dsoDays=${dsoDays}&payableDays=${payableDays}${pp}`,
  );
  if (r?.error)
    return { error: r.error, assumptions: { dsoDays, payableDays }, ratios: [], balanceSheet: {} };
  const bs: Record<string, { value: number; estimated: boolean }> = {};
  for (const [k, v] of Object.entries(r.balanceSheet ?? {})) {
    const cell = v as { value: number; estimated: boolean };
    bs[k] = { value: p(cell.value), estimated: cell.estimated };
  }
  return { basis: r.basis, assumptions: r.assumptions ?? { dsoDays, payableDays }, ratios: r.ratios ?? [], balanceSheet: bs };
}
```

(Leave `getCashflow` and `getValuationBase` unchanged — cashflow + valuation stay group-level.)

- [ ] **Step 2: hooks accept + key on practiceId**

In `finance/hooks.ts`:

```ts
export function useFinanceSeries(practiceId: string | null = null) {
  return useQuery({
    queryKey: ['finance-series', practiceId],
    queryFn: () => getFinanceSeries(practiceId),
  });
}

export function useFinancial(dsoDays = 45, payableDays = 30, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['financial', dsoDays, payableDays, practiceId],
    queryFn: () => getFinancial(dsoDays, payableDays, practiceId),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes (existing callers use defaults).

- [ ] **Step 4: Commit**

```bash
git add frontend/features/finance/api.ts frontend/features/finance/hooks.ts
git commit -m "feat(finance): finance api/hooks accept practiceId"
```

### Task 4.4: Profit screen tab + empty state

**Files:**
- Modify: `frontend/features/finance/components/ProfitScreen.tsx`

- [ ] **Step 1: Add tab + state**

Add `import PracticeTabs from '@/features/practices/PracticeTabs';`. Change the data line and add state:

```tsx
export default function ProfitScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const { data, isLoading, isError } = useFinanceSeries(practiceId);
```

(`useState` is already imported.) Render `<PracticeTabs value={practiceId} onChange={setPracticeId} />` directly under the page header / `<FinanceToolbar … />`.

- [ ] **Step 2: Per-practice empty copy**

`hasData` is already `series.length > 0`. When a practice is selected and has no actuals, the series is empty and `data.error` is undefined (basis `actuals`, empty months). Ensure the existing "no data" UI also covers `practiceId && !hasData`. Where the screen currently branches on `noBaseline`/`hasData`, add a message for the practice-empty case, e.g. render when `practiceId && !hasData && !noBaseline`:

```tsx
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          No P&amp;L actuals entered for this practice yet. Use “Enter P&amp;L actuals”
          and pick this practice, or connect Xero with practice tagging.
        </p>
```

- [ ] **Step 3: Pass the active practice into the modal**

When rendering `<ManualPLModal … />`, pass the selected practice so new lines default to it (modal change in Task 4.5):

```tsx
        <ManualPLModal open={plModalOpen} onClose={() => setPlModalOpen(false)} practiceId={practiceId} />
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: fails only on the new `practiceId` prop until Task 4.5 — do Task 4.5 next, then typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/finance/components/ProfitScreen.tsx
git commit -m "feat(finance): per-practice tab + empty state on Profit screen"
```

### Task 4.5: ManualPLModal practice dropdown

**Files:**
- Modify: `frontend/features/finance/components/ManualPLModal.tsx`

- [ ] **Step 1: Accept practiceId prop + practice picker**

Add `import { usePractices } from '@/features/practices/hooks';`. Extend `Props`:

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  practiceId?: string | null;
}
```

In the component signature take the new prop and seed local state from it:

```tsx
export default function ManualPLModal({ open, onClose, practiceId = null }: Props) {
  const record = useRecordMonthlyFinancial();
  const remove = useDeleteMonthlyFinancial();
  const { data: practiceData } = usePractices();
  const practices: { id: string; name: string }[] = practiceData?.practices ?? [];
  const [period, setPeriod] = useState(thisMonth());
  const [bucket, setBucket] = useState<DentalBucket>('revenue');
  const [amount, setAmount] = useState('');
  const [practice, setPractice] = useState<string>(practiceId ?? '');
```

Add an effect to re-sync when the screen's tab changes while the modal is mounted:

```tsx
  useEffect(() => { setPractice(practiceId ?? ''); }, [practiceId]);
```

(Add `useEffect` to the `react` import.)

- [ ] **Step 2: Render the dropdown (only when >1 practice)**

Above the Amount field add:

```tsx
        {practices.length > 1 && (
          <>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Practice</label>
            <select value={practice} onChange={(e) => setPractice(e.target.value)} style={fieldStyle}>
              <option value="">Whole group / unassigned</option>
              {practices.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>
          </>
        )}
```

- [ ] **Step 3: Send practice_id on submit**

Change the `record.mutateAsync` call in `submit`:

```tsx
    await record.mutateAsync({ period, dental_bucket: bucket, amount_pence: amountPence, practice_id: practice || null });
```

(`MonthlyFinancialInput.practice_id` already exists in `finance/api.ts`; the backend `monthlyFinancialCreateSchema` already accepts `practice_id`.)

- [ ] **Step 4: Filter the echoed rows to the chosen practice**

The "Entered for {period}" list should reflect the same practice scope. Change `useMonthlyFinancials` to filter — note its api `listMonthlyFinancials` must forward `practice_id`. First extend it:

In `finance/api.ts` change `listMonthlyFinancials`:

```ts
export async function listMonthlyFinancials(params?: {
  from?: string;
  to?: string;
  practice_id?: string | null;
}): Promise<{ rows: MonthlyFinancialRow[] }> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.practice_id) qs.set('practice_id', params.practice_id);
  const q = qs.toString();
  return api(`/api/monthly-financials${q ? `?${q}` : ''}`);
}
```

In `finance/hooks.ts` change `useMonthlyFinancials`:

```ts
export function useMonthlyFinancials(params?: { from?: string; to?: string; practice_id?: string | null }) {
  return useQuery({
    queryKey: ['monthly-financials', params?.from ?? null, params?.to ?? null, params?.practice_id ?? null],
    queryFn: () => listMonthlyFinancials(params),
  });
}
```

In `ManualPLModal.tsx` change the list call:

```tsx
  const { data } = useMonthlyFinancials({ from: period, to: period, practice_id: practice || null });
```

(`monthly_financials` repo `list` already filters by `practice_id` — backend supports it.)

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes (now ProfitScreen's `practiceId` prop resolves too).

- [ ] **Step 6: Commit**

```bash
git add frontend/features/finance/components/ManualPLModal.tsx frontend/features/finance/api.ts frontend/features/finance/hooks.ts
git commit -m "feat(finance): ManualPLModal practice dropdown + scoped echo"
```

### Task 4.6: Financial (ratios) screen tab

**Files:**
- Modify: the Financial screen under `frontend/features/finance/components/` calling `useFinancial`

- [ ] **Step 1: Find the screen**

Run: `cd frontend && grep -rl "useFinancial" features/finance/components`
Open that file.

- [ ] **Step 2: Add tab + state**

Add `import PracticeTabs from '@/features/practices/PracticeTabs';` and (if absent) `import { useState } from 'react';`. Add `const [practiceId, setPracticeId] = useState<string | null>(null);`, change the `useFinancial(dsoDays, payableDays)` call to `useFinancial(dsoDays, payableDays, practiceId)`, and render `<PracticeTabs value={practiceId} onChange={setPracticeId} />` under the page header. The existing `error`/empty-state branch already handles the practice-with-no-actuals case (`{ error: 'No data for this practice' }` maps to the same empty UI as "No baseline set").

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/finance/components/
git commit -m "feat(finance): per-practice tab on Financial screen"
```

---

## Phase 5 — Docs + QA

### Task 5.1: Update API docs

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Document the param**

Add to the entries for `GET /api/payments`, `GET /api/payments/summary`, `GET /api/contacts`, `GET /api/analytics/finance-series`, `GET /api/analytics/financial`, `GET /api/analytics/pl`, and `GET /api/monthly-financials`:

> Optional `practice_id` (UUID) query param scopes the response to one practice. Omitted = org-wide (consolidated). For the analytics finance endpoints, a `practice_id` returns **actuals only** (no org-baseline projection); a practice with no actuals returns `{ "error": "No data for this practice" }`. `GET /api/analytics/cashflow` is group-level only and ignores `practice_id`.

- [ ] **Step 2: Commit**

```bash
git add docs/API.md
git commit -m "docs(api): document practice_id query param"
```

### Task 5.2: Manual QA

- [ ] **Step 1: Run both apps**

Backend: `cd backend && npm run dev`. Frontend: `cd frontend && npm run dev`. Log in to an org that has ≥2 practices mapped (the GM Dental org).

- [ ] **Step 2: Verify each domain**

Use `/qa` (or manually): on Payments, Contacts, Profit, Financial, and Business Hub — confirm the tab strip appears, switching a practice refetches and narrows the data, "All practices" matches the previous consolidated totals, and switching pages then returning resets to All. Confirm a practice with no P&L actuals shows the empty copy on Profit/Financial. Confirm ManualPLModal's practice dropdown defaults to the active tab and the entered line appears only under that practice.

- [ ] **Step 3: Full backend test run**

Run: `cd backend && npm run lint && npx vitest run`
Expected: lint clean, all tests green.

---

## Self-Review notes

- **Spec coverage:** Finance (4.1–4.6), Payments (1.x), Contacts (2.x), Overview (3.1) all covered. Cashflow deliberately excluded per Design Decision 2 (documented + flagged) — a conscious deviation from the spec's "cashflow" mention because there is no honest per-practice forecast source.
- **`practiceId` naming** is consistent: backend service option `practiceId`, query param `practice_id`, frontend prop/state `practiceId`. Repos use `q.practice_id` (payments) / filter arg `practiceId` (summary, actuals).
- **Org-wide regression** is guarded by Task 4.1's regression test + the existing `analytics.test.mjs`/`monthly-financial.test.mjs` suites (run in 4.1/4.2).

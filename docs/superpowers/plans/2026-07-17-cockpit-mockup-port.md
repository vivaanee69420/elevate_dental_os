# Daily Command Cockpit — Mockup Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the cards and sections of `elevate-cockpit-mockup_1.html` into the live `/cockpit`, adding the net-new "Profit vs Breakeven" module with a *corrected* breakeven formula.

**Architecture:** Extends the existing cockpit slice rather than rebuilding it. One new historised table (`practice_cost_model`) supplies per-practice fixed-cost/breakeven/target inputs, read as-of the window. One new pure function in `lib/formulas.js` does the maths. The `/api/cockpit` payload grows three blocks (`revenue.month`, `breakeven`, `revenueByLine`) plus two `monthly` fields; the frontend grows four sections. No restyling — existing `KpiTile`/`Panel` primitives only.

**Tech Stack:** Express (native ESM) + Supabase/Postgres + Zod on the backend; Next.js 14 App Router + React Query + Tailwind on the frontend; vitest for backend tests.

**Spec:** `docs/superpowers/specs/2026-07-17-cockpit-mockup-port-design.md`

**Scope:** Phase 0 + A + B. **Phase C (ad-account→practice mapping UI, per-practice spend/CPL/ROAS) is a separate plan** — it's a different subsystem and ships independently.

## Global Constraints

- **Money is integer pence.** Never floats. Display via `formatPence` (frontend) / `formatPounds` (backend). Inline money inputs edit in **whole pounds** and convert at the boundary: `Math.round(Number(raw) * 100)`.
- **Tenant isolation is manual.** Repositories use `serviceClient`, which **bypasses RLS**. Every query MUST chain `.eq('organisation_id', orgId)`. There is no automatic isolation on this path.
- **Backend is native ESM.** `import`/`export`, relative imports carry `.js` extensions. Never `require`/`module.exports`. Namespace imports keep their original local var (`import * as x_1 from "../y.js"`).
- **British English in all UI copy** (organisation, colour, optimise, centre).
- **No dark mode** — light/white only. **No emojis** in code or UI.
- **Never render `£0` for absent data.** A missing feed renders "Not reporting"; an unset input renders "Not set"; an undefined ratio renders "—". A zero means "genuinely zero".
- Any new/changed formula MUST update `docs/FORMULAS.md` **and** add a unit test (the accountant reviews `FORMULAS.md` before launch).
- Any new endpoint MUST update `docs/API.md`.
- After any hosted DDL: `NOTIFY pgrst, 'reload schema';` (PostgREST cache goes stale — recurring gotcha).
- Target org: **Plan4growth** `1a5f888a-0dfe-4802-acf8-6003665089ad`. Ignore the `developer` org.
- Backend tests: `cd backend && npx vitest run test/<file>.test.mjs`. Frontend has no test framework — verify with `npm run typecheck && npm run lint && npm run build`.

---

### Task 1: Phase 0 — Plan4growth data fixes

Data-only, no application code. These are **tenant data**, not schema, so they do NOT go in `supabase/migrations/`. Record them as a runbook and execute against hosted via the Supabase MCP.

**Files:**
- Create: `docs/runbooks/2026-07-17-plan4growth-practice-fixes.md`

**Interfaces:**
- Produces: practice rows renamed to site names, plus a `Warwick Lodge` practice row. Later tasks refer to practices by these names.

- [ ] **Step 1: Write the runbook**

````markdown
# Runbook — Plan4growth practice fixes (2026-07-17)

Org: `1a5f888a-0dfe-4802-acf8-6003665089ad` (Plan4growth). Run in order; verify after each.

## 1. Rename practices to site names

The rows are named after legal entities; everyone thinks in site names. Ids are
unchanged, so no mapping re-points.

```sql
update practices set name = 'Ashford'     where id = 'bf70e504-a7e0-45f6-b90b-ef4039e4b789';
update practices set name = 'Barnet'      where id = '853affdd-fdde-4dd8-840a-c798f738a685';
update practices set name = 'Rochester'   where id = 'a0ddc392-6c92-4a58-99ba-6c334d292084';
update practices set name = 'Bexleyheath (Fixed Teeth Solutions)'
                                          where id = '03117019-c2d1-432d-a6ae-00ec41538bb3';
```

Bexleyheath and Fixed Teeth Solutions are the SAME site (owner-confirmed). Both
names are in active use (Emergent says Bexleyheath, Meta says FTS), so the
compound name keeps both recognisable.

## 2. Delete the dead duplicate practice

`675c4bfc-fa5f-480e-a120-876a81ddcc0c` "GM Dental And Implant Centre" has 0
cash-up, 0 GHL accounts, 0 ad accounts. It is NOT empty: `contacts.practice_id`
has 49 GHL-sourced rows on it, and that FK is `ON DELETE NO ACTION`, so the
delete fails while they exist. Null them first.

```sql
update contacts set practice_id = null
 where practice_id = '675c4bfc-fa5f-480e-a120-876a81ddcc0c';
delete from practices where id = '675c4bfc-fa5f-480e-a120-876a81ddcc0c';
```

The 49 become unmapped, which every read path already handles ("Unmapped
practice"); the next GoHighLevel sync re-stamps them from their subaccount's
`practice_id`. Do NOT guess a practice for them — the dead row has no
`integration_accounts` entry, so there is no evidence of which site they belong
to.

## 3. Create Warwick Lodge

Real practice (owner-confirmed) with no data feed of any kind. Created so the
gap is visible; renders "Not reporting" until Emergent is configured.

```sql
insert into practices (organisation_id, name, active)
select '1a5f888a-0dfe-4802-acf8-6003665089ad', 'Warwick Lodge', true
 where not exists (
   select 1 from practices
    where organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad'
      and name = 'Warwick Lodge');
```

## 4. Reconnect the failed GoHighLevel subaccounts

Not SQL — an owner action in the UI. Three of four subaccounts are
`status = 'failed'` (Barnet, Rochester, Ashford); only Bexleyheath/FTS is
active. §3's lead counts go stale until these are reconnected.

```sql
-- verify
select ia.status, p.name from integration_accounts ia
  left join practices p on p.id = ia.practice_id
 where ia.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad'
   and ia.provider = 'gohighlevel' and ia.practice_id is not null;
```

## Verification

```sql
select name, active from practices
 where organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad' order by name;
-- expect exactly: Ashford, Barnet, Bexleyheath (Fixed Teeth Solutions),
--                 Rochester, Warwick Lodge   (5 rows, no duplicate)

select count(*) from contacts where practice_id = '675c4bfc-fa5f-480e-a120-876a81ddcc0c';
-- expect 0

select business_name, p.name from emergent_practice_map m
  left join practices p on p.id = m.practice_id
 where m.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad' order by business_name;
-- expect Ashford->Ashford, Barnet->Barnet, Bexleyheath->Bexleyheath (Fixed Teeth Solutions),
--        Rochester->Rochester, Elevate360 Academy->null, Webhook Test Ping->null
```

## Owner actions still required

- Configure Emergent to send a **Warwick Lodge** business (the map auto-discovers on sync).
- Reconnect the three failed GoHighLevel subaccounts.
````

- [ ] **Step 2: Verify the duplicate's dependants haven't changed since 2026-07-17**

Run via the Supabase MCP against `mkfhpzjbijbachoonytt`:

```sql
select 'contacts' t, count(*) from contacts where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'leads', count(*) from leads where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'emergent_daily_cashup', count(*) from emergent_daily_cashup where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c';
```

Expected: `contacts = 49`, everything else `0`. **If any non-contacts count is > 0, STOP** — the row is no longer dead and deleting it would lose data. Report and await instruction.

- [ ] **Step 3: Execute sections 1–3 against hosted**

Run the SQL from the runbook via the Supabase MCP. Section 4 is an owner action, not ours.

- [ ] **Step 4: Run the runbook's Verification block**

Expected: 5 practices with the exact names listed; `contacts` on the dup = 0; the Emergent map resolving to the new names.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/2026-07-17-plan4growth-practice-fixes.md
git commit -m "docs: Plan4growth practice fixes runbook — rename to site names, drop dead duplicate, add Warwick Lodge"
```

---

### Task 2: §2 — close-rate note on the Attended card

Smallest visible win. Frontend only, no API change.

**Files:**
- Modify: `frontend/features/cockpit/components/CockpitScreen.tsx` (the `TreatmentSection` component, the `Attended` `KpiTile`)

**Interfaces:**
- Consumes: `CockpitResponse['treatment']` — `{ acceptedCount, txPlansGiven, attended }`, all `number`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the close-rate helper above `TreatmentSection`**

The mockup shows "close rate 8/15 = 53%". Guard the divide — `txPlansGiven = 0` must render nothing, not `NaN%` or `0%`.

```tsx
// "close rate 8/15 = 53%" — accepted as a share of the plans presented.
// Returns null when no plans were keyed in: a close rate out of zero plans is
// undefined, not 0%.
function closeRate(acceptedCount: number, txPlansGiven: number): string | null {
  if (txPlansGiven <= 0) return null;
  const rounded = Math.round((acceptedCount / txPlansGiven) * 100);
  return `close rate ${acceptedCount}/${txPlansGiven} = ${rounded}%`;
}
```

- [ ] **Step 2: Wire it into the Attended tile**

Replace the existing `Attended` `KpiTile` `delta` prop. Current code reads:

```tsx
delta={t.attended === 0 ? 'Not being keyed in' : undefined}
```

Replace with:

```tsx
delta={t.attended === 0 ? 'Not being keyed in' : (closeRate(t.acceptedCount, t.txPlansGiven) ?? undefined)}
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all pass, no new warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/cockpit/components/CockpitScreen.tsx
git commit -m "feat(cockpit): close-rate note on the Attended card"
```

---

### Task 3: §5 — Clinician fees, Lab + overhead, and the margin tag

The data is already in `emergent_monthly_pl`; the service just collapses it to a 6-line summary. Derive the two groupings in the **service** (single source of truth) and surface the reconciliation residual rather than hiding it.

**Files:**
- Modify: `backend/src/services/cockpit.service.js` (add `CLINICIAN_LINE_COLS`, extend the `monthly` block in `build`)
- Modify: `backend/test/cockpit-service.test.mjs`
- Modify: `frontend/features/cockpit/api.ts` (extend `CockpitResponse['monthly']`)
- Modify: `frontend/features/cockpit/components/CockpitScreen.tsx` (`MonthlySection`)
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: `cockpitRepository.monthlyPl(orgId, monthStart, practiceId)` → rows with the typed pence columns.
- Produces: `monthly.clinicianFeesPence: number`, `monthly.labOverheadPence: number`, `monthly.residualPence: number`, `monthly.marginPct: number | null`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/cockpit-service.test.mjs`. The default `monthlyPl` stub already set up in `beforeEach` has `revenue_pence: 9500000`, `net_profit_pence: 2122000`, `principal_fees_pence: 300000`, `hygienist_therapist_pence: 0`, plus lab/materials/sedation and the opex lines.

```js
describe('monthly clinician / lab+overhead split', () => {
  it('splits clinician fees from lab+overhead and reconciles to net profit', async () => {
    const out = await cockpitService.build('ORG1', { since: '2026-07-01', until: '2026-08-01' });

    // clinician = principal_fees + hygienist_therapist = 300000 + 0
    expect(out.monthly.clinicianFeesPence).toBe(300000);

    // lab+overhead = every other cost line + all opex + custom lines
    //   cost side : lab 150000 + materials 0 + sedation 50000            = 200000
    //   opex side : 80000+0+200000+500000+0+40000+0+0+10000+0+5000       = 835000
    //   custom    : 60000 + 0                                            =  60000
    expect(out.monthly.labOverheadPence).toBe(1095000);

    // residual = revenue - clinician - labOverhead - netProfit
    //          = 9500000 - 300000 - 1095000 - 2122000 = 5983000
    // Emergent's own lines do not add up to its net_profit; we surface that
    // rather than plugging it.
    expect(out.monthly.residualPence).toBe(5983000);

    // margin = netProfit / revenue = 2122000/9500000 = 22.34%
    expect(out.monthly.marginPct).toBe(22.34);
  });

  it('reports a null margin rather than 0% when there is no revenue', async () => {
    cockpitRepository.monthlyPl.mockImplementation(async () => [
      { business_name: 'Ashford', revenue_pence: 0, net_profit_pence: 0, custom_lines: {}, line_notes: {} },
    ]);
    const out = await cockpitService.build('ORG1', { since: '2026-07-01', until: '2026-08-01' });
    expect(out.monthly.marginPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npx vitest run test/cockpit-service.test.mjs -t "splits clinician fees"
```

Expected: FAIL — `expected undefined to be 300000`.

- [ ] **Step 3: Implement in `cockpit.service.js`**

Add below the existing `OPEX_LINE_COLS` declaration:

```js
// The two clinician-pay columns, split out of COST_LINE_COLS for the §5
// "Clinician fees" card. Everything else in COST_LINE_COLS (lab, materials,
// sedation) is lab+overhead.
const CLINICIAN_LINE_COLS = ['principal_fees_pence', 'hygienist_therapist_pence'];

// Sums the named typed columns across all monthly_pl rows.
function sumCols(rows, cols) {
    let total = 0;
    for (const row of rows || []) for (const col of cols) total += num(row[col]);
    return total;
}
```

In `build`, after the existing `const lineNotes = collectLineNotes(monthlyRows);`:

```js
        // §5 card split. Clinician fees are the two pay columns; lab+overhead
        // is every other cost line + all opex + custom lines.
        const clinicianFeesPence = sumCols(monthlyRows, CLINICIAN_LINE_COLS);
        const otherCostCols = COST_LINE_COLS.map(([col]) => col).filter(c => !CLINICIAN_LINE_COLS.includes(c));
        const labOverheadPence =
            sumCols(monthlyRows, otherCostCols) +
            sumCols(monthlyRows, OPEX_LINE_COLS.map(([col]) => col)) +
            customLines.reduce((s, l) => s + l.amountPence, 0);

        // Revenue - clinician - lab/overhead SHOULD equal the net profit Emergent
        // sent. Where it doesn't, Emergent's own lines don't add up — surface the
        // gap rather than plugging it, or a broken feed looks like a healthy one.
        const residualPence =
            monthlyTotals.revenuePence - clinicianFeesPence - labOverheadPence - monthlyTotals.netProfitPence;

        const marginPct = monthlyTotals.revenuePence > 0
            ? Math.round((monthlyTotals.netProfitPence / monthlyTotals.revenuePence) * 10000) / 100
            : null;
```

Add to the returned `monthly` object, after `netProfitPence`:

```js
                clinicianFeesPence,
                labOverheadPence,
                residualPence,
                marginPct,
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx vitest run test/cockpit-service.test.mjs
```

Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Extend the frontend type**

In `frontend/features/cockpit/api.ts`, inside `CockpitResponse['monthly']`, after `netProfitPence: number;`:

```ts
    clinicianFeesPence: number;
    labOverheadPence: number;
    // revenue − clinician − labOverhead − netProfit. Non-zero means Emergent's
    // own P&L lines don't reconcile to the net profit it sent.
    residualPence: number;
    // null when revenue is 0 — a margin on no revenue is undefined, not 0%.
    marginPct: number | null;
```

- [ ] **Step 6: Render the cards**

In `MonthlySection` in `CockpitScreen.tsx`, replace the 2-card grid:

```tsx
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <Card label="Revenue" value={formatPence(m.revenuePence)} />
        <Card label="Net profit" value={formatPence(m.netProfitPence)} />
      </div>
```

with:

```tsx
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Revenue" value={formatPence(m.revenuePence)} />
        <Card
          label="Net profit"
          value={formatPence(m.netProfitPence)}
          sub={m.marginPct === null ? undefined : `${m.marginPct.toFixed(1)}% margin`}
        />
        <Card
          label="Clinician fees"
          value={formatPence(m.clinicianFeesPence)}
          sub={
            m.revenuePence > 0
              ? `${((m.clinicianFeesPence / m.revenuePence) * 100).toFixed(1)}% of revenue`
              : undefined
          }
        />
        <Card
          label="Lab &amp; overhead"
          value={formatPence(m.labOverheadPence)}
          sub="Lab, materials, rent, staff, marketing"
        />
      </div>
      {m.residualPence !== 0 && m.revenuePence > 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          Emergent&rsquo;s P&amp;L lines don&rsquo;t reconcile to the net profit it sent &mdash;{' '}
          {formatPence(Math.abs(m.residualPence))} is {m.residualPence > 0 ? 'unaccounted for' : 'double-counted'}. The
          cards above show what Emergent actually sent, not a balanced figure.
        </p>
      ) : null}
```

- [ ] **Step 7: Update `docs/API.md`**

In the `### \`GET /api/cockpit\`` section, the `monthly { … }` shape is currently elided. Add below the response block:

```markdown
`monthly` carries the latest month Emergent has sent a P&L for (falling back from
the current calendar month via `latestMonthlyPl`): `{ periodMonth, revenuePence,
netProfitPence, clinicianFeesPence, labOverheadPence, residualPence, marginPct,
byBusiness[], costLines[], opexLines[], customLines[], lineNotes[] }`.

- `clinicianFeesPence` — `principal_fees_pence + hygienist_therapist_pence`.
- `labOverheadPence` — every other cost line + all opex lines + `custom_lines`.
- `residualPence` — `revenue − clinician − labOverhead − netProfit`. **Non-zero
  means Emergent's own lines don't add up to the net profit it sent.** Surfaced
  rather than plugged, so a broken feed can't masquerade as a balanced one.
- `marginPct` — `netProfit / revenue`, to 2dp. **`null` when revenue is 0** (a
  margin on no revenue is undefined, not 0%).
```

- [ ] **Step 8: Typecheck, lint, build**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/cockpit.service.js backend/test/cockpit-service.test.mjs \
        frontend/features/cockpit/api.ts frontend/features/cockpit/components/CockpitScreen.tsx docs/API.md
git commit -m "feat(cockpit): clinician fees + lab/overhead cards, margin tag, honest P&L residual"
```

---

### Task 4: §7 — Revenue by line on the cockpit

Reuse the existing `treatment_revenue_matrix` RPC. It takes no practice param — it returns `practice_id` per row, so filter in JS.

**Files:**
- Modify: `backend/src/repositories/cockpit.repository.js` (add `revenueByLine`)
- Modify: `backend/src/services/cockpit.service.js` (call it, shape `revenueByLine`)
- Create: `backend/test/cockpit-revenue-by-line.test.mjs`
- Modify: `frontend/features/cockpit/api.ts`
- Create: `frontend/features/cockpit/components/RevenueByLine.tsx`
- Modify: `frontend/features/cockpit/components/CockpitScreen.tsx`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: RPC `treatment_revenue_matrix(p_org UUID, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ)` → `TABLE (practice_id UUID, treatment_name TEXT, fee_pence BIGINT, item_count BIGINT)`.
- Produces: `revenueByLine: Array<{ name: string; amountPence: number; sharePct: number }>` on the cockpit payload, largest-first.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/cockpit-revenue-by-line.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: { channelBreakdown: vi.fn(async () => ({ channels: [], group: {}, groupChannels: {} })) },
  classifyChannel: () => null,
  matchAcceptedValue: () => null,
  buildAcceptedByKey: () => ({ acceptedByKey: new Map(), nameByPractice: new Map() }),
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => []),
    monthlyPl: vi.fn(async () => []),
    latestMonthlyPl: vi.fn(async () => ({ periodMonth: null, rows: [] })),
    acceptedContactsInWindow: vi.fn(async () => []),
    activePractices: vi.fn(async () => []),
    costModelAsOf: vi.fn(async () => []),
    revenueByLine: vi.fn(async () => [
      { practice_id: 'P1', treatment_name: 'Implants', fee_pence: 10764300, item_count: 20 },
      { practice_id: 'P2', treatment_name: 'Implants', fee_pence: 0, item_count: 0 },
      { practice_id: 'P1', treatment_name: 'Restorative', fee_pence: 5493100, item_count: 40 },
      { practice_id: 'P2', treatment_name: 'Orthodontics', fee_pence: 774400, item_count: 5 },
    ]),
  },
}));

let cockpitService;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));
});

describe('cockpit revenueByLine', () => {
  it('sums fee by treatment name across practices, largest-first, with share', async () => {
    const out = await cockpitService.build('ORG1', { since: '2026-06-10', until: '2026-07-18' });
    // total = 10764300 + 5493100 + 774400 = 17031800
    expect(out.revenueByLine).toEqual([
      { name: 'Implants',      amountPence: 10764300, sharePct: 63.2 },
      { name: 'Restorative',   amountPence: 5493100,  sharePct: 32.3 },
      { name: 'Orthodontics',  amountPence: 774400,   sharePct: 4.5 },
    ]);
  });

  it('drops zero-fee lines rather than rendering them as £0 rows', async () => {
    const out = await cockpitService.build('ORG1', { since: '2026-06-10', until: '2026-07-18' });
    expect(out.revenueByLine.some(l => l.amountPence === 0)).toBe(false);
  });

  it('returns an empty list, not a crash, when the window predates invoice_items', async () => {
    const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
    cockpitRepository.revenueByLine.mockImplementation(async () => []);
    const out = await cockpitService.build('ORG1', { since: '2026-01-01', until: '2026-02-01' });
    expect(out.revenueByLine).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npx vitest run test/cockpit-revenue-by-line.test.mjs
```

Expected: FAIL — `expected undefined to deeply equal [...]`.

- [ ] **Step 3: Add the repository method**

In `backend/src/repositories/cockpit.repository.js`, alongside the other methods. Follow the existing `acceptedLeadSource` RPC style:

```js
    // §7 Revenue by line — invoiced fee per treatment name, via the same RPC
    // the analytics treatment-revenue matrix uses (migration 000041). The RPC
    // has no practice param; it returns practice_id per row, so the caller
    // filters. organisation_id is passed as p_org — the RPC filters on it.
    async revenueByLine(orgId, since, until) {
        const { data, error } = await supabase_1.serviceClient.rpc('treatment_revenue_matrix', {
            p_org: orgId,
            p_since: since,
            p_until: until,
        });
        if (error) throw new Error(`treatment_revenue_matrix: ${error.message}`);
        return data ?? [];
    },
```

- [ ] **Step 4: Shape it in the service**

In `cockpit.service.js`, add `cockpitRepository.revenueByLine(orgId, since, until)` to the `Promise.all` in `build`, destructuring as `revenueLineRows`:

```js
        const [cashupRows, monthlyRowsForCurrent, leadRoi, acceptedRows, revenueLineRows] = await Promise.all([
            cockpitRepository.cashupRollup(orgId, since, until, practiceId),
            cockpitRepository.monthlyPl(orgId, periodMonth, practiceId),
            leadAttributionService.channelBreakdown(orgId, { since, until, practiceId }),
            cockpitRepository.acceptedContactsInWindow(orgId, since, until, practiceId),
            cockpitRepository.revenueByLine(orgId, since, until),
        ]);
```

Add this helper above `export const cockpitService`:

```js
// §7 Revenue by line — sum invoiced fee per treatment name, largest-first, with
// each line's share of the total. Practice filtering happens here because the
// RPC returns practice_id per row and takes no practice param.
function shapeRevenueByLine(rows, practiceId) {
    const totals = new Map();
    for (const row of rows || []) {
        if (practiceId && row.practice_id !== practiceId) continue;
        const v = num(row.fee_pence);
        if (v === 0) continue;
        const name = row.treatment_name || 'Unspecified';
        totals.set(name, (totals.get(name) || 0) + v);
    }
    const grand = Array.from(totals.values()).reduce((s, v) => s + v, 0);
    return Array.from(totals, ([name, amountPence]) => ({
        name,
        amountPence,
        sharePct: grand > 0 ? Math.round((amountPence / grand) * 1000) / 10 : 0,
    })).sort((a, b) => b.amountPence - a.amountPence);
}
```

Add `revenueByLine: shapeRevenueByLine(revenueLineRows, practiceId),` to the returned object, after `leadRoi,`.

- [ ] **Step 5: Run the tests**

```bash
cd backend && npx vitest run test/cockpit-revenue-by-line.test.mjs && npx vitest run test/cockpit-service.test.mjs
```

Expected: both PASS. If `cockpit-service.test.mjs` fails on a missing `revenueByLine` mock, add `revenueByLine: vi.fn(async () => [])` to its `vi.mock` repository factory.

- [ ] **Step 6: Add the frontend type**

In `frontend/features/cockpit/api.ts`, above `CockpitResponse`:

```ts
export interface RevenueLine {
  name: string;
  amountPence: number;
  /** Share of the window's invoiced total, 0–100, 1dp. */
  sharePct: number;
}
```

And inside `CockpitResponse`, after `leadRoi: LeadRoi;`:

```ts
  revenueByLine: RevenueLine[];
```

- [ ] **Step 7: Build the component**

```tsx
// frontend/features/cockpit/components/RevenueByLine.tsx
'use client';
// §7 Revenue by line — invoiced fee per treatment, largest-first. Sourced from
// Dentally invoice_items via the treatment_revenue_matrix RPC.
//
// Live data only runs from 10 Jun 2026, so a window before that is legitimately
// empty. The empty state says so — rendering "£0" would read as "we invoiced
// nothing", which is not what an absent feed means.
import { Panel, PanelHead } from '@/features/intelligence/components/os-ui';
import { formatPence } from '@/lib/format';
import type { RevenueLine } from '../api';

export function RevenueByLine({ lines }: { lines: RevenueLine[] }) {
  if (lines.length === 0) {
    return (
      <Panel>
        <PanelHead title="Revenue by line" sub="Invoiced fee per treatment, from Dentally." />
        <p className="text-sm text-ink-muted">
          No invoiced treatment lines in this window. Dentally invoice data starts on 10 June 2026 &mdash; earlier
          windows have nothing to show rather than nothing invoiced.
        </p>
      </Panel>
    );
  }

  const max = lines[0].amountPence || 1;

  return (
    <Panel>
      <PanelHead title="Revenue by line" sub="Invoiced fee per treatment, from Dentally. Largest first." />
      <div className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <div key={l.name} className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate text-[12px] text-slate-700" title={l.name}>
              {l.name}
            </div>
            <div className="h-2.5 rounded-full bg-emerald-700" style={{ width: `${(l.amountPence / max) * 100}%` }} />
            <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-slate-900">
              {formatPence(l.amountPence)} &middot; {l.sharePct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 8: Wire it into the screen**

In `CockpitScreen.tsx`, add the import:

```tsx
import { RevenueByLine } from './RevenueByLine';
```

and render it after `<MonthlySection data={data} />`:

```tsx
          <RevenueByLine lines={data.revenueByLine} />
```

- [ ] **Step 9: Update `docs/API.md`**

Add under the `GET /api/cockpit` section:

```markdown
`revenueByLine[]` — `{ name, amountPence, sharePct }`, largest-first, zero-fee
lines dropped. Invoiced fee per treatment from the `treatment_revenue_matrix`
RPC (migration `…000041`), scoped to `scope` when it's a practice. **Empty for
windows before 10 Jun 2026** — that's where `invoice_items` starts, not a zero.
```

- [ ] **Step 10: Typecheck, lint, build, commit**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
cd .. && git add backend/src/repositories/cockpit.repository.js backend/src/services/cockpit.service.js \
        backend/test/cockpit-revenue-by-line.test.mjs backend/test/cockpit-service.test.mjs \
        frontend/features/cockpit/api.ts frontend/features/cockpit/components/RevenueByLine.tsx \
        frontend/features/cockpit/components/CockpitScreen.tsx docs/API.md
git commit -m "feat(cockpit): revenue by line, sourced from Dentally invoice_items"
```

---

### Task 5: Migration — `practice_cost_model`

**Files:**
- Create: `supabase/migrations/20260101000113_practice_cost_model.sql`
- Modify: `db/01_schema.sql` (unmanaged source copy — keep in sync)
- Modify: `db/02_rls.sql` (unmanaged source copy — keep in sync)

**Interfaces:**
- Produces: table `public.practice_cost_model` with columns `id, organisation_id, practice_id, effective_from, fixed_cost_pence_month, breakeven_low_pence, breakeven_high_pence, working_days_per_month, revenue_target_pence_month, created_at, updated_at`; unique `(practice_id, effective_from)`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- practice_cost_model — the per-practice fixed-cost / breakeven / working-days
-- / revenue-target inputs behind the cockpit's "Profit vs Breakeven" section
-- (§6) and its "Daily target" card (§1). Manual inputs; no feed supplies these.
--
-- HISTORISED: one row per (practice, effective_from). Reads take the latest row
-- where effective_from <= the window's start, so a rent rise in July does not
-- rewrite March's profit. Same model as the business-health baseline/targets
-- (migration 000054); chair_utilisation's overwrite-in-place is the anti-pattern
-- this deliberately avoids.
--
-- Money is INTEGER PENCE (rule 2). Every row carries organisation_id (rule 3);
-- repositories filter on it explicitly — the serviceClient path they use has NO
-- automatic isolation.
--
-- RLS is enabled with no policies, matching the other Emergent-era tables: the
-- repositories read via serviceClient (which bypasses RLS), and nothing reaches
-- this table over the tenantClient path.
--
-- Idempotent + additive; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
create table if not exists public.practice_cost_model (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisations(id) on delete cascade,
  practice_id                uuid not null references public.practices(id) on delete cascade,
  effective_from             date not null,
  fixed_cost_pence_month     bigint,
  breakeven_low_pence        bigint,
  breakeven_high_pence       bigint,
  working_days_per_month     int not null default 20,
  revenue_target_pence_month bigint,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (practice_id, effective_from),
  constraint practice_cost_model_working_days_chk
    check (working_days_per_month between 1 and 31),
  constraint practice_cost_model_breakeven_order_chk
    check (breakeven_low_pence is null or breakeven_high_pence is null
           or breakeven_low_pence <= breakeven_high_pence),
  constraint practice_cost_model_non_negative_chk
    check (coalesce(fixed_cost_pence_month, 0) >= 0
       and coalesce(breakeven_low_pence, 0) >= 0
       and coalesce(breakeven_high_pence, 0) >= 0
       and coalesce(revenue_target_pence_month, 0) >= 0)
);

-- The as-of read: latest effective_from <= window start, per org+practice.
create index if not exists practice_cost_model_org_practice_from_idx
  on public.practice_cost_model (organisation_id, practice_id, effective_from desc);

drop trigger if exists practice_cost_model_updated_at on public.practice_cost_model;
create trigger practice_cost_model_updated_at
  before update on public.practice_cost_model
  for each row execute function set_updated_at();

alter table public.practice_cost_model enable row level security;

-- Reload PostgREST cache after applying:
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it locally and confirm it re-applies cleanly**

```bash
cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset
```

Expected: all migrations `000001`→`000113` apply with no error. Run `supabase db reset` a second time to prove idempotency.

- [ ] **Step 3: Mirror the DDL into the unmanaged source copies**

Append the same `create table` + index + trigger block to `db/01_schema.sql`, and the `alter table … enable row level security;` line to `db/02_rls.sql`. These files are **not** what `supabase db reset` reads, but the project requires them kept in sync when schema changes.

- [ ] **Step 4: Apply on hosted**

Via the Supabase MCP `apply_migration` against project `mkfhpzjbijbachoonytt`, name `practice_cost_model`. Then verify:

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'practice_cost_model' order by ordinal_position;
```

Expected: all 11 columns present. Then run `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000113_practice_cost_model.sql db/01_schema.sql db/02_rls.sql
git commit -m "feat(db): practice_cost_model — historised per-practice fixed cost, breakeven and target"
```

---

### Task 6: `calculateBreakeven` in `lib/formulas.js`

The corrected formula. **This is the one the mockup got wrong** — see the spec.

**Files:**
- Modify: `backend/src/lib/formulas.js`
- Create: `backend/test/formulas-breakeven.test.mjs`
- Modify: `docs/FORMULAS.md`

**Interfaces:**
- Produces: `calculateBreakeven({ revenuePence, fixedCostPenceMonth, breakevenLowPence, breakevenHighPence, workingDaysPerMonth, workingDaysInWindow })` → `{ breakevenMidPence, contributionMarginPct, fixedDayPence, breakevenDayPence, contributionPence, fixedPence, profitPence, status }` where `status` is `'above' | 'below' | 'not_set'` and every derived money field is `null` when `status === 'not_set'`.

- [ ] **Step 1: Write the failing test**

Pure function — no mocking needed.

**Note on the numbers:** the spec's illustrative table used a rounded margin of `0.371` and so quotes Ashford as £268. The exact margin is `3100000/8350000 = 0.3712574850…`, which gives **£269.16**. These tests assert the exact arithmetic. Do not "correct" them to match the spec's rounded table.

```js
// backend/test/formulas-breakeven.test.mjs
import { describe, it, expect } from 'vitest';
import { calculateBreakeven } from '../src/lib/formulas.js';

// The source mockup's per-practice inputs: £31,000/mo fixed, £81k–£86k/mo
// breakeven, 20 working days. One day of trading in the window.
const MODEL = {
  fixedCostPenceMonth: 3100000,
  breakevenLowPence: 8100000,
  breakevenHighPence: 8600000,
  workingDaysPerMonth: 20,
  workingDaysInWindow: 1,
};

describe('calculateBreakeven', () => {
  it('uses fixed/breakeven as the contribution margin, not 1 - fixed/breakeven', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 490000 });
    // 3100000/8350000 = 0.37125748... -> 37.13%. The mockup used 62.9%, which
    // is the VARIABLE-cost ratio (1 - 0.371), not the contribution margin.
    expect(r.contributionMarginPct).toBe(37.13);
  });

  it('reconciles breakevenDay to breakevenMid / workingDays', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 0 });
    expect(r.breakevenMidPence).toBe(8350000);
    expect(r.fixedDayPence).toBe(155000);           // 31000/20 = £1,550
    expect(r.breakevenDayPence).toBe(417500);       // £4,175 = 8350000/20
    // This identity is the proof the margin is right: fixedDay/margin
    // = (fixed/wd)/(fixed/mid) = mid/wd. The mockup's £2,464 implied a
    // £49,280/mo breakeven, contradicting its own stated £81-86k.
    expect(r.breakevenDayPence).toBe(Math.round(r.breakevenMidPence / MODEL.workingDaysPerMonth));
  });

  it("reproduces the mockup's own table with correct outputs", () => {
    const profit = (revenuePence) => calculateBreakeven({ ...MODEL, revenuePence }).profitPence;
    expect(profit(490000)).toBe(26916);    //  Ashford      £4,900 ->   £269.16 (mockup claimed £1,532)
    expect(profit(378000)).toBe(-14665);   //  Rochester    £3,780 ->  -£146.65 (mockup claimed   £828)
    expect(profit(210000)).toBe(-77036);   //  Barnet       £2,100 ->  -£770.36
    expect(profit(170000)).toBe(-91886);   //  Bexleyheath  £1,700 ->  -£918.86
    expect(profit(322000)).toBe(-35455);   //  FTS          £3,220 ->  -£354.55 (mockup claimed   £476)
  });

  it('flips status to below where the mockup claimed above', () => {
    expect(calculateBreakeven({ ...MODEL, revenuePence: 490000 }).status).toBe('above');
    expect(calculateBreakeven({ ...MODEL, revenuePence: 378000 }).status).toBe('below');
    expect(calculateBreakeven({ ...MODEL, revenuePence: 322000 }).status).toBe('below');
  });

  it('is exactly at breakeven when revenue equals breakevenDay', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 417500 });
    expect(r.profitPence).toBe(0);
    expect(r.status).toBe('above'); // >= 0 counts as above
  });

  it('scales fixed cost by the days actually traded', () => {
    const r = calculateBreakeven({ ...MODEL, revenuePence: 4900000, workingDaysInWindow: 10 });
    expect(r.fixedPence).toBe(1550000);              // 155000 x 10
    expect(r.profitPence).toBe(1819162 - 1550000);   // contribution - fixed
  });

  it('returns not_set with null money rather than a phantom £0 loss', () => {
    for (const bad of [
      { fixedCostPenceMonth: 0 },
      { breakevenLowPence: 0, breakevenHighPence: 0 },
      { workingDaysPerMonth: 0 },
    ]) {
      const r = calculateBreakeven({ ...MODEL, revenuePence: 490000, ...bad });
      expect(r.status).toBe('not_set');
      expect(r.profitPence).toBeNull();
      expect(r.contributionMarginPct).toBeNull();
      expect(r.breakevenDayPence).toBeNull();
    }
  });

  it('rejects a breakeven below fixed cost as nonsense', () => {
    // margin = fixed/mid would exceed 1: revenue would have to cover more than
    // 100% contribution. That is a bad input, not a very profitable practice.
    const r = calculateBreakeven({
      ...MODEL, revenuePence: 490000,
      fixedCostPenceMonth: 9000000, breakevenLowPence: 8100000, breakevenHighPence: 8600000,
    });
    expect(r.status).toBe('not_set');
    expect(r.profitPence).toBeNull();
  });

  it('defaults to zeros without throwing when called with no args', () => {
    expect(calculateBreakeven().status).toBe('not_set');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npx vitest run test/formulas-breakeven.test.mjs
```

Expected: FAIL — `calculateBreakeven is not a function`.

- [ ] **Step 3: Implement it**

Append to `backend/src/lib/formulas.js`, following the `calculateRunway` template (destructured-with-defaults, guarded divide, `null` for no-finite-answer, status band):

```js
// Per-practice breakeven and profit (Daily Command Cockpit — §6 Profit vs
// Breakeven). Pure; integer pence.
//
// THE MARGIN. contributionMargin is fixed/breakevenMid, NOT 1 - fixed/breakevenMid.
// At breakeven, revenue covers fixed + variable, so variable/revenue =
// 1 - fixed/breakeven — that quantity is the VARIABLE-COST RATIO, and what's
// left over, fixed/breakeven, is the contribution margin. The source mockup
// used the variable ratio as the margin (0.629 instead of 0.371); with
// £31k fixed and £83.5k breakeven that reports a group £4,050/day better than
// reality and flips practices from below to above breakeven.
//
// The identity breakevenDay === breakevenMid/workingDays is the check that the
// margin is right: fixedDay/margin = (fixed/wd)/(fixed/mid) = mid/wd. The
// mockup's own £2,464/day implied a £49,280/mo breakeven, contradicting the
// £81-86k/mo it stated two lines earlier.
//
// NULLS, NOT ZEROS. Without a usable model every derived figure is null and
// status is 'not_set'. A practice with no cost model has not made £0 profit —
// we simply cannot say, and £0 would drag a group total down with a fiction.
export function calculateBreakeven({
    revenuePence = 0,
    fixedCostPenceMonth = 0,
    breakevenLowPence = 0,
    breakevenHighPence = 0,
    workingDaysPerMonth = 20,
    workingDaysInWindow = 0,
} = {}) {
    const breakevenMidPence = Math.round((breakevenLowPence + breakevenHighPence) / 2);

    // margin = fixed/mid must land in (0, 1]. mid < fixed would mean revenue has
    // to cover more than 100% contribution — a bad input, not a great practice.
    const usable =
        fixedCostPenceMonth > 0 &&
        breakevenMidPence > 0 &&
        fixedCostPenceMonth <= breakevenMidPence &&
        workingDaysPerMonth > 0;

    if (!usable) {
        return {
            breakevenMidPence,
            contributionMarginPct: null,
            fixedDayPence: null,
            breakevenDayPence: null,
            contributionPence: null,
            fixedPence: null,
            profitPence: null,
            status: 'not_set',
        };
    }

    const margin = fixedCostPenceMonth / breakevenMidPence;
    const fixedDayPence = pence(fixedCostPenceMonth / workingDaysPerMonth);
    const breakevenDayPence = pence(fixedDayPence / margin);
    const contributionPence = pence(revenuePence * margin);
    const fixedPence = pence(fixedDayPence * workingDaysInWindow);
    const profitPence = contributionPence - fixedPence;

    return {
        breakevenMidPence,
        contributionMarginPct: pct(margin * 100, 2),
        fixedDayPence,
        breakevenDayPence,
        contributionPence,
        fixedPence,
        profitPence,
        status: profitPence >= 0 ? 'above' : 'below',
    };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx vitest run test/formulas-breakeven.test.mjs
```

Expected: PASS, all 9.

- [ ] **Step 5: Document it in `docs/FORMULAS.md`**

Append a new numbered section, mirroring §14's format (Source line, indented equation block, bolded prose on what's deliberately not computed):

````markdown
## 15. Profit vs Breakeven (Daily Command Cockpit — §6)

Source: `backend/src/lib/formulas.js` (`calculateBreakeven`); tested in
`backend/test/formulas-breakeven.test.mjs`. Pure function, integer pence.
Surfaced on `GET /api/cockpit` as the `breakeven` block. Inputs are manual,
per-practice and historised in `practice_cost_model` (migration `…000113`), read
as-of the window's start.

    breakevenMid       = (breakevenLow + breakevenHigh) / 2
    contributionMargin = fixed / breakevenMid                 (NOT 1 - fixed/breakevenMid)
    fixedDay           = fixed / workingDaysPerMonth
    breakevenDay       = fixedDay / contributionMargin        ( === breakevenMid / workingDaysPerMonth )
    contribution       = revenue x contributionMargin
    fixedForWindow     = fixedDay x workingDaysInWindow
    profit             = contribution - fixedForWindow
    status             = profit >= 0 -> above ; else below ; no usable model -> not_set

**The margin is fixed/breakeven, not 1 − fixed/breakeven.** At breakeven, revenue
covers fixed + variable costs, so `variable/revenue = 1 − fixed/breakeven`. That
quantity is the **variable-cost ratio**; the contribution margin is what remains,
`fixed/breakeven`. With £31,000/mo fixed and an £81–86k/mo breakeven the two are
62.9% and 37.1% respectively. The source mockup specified the former as the
margin. Building it as specified reports a five-practice group £2,125/day in
profit on a day it actually lost £1,925 — £4,050/day adrift — and flips three of
five practices from below to above breakeven.

**The identity is the check.** `breakevenDay` must reduce to
`breakevenMid / workingDays`, because `fixedDay/margin = (fixed/wd)/(fixed/mid) =
mid/wd`. With the correct margin, £1,550/0.371 = £4,175 = £83,500/20 ✓. With the
mockup's, £1,550/0.629 = £2,464, implying a £49,280/mo breakeven — contradicting
the £81–86k/mo the same document states.

**Nulls, not zeros.** Without a usable model (`fixed <= 0`, `breakevenMid <= 0`,
`workingDays <= 0`, or `fixed > breakevenMid`) every derived figure is `null` and
status is `not_set`. A practice with no cost model has not earned £0 — we cannot
say. It is excluded from the group row rather than dragging it down with a
fiction.

**Working days are days actually traded**, counted from the practice's cash-up
rows in the window, not calendar weekdays. A day with no cash-up contributes
neither revenue nor fixed cost, so a practice that failed to key a cash-up shows
a shorter window rather than a phantom loss.

**No fixed/variable split from the P&L.** `emergent_monthly_pl` carries monthly
actuals with no fixed/variable tagging, so the margin cannot yet be derived from
real costs — it comes from the manual breakeven-revenue input. Once a tagged P&L
exists, replace the assumed margin with the real one.

---
````

Also add `calculateBreakeven` to the `## Unit tests` section near the end of the file, following the existing entries' format.

- [ ] **Step 6: Run the whole backend suite**

```bash
cd backend && npm test
```

Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/formulas.js backend/test/formulas-breakeven.test.mjs docs/FORMULAS.md
git commit -m "feat(formulas): calculateBreakeven — contribution margin is fixed/breakeven, not the variable ratio"
```

---

### Task 7: Cost-model repository

**Files:**
- Create: `backend/src/repositories/practice-cost-model.repository.js`
- Create: `backend/test/practice-cost-model-repository.test.mjs`
- Modify: `backend/src/repositories/cockpit.repository.js` (add `activePractices`)

**Interfaces:**
- Produces:
  - `practiceCostModelRepository.asOf(orgId, asOfDate)` → `Array<{ practice_id, effective_from, fixed_cost_pence_month, breakeven_low_pence, breakeven_high_pence, working_days_per_month, revenue_target_pence_month }>` — **one row per practice**, the latest with `effective_from <= asOfDate`.
  - `practiceCostModelRepository.upsert(orgId, practiceId, effectiveFrom, fields)` → the written row.
  - `cockpitRepository.activePractices(orgId, practiceId)` → `Array<{ id, name }>`.

- [ ] **Step 1: Write the failing test**

The `test/setup.js` recorder exposes `supaRec.last` — the last query as
`{ table, op, eqs: [{col,val}], ltes: [{col,val}], order: {col,opts}, upsertVals,
upsertOpts, selectArgs }` — and `supaRec.resultProvider = (q) => ({ data, error })`.
Note the fake does **not** sort: `.order()` is only recorded, so the stub data must
already be in the order the real query would return it (descending
`effective_from` here).

```js
// backend/test/practice-cost-model-repository.test.mjs
// practice_cost_model data access — the as-of read (latest model in force at a
// date) and the historised upsert. Verifies org-scoping, since serviceClient
// bypasses RLS and the .eq('organisation_id') filter is the only isolation.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('practiceCostModelRepository.asOf', () => {
  it('filters by organisation_id — serviceClient has no automatic isolation', async () => {
    await practiceCostModelRepository.asOf('ORG1', '2026-07-01');
    expect(supaRec.last.table).toBe('practice_cost_model');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: 'ORG1' });
  });

  it('bounds effective_from with lte so a future model never leaks into a past window', async () => {
    await practiceCostModelRepository.asOf('ORG1', '2026-03-31');
    expect(supaRec.last.ltes).toContainEqual({ col: 'effective_from', val: '2026-03-31' });
    expect(supaRec.last.order).toEqual({ col: 'effective_from', opts: { ascending: false } });
  });

  it('keeps only the latest effective_from per practice', async () => {
    supaRec.resultProvider = () => ({
      data: [
        // Newest-first, as the real ordered query returns them.
        { practice_id: 'P1', effective_from: '2026-07-01', fixed_cost_pence_month: 3300000, working_days_per_month: 20 },
        { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000, working_days_per_month: 20 },
        { practice_id: 'P2', effective_from: '2026-03-01', fixed_cost_pence_month: 2000000, working_days_per_month: 22 },
      ],
      error: null,
    });
    const rows = await practiceCostModelRepository.asOf('ORG1', '2026-07-15');
    expect(rows).toHaveLength(2);
    // July's model wins over January's — a rent rise must not rewrite the past,
    // but it must apply to the present.
    expect(rows.find((r) => r.practice_id === 'P1').fixed_cost_pence_month).toBe(3300000);
    expect(rows.find((r) => r.practice_id === 'P2').working_days_per_month).toBe(22);
  });

  it('throws with the table name when the query errors', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(practiceCostModelRepository.asOf('ORG1', '2026-07-01')).rejects.toThrow(/practice_cost_model asOf: boom/);
  });
});

describe('practiceCostModelRepository.upsert', () => {
  it('upserts on practice_id,effective_from so two edits in one day update one row', async () => {
    let captured;
    // .upsert(...).select().single() flips q.op to 'select' before settle, so
    // key off the recorded upsertVals rather than q.op.
    supaRec.resultProvider = (q) => {
      if (q.upsertVals !== undefined) captured = q;
      return { data: { practice_id: 'P1' }, error: null };
    };
    await practiceCostModelRepository.upsert('ORG1', 'P1', '2026-07-17', { fixed_cost_pence_month: 3100000 });

    expect(captured.table).toBe('practice_cost_model');
    expect(captured.upsertOpts).toEqual({ onConflict: 'practice_id,effective_from' });
    expect(captured.upsertVals).toEqual({
      organisation_id: 'ORG1',
      practice_id: 'P1',
      effective_from: '2026-07-17',
      fixed_cost_pence_month: 3100000,
    });
  });

  it('stamps organisation_id on every written row', async () => {
    let captured;
    supaRec.resultProvider = (q) => {
      if (q.upsertVals !== undefined) captured = q;
      return { data: {}, error: null };
    };
    await practiceCostModelRepository.upsert('ORG1', 'P1', '2026-07-17', { revenue_target_pence_month: 40000000 });
    expect(captured.upsertVals.organisation_id).toBe('ORG1');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npx vitest run test/practice-cost-model-repository.test.mjs
```

Expected: FAIL — cannot resolve `../src/repositories/practice-cost-model.repository.js`.

- [ ] **Step 3: Implement the repository**

```js
// practice_cost_model data access — the manual per-practice fixed-cost /
// breakeven / working-days / revenue-target inputs behind the cockpit's §6
// Profit vs Breakeven and §1 Daily target.
//
// Queries in, rows out. No business logic — the maths lives in
// lib/formulas.js (calculateBreakeven).
//
// MULTI-TENANT: serviceClient BYPASSES RLS, so every query chains an explicit
// .eq('organisation_id', orgId). There is no automatic isolation here.
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, practice_id, effective_from, fixed_cost_pence_month, breakeven_low_pence, ' +
    'breakeven_high_pence, working_days_per_month, revenue_target_pence_month';

export const practiceCostModelRepository = {
    // The as-of read: for each practice, the newest model in force at asOfDate.
    // Ordered newest-first and collapsed in JS — a window function would need an
    // RPC, and the row count here is one per practice per edit, not per day.
    async asOf(orgId, asOfDate) {
        let q = supabase_1.serviceClient
            .from('practice_cost_model')
            .select(COLS)
            .eq('organisation_id', orgId)
            .order('effective_from', { ascending: false });
        if (asOfDate) q = q.lte('effective_from', asOfDate);
        const { data, error } = await q;
        if (error) throw new Error(`practice_cost_model asOf: ${error.message}`);

        const latest = new Map();
        for (const row of data ?? []) {
            if (!latest.has(row.practice_id)) latest.set(row.practice_id, row);
        }
        return Array.from(latest.values());
    },

    // Upsert at (practice_id, effective_from) — the table's unique key. Editing
    // twice on the same day updates that day's row rather than stacking two.
    async upsert(orgId, practiceId, effectiveFrom, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('practice_cost_model')
            .upsert({
                organisation_id: orgId,
                practice_id: practiceId,
                effective_from: effectiveFrom,
                ...fields,
            }, { onConflict: 'practice_id,effective_from' })
            .select(COLS)
            .single();
        if (error) throw new Error(`practice_cost_model upsert: ${error.message}`);
        return data;
    },
};
```

- [ ] **Step 4: Add `activePractices` to `cockpit.repository.js`**

§6 must list Warwick Lodge — a practice with no cash-up rows never appears in `cashupRollup`, so the practice list has to come from `practices`.

```js
    // Every active practice, so §6 can show a practice that is REPORTING NOTHING
    // (Warwick Lodge) rather than silently omitting it. cashupRollup only knows
    // practices that have sent a cash-up.
    async activePractices(orgId, practiceId) {
        let q = supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .eq('active', true)
            .order('name', { ascending: true });
        if (practiceId) q = q.eq('id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(`activePractices: ${error.message}`);
        return data ?? [];
    },
```

- [ ] **Step 5: Run the tests**

```bash
cd backend && npx vitest run test/practice-cost-model-repository.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repositories/practice-cost-model.repository.js \
        backend/src/repositories/cockpit.repository.js \
        backend/test/practice-cost-model-repository.test.mjs
git commit -m "feat(cockpit): practice_cost_model repository with as-of reads"
```

---

### Task 8: Cost-model service, model, controller and routes

**Files:**
- Create: `backend/src/services/practice-cost-model.service.js`
- Create: `backend/src/models/practice-cost-model.model.js`
- Modify: `backend/src/controllers/cockpit.controller.js`
- Modify: `backend/src/routes/cockpit.routes.js`
- Create: `backend/test/practice-cost-model-service.test.mjs`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: `practiceCostModelRepository.asOf` / `.upsert`; `cockpitRepository.activePractices`.
- Produces:
  - `GET /api/cockpit/cost-model?asOf=YYYY-MM-DD` → `{ asOf, rows: [{ practiceId, name, effectiveFrom, fixedCostPenceMonth, breakevenLowPence, breakevenHighPence, workingDaysPerMonth, revenueTargetPenceMonth }] }` — one row per active practice, nulls where unset.
  - `PUT /api/cockpit/cost-model/:practiceId` → the written row, same shape.

- [ ] **Step 1: Write the Zod model**

```js
// practice_cost_model request schemas. Money arrives as integer PENCE from the
// client (the UI converts pounds -> pence at its boundary, per the repo
// convention). Every field optional so a partial edit is possible, but at least
// one must be present.
import * as zod_1 from "zod";

const PENCE = zod_1.z.number().int().nonnegative().nullable();

export const costModelQuerySchema = zod_1.z.object({
    asOf: zod_1.z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOf must be YYYY-MM-DD' }).optional(),
});

export const costModelUpsertSchema = zod_1.z.object({
    fixedCostPenceMonth: PENCE.optional(),
    breakevenLowPence: PENCE.optional(),
    breakevenHighPence: PENCE.optional(),
    workingDaysPerMonth: zod_1.z.number().int().min(1).max(31).optional(),
    revenueTargetPenceMonth: PENCE.optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'no fields to update' })
  .refine(
      v => v.breakevenLowPence == null || v.breakevenHighPence == null || v.breakevenLowPence <= v.breakevenHighPence,
      { message: 'breakevenLowPence must not exceed breakevenHighPence' },
  );
```

- [ ] **Step 2: Write the failing test**

```js
// backend/test/practice-cost-model-service.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/practice-cost-model.repository.js', () => ({
  practiceCostModelRepository: {
    asOf: vi.fn(async () => [
      { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000,
        breakeven_low_pence: 8100000, breakeven_high_pence: 8600000,
        working_days_per_month: 20, revenue_target_pence_month: 40000000 },
    ]),
    upsert: vi.fn(async (orgId, practiceId, effectiveFrom, fields) => ({
      practice_id: practiceId, effective_from: effectiveFrom, working_days_per_month: 20, ...fields,
    })),
  },
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    activePractices: vi.fn(async () => [
      { id: 'P1', name: 'Ashford' },
      { id: 'P9', name: 'Warwick Lodge' },
    ]),
  },
}));

let practiceCostModelService, practiceCostModelRepository;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ practiceCostModelService } = await import('../src/services/practice-cost-model.service.js'));
  ({ practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js'));
});

describe('practiceCostModelService.list', () => {
  it('returns a row for every active practice, nulls where no model is set', async () => {
    const out = await practiceCostModelService.list('ORG1', { asOf: '2026-07-17' });
    expect(out.rows).toHaveLength(2);

    const ashford = out.rows.find((r) => r.practiceId === 'P1');
    expect(ashford.fixedCostPenceMonth).toBe(3100000);
    expect(ashford.workingDaysPerMonth).toBe(20);

    // Warwick Lodge has no model — nulls, NOT zeros. A zero would render as a
    // real £0 fixed cost and drag §6's group row down with a fiction.
    const warwick = out.rows.find((r) => r.practiceId === 'P9');
    expect(warwick.name).toBe('Warwick Lodge');
    expect(warwick.fixedCostPenceMonth).toBeNull();
    expect(warwick.effectiveFrom).toBeNull();
    // working days still defaults, since it has a NOT NULL DEFAULT 20
    expect(warwick.workingDaysPerMonth).toBe(20);
  });

  it('defaults asOf to today when not given', async () => {
    await practiceCostModelService.list('ORG1', {});
    const asOf = practiceCostModelRepository.asOf.mock.calls[0][1];
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('practiceCostModelService.save', () => {
  it('writes at effective_from = today so history is preserved', async () => {
    await practiceCostModelService.save('ORG1', 'P1', { fixedCostPenceMonth: 3300000 });
    const [orgId, practiceId, effectiveFrom, fields] = practiceCostModelRepository.upsert.mock.calls[0];
    expect(orgId).toBe('ORG1');
    expect(practiceId).toBe('P1');
    expect(effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fields).toEqual({ fixed_cost_pence_month: 3300000 });
  });

  it('maps only the fields supplied — a partial edit must not null the rest', async () => {
    await practiceCostModelService.save('ORG1', 'P1', { revenueTargetPenceMonth: 50000000 });
    const fields = practiceCostModelRepository.upsert.mock.calls[0][3];
    expect(fields).toEqual({ revenue_target_pence_month: 50000000 });
    expect(fields).not.toHaveProperty('fixed_cost_pence_month');
  });

  it('rejects a practice outside the org', async () => {
    await expect(practiceCostModelService.save('ORG1', 'NOT-MINE', { fixedCostPenceMonth: 1 }))
      .rejects.toThrow(/practice not found/i);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd backend && npx vitest run test/practice-cost-model-service.test.mjs
```

Expected: FAIL — cannot resolve the service module.

- [ ] **Step 4: Implement the service**

```js
// practice_cost_model business logic — lists the manual per-practice inputs
// as-of a date and writes edits, always at effective_from = today so the
// history is preserved (a rent rise in July must not rewrite March).
import { practiceCostModelRepository } from "../repositories/practice-cost-model.repository.js";
import { cockpitRepository } from "../repositories/cockpit.repository.js";

const today = () => new Date().toISOString().slice(0, 10);

// camelCase API field -> snake_case column. Only supplied keys are mapped, so a
// partial edit never nulls the fields it didn't mention.
const FIELD_MAP = {
    fixedCostPenceMonth: 'fixed_cost_pence_month',
    breakevenLowPence: 'breakeven_low_pence',
    breakevenHighPence: 'breakeven_high_pence',
    workingDaysPerMonth: 'working_days_per_month',
    revenueTargetPenceMonth: 'revenue_target_pence_month',
};

function shape(practice, model) {
    return {
        practiceId: practice.id,
        name: practice.name,
        // null (not today) when the practice has no model at all — the UI
        // renders "Not set", never a fabricated £0.
        effectiveFrom: model?.effective_from ?? null,
        fixedCostPenceMonth: model?.fixed_cost_pence_month ?? null,
        breakevenLowPence: model?.breakeven_low_pence ?? null,
        breakevenHighPence: model?.breakeven_high_pence ?? null,
        workingDaysPerMonth: model?.working_days_per_month ?? 20,
        revenueTargetPenceMonth: model?.revenue_target_pence_month ?? null,
    };
}

export const practiceCostModelService = {
    async list(orgId, { asOf, practiceId } = {}) {
        const on = asOf || today();
        const [practices, models] = await Promise.all([
            cockpitRepository.activePractices(orgId, practiceId),
            practiceCostModelRepository.asOf(orgId, on),
        ]);
        const byPractice = new Map((models || []).map(m => [m.practice_id, m]));
        return { asOf: on, rows: (practices || []).map(p => shape(p, byPractice.get(p.id))) };
    },

    async save(orgId, practiceId, input) {
        // The practice must belong to the caller's org. activePractices is
        // org-filtered, so an id from another tenant simply isn't in the list.
        const practices = await cockpitRepository.activePractices(orgId, practiceId);
        const practice = (practices || []).find(p => p.id === practiceId);
        if (!practice) throw new Error('practice not found');

        const fields = {};
        for (const [key, col] of Object.entries(FIELD_MAP)) {
            if (input[key] !== undefined) fields[col] = input[key];
        }

        const row = await practiceCostModelRepository.upsert(orgId, practiceId, today(), fields);
        return shape(practice, row);
    },
};
```

- [ ] **Step 5: Add the controllers**

In `backend/src/controllers/cockpit.controller.js`, add the imports:

```js
import { practiceCostModelService } from "../services/practice-cost-model.service.js";
import { costModelQuerySchema, costModelUpsertSchema } from "../models/practice-cost-model.model.js";
```

and two methods to the `cockpitController` object:

```js
    async costModel(req, res) {
        const q = costModelQuerySchema.parse(req.query);
        res.json(await practiceCostModelService.list(req.user.organisation_id, { asOf: q.asOf }));
    },

    async saveCostModel(req, res) {
        const practiceId = String(req.params.practiceId || '');
        if (!UUID_RE.test(practiceId)) return res.status(400).json({ error: 'invalid practiceId' });
        const input = costModelUpsertSchema.parse(req.body);
        res.json(await practiceCostModelService.save(req.user.organisation_id, practiceId, input));
    },
```

- [ ] **Step 6: Add the routes**

In `backend/src/routes/cockpit.routes.js`. **Order matters** — these are static/param paths and must be declared before the root `/` handler, matching the file's existing convention.

Reads keep the `finance.view` gate. **Writes are owner-only**: rule 5 makes Practice Manager finance access an owner-toggled thing, so a manager must not be able to set the group's targets by default. This is delegable later via the permissions catalog.

```js
const owner = (0, auth_1.requireRole)('owner');

router.get('/cost-model', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.costModel));
router.put('/cost-model/:practiceId', owner, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.saveCostModel));
```

Insert these after the `/cashup-days` line and before the `router.get('/', ...)` line.

- [ ] **Step 7: Run the tests**

```bash
cd backend && npx vitest run test/practice-cost-model-service.test.mjs && npm test
```

Expected: both PASS.

- [ ] **Step 8: Update `docs/API.md`**

Add to the Daily Command Cockpit section:

````markdown
### `GET /api/cockpit/cost-model?asOf=YYYY-MM-DD`

The manual per-practice inputs behind §6 Profit vs Breakeven and §1's Daily
target. `finance.view`. `asOf` defaults to today; the read returns the model **in
force on that date** (latest `effective_from <= asOf`), so a past window is
costed with the model that was actually in force then.

```
{ asOf, rows: [{ practiceId, name, effectiveFrom, fixedCostPenceMonth,
                 breakevenLowPence, breakevenHighPence, workingDaysPerMonth,
                 revenueTargetPenceMonth }] }
```

One row per **active practice**, not per stored model — a practice with no model
returns `null` for every input (and `effectiveFrom: null`), never `0`.
`workingDaysPerMonth` defaults to 20.

### `PUT /api/cockpit/cost-model/:practiceId`

**Owner only** (`requireRole('owner')`) — rule 5 makes Practice Manager finance
access owner-toggled, so a manager cannot set targets by default. Body is any
subset of `{ fixedCostPenceMonth, breakevenLowPence, breakevenHighPence,
workingDaysPerMonth, revenueTargetPenceMonth }`; money is integer **pence**.
Omitted fields are left untouched.

Writes at `effective_from = today`, upserting on `(practice_id, effective_from)`
— so two edits in one day update one row rather than stacking two, and yesterday's
model is preserved. Returns the written row in the same shape as the list.

`400` on a malformed `practiceId`, an empty body, or `breakevenLowPence >
breakevenHighPence`.
````

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/practice-cost-model.service.js backend/src/models/practice-cost-model.model.js \
        backend/src/controllers/cockpit.controller.js backend/src/routes/cockpit.routes.js \
        backend/test/practice-cost-model-service.test.mjs docs/API.md
git commit -m "feat(cockpit): cost-model API — as-of reads, owner-gated historised writes"
```

---

### Task 9: The `breakeven` and `revenue.month` blocks on `/api/cockpit`

Wires the formula and the cost model into the payload. This is where §6 and §1's cards get their numbers.

**Files:**
- Modify: `backend/src/services/cockpit.service.js`
- Create: `backend/test/cockpit-breakeven.test.mjs`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: `calculateBreakeven` (Task 6), `practiceCostModelRepository.asOf` (Task 7), `cockpitRepository.activePractices` (Task 7), `cockpitRepository.cashupRollup`.
- Produces:
  - `breakeven: { rows: BreakevenRow[], group: { revenuePence, contributionPence, fixedPence, profitPence, breakevenPence, status, excludedCount } }` where `BreakevenRow = { practiceId, name, revenuePence, workingDaysInWindow, breakevenDayPence, contributionPence, fixedDayPence, fixedPence, profitPence, status }` and `status ∈ 'above' | 'below' | 'not_set' | 'not_reporting'`.
  - `revenue.month: { periodMonth, todayPence, todayDate, mtdPence, workingDaysElapsed, avgPerDayPence, projectedPence, dailyTargetPence, byPractice[] }`.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/cockpit-breakeven.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: { channelBreakdown: vi.fn(async () => ({ channels: [], group: {}, groupChannels: {} })) },
  classifyChannel: () => null,
  matchAcceptedValue: () => null,
  buildAcceptedByKey: () => ({ acceptedByKey: new Map(), nameByPractice: new Map() }),
}));

// Ashford traded one day (£4,900); Warwick Lodge has no cash-up at all.
const CASHUP = [
  { practice_id: 'P1', business_name: 'Ashford', cashup_date: '2026-07-15',
    cash_up_money_taken_pence: 490000, detail_patient_money_total_pence: 490000,
    tx_plans_given: 0, tx_plan_given_value_pence: 0, num_new_leads: 0, num_attended: 0 },
];

vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => CASHUP),
    monthlyPl: vi.fn(async () => []),
    latestMonthlyPl: vi.fn(async () => ({ periodMonth: null, rows: [] })),
    acceptedContactsInWindow: vi.fn(async () => []),
    revenueByLine: vi.fn(async () => []),
    activePractices: vi.fn(async () => [
      { id: 'P1', name: 'Ashford' },
      { id: 'P9', name: 'Warwick Lodge' },
    ]),
  },
}));
vi.mock('../src/repositories/practice-cost-model.repository.js', () => ({
  practiceCostModelRepository: {
    asOf: vi.fn(async () => [
      { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000,
        breakeven_low_pence: 8100000, breakeven_high_pence: 8600000,
        working_days_per_month: 20, revenue_target_pence_month: 16000000 },
      // P9 (Warwick Lodge) deliberately has no model.
    ]),
  },
}));

let cockpitService;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));
});

const WIN = { since: '2026-07-15', until: '2026-07-16' };

describe('cockpit breakeven block', () => {
  it('computes profit for a practice with a model over the days it traded', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    const ashford = out.breakeven.rows.find((r) => r.practiceId === 'P1');
    expect(ashford.revenuePence).toBe(490000);
    expect(ashford.workingDaysInWindow).toBe(1);
    expect(ashford.breakevenDayPence).toBe(417500);
    expect(ashford.fixedPence).toBe(155000);
    expect(ashford.profitPence).toBe(26916);
    expect(ashford.status).toBe('above');
  });

  it('shows a practice with no feed as not_reporting, never £0', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    const warwick = out.breakeven.rows.find((r) => r.practiceId === 'P9');
    expect(warwick.name).toBe('Warwick Lodge');
    expect(warwick.status).toBe('not_reporting');
    expect(warwick.revenuePence).toBeNull();
    expect(warwick.profitPence).toBeNull();
  });

  it('excludes practices without a usable model from the group row and counts them', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    // Only Ashford contributes. Folding Warwick in as £0 fixed would overstate
    // group profit — the exact failure this section exists to prevent.
    expect(out.breakeven.group.revenuePence).toBe(490000);
    expect(out.breakeven.group.profitPence).toBe(26916);
    expect(out.breakeven.group.status).toBe('above');
    expect(out.breakeven.group.excludedCount).toBe(1);
  });

  it('reads the cost model as-of the window start, not today', async () => {
    const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');
    await cockpitService.build('ORG1', { since: '2026-03-01', until: '2026-04-01' });
    expect(practiceCostModelRepository.asOf).toHaveBeenCalledWith('ORG1', '2026-03-01');
  });
});

describe('cockpit revenue.month block', () => {
  it('derives today, MTD, projection and daily target', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    const m = out.revenue.month;
    expect(m.todayPence).toBe(490000);
    expect(m.todayDate).toBe('2026-07-15');
    expect(m.mtdPence).toBe(490000);
    expect(m.workingDaysElapsed).toBe(1);
    // projection = mtd/elapsed x workingDaysPerMonth = 490000/1 x 20
    expect(m.projectedPence).toBe(9800000);
    // daily target = 16000000/20 = 800000 (£8,000)
    expect(m.dailyTargetPence).toBe(800000);
  });

  it('returns a null projection rather than dividing by zero when nothing traded', async () => {
    const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
    cockpitRepository.cashupRollup.mockImplementation(async () => []);
    const out = await cockpitService.build('ORG1', WIN);
    expect(out.revenue.month.projectedPence).toBeNull();
    expect(out.revenue.month.todayPence).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npx vitest run test/cockpit-breakeven.test.mjs
```

Expected: FAIL — `Cannot read properties of undefined (reading 'rows')`.

- [ ] **Step 3: Implement in `cockpit.service.js`**

Add the imports at the top:

```js
import { practiceCostModelRepository } from "../repositories/practice-cost-model.repository.js";
import { calculateBreakeven } from "../lib/formulas.js";
```

Add the month-bounds helper next to `monthStartFrom`:

```js
// The calendar month containing `until` (or today). §1's today/MTD/projected
// cards are anchored to this month, NOT to the window — "month to date" against
// an arbitrary window is meaningless. Each card is labelled with the month.
function monthBoundsFrom(until) {
    const d = until ? new Date(until) : new Date();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return {
        start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
        endExclusive: new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10),
    };
}

// Days the practice ACTUALLY TRADED, from its cash-up rows — not calendar
// weekdays. A day with no cash-up contributes neither revenue nor fixed cost, so
// a missed cash-up shortens the window rather than manufacturing a loss.
function tradedDaysByPractice(rows) {
    const days = new Map();
    for (const row of rows || []) {
        if (!row.practice_id || !row.cashup_date) continue;
        if (!days.has(row.practice_id)) days.set(row.practice_id, new Set());
        days.get(row.practice_id).add(row.cashup_date);
    }
    return days;
}
```

In `build`, extend the `Promise.all` (it already gained `revenueByLine` in Task 4) with the three new reads. The cost model is read **as-of the window start**:

```js
        const month = monthBoundsFrom(until);
        const [cashupRows, monthlyRowsForCurrent, leadRoi, acceptedRows, revenueLineRows,
               practices, costModels, monthCashupRows] = await Promise.all([
            cockpitRepository.cashupRollup(orgId, since, until, practiceId),
            cockpitRepository.monthlyPl(orgId, periodMonth, practiceId),
            leadAttributionService.channelBreakdown(orgId, { since, until, practiceId }),
            cockpitRepository.acceptedContactsInWindow(orgId, since, until, practiceId),
            cockpitRepository.revenueByLine(orgId, since, until),
            cockpitRepository.activePractices(orgId, practiceId),
            // As-of the window's START: a March window must be costed with the
            // model in force in March, not the one set last week.
            practiceCostModelRepository.asOf(orgId, (since || month.start).slice(0, 10)),
            cockpitRepository.cashupRollup(orgId, month.start, month.endExclusive, practiceId),
        ]);
```

Add this block just before the `return {`:

```js
        // ---- §6 Profit vs Breakeven, and §1's month-anchored cards ----------
        const modelByPractice = new Map((costModels || []).map(m => [m.practice_id, m]));
        const windowTradedDays = tradedDaysByPractice(cashupRows);
        const revenueByPractice = new Map(byPractice.filter(p => p.practiceId).map(p => [p.practiceId, p.collectedPence]));

        const breakevenRows = (practices || []).map(p => {
            const model = modelByPractice.get(p.id);
            const traded = windowTradedDays.get(p.id)?.size ?? 0;
            const revenuePence = revenueByPractice.get(p.id) ?? null;

            // No cash-up at all in this window: the practice is not REPORTING.
            // That is not "£0 revenue" — Warwick Lodge has no Emergent feed.
            if (revenuePence === null) {
                return {
                    practiceId: p.id, name: p.name, revenuePence: null, workingDaysInWindow: 0,
                    breakevenDayPence: null, contributionPence: null, fixedDayPence: null,
                    fixedPence: null, profitPence: null, status: 'not_reporting',
                };
            }

            const b = calculateBreakeven({
                revenuePence,
                fixedCostPenceMonth: num(model?.fixed_cost_pence_month),
                breakevenLowPence: num(model?.breakeven_low_pence),
                breakevenHighPence: num(model?.breakeven_high_pence),
                workingDaysPerMonth: model?.working_days_per_month ?? 20,
                workingDaysInWindow: traded,
            });
            return {
                practiceId: p.id, name: p.name, revenuePence, workingDaysInWindow: traded,
                breakevenDayPence: b.breakevenDayPence, contributionPence: b.contributionPence,
                fixedDayPence: b.fixedDayPence, fixedPence: b.fixedPence,
                profitPence: b.profitPence, status: b.status,
            };
        });

        // Group = sum of the practices that HAVE a usable model and are
        // reporting. Anything else is excluded and counted, never folded in as
        // £0 — a costless practice would silently overstate group profit.
        const counted = breakevenRows.filter(r => r.status === 'above' || r.status === 'below');
        const groupProfit = counted.reduce((s, r) => s + r.profitPence, 0);
        const breakevenGroup = {
            revenuePence: counted.reduce((s, r) => s + r.revenuePence, 0),
            contributionPence: counted.reduce((s, r) => s + r.contributionPence, 0),
            fixedPence: counted.reduce((s, r) => s + r.fixedPence, 0),
            breakevenPence: counted.reduce((s, r) => s + r.breakevenDayPence * r.workingDaysInWindow, 0),
            profitPence: counted.length > 0 ? groupProfit : null,
            status: counted.length === 0 ? 'not_set' : groupProfit >= 0 ? 'above' : 'below',
            excludedCount: breakevenRows.length - counted.length,
        };

        // §1's month-anchored cards.
        const monthTradedDays = tradedDaysByPractice(monthCashupRows);
        const monthByPractice = new Map();
        for (const row of monthCashupRows || []) {
            const key = row.practice_id;
            if (!key) continue;
            if (!monthByPractice.has(key)) monthByPractice.set(key, { mtdPence: 0 });
            monthByPractice.get(key).mtdPence += num(row.cash_up_money_taken_pence);
        }

        const monthRowsOut = (practices || []).map(p => {
            const mtdPence = monthByPractice.get(p.id)?.mtdPence ?? 0;
            const elapsed = monthTradedDays.get(p.id)?.size ?? 0;
            const wdpm = modelByPractice.get(p.id)?.working_days_per_month ?? 20;
            const target = modelByPractice.get(p.id)?.revenue_target_pence_month ?? null;
            return {
                practiceId: p.id,
                name: p.name,
                mtdPence,
                workingDaysElapsed: elapsed,
                // Project each practice separately and sum — same principle as
                // the target: the group is the sum of its parts, so it can't drift.
                projectedPence: elapsed > 0 ? Math.round((mtdPence / elapsed) * wdpm) : null,
                dailyTargetPence: target !== null && wdpm > 0 ? Math.round(target / wdpm) : null,
            };
        });

        const monthMtdPence = monthRowsOut.reduce((s, r) => s + r.mtdPence, 0);
        const monthElapsed = new Set((monthCashupRows || []).map(r => r.cashup_date).filter(Boolean)).size;
        const projectedRows = monthRowsOut.filter(r => r.projectedPence !== null);
        const targetRows = monthRowsOut.filter(r => r.dailyTargetPence !== null);
        const latestDay = (monthCashupRows || []).reduce((a, r) => (r.cashup_date > a ? r.cashup_date : a), '');
        const todayPence = latestDay
            ? (monthCashupRows || []).filter(r => r.cashup_date === latestDay)
                .reduce((s, r) => s + num(r.cash_up_money_taken_pence), 0)
            : null;

        const revenueMonth = {
            periodMonth: month.start,
            todayPence,
            todayDate: latestDay || null,
            mtdPence: monthMtdPence,
            workingDaysElapsed: monthElapsed,
            avgPerDayPence: monthElapsed > 0 ? Math.round(monthMtdPence / monthElapsed) : null,
            projectedPence: projectedRows.length > 0 ? projectedRows.reduce((s, r) => s + r.projectedPence, 0) : null,
            dailyTargetPence: targetRows.length > 0 ? targetRows.reduce((s, r) => s + r.dailyTargetPence, 0) : null,
            byPractice: monthRowsOut,
        };
```

Add `month: revenueMonth,` inside the returned `revenue` object, and `breakeven: { rows: breakevenRows, group: breakevenGroup },` after `leadRoi,`.

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx vitest run test/cockpit-breakeven.test.mjs && npm test
```

Expected: both PASS. If `cockpit-service.test.mjs` or `cockpit-revenue-by-line.test.mjs` fail on the new repository methods, add `activePractices: vi.fn(async () => [])` to their `vi.mock` factories and a `vi.mock` for `practice-cost-model.repository.js` returning `{ asOf: vi.fn(async () => []) }`.

- [ ] **Step 5: Update `docs/API.md`**

````markdown
`breakeven` — §6 Profit vs Breakeven. Inputs come from `practice_cost_model`
(migration `…000113`), read **as-of the window's start**. Maths in
`calculateBreakeven` (`docs/FORMULAS.md` §15).

- `rows[]` — one per **active practice**: `{ practiceId, name, revenuePence,
  workingDaysInWindow, breakevenDayPence, contributionPence, fixedDayPence,
  fixedPence, profitPence, status }`.
- `status` — `above` | `below` | `not_set` (no usable cost model) |
  `not_reporting` (no cash-up in the window at all, e.g. Warwick Lodge). For the
  last two, every money field is **`null`, not `0`** — a practice with no feed has
  not earned £0.
- `workingDaysInWindow` counts **days the practice actually traded** (distinct
  cash-up dates), not calendar weekdays.
- `group` — `{ revenuePence, contributionPence, fixedPence, breakevenPence,
  profitPence, status, excludedCount }`. Sums **only** the `above`/`below` rows;
  `excludedCount` reports how many were left out. A costless practice folded in as
  £0 fixed would silently overstate group profit.

`revenue.month` — §1's Cash today / MTD / Projected / Daily target cards.
**Anchored to the calendar month containing `until`**, not to the window ("month
to date" against an arbitrary window is meaningless); the UI labels the month.
`{ periodMonth, todayPence, todayDate, mtdPence, workingDaysElapsed,
avgPerDayPence, projectedPence, dailyTargetPence, byPractice[] }`.

- `projectedPence` — each practice projected separately (`mtd / daysElapsed ×
  workingDaysPerMonth`) then summed, so the group can't drift from its parts.
  **`null` when nothing has traded** — never a divide-by-zero or a £0.
- `dailyTargetPence` — sum of each practice's `revenueTargetPenceMonth /
  workingDaysPerMonth`. `null` when no practice has a target set.
- `todayPence` / `todayDate` — the latest cash-up day in the month; `null` when
  the month has no cash-up at all.
````

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cockpit.service.js backend/test/cockpit-breakeven.test.mjs \
        backend/test/cockpit-service.test.mjs backend/test/cockpit-revenue-by-line.test.mjs docs/API.md
git commit -m "feat(cockpit): breakeven + month-anchored revenue blocks on /api/cockpit"
```

---

### Task 10: Frontend cost-model API and hooks

**Files:**
- Create: `frontend/features/cockpit/cost-model-api.ts`
- Modify: `frontend/features/cockpit/hooks.ts`
- Modify: `frontend/features/cockpit/api.ts` (types for the two new payload blocks)

**Interfaces:**
- Produces: `useCostModel(asOf?)`, `useSaveCostModel()`; types `CostModelRow`, `BreakevenRow`, `BreakevenGroup`, `RevenueMonth`.

- [ ] **Step 1: Add the payload types**

In `frontend/features/cockpit/api.ts`:

```ts
export type BreakevenStatus = 'above' | 'below' | 'not_set' | 'not_reporting';

export interface BreakevenRow {
  practiceId: string;
  name: string;
  /** null when the practice sent no cash-up at all in this window. */
  revenuePence: number | null;
  /** Days the practice actually traded — distinct cash-up dates, not weekdays. */
  workingDaysInWindow: number;
  breakevenDayPence: number | null;
  contributionPence: number | null;
  fixedDayPence: number | null;
  fixedPence: number | null;
  profitPence: number | null;
  status: BreakevenStatus;
}

export interface BreakevenGroup {
  revenuePence: number;
  contributionPence: number;
  fixedPence: number;
  breakevenPence: number;
  profitPence: number | null;
  status: BreakevenStatus;
  /** Practices left out of the group row — no cost model, or not reporting. */
  excludedCount: number;
}

export interface RevenueMonthPractice {
  practiceId: string;
  name: string;
  mtdPence: number;
  workingDaysElapsed: number;
  projectedPence: number | null;
  dailyTargetPence: number | null;
}

export interface RevenueMonth {
  periodMonth: string;
  todayPence: number | null;
  todayDate: string | null;
  mtdPence: number;
  workingDaysElapsed: number;
  avgPerDayPence: number | null;
  projectedPence: number | null;
  dailyTargetPence: number | null;
  byPractice: RevenueMonthPractice[];
}
```

Add `month: RevenueMonth;` to `CockpitResponse['revenue']`, and `breakeven: { rows: BreakevenRow[]; group: BreakevenGroup };` to `CockpitResponse`.

- [ ] **Step 2: Write the cost-model API module**

```ts
// frontend/features/cockpit/cost-model-api.ts
// The manual per-practice inputs behind §6 Profit vs Breakeven and §1's Daily
// target. Money is integer PENCE over the wire; the UI edits in whole pounds and
// converts at its boundary (Math.round(Number(raw) * 100)), per repo convention.
import { api } from '@/lib/api';

export interface CostModelRow {
  practiceId: string;
  name: string;
  /** null when this practice has no cost model at all. */
  effectiveFrom: string | null;
  fixedCostPenceMonth: number | null;
  breakevenLowPence: number | null;
  breakevenHighPence: number | null;
  workingDaysPerMonth: number;
  revenueTargetPenceMonth: number | null;
}

export interface CostModelResponse {
  asOf: string;
  rows: CostModelRow[];
}

export interface CostModelInput {
  fixedCostPenceMonth?: number | null;
  breakevenLowPence?: number | null;
  breakevenHighPence?: number | null;
  workingDaysPerMonth?: number;
  revenueTargetPenceMonth?: number | null;
}

export function fetchCostModel(asOf?: string) {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  return api<CostModelResponse>(`/api/cockpit/cost-model${qs}`);
}

export function saveCostModel(practiceId: string, input: CostModelInput) {
  return api<CostModelRow>(`/api/cockpit/cost-model/${practiceId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 3: Add the hooks**

Append to `frontend/features/cockpit/hooks.ts`, following the established
query-then-mutate-then-invalidate pattern (see `pl-sheets-hooks.ts`):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCostModel, saveCostModel, type CostModelInput } from './cost-model-api';

export function useCostModel(asOf?: string) {
  return useQuery({
    queryKey: ['cockpit-cost-model', asOf ?? 'today'],
    queryFn: () => fetchCostModel(asOf),
    staleTime: 30_000,
  });
}

export function useSaveCostModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ practiceId, input }: { practiceId: string; input: CostModelInput }) =>
      saveCostModel(practiceId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cockpit-cost-model'] });
      // The cockpit payload derives §6 and §1's target from this model, so it
      // must refetch too — invalidate the key prefix, since the cockpit query is
      // keyed by scope+window and we don't know which one is mounted.
      qc.invalidateQueries({ queryKey: ['cockpit'] });
    },
  });
}
```

**Check** the existing `useQuery`/`useCockpit` import line at the top of `hooks.ts` and merge the `useMutation`/`useQueryClient` imports into it rather than adding a duplicate `@tanstack/react-query` import. Confirm the cockpit query key prefix really is `['cockpit', …]`; if it differs, invalidate the actual prefix.

- [ ] **Step 4: Typecheck, lint, build**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/cockpit/cost-model-api.ts frontend/features/cockpit/hooks.ts frontend/features/cockpit/api.ts
git commit -m "feat(cockpit): cost-model client api + hooks"
```

---

### Task 11: §6 — the Profit vs Breakeven section

**Files:**
- Create: `frontend/features/cockpit/components/BreakevenSection.tsx`
- Modify: `frontend/features/cockpit/components/CockpitScreen.tsx`

**Interfaces:**
- Consumes: `CockpitResponse['breakeven']`, `useCostModel`, `useSaveCostModel`.

- [ ] **Step 1: Build the section**

```tsx
// frontend/features/cockpit/components/BreakevenSection.tsx
'use client';
// §6 Profit vs Breakeven — per practice, is today's cash above the cost of
// opening the doors?
//
// The margin is fixed/breakeven (37.1% on GM's numbers), NOT 1 - fixed/breakeven
// (62.9%). The latter is the variable-cost ratio; using it as the margin — as
// the source mockup did — reports a group in profit on a day it lost money. See
// docs/FORMULAS.md §15.
//
// Practices with no cost model ("Not set") and no cash-up feed ("Not reporting")
// show their state rather than £0, and are excluded from the Group row.
import { useState } from 'react';
import { Panel, PanelHead, th, td } from '@/features/intelligence/components/os-ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useCostModel, useSaveCostModel } from '../hooks';
import type { BreakevenRow, BreakevenStatus, CockpitResponse } from '../api';

const STATUS_LABEL: Record<BreakevenStatus, string> = {
  above: 'Above',
  below: 'Below',
  not_set: 'Not set',
  not_reporting: 'Not reporting',
};

function StatusPill({ status }: { status: BreakevenStatus }) {
  const tone =
    status === 'above'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'below'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-slate-100 text-slate-500';
  return <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{STATUS_LABEL[status]}</span>;
}

// "—" for anything we can't state. Never £0: a practice with no feed has not
// earned nothing, we simply cannot say.
const money = (v: number | null) => (v === null ? <span className="text-ink-muted">&mdash;</span> : formatPence(v));

function CostModelEditor({ row, onDone }: { row: BreakevenRow; onDone: () => void }) {
  const { data } = useCostModel();
  const save = useSaveCostModel();
  const current = data?.rows.find((r) => r.practiceId === row.practiceId);

  // Edit in whole pounds; convert to integer pence at the boundary.
  const [fixed, setFixed] = useState(() => (current?.fixedCostPenceMonth ?? 0) / 100 || '');
  const [low, setLow] = useState(() => (current?.breakevenLowPence ?? 0) / 100 || '');
  const [high, setHigh] = useState(() => (current?.breakevenHighPence ?? 0) / 100 || '');
  const [days, setDays] = useState(() => current?.workingDaysPerMonth ?? 20);

  const toPence = (v: string | number) => Math.round(Number(v) * 100);
  const invalid = low !== '' && high !== '' && Number(low) > Number(high);

  const submit = () => {
    if (invalid) return;
    save.mutate(
      {
        practiceId: row.practiceId,
        input: {
          fixedCostPenceMonth: fixed === '' ? null : toPence(fixed),
          breakevenLowPence: low === '' ? null : toPence(low),
          breakevenHighPence: high === '' ? null : toPence(high),
          workingDaysPerMonth: Number(days),
        },
      },
      { onSuccess: onDone },
    );
  };

  const field = 'w-32 rounded border border-slate-200 px-2 py-1 text-[13px] tabular-nums';

  return (
    <tr className="bg-slate-50">
      <td className={td} colSpan={7}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-slate-600">
            Fixed cost / month £<br />
            <input className={field} type="number" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-600">
            Breakeven revenue low £<br />
            <input className={field} type="number" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-600">
            Breakeven revenue high £<br />
            <input className={field} type="number" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-600">
            Working days / month<br />
            <input className={field} type="number" min={1} max={31} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={save.isPending || invalid}
            className="rounded bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onDone} className="text-[13px] text-slate-500 underline">
            Cancel
          </button>
        </div>
        {invalid ? (
          <p className="mt-2 text-xs text-danger">Breakeven low can&rsquo;t be higher than breakeven high.</p>
        ) : null}
        {save.isError ? <p className="mt-2 text-xs text-danger">Couldn&rsquo;t save. Owners only.</p> : null}
        <p className="mt-2 text-xs text-ink-muted">
          Saved against today, so past months keep the costs that were actually in force then.
        </p>
      </td>
    </tr>
  );
}

export function BreakevenSection({ data }: { data: CockpitResponse['breakeven'] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const g = data.group;

  return (
    <Panel>
      <PanelHead
        title="Profit vs breakeven"
        sub="Per practice: is the cash taken covering the cost of opening the doors? Contribution is revenue x the practice's contribution margin (fixed cost / breakeven revenue); fixed is charged for the days it actually traded."
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 760 }}>
          <thead>
            <tr className="border-b border-border">
              <th className={`${th} text-left`}>Practice</th>
              <th className={`${th} text-right`}>Revenue</th>
              <th className={`${th} text-right`}>Breakeven/day</th>
              <th className={`${th} text-right`}>Contribution</th>
              <th className={`${th} text-right`}>Fixed</th>
              <th className={`${th} text-right`}>Profit</th>
              <th className={`${th} text-left`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.practiceId} className="border-b border-border">
                <td className={td}>
                  <button type="button" className="text-left underline decoration-dotted" onClick={() => setEditing(editing === r.practiceId ? null : r.practiceId)}>
                    {r.name}
                  </button>
                  {r.status === 'not_reporting' ? (
                    <div className="text-[11px] text-ink-muted">Emergent isn&rsquo;t sending a business for this practice</div>
                  ) : null}
                  {r.status === 'not_set' ? (
                    <div className="text-[11px] text-ink-muted">No cost model &mdash; click to set one</div>
                  ) : null}
                </td>
                <td className={`${td} text-right tabular-nums`}>{money(r.revenuePence)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.breakevenDayPence)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.contributionPence)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.fixedPence)}</td>
                <td className={`${td} text-right tabular-nums ${r.profitPence !== null && r.profitPence < 0 ? 'text-danger' : ''}`}>
                  {money(r.profitPence)}
                </td>
                <td className={td}><StatusPill status={r.status} /></td>
              </tr>
            ))}
            {data.rows.map((r) => (editing === r.practiceId ? <CostModelEditor key={`${r.practiceId}-edit`} row={r} onDone={() => setEditing(null)} /> : null))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td className={td}>Group</td>
              <td className={`${td} text-right tabular-nums`}>{formatPence(g.revenuePence)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatPence(g.breakevenPence)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatPence(g.contributionPence)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatPence(g.fixedPence)}</td>
              <td className={`${td} text-right tabular-nums ${g.profitPence !== null && g.profitPence < 0 ? 'text-danger' : ''}`}>
                {money(g.profitPence)}
              </td>
              <td className={td}><StatusPill status={g.status} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {g.excludedCount > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          {formatNumber(g.excludedCount)} {g.excludedCount === 1 ? 'practice is' : 'practices are'} left out of the group
          row &mdash; no cost model set, or no cash-up feed. Counting them as £0 fixed cost would make the group look more
          profitable than it is.
        </p>
      ) : null}
    </Panel>
  );
}
```

- [ ] **Step 2: Wire it into the screen**

In `CockpitScreen.tsx`, import it and render after `<CashUpSection … />`:

```tsx
import { BreakevenSection } from './BreakevenSection';
```

```tsx
          <BreakevenSection data={data.breakeven} />
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/cockpit/components/BreakevenSection.tsx frontend/features/cockpit/components/CockpitScreen.tsx
git commit -m "feat(cockpit): Profit vs Breakeven section with per-practice cost model editor"
```

---

### Task 12: §1 — the four revenue cards and the editable Daily target

**Files:**
- Modify: `frontend/features/cockpit/components/CockpitScreen.tsx` (`RevenueSection`)

**Interfaces:**
- Consumes: `CockpitResponse['revenue']['month']`, `useSaveCostModel`, `useCostModel`, `useScopePeriod`.

- [ ] **Step 1: Add the target editor**

Add above `RevenueSection` in `CockpitScreen.tsx`:

```tsx
// The daily target is typed straight into the card. It is stored per practice
// (revenue_target_pence_month on practice_cost_model) and the group figure is the
// SUM of the practices, so the group can never disagree with its parts — which is
// why it's only editable when a single practice is in scope.
function DailyTargetCard({
  month,
  practiceId,
}: {
  month: CockpitResponse['revenue']['month'];
  practiceId?: string;
}) {
  const { data: cm } = useCostModel();
  const save = useSaveCostModel();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const row = practiceId ? cm?.rows.find((r) => r.practiceId === practiceId) : undefined;
  const workingDays = row?.workingDaysPerMonth ?? 20;

  const submit = () => {
    if (!practiceId) return;
    const dailyPounds = Number(draft);
    if (!Number.isFinite(dailyPounds) || dailyPounds < 0) return;
    // The card edits a DAILY figure; the model stores a MONTHLY target.
    save.mutate(
      { practiceId, input: { revenueTargetPenceMonth: Math.round(dailyPounds * 100) * workingDays } },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Daily target</div>
      {editing && practiceId ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            autoFocus
            type="number"
            className="w-28 rounded border border-slate-200 px-2 py-1 text-[15px] tabular-nums"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" onClick={submit} disabled={save.isPending} className="rounded bg-slate-900 px-2 py-1 text-[12px] text-white disabled:opacity-40">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-[12px] text-slate-500 underline">
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
          {month.dailyTargetPence === null ? <span className="text-slate-400">Not set</span> : formatPence(month.dailyTargetPence)}
        </div>
      )}

      {!editing ? (
        <div className="mt-0.5 text-[12px] text-slate-400">
          {practiceId ? (
            <button
              type="button"
              className="underline"
              onClick={() => {
                setDraft(month.dailyTargetPence !== null ? String(month.dailyTargetPence / 100) : '');
                setEditing(true);
              }}
            >
              {month.dailyTargetPence === null ? 'Set a target' : 'Edit'}
            </button>
          ) : (
            <>Sum of each practice&rsquo;s target. Pick a practice above to set one.</>
          )}
        </div>
      ) : (
        <div className="mt-0.5 text-[12px] text-slate-400">Daily figure, in £. Stored as {workingDays} working days a month.</div>
      )}
      {save.isError ? <div className="mt-1 text-[11px] text-danger">Couldn&rsquo;t save. Owners only.</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: Replace the single card with the four-card grid**

In `RevenueSection`, replace the lone `<KpiTile label="Cash taken (Emergent) in period" … />` with:

```tsx
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            label="Cash taken today"
            value={data.revenue.month.todayPence === null ? '—' : formatPence(data.revenue.month.todayPence)}
            delta={data.revenue.month.todayDate ? fmtDay(data.revenue.month.todayDate) : 'No cash-up yet this month'}
            info="The latest day Emergent has sent a cash-up for in this month. This card and the next three are anchored to the calendar month, not to the period you've selected — a month-to-date figure against an arbitrary window would be meaningless."
          />
          <KpiTile
            label={`Cash ${monthLabelShort(data.revenue.month.periodMonth)} to date`}
            value={formatPence(data.revenue.month.mtdPence)}
            delta={
              data.revenue.month.avgPerDayPence !== null
                ? `${formatNumber(data.revenue.month.workingDaysElapsed)} days traded · ${formatPence(data.revenue.month.avgPerDayPence)}/day`
                : 'No days traded yet'
            }
            info="Cash taken from the 1st of the month to now. 'Days traded' counts days a practice actually sent a cash-up, not calendar weekdays."
          />
          <KpiTile
            label="Projected month"
            value={data.revenue.month.projectedPence === null ? '—' : formatPence(data.revenue.month.projectedPence)}
            delta={data.revenue.month.projectedPence === null ? 'Nothing traded yet' : 'at current run-rate'}
            info="Each practice is projected on its own run-rate (month-to-date ÷ days traded × its working days per month) and the results are summed, so the group figure is always the sum of its parts."
          />
          <DailyTargetCard month={data.revenue.month} practiceId={practiceId} />
        </div>

        <KpiTile
          label="Cash taken (Emergent) in the selected period"
          value={formatPence(data.revenue.collectedPence)}
          onClick={onToggle}
          active={active}
        />
```

- [ ] **Step 3: Add the month-label helper and thread `practiceId`**

Add next to `periodMonthLabel`:

```tsx
function monthLabelShort(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}
```

`RevenueSection` currently takes `{ data, drill, onToggle }`. Add `practiceId?: string` to its props and pass it from `CockpitScreen`:

```tsx
<RevenueSection data={data} practiceId={practiceId} drill={drill} onToggle={() => toggle('revenue')} />
```

Add the imports `useCostModel`, `useSaveCostModel` to the existing `../hooks` import line.

- [ ] **Step 4: Typecheck, lint, build**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 5: Manual verification against the live app**

Start the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`), log in as `dev.ruhithpasha@gmail.com` (owner, Plan4growth), open `/cockpit`.

Confirm:
- §1 shows four cards; Daily target reads "Not set" with "Pick a practice above to set one" at All practices.
- Scope to Ashford → Daily target becomes editable; set 8000 → saves → card reads £8,000.00.
- Back to All practices → Daily target shows the sum of the practice targets, read-only.
- §6 lists five practices; Warwick Lodge reads "Not reporting" with dashes, **not £0.00**.
- Practices with no cost model read "Not set"; the group row's footnote counts them.
- Set Ashford's model (fixed 31000, low 81000, high 86000, days 20) → its breakeven/day reads **£4,175.00** (not £2,464).

- [ ] **Step 6: Commit**

```bash
git add frontend/features/cockpit/components/CockpitScreen.tsx
git commit -m "feat(cockpit): four revenue cards + inline-editable daily target"
```

---

## Self-review notes

**Spec coverage.** §1 → Tasks 9, 12. §2 → Task 2. §3 → **Phase C, separate plan** (deliberate). §4 → already matches, no task. §5 → Task 3. §6 → Tasks 5, 6, 7, 8, 9, 11. §7 → Task 4. Phase 0 → Task 1. Formula correction → Task 6. `practice_cost_model` → Task 5. Owner-only writes → Task 8.

**Known deviation from the spec's illustrative table.** The spec quotes Ashford at £268 using a rounded 0.371 margin; exact arithmetic gives £269.16. Task 6's tests assert the exact values. This is not a bug.

**Dependency fixed.** The spec's phase order put §1's cards (Phase A) before the migration (Phase B), but "Projected month" needs `working_days_per_month` from `practice_cost_model`. The migration is therefore Task 5, ahead of the §1 work in Task 12. Tasks 2–4 remain migration-free.

**Follow-on work, not in this plan:**
- Phase C — ad-account→practice mapping UI and per-practice spend/CPL/ROAS.
- Owner actions — configure an Emergent business for Warwick Lodge; reconnect the three failed GoHighLevel subaccounts; consolidate the ad connector into one org.
- Open questions in the spec — which practice owns the £94,585.84 Meta account; the real per-practice daily targets.

# Daily Command Cockpit v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A live Daily Command Cockpit page reading the now-ingested Emergent + GHL data, whose centrepiece is a per-practice × channel **Google/Facebook lead comparison** (leads → Emergent conversions → spend → CPL/conv%/ROI).

**Architecture:** No migration (v1). Backend: a `lead-attribution.service` classifies GHL leads by their pipeline name (`Facebook/Google Ads Leads`) → channel, matches them to Emergent `treatment_accepted` conversions by phone/email, and joins ad spend from `ad_metrics`; a `cockpit.service` assembles all sections for a `{since, until}` window from `emergent_daily_cashup` / `emergent_monthly_pl` / the attribution service; exposed at `GET /api/cockpit`. Frontend: a light-themed page under `(dashboard)/cockpit` following the `features/ghl/` slice pattern + `ScopePeriodBar`.

**Tech Stack:** Node ESM backend, vitest; Next 14 App Router, React Query, Tailwind. Money = integer pence.

## Global Constraints

- Native ESM (`import`/`export`, `.js` suffixes, no `require`). (CLAUDE.md)
- Money is integer pence; display via `formatPence` (`frontend/lib/format.ts`). (rule 2)
- Tenant isolation: repos use `serviceClient` + explicit `.eq('organisation_id', orgId)`. (rule 3)
- Light theme only; British English. (rules 1, 4)
- Window: `{since, until}` are ISO strings, `until` EXCLUSIVE (London-local day bounds), from `useScopePeriod().win`. Leads/treatments date fields: `leads.created_at` (timestamptz), `treatment_accepted.accepted_date` (date), `emergent_daily_cashup.cashup_date` (date), `ad_metrics.metric_date` (date → `YYYY-MM-DD`).
- Channel classification regex: name matches `/facebook|\bfb\b/i` → `facebook`; `/google/i` → `google`; else `null` (excluded).
- GM org for verification: `1a5f888a-0dfe-4802-acf8-6003665089ad`. 4 dental subaccounts have `1./2. Facebook Ads Leads` + `1./2. Google Ads Leads` pipelines (naming varies).
- Commit after each task; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Tests: `cd backend && npx vitest run <file>`.

## File Structure

- `backend/src/repositories/cockpit.repository.js` — **create**: windowed reads for ad-leads (leads⋈contacts), pipeline→channel source, treatment_accepted match rows, ad spend by provider, emergent cash-up/PL rollups.
- `backend/src/services/lead-attribution.service.js` — **create**: channel classification + lead↔conversion match + per-channel/practice metrics.
- `backend/src/services/cockpit.service.js` — **create**: assemble all sections for `{since, until}` + calendar-month block.
- `backend/src/controllers/cockpit.controller.js` — **create**: parse query, delegate.
- `backend/src/routes/cockpit.routes.js` — **create**: `GET /api/cockpit`; wire in `src/app.js`.
- `backend/src/models/cockpit.model.js` — **create**: Zod `cockpitQuerySchema` (`since?, until?, scope?`).
- `backend/test/lead-attribution.test.mjs`, `backend/test/cockpit-service.test.mjs` — **create**.
- `frontend/features/cockpit/{api.ts,hooks.ts,components/CockpitScreen.tsx,components/LeadComparison.tsx}` — **create**.
- `frontend/app/(dashboard)/cockpit/page.tsx` — **create** (re-export).
- `frontend/lib/nav.ts` — **modify**: add `{ id: 'cockpit', label: 'Daily Cockpit', isNew: true }`.

---

### Task 1: Lead-attribution service (channel classification + conversion match)

**Files:**
- Create: `backend/src/repositories/cockpit.repository.js`
- Create: `backend/src/services/lead-attribution.service.js`
- Test: `backend/test/lead-attribution.test.mjs`

**Interfaces:**
- Produces: `classifyChannel(pipelineName): 'google'|'facebook'|null`.
- Produces: `leadAttributionService.channelBreakdown(orgId, { since, until }): Promise<{ channels: Array<{ practiceId, practiceName, channel, leads, conversions, matchedValuePence }>, spendByChannel: { google, facebook }, group: { google:{leads,conversions,matchedValuePence,spendPence}, facebook:{...} } }>`.
- Consumes: repo methods below.

**Repo methods (`cockpit.repository.js`)** — all `serviceClient` + `.eq('organisation_id', orgId)`:
- `pipelineChannelMap(orgId)` → reads `integration_accounts` (provider `gohighlevel`), flattens `config.pipelines` to `[{ pipeline_id, name, practice_id }]` (practice_id from the account row). Returns array.
- `adLeadsInWindow(orgId, sinceISO, untilISO)` → `leads` join `contacts`: select `l.id, l.ghl_pipeline_id, l.practice_id, l.integration_account_id, l.created_at, c.phone, c.email` where `l.created_at >= since and < until` and `l.ghl_pipeline_id is not null`. (Use `.select('id, ghl_pipeline_id, practice_id, integration_account_id, created_at, contacts(phone,email)')` PostgREST embed.)
- `acceptedContactsInWindow(orgId, sinceISO, untilISO)` → `treatment_accepted` select `practice_id, value_pence, phone, email, raw, accepted_date` where `accepted_date >= since::date and <= until::date` and `status='accepted'`. (phone/email may be null on older rows → coalesce with `raw->>'phone'` / `raw->>'email'` in JS.)
- `adSpendByProvider(orgId, fromDate, toDate)` → `ad_metrics` group by provider: return `{ google_ads: sumSpendPence, meta_ads: sumSpendPence }` (read rows, sum in JS; dates `YYYY-MM-DD`).

**Matching logic (service):** normalise phone = digits-only last 10; email = lowercased trim. Build a Set of accepted-contact keys (phone + email) → value. A lead converts if its contact phone or email is in the accepted set; matchedValue += that accepted value (first match). Group leads by `practiceId` (from account map or lead.practice_id) × channel.

- [ ] **Step 1: Write the failing test** (pure classifier + a matching unit with injected rows)

```javascript
// backend/test/lead-attribution.test.mjs
import { describe, it, expect } from 'vitest';
const { classifyChannel, matchBreakdown } = await import('../src/services/lead-attribution.service.js');

describe('classifyChannel', () => {
  it('maps facebook/google pipeline names, else null', () => {
    expect(classifyChannel('1. Facebook Ads Leads')).toBe('facebook');
    expect(classifyChannel('2. Google Ads Leads')).toBe('google');
    expect(classifyChannel('Fts Google ads marketing pipeline')).toBe('google');
    expect(classifyChannel('Dental Patient Pipeline')).toBeNull();
  });
});

describe('matchBreakdown (pure)', () => {
  const pipes = [
    { pipeline_id: 'fb1', name: '1. Facebook Ads Leads', practice_id: 'P1' },
    { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1' },
  ];
  const leads = [
    { id: 'l1', ghl_pipeline_id: 'fb1', practice_id: 'P1', contacts: { phone: '07700 900 111', email: 'a@b.com' } },
    { id: 'l2', ghl_pipeline_id: 'fb1', practice_id: 'P1', contacts: { phone: '07700 900 222', email: 'x@y.com' } },
    { id: 'l3', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: { phone: null, email: 'g@lead.com' } },
  ];
  const accepted = [
    { practice_id: 'P1', value_pence: 450000, phone: '+44 7700 900111', email: null, raw: {} },
    { practice_id: 'P1', value_pence: 120000, phone: null, email: 'G@LEAD.com', raw: {} },
  ];
  it('counts leads + matched conversions per practice/channel by phone or email', () => {
    const r = matchBreakdown(pipes, leads, accepted);
    const fb = r.channels.find((c) => c.channel === 'facebook');
    const g = r.channels.find((c) => c.channel === 'google');
    expect(fb.leads).toBe(2);
    expect(fb.conversions).toBe(1);          // l1 matched by phone (last-10 digits)
    expect(fb.matchedValuePence).toBe(450000);
    expect(g.leads).toBe(1);
    expect(g.conversions).toBe(1);           // l3 matched by email (case-insensitive)
    expect(g.matchedValuePence).toBe(120000);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && npx vitest run test/lead-attribution.test.mjs` → FAIL (functions undefined).

- [ ] **Step 3: Implement** `cockpit.repository.js` (the 4 reads above, following `analytics.repository.js` style) and `lead-attribution.service.js` exporting `classifyChannel`, a pure `matchBreakdown(pipes, leads, accepted)`, and `channelBreakdown(orgId, {since,until})` that loads via the repo then calls `matchBreakdown` + attaches `spendByChannel`. Normalisation helpers: `normPhone = s => (String(s||'').replace(/\D/g,'').slice(-10) || null)`, `normEmail = s => (String(s||'').trim().toLowerCase() || null)`. Accepted key set built from both phone and email (coalesce column then `raw`). Group total sums per channel + spend (`google` ← `ad_metrics.google_ads`, `facebook` ← `meta_ads`).

- [ ] **Step 4: Run to verify it passes** — same command → PASS. Then full suite: `npx vitest run` → only the 6 known pre-existing files fail.

- [ ] **Step 5: Commit** `feat(cockpit): lead-attribution service — GHL pipeline→channel + Emergent conversion match`.

---

### Task 2: Cockpit service + endpoint

**Files:**
- Create: `backend/src/services/cockpit.service.js`, `backend/src/controllers/cockpit.controller.js`, `backend/src/routes/cockpit.routes.js`, `backend/src/models/cockpit.model.js`
- Modify: `backend/src/app.js` (mount route)
- Test: `backend/test/cockpit-service.test.mjs`

**Interfaces:**
- Produces: `cockpitService.build(orgId, { since, until }): Promise<CockpitPayload>` and `GET /api/cockpit?since&until` (gated `requirePermission('finance.view')`, same as business-hub).
- `CockpitPayload` shape:
```js
{
  window: { since, until },
  revenue: { collectedPence, byPractice: [{ practiceId, name, collectedPence }] },   // from emergent_daily_cashup.cash_up_money_taken_pence
  treatment: { acceptedCount, acceptedValuePence, txPlansGiven, txPlanValuePence, newLeads, attended, byPractice:[...] },
  leadRoi: <channelBreakdown output>,                                                 // Task 1
  cashUp: { collectedPence, detailPence, variancePence, byPractice:[...] },
  monthly: { periodMonth, revenuePence, netProfitPence, byBusiness:[...] },           // emergent_monthly_pl (current calendar month)
  updatedAt,
}
```

**Repo additions (`cockpit.repository.js`):** `cashupRollup(orgId, since, until)` (sum cash_up_money_taken_pence, treatments_accepted, tx_plans_given, tx_plan_given_value_pence, num_new_leads, num_attended, detail_patient_money_total_pence, group by practice_id + business_name) and `monthlyPl(orgId, monthStart)` (rows for the calendar month). Reuse `emergentDailyCashupRepository`/`emergentMonthlyPlRepository.listByOrg` where possible.

- [ ] **Step 1: Write the failing test** — assemble from injected repo doubles, assert pence sums + that `leadRoi` is threaded through and money stays integer. (Mock the repo module + `lead-attribution.service`; assert `build()` shape and a revenue sum.)

```javascript
// backend/test/cockpit-service.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: { channelBreakdown: vi.fn(async () => ({ channels: [], spendByChannel: { google: 0, facebook: 0 }, group: {} })) },
  classifyChannel: () => null,
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => [{ practice_id: 'P1', business_name: 'Ashford', cash_up_money_taken_pence: 185000, treatments_accepted: 2, tx_plans_given: 3, tx_plan_given_value_pence: 1200000, num_new_leads: 9, num_attended: 8, detail_patient_money_total_pence: 450000 }]),
    monthlyPl: vi.fn(async () => [{ business_name: 'Ashford', revenue_pence: 9500000, net_profit_pence: 2122000 }]),
  },
}));
let cockpitService;
beforeEach(async () => { vi.clearAllMocks(); ({ cockpitService } = await import('../src/services/cockpit.service.js')); });
it('sums revenue from cash-up and threads leadRoi', async () => {
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.revenue.collectedPence).toBe(185000);
  expect(r.monthly.revenuePence).toBe(9500000);
  expect(r.leadRoi).toBeDefined();
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** the service (assemble from repo + attribution), controller (parse `cockpitQuerySchema`, `req.user.organisation_id`), route (`router.get('/', fin, asyncHandler(cockpitController.cockpit))`), model (Zod), and mount in `app.js` under `/api/cockpit` (follow how `analytics.routes` is mounted). Money stays integer pence; use `const num = v => Number(v||0)`.
- [ ] **Step 4: Run to verify it passes** → PASS; full suite → only 6 pre-existing failures.
- [ ] **Step 5: Commit** `feat(cockpit): /api/cockpit aggregation endpoint`.

---

### Task 3: Frontend cockpit page (verified live)

**Files:**
- Create: `frontend/features/cockpit/api.ts`, `hooks.ts`, `components/CockpitScreen.tsx`, `components/LeadComparison.tsx`
- Create: `frontend/app/(dashboard)/cockpit/page.tsx`
- Modify: `frontend/lib/nav.ts`

**Interfaces:**
- Consumes: `GET /api/backend/cockpit?since&until` via `api<T>()`; `useScopePeriod().win`.

- [ ] **Step 1: api + hooks** — `fetchCockpit({since,until})` builds `URLSearchParams` and calls `api<CockpitResponse>('/api/backend/cockpit?...')` (mirror `features/ghl/api.ts`). `useCockpit(win)` React Query hook keyed on `['cockpit', since, until]`, `staleTime: 30_000`. Type `CockpitResponse` mirrors the Task 2 payload.

- [ ] **Step 2: CockpitScreen** (`'use client'`, default export) — reads `useScopePeriod().win`, calls `useCockpit`, renders `<ScopePeriodBar />` + loading/error/empty branches + sections: Revenue, Treatment & Close, `<LeadComparison data={data.leadRoi} />`, Cash Up, Monthly. Light theme (white cards, `border`, no dark classes). Money via `formatPence`. British English labels.

- [ ] **Step 3: LeadComparison** — a table: rows = practice × channel (Google/Facebook), columns = Leads, Conversions, Conv %, Ad spend, CPL, ROI (spend shown at group level with a footnote that per-practice spend isn't attributable). Group total row.

- [ ] **Step 4: page + nav** — `app/(dashboard)/cockpit/page.tsx`: `export { default } from '@/features/cockpit/components/CockpitScreen';`. Add nav item `{ id: 'cockpit', label: 'Daily Cockpit', isNew: true }` to the Overview section in `lib/nav.ts` (route resolves to `/cockpit` automatically).

- [ ] **Step 5: Verify live** — dev servers are running (`:3000`/`:8080`). Load `http://localhost:3000/cockpit` (logged in as owner), confirm the page renders with real numbers and the lead-comparison table shows Google/Facebook leads + conversions. Run `cd frontend && npm run typecheck && npm run lint`. Fix any type/lint errors.

- [ ] **Step 6: Commit** `feat(cockpit): Daily Command Cockpit page + lead comparison (v1)`.

---

## Deferred to Phase B (not this plan)
Businesses grouping table + owner setup; per-business £/day targets (Revenue-vs-target section shows revenue only for now); breakeven config + 3-way toggle (Profit section uses Emergent monthly P&L net_profit); editable pipeline→channel map UI (v1 auto-classifies by name); the 09:30 email digest; deeper `full` GHL backfill.

## Self-review notes
- treatment_accepted phone/email exist as columns (migration 000110) but are null on pre-enrichment rows → always coalesce with `raw->>'phone'`/`raw->>'email'`.
- Emergent `source` on conversions could tighten matching (require source==channel), but v1 matches on phone/email only to maximise recall; note this in the service comment.
- Revenue "collected" here = Emergent till cash-up (`cash_up_money_taken_pence`), not settled receipts — label it "Cash taken (Emergent)" to stay honest.

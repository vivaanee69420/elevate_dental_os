# Tabbed Ad Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Facebook page with three tabs and one Google page with four tabs, over shared table and tab components, so every ad grain the deep-grain sync collects is readable in the shape the owner asked for.

**Architecture:** The backend already returns every grain — `ad_grain_rollup` and `ad_keyword_rollup` (migration `000148`) and `ad_meta_funnel` (`000156`) are applied on hosted. Facebook's service exists and its logic is correct; only the parent-id argument's optionality and the route shape change. Google needs a new read service over the same rollups. The frontend replaces a two-route drill-down with one tabbed page per platform, over extracted shared components.

**Tech Stack:** Native-ESM Node backend, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-tabbed-ad-reporting-design.md`

## Global Constraints

- **MULTI-TENANT — the org id comes ONLY from `req.user.organisation_id`.** Never a query parameter, never a body field. Under an agency switch that value is already the sub-account's.
- **`serviceClient` bypasses RLS**, so the explicit `organisation_id` / `p_org` filter IS the tenant boundary.
- **No lead is identified by a CRM's own vocabulary.** Structural tests only — never `attribution_source = 'Paid Social'` or any label another tenant may name differently.
- **Costs are `null` on a zero denominator, never `0`.** A cost per nothing is unknowable, not free. `formatPence` accepts null and renders `£0.00`, so every nullable money cell needs a guard — which is exactly why the formatters are shared.
- **Paged reads: order on a unique key, `.range()`, and STOP ON AN EMPTY PAGE, NEVER A SHORT ONE.** PostgREST caps responses at 1000 rows and that applies to set-returning RPCs identically. Tests assert READ COUNT, not row total — a row total cannot tell a correct pager from one that stops on a short page.
- **PostgREST aggregate-select is DISABLED on this project** (`PGRST123`). Aggregate in SQL via an RPC, never `col.count()` in a select.
- **The window is clamped to the deep tables' 92-day floor**, with `effectiveSince`/`windowClamped` returned and surfaced, never clamped silently.
- **Tenant states are computed per tenant and displayed, never assumed:** `not_connected`, `never_synced`, `no_spend_in_window`, `no_ad_id_coverage`, `ok`. A tab showing an empty table must say why.
- Gating: `requirePermission('marketing.view')` on every route; `ROUTE_PERMISSION` entries in `frontend/lib/permissions.ts` **and** matching entries in `backend/src/lib/permissions.js` `PAGE_SECTION` — a page registered on only one side falls back to its section grant and silently ignores a per-page override. Reception stays out per project rule 5.
- **NO DARK MODE** (rule 1). **BRITISH ENGLISH** in all UI copy (rule 4). **No emojis** (rule 7).
- Native ESM: `import`/`export`, `.js` extensions on relative imports, never `require`/`module.exports`.
- **No migration in this plan.** Every RPC it needs is already applied on hosted.

---

### Task 1: Shared tab and table components

**Files:**
- Create: `frontend/features/marketing/_shared/AdReportTabs.tsx`
- Create: `frontend/features/marketing/_shared/AdMetricTable.tsx`
- Create: `frontend/features/marketing/_shared/format.ts`
- Test: none (frontend has no test framework — correctness is proven by the typecheck and by Tasks 3 and 5 consuming these)

**Interfaces:**
- Produces `AdReportTabs({ tabs, active, onChange })` — a tab strip whose active tab lives in the URL query (`?tab=`), so a view is shareable and the back button works.
- Produces `AdMetricTable({ columns, rows, emptyState, onRowClick })` — the table shell: sticky header, its OWN `overflow-x-auto` container so the page body never scrolls horizontally, and the em-dash contract applied centrally.
- Produces `money(pence: number | null)`, `ctr(fraction: number | null)`, `num(n: number | null)`, `DASH` — the cell formatters.

- [ ] **Step 1: Read the conventions before writing**

- `cat frontend/features/marketing/components/*.tsx | head -120` — the existing marketing screens' idiom.
- `cat frontend/tailwind.config.ts` — the REAL tokens (`ink`, `ink-muted`, `border`, `surface`, `bg`, `brand`, `success`, `danger`, `warning`, `rounded-panel`). A previous plan in this repo invented `slate`/`emerald` classes that do not exist here and every one had to be corrected.
- `grep -n "useState" frontend/features/*/components/TaskManagerScreen.tsx` — how a screen currently rolls its own tabs. There is no `Tabs` primitive in `components/ui`; this task creates the first shared one, scoped to marketing.
- `cat frontend/lib/format.ts` — `formatPence`'s real signature.

- [ ] **Step 2: Write `format.ts`**

```ts
import { formatPence } from '@/lib/format';

export const DASH = '—';

// A cost per nothing is unknowable, not free. formatPence accepts null and
// returns £0.00, so TypeScript never warns — the guard has to be here, and
// being here once is the whole reason this file exists.
export const money = (pence: number | null | undefined): string =>
  pence === null || pence === undefined ? DASH : formatPence(pence);

// CTR arrives as a raw 0-1 fraction from the rollups. Scale it exactly once,
// here, so two pages cannot disagree about whether 0.0312 is 3.12% or 0.03%.
export const ctr = (fraction: number | null | undefined): string =>
  fraction === null || fraction === undefined ? DASH : `${(fraction * 100).toFixed(2)}%`;

export const num = (n: number | null | undefined): string =>
  n === null || n === undefined ? DASH : n.toLocaleString('en-GB');
```

- [ ] **Step 3: Write `AdReportTabs.tsx`**

A button row. The active tab is read from and written to the URL via `useRouter`/`useSearchParams` (`?tab=<id>`), defaulting to the first tab when absent or unrecognised. Style it with the real tokens; the active tab is visually distinct without colour alone carrying the meaning.

- [ ] **Step 4: Write `AdMetricTable.tsx`**

```tsx
export type Column<R> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: R) => React.ReactNode;
};
```

The shell renders `<div style={{ overflowX: 'auto' }}>` around the table so wide content scrolls inside its own container — the page body must never scroll horizontally. A sticky header. When `rows` is empty it renders `emptyState` (a node the caller supplies, because "no rows" means something different per tenant state) instead of an empty table.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both clean. Nothing consumes these yet; that is expected.

```bash
git add frontend/features/marketing/_shared
git commit -m "feat(marketing): shared tab strip, metric table and cell formatters

Seven tables across two ad-reporting pages is past the point where the
per-file formatter convention holds: one copy is a helper, seven copies is a
liability. Particularly for the em-dash rule, where a single missed guard
renders a confident £0.00 for a cost that is genuinely unknowable.

CTR is scaled exactly once, here, so two pages cannot disagree about whether
0.0312 means 3.12% or 0.03%."
```

---

### Task 2: Facebook backend — parent id becomes an optional filter

**Files:**
- Modify: `backend/src/services/facebook-report.service.js`
- Modify: `backend/src/controllers/marketing.controller.js` (or wherever the Facebook endpoints live — `grep -rn "facebookReportService" backend/src`)
- Modify: `backend/src/routes/marketing.routes.js`
- Test: `backend/test/facebook-report.service.test.mjs`

**Interfaces:**
- Consumes: `adGrainRepository.rollup(orgId, grain, { since, until, practiceId, campaignId, parentId })` — `filterParams` ALREADY defaults `campaignId` and `parentId` to null, so unfiltered listing needs no repository change. Verify that before writing code.
- Produces: `facebookReportService.adSets(orgId, { since, until, practiceId, campaignId })` and `.ads(orgId, { since, until, practiceId, adSetId, cursor })` — parent id moves from a required positional argument into the options object, optional.

- [ ] **Step 1: Write the failing tests**

The case that does not exist today is the UNFILTERED one — these methods only ever ran inside a drill-down. Cover:
- `adSets` with no `campaignId` returns every ad set in the window, across campaigns.
- `adSets` with a `campaignId` returns only that campaign's — the existing behaviour, unchanged.
- Same pair for `ads` with and without `adSetId`.
- The org id is never taken from a request parameter.
- Cross-org isolation: another org's ad sets never appear.
- Costs are `null`, not `0`, on a zero denominator.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/facebook-report.service.test.mjs`

- [ ] **Step 3: Change the signatures and the routes**

Move the parent id into the options object in both methods. Everything else in these methods — the funnel join, the structural Meta test, `clampWindow`, `funnelUntil`, `collapseByCampaign`, `perUnitPence`, the four states, `unmatchedLeads`/`notIdentified` — is REVIEWED AND CORRECT. Do not restructure it.

Routes become query-parameter filters rather than nested paths:
```javascript
router.get('/facebook/campaigns', requirePermission('marketing.view'), asyncHandler(c.facebookCampaigns));
router.get('/facebook/ad-sets',   requirePermission('marketing.view'), asyncHandler(c.facebookAdSets));   // ?campaignId=
router.get('/facebook/ads',       requirePermission('marketing.view'), asyncHandler(c.facebookAds));      // ?adSetId=
```
Widen the Zod query schema to accept the optional filter, keeping the existing `since > until` refinement (an inverted range previously reached the repository unfiltered, matched nothing, and reported `never_synced` to a fully synced tenant).

- [ ] **Step 4: Run the tests and the full suite**

Run: `cd backend && npx vitest run test/facebook-report.service.test.mjs && npm test && npm run lint`
Report the totals.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/facebook-report.service.js backend/src/controllers backend/src/routes backend/test/facebook-report.service.test.mjs
git commit -m "feat(marketing): Facebook grains list unfiltered, parent id becomes a filter

adSets and ads took their parent id as a required positional argument because
they only ever ran inside a drill-down. A standalone tab must list every ad
set, or every ad, across the whole window.

The aggregation, the structural Meta identification, the window clamp and the
practice scoping are untouched — only the argument's optionality and the route
shape move."
```

---

### Task 3: Facebook frontend — one page, three tabs

**Files:**
- Modify: `frontend/app/(dashboard)/marketing-facebook/page.tsx`
- Delete: `frontend/app/(dashboard)/marketing-facebook/[campaignId]/` (the whole route)
- Modify: `frontend/features/marketing/facebook-api.ts` and its hooks (find them: `grep -rn "marketing-facebook\|facebookReport" frontend/features`)
- Modify/replace: the two existing Facebook screen components

**Interfaces:**
- Consumes Task 1's `AdReportTabs`, `AdMetricTable`, `money`/`ctr`/`num`/`DASH`, and Task 2's three endpoints.

- [ ] **Step 1: Read what exists before deleting anything**

`cat` both current Facebook screens. Everything they render that is still true must survive: the four tenant states with their own copy, the clamped-window notice, `unmatchedLeads` and `notIdentified` (which carry leads but never spend, and render only when non-empty), and the em-dash on every null cost.

- [ ] **Step 2: Build the tabbed page**

Tabs **Campaigns**, **Ad sets**, **Ads**. Columns per tab: name, spend, impressions, clicks, CTR, CPC, leads, booked, attended, patients, CPL, CPB, CPA.

Still binding: `attended` is Dentally-only and labelled as such. No platform-conversions column at ad set or ad grain — Meta's `actions` are not requested at those grains and the column would be a permanent zero.

**The filter chain:** clicking a campaign row filters the Ad sets tab and switches to it; clicking an ad set row filters Ads and switches to it. The active filter renders as a dismissible chip naming what is being filtered by, and lives in the URL beside the active tab. A tab that cannot honour the current filter clears it rather than silently ignoring it.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
`npm run build` may exit 1 on `/(auth)/forgot-password` when Supabase env vars are absent — confirm that is the ONLY failing page.

Confirm the deleted `[campaignId]` route leaves no dangling import and no dead nav entry.

- [ ] **Step 4: Commit**

```bash
git add -u frontend && git add frontend/app/\(dashboard\)/marketing-facebook
git commit -m "feat(marketing): Facebook reporting as one page with three tabs

Replaces the two-route drill-down. The owner asked for tabs, and shipping the
drill-down would have left two ad-reporting pages with different interaction
models.

Every statement the drill-down made survives: the four tenant states keep
their own copy, the clamped window is surfaced rather than applied silently,
and unmatched leads still carry leads without spend."
```

---

### Task 4: Google backend — read service over the same rollups

**Files:**
- Create: `backend/src/services/google-report.service.js`
- Modify: `backend/src/controllers/marketing.controller.js`
- Modify: `backend/src/routes/marketing.routes.js`
- Modify: `backend/src/models/marketing.model.js` (Zod query schema)
- Test: `backend/test/google-report.service.test.mjs`

**Interfaces:**
- Consumes: `adGrainRepository.rollup(orgId, 'google_adgroups'|'google_ads', …)` and `.keywordRollup(orgId, …)`; `marketingRepository.campaignSpendByProvider(orgId, since, until, 'google_ads', customerIds, practiceId)`.
- Produces: `googleReportService.campaigns/adGroups/ads/keywords(orgId, { since, until, practiceId, campaignId, parentId, cursor })` and four endpoints under `/api/marketing/google/*`.

- [ ] **Step 1: Write the failing tests**

- Each method returns rows with the parent filter ABSENT and PRESENT.
- **Google's `conversions` and cost-per-conversion ARE present** at every grain — `google-ads-deep-sync.js` requests `metrics.conversions` on all three streams and both rollups return them. This is the deliberate difference from Facebook, and a test pins it.
- Keywords carry match type, Quality Score and the three impression-share figures.
- Cost per conversion is `null`, not `0`, when conversions are zero.
- The org id never arrives from a request parameter; cross-org isolation holds.
- Paged reads assert READ COUNT.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/google-report.service.test.mjs`

- [ ] **Step 3: Implement**

Mirror `facebook-report.service.js`'s structure — the same `clampWindow` against `DEEP_WINDOW_DAYS`, the same four tenant states computed from this tenant's own rows, the same `perUnitPence` returning `null` on a zero denominator. Read it first and follow it; do not invent a second shape.

Two figures need their approximation stated in the response so the UI can print it, because saying so is the point:
- **Impression share is an impression-weighted average** over the days in the window, with the denominator filtered to days Google actually reported a share. Google computes its own range figure from eligible impressions, which the API does not expose, so ours can differ slightly. Spend, clicks and conversions are exact.
- **Quality Score is the latest value in the window**, not an average — it is a 1-10 grade, and averaging grades is meaningless.

**No CPL/CPB/CPA on any Google tab in this plan.** Those need the CallRail-and-GoHighLevel dedup, which is its own plan. Do not add the columns blank — an empty column is worse than an absent one, the same reason Reach was removed from the Facebook page.

- [ ] **Step 4: Run the tests and the full suite; commit**

```bash
git add backend/src/services/google-report.service.js backend/src/controllers backend/src/routes backend/src/models backend/test/google-report.service.test.mjs
git commit -m "feat(marketing): Google reporting service at four grains

Campaign, ad group, ad and keyword. Ads and keywords are SIBLINGS under an ad
group in Google's hierarchy — neither contains the other, so neither is
nested inside the other's view.

Google reports conversions at every grain where Meta does not, so these tabs
carry a real cost per conversion from Google's own tracking. Impression share
is an impression-weighted average and Quality Score is the latest value in the
window, both stated rather than presented as exact."
```

---

### Task 5: Google frontend — one page, four tabs

**Files:**
- Create: `frontend/app/(dashboard)/marketing-google/page.tsx`
- Create: `frontend/features/marketing/components/GoogleReportScreen.tsx`
- Modify: `frontend/features/marketing/` api + hooks files (match how Facebook's are organised — do NOT create per-provider files if the directory shares one)
- Modify: `frontend/lib/nav.ts`, `frontend/lib/permissions.ts`
- Modify: `backend/src/lib/permissions.js`

**Interfaces:**
- Consumes Task 1's shared components and Task 4's four endpoints.

- [ ] **Step 1: Register the page on BOTH sides**

`ROUTE_PERMISSION['marketing-google'] = 'marketing.view'` in `frontend/lib/permissions.ts`, a nav entry in `frontend/lib/nav.ts` under Marketing beside Facebook, **and** `'marketing-google': 'marketing.view'` in `backend/src/lib/permissions.js` `PAGE_SECTION`.

Both sides are required. `backend/test/page-permissions.test.mjs` cross-checks them and will fail otherwise — and the failure it guards is silent: a page the backend does not know about falls back to its section grant and ignores a per-page override without erroring, so a page-level grant would look applied and do nothing.

- [ ] **Step 2: Build the four-tab page**

Tabs **Campaigns**, **Ad groups**, **Ads**, **Keywords**. Columns: name, spend, impressions, clicks, CTR, CPC, conversions, cost per conversion. Keywords additionally: match type, Quality Score, and the three impression-share figures.

Print the two approximation statements from Task 4 where the figures they describe appear, not buried in a footer.

Filter chain: campaign → Ad groups; ad group → Ads, and the same ad-group filter applies to Keywords.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`, then `cd ../backend && npx vitest run test/page-permissions.test.mjs`.

- [ ] **Step 4: Commit**

```bash
git add frontend backend/src/lib/permissions.js
git commit -m "feat(marketing): Google reporting page with four tabs

Campaigns, ad groups, ads and keywords. Four rather than three because ads and
keywords are siblings under an ad group, not nested.

Registered in both permission maps: a page known to only one side falls back to
its section grant and ignores a per-page override without erroring."
```

---

### Task 6: Docs, gates and the state log

**Files:**
- Modify: `docs/API.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run every gate and report each verbatim**

```
cd backend  && npm test
cd backend  && npm run lint
cd backend  && npm run typecheck
cd frontend && npm run typecheck
cd frontend && npm run lint
cd frontend && npm run build
ggshield secret scan commit-range origin/main..HEAD
```
`npm run build` may exit 1 on `/(auth)/forgot-password` only. Confirm no OTHER page fails.

- [ ] **Step 2: Document the endpoints in `docs/API.md`**

All seven: three Facebook, four Google. State that the organisation comes from the session and is never accepted as a parameter, that the parent id is an optional filter rather than a path segment, and that Google carries conversions where Facebook deliberately does not.

- [ ] **Step 3: Add ONE bullet to `CLAUDE.md`'s "Current state"**

Read two neighbouring bullets and match their density. Record: both routes and their tabs; that no migration was needed because `000148` and `000156` were already applied; that Google reports conversions at every grain and Meta does not, so the pages differ on purpose; that impression share is an impression-weighted average and Quality Score the latest value; and that CPL/CPB/CPA are deliberately absent from Google pending the CallRail dedup plan.

- [ ] **Step 4: Commit**

```bash
git add docs/API.md CLAUDE.md
git commit -m "docs(marketing): document the tabbed ad reporting endpoints"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Shared `AdReportTabs`, `AdMetricTable`, formatters in `features/marketing/_shared/` | 1 |
| Parent id becomes an optional filter; routes take query params | 2 |
| Facebook: one page, three tabs | 3 |
| Google: four grains, conversions at every grain | 4 |
| Google: one page, four tabs; keywords carry match type, QS, impression share | 5 |
| Filter chain with a dismissible chip, in the URL | 3, 5 |
| Impression share and Quality Score stated as approximations | 4, 5 |
| No CPL/CPB/CPA on Google | 4 (explicitly deferred) |
| Four tenant states, per tab, with their own copy | 3, 5 |
| `requirePermission('marketing.view')` + both permission maps | 2, 4, 5 |
| Window clamped to 92 days, surfaced not silent | 2, 4 |

**Deliberately out of scope:** the Google lead-conversions tab (CPL/CPB/CPA against Dentally, with CallRail and GoHighLevel deduplicated to one person per lead). It needs a migration and its own design; it gets its own plan. Stated here so the omission is deliberate rather than forgotten.

**Type consistency:** `money`/`ctr`/`num` are defined in Task 1 and consumed in Tasks 3 and 5 with those names. `adSets(orgId, {campaignId})` and `ads(orgId, {adSetId})` are defined in Task 2 and called with those shapes in Task 3. `googleReportService`'s four methods are defined in Task 4 and consumed in Task 5.

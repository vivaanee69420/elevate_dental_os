# Per-Practice Data Tabs — Design

Date: 2026-05-25
Branch: feat/gohighlevel-integration

## Problem

Every practice in a group has its own data, but every frontend screen currently shows
org-wide consolidated totals. Data already lands per-practice in the database (Dentally
sync maps records to a practice via `practices.pms_site_id`), but there is no way for a
user to view one practice's data in isolation. We need per-practice views so data from
different sources (Dentally, Xero, manual, CSV) is visible scoped to the practice it
belongs to.

## Goals

- Let users filter the data on a page down to a single practice, or view all practices
  consolidated.
- Cover four domains in this slice: **Finance** (Profit/P&L, cashflow, financial),
  **Payments**, **Contacts/patients**, **Overview/Business Hub**.
- No data hidden: rows with no `practice_id` (unmapped Dentally contacts, manual P&L
  entered without a practice) remain visible under the consolidated "All" view.

## Non-Goals

- No global/shared practice selector — tabs are per page, selection does not carry
  across navigation (explicit user decision).
- No formula changes (`docs/FORMULAS.md` untouched).
- No change to the Dentally sync mapping mechanism — it already writes `practice_id`.
- No new test framework for the frontend (none exists; manual QA instead).

## Current State (verified)

Data layer is mostly ready:

| Table | practice_id | Notes |
|---|---|---|
| `appointments` | NOT NULL | synced row skipped if Dentally site unmapped |
| `payments` | NOT NULL | fully splittable |
| `contacts` | nullable | patients sync even when site unmapped |
| `monthly_financials` | nullable | per-practice line items; manual/Xero/CSV |

Gap: backend read endpoints take no `practice_id` param, and no practice tab/selector UI
exists. Dentally sync maps via `practices.pms_site_id` → `practice_id` in
`backend/src/lib/integrations/dentally-sync.js` (`loadSiteMap`).

Practices CRUD lives inline in `backend/src/routes/practices.routes.js` (no dedicated
controller/service/repo); `GET /api/practices` already lists practices for pickers.

## What "practice" means here

A practice is a row in the `practices` table linked to a Dentally site via
`practices.pms_site_id` (the site UUID) on the Integrations → Dentally practice mapping
screen — e.g. *GM Dental & Implant Centre Ashford*, *…Rochester*. Tabs are generated
**dynamically** from `GET /api/practices` (this same list); adding/renaming a practice or
changing its site mapping updates the tabs with no code change. The Dentally sync resolves
`site_id → practice_id` at sync time, so filtering stored rows by `practice_id` is exactly
filtering by the Dentally site link — no live Dentally call per page view.

## Decisions

1. **Tab pattern**: per-page tabs (each page renders its own `All | Practice A | …`
   row), generated dynamically from `GET /api/practices`. Selection is independent per
   page, resets to All on navigation.
2. **Default / All view**: "All practices" = current org-wide totals (param omitted),
   includes unassigned rows. Each practice tab shows only its own rows.
3. **Unassigned data**: folds into All only; no dedicated "Unassigned" tab.
4. **State plumbing**: plain per-page `useState` (default null = All). URL persistence
   (`?practice=`) is an optional later refinement, off by default.

## Architecture

### Backend — filtering

Add an optional `practice_id` query param (validated as UUID) to the read endpoints.
Repos add `.eq('practice_id', id)` **only when the param is present**; the mandatory
`organisation_id` filter is always applied. Omitting the param = unchanged org-wide
behaviour, so unassigned/null rows naturally fold into All.

Endpoints to thread `practiceId` through (route → controller → service → repo):

- `analytics.service`: `finance-series`, `cashflow`, `financial`. For
  `monthly_financials` aggregation, filter rows by `practice_id` when set (null rows
  excluded from a specific practice, included in All).
- `payments`: list + summary.
- `contacts`: list.
- Overview / Business Hub: accept `practice_id`, scope the rollup to one practice when set.

### Frontend — per-page tabs

- **`features/practices/`** (new slice): `api.ts` `listPractices()` (reuse existing
  endpoint), `hooks.ts` `usePractices()`. Shared data source, no shared selection.
- **`PracticeTabs`** reusable controlled component: renders `All practices | Practice A
  | …` from `usePractices()`; props `value` + `onChange`. Hidden when org has ≤1
  practice.
- **Each page** holds `const [practiceId, setPracticeId] = useState(null)`, renders
  `<PracticeTabs value={practiceId} onChange={setPracticeId} />` at the top, and passes
  `practiceId` into its data hooks.
- **Hooks** (`useFinanceSeries`, `useCashflow`, `useFinancial`, `usePayments`,
  `usePaymentSummary`, contacts list, overview) accept a `practiceId` arg, add it to the
  React Query `queryKey`, and forward `?practice_id=` to the api call. Switching tab
  refetches automatically.
- **`ManualPLModal`**: add a practice dropdown defaulting to the page's active tab,
  allowing "Whole group / unassigned". Passes `practice_id` on create.

### Data flow

```
PracticeTabs(onChange) -> page useState(practiceId) -> hooks(practiceId)
  -> queryKey:[domain, practiceId] + ?practice_id=ID -> Next proxy -> Express
  -> service threads practiceId -> repo .eq('practice_id') -> scoped rows -> UI
```

All practices = practiceId null -> no param at every hop -> unchanged consolidated path.

## Error / Edge Handling

- Invalid `practice_id` (not a UUID): Zod rejects at the controller (400).
- `practice_id` belonging to another org: the mandatory `organisation_id` filter means it
  returns zero rows, never cross-org data.
- Org with one practice: tabs hidden, behaves exactly as today.
- Manual P&L with no practice chosen: stored with null `practice_id`, visible under All.

## Testing

- **Backend (vitest)**: per endpoint, assert `?practice_id=X` returns only that
  practice's rows and that omitting the param returns org-wide (incl. unassigned). Add a
  cross-practice isolation test (practice A param never leaks practice B rows). Extends
  existing suites.
- **Frontend**: no test framework — manual QA via `/qa` against the running app (switch
  tabs, verify refetch + isolation).
- **Docs**: `docs/API.md` updated for the new `practice_id` param on each endpoint.

## Files Touched (anticipated)

Backend:
- `routes/`, `controllers/`, `services/`, `repositories/` for analytics, payments,
  contacts, overview/business-hub — add optional `practice_id`.
- `models/` — add `practice_id` (optional UUID) to relevant list-query Zod schemas.

Frontend:
- new `features/practices/{api,hooks}.ts`
- new `PracticeTabs` component
- edits to finance/payments/contacts/overview pages + their `hooks.ts`
- `features/finance/components/ManualPLModal.tsx`

Docs:
- `docs/API.md`

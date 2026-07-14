# Integration connection gating — design spec

- **Date:** 2026-06-25
- **Status:** Design approved (Sections 1–2 signed off; 3–4 captured below for review)
- **Scope:** Frontend-only (plus minor backend logging verification)
- **Owner:** ruhithpasha

## Problem

When an owner disconnects an integration on the Integrations page, most of the app that
depends on it does **not** respond — Dentally/GHL/QuickBooks/Xero screens keep rendering
(empty or stale) with no explanation, and the user is given no path back to reconnect.
`useIntegrations()` (the only source of per-provider connection status) is used **only** on
the Integrations page; no other screen consults it.

## Goal / chosen behaviour

When an integration is **not connected**, the things in the app that depend on it show a
**"connect" prompt** (the nav item and page stay; the page/card content is replaced with a
connect empty-state that links to Integrations). Applies **app-wide**.

Decisions (locked):
- **"Not connected" = anything but `active`** — covers `revoked`, `failed`, `pending`,
  `verifying`, and never-connected.
- **Shared (multi-source) screens stay** — only the cards/sections sourced from a
  disconnected provider show an inline ("compact") prompt. A whole-screen prompt appears
  only if **all** of a screen's sources are disconnected.
- **Manual-data rule:** only **provider-locked** surfaces (data that can *only* come from an
  integration) are gated. Manually-entered / CSV-fed cards are never gated — otherwise a
  manual-data org would get spurious "connect Dentally" prompts. This mirrors the backend
  `integration-gating.js` semantics (never-connected providers do not hide manual data).
- **Nav untouched:** sidebar items are not removed or disabled; clicking lands on the page,
  which shows the prompt.
- **Frontend-only:** the backend already hides *revoked* providers' data; single-source
  screens have no data when not connected, so a UI gate suffices. Plus error-logging touch-ups.

## Architecture — Approach 1 (declarative gate primitives + targeted application)

Chosen over (2) a central route→providers registry + layout guard (route-level only; can't do
per-card) and (3) backend-driven gating flags (touches every endpoint; overkill for a UI
affordance).

### Section 1 — Reusable primitives (APPROVED)

All client components, all reading the existing `['integrations']` React Query (already
invalidated on connect/disconnect via `useRevoke`, 15s `staleTime`).

**`frontend/features/integrations/useProviderStatus.ts`** (new hook, wraps `useIntegrations()`):
```
isLoading, isError
statusOf(provider)      // 'active'|'failed'|'pending'|'verifying'|'revoked'|null
isConnected(provider)   // status === 'active'  (the only "connected" state)
anyConnected(providers) // some(active)         (shared/multi-source gates)
hasError(provider)      // status === 'failed'  (broken creds → reconnect, not first-connect)
labelOf(provider)       // from data.available[].label, fallback to a static LABELS map
```

**`frontend/components/integrations/ConnectPrompt.tsx`** (new presentational empty-state):
- **Not-connected / revoked** → "Connect {Label}" + one line + button → `/integrations`.
- **Failed** → "Reconnect {Label}" + shows the provider's `last_error` (why) + link.
- **Pending / verifying** → friendlier "Connecting {Label}…" variant (in progress).
- `compact` variant for inline per-card use. British English, no emojis.

**`frontend/components/integrations/RequiresIntegration.tsx`** (new gate):
```tsx
<RequiresIntegration providers={['dentally','soe']} mode="any" compact?>
  {children}
</RequiresIntegration>
```
- `mode="any"` (default): connected if *any* listed provider is `active` — PMS screens gate on
  `['dentally','soe']` so an SOE org isn't wrongly prompted.
- While `isLoading` → render a small skeleton (not the prompt, not children) to avoid a flash.
- Connected → render children; else → `<ConnectPrompt>` with the correct reason.

### Section 2 — Single-source screens → whole-screen gate (APPROVED)

Exact provider per screen is verified against each component's real API/query keys at
implementation time before wrapping.

**Dentally / PMS domain — `providers={['dentally','soe']}` `mode="any"`:**
| Route | Component |
|---|---|
| `/appointments` | `operations/AppointmentsScreen` |
| `/clinicians` | `intelligence/CliniciansScreen` |
| `/treatments` | `operations/TreatmentMatrixScreen` |
| `/patients` | `growth/...` |
| `/booking` | `growth/BookingSummary` |
| `/chair` | `operations/ChairUtilisationScreen` |
| `/uda` | `operations/UDATrackerScreen` |
| `/leakage` | `finance/RevenueLeakageScreen` |
| `/day` | `overview/DayScreen` |
| `/workbench` | `finance/TreatmentEconomicsWorkbench` |

**GoHighLevel — `providers={['gohighlevel']}`:**
| Route | Component |
|---|---|
| `/ghl-dashboard` | `ghl/GhlDashboardScreen` |
| `/crm-today` | `crm/TodayScreen` |
| `/inbox` | `crm/InboxScreen` |
| `/pipeline` | `crm/PipelineScreen` |
| `/leads` | `leads/LeadFunnelScreen` |
| `/crm-enquiries` | `crm/EnquiriesScreen` |
| `/crm-reports` | `crm/ReportsScreen` |

**QuickBooks — `providers={['quickbooks']}`:** `/quickbooks` (`finance/QuickBooksScreen`)
**Xero — `providers={['xero']}`:** `/tax` (`intelligence/TaxScreen`)

**Verify-then-decide** (likely multi-source / manual-fed — read API first; if manual-fed, move
to Section 3 or leave alone): `/associates`, `/staff`, `/pay` (Dentally activity + Xero
payroll), `/contacts` (GHL but may hold manually-added contacts).

### Section 3 — Shared screens → per-card prompts (for review)

Principle: shared/multi-source screens never fully hide. Only **provider-locked** cards show an
inline `compact` `<ConnectPrompt>`; whole-screen prompt only if **all** the screen's sources are
disconnected. Cards that can be manually/CSV-fed are not gated.

Concrete targets (clean attribution; several already carry a partial signal today):
- **`/cashflow`** (`finance/CashflowScreen`): bank-position / Open Banking section → compact
  "Connect Open Banking" when `!bankConnected` / `gocardless` not active. Dentally cash-in core
  stays; the existing connect-accounting banner for cash-out stays.
- **`/marketing`** (`intelligence/MarketingRoiScreen`): replace the generic "no ad spend or
  leads" message with one that **names** the missing provider(s) — Google Ads / Meta Ads — via
  `isConnected`/`hasError`, plus a connect CTA.
- **`/dashboard`** (`dashboard/DashboardScreen`): the paid-marketing card already checks
  `roi.connected`; swap to a compact `<ConnectPrompt>` naming the ad providers. (Xero £0-cost
  hint optional / low priority.)

**Left untouched** (degrade gracefully; per-card gating here is low-value/high-risk — possible
fast-follow): `/business-hub`, `/deep-dive`, `/financial`, `/profit`, `/debt`, `/alerts`,
`/ai-insights`, `/board-report`, `/exit-plan`, `/p4g-ai`, `/progress`, `/kpiscorecard`.

### Section 4 — Integrations page, nav, error logging, edge cases, testing (for review)

**Integrations page** is the management surface — `failed`/`pending` integrations **must stay
visible** there so the owner can fix/reconnect. The "anything but active hides" rule does **not**
apply to the Integrations page panels themselves. No behavioural change needed beyond existing
self-handling (`QuickBooksPanel`/`EmergentPanel` self-empty; GHL panel stays on non-revoked).

**Nav:** not removed/disabled (per chosen behaviour). Optional future: subtle "not connected"
dot — out of scope.

**Error logging:**
- Frontend: add a tiny shared `frontend/lib/log.ts` (level + tag + payload) for consistent,
  greppable logs. `useProviderStatus` logs `error('[integrations] status query failed', {error})`
  when the query errors (today it fails silently off the Integrations page). The gate logs
  `warn('[integrations] surface gated — provider failed', {provider, lastError})` when blocking
  on a `failed` provider. `ConnectPrompt` surfaces `last_error` for failed providers.
- Backend: verify/add `pino` logging in `integration.service.js` on connect-callback failure,
  sync failure (`markFailed`), and revoke — log `{orgId, provider, err}` so failures land in the
  Railway log files (production file logging), not just the `last_error` DB column.

**Edge cases:**
- Loading flash → gate renders a skeleton while `isLoading`.
- `pending`/`verifying` → "Connecting…" variant, not "Connect".
- Multi-source / manual data → only provider-locked surfaces gated.
- Revoke already invalidates relevant query keys → prompt appears immediately, no refresh.

**Testing/verification** (frontend has no test framework):
- `cd frontend && npm run typecheck && npm run lint && npm run build` must pass.
- Backend logging covered by existing vitest; add a small unit test only if new logic is added.
- Manual QA matrix: disconnect each provider → confirm its single-source screens show the prompt
  and shared screens degrade per-card. Document the steps.

## Effort estimate

~2.5–3.5 days focused work (~3 implementation sessions):
- Primitives (hook + `ConnectPrompt` + `RequiresIntegration` + `lib/log.ts`): ~0.5 day
- Verify per-screen sources & wrap ~17 single-source screens: ~1 day
- Shared per-card prompts (Cashflow, Marketing, Dashboard): ~0.5 day
- Integrations-page/nav consistency + frontend & backend error logging: ~0.5 day
- Manual QA matrix + typecheck/lint/build + plan write-up: ~0.5 day

## Pending work checklist

- [ ] **Primitives**
  - [ ] `features/integrations/useProviderStatus.ts`
  - [ ] `components/integrations/ConnectPrompt.tsx` (not-connected / failed / connecting + compact)
  - [ ] `components/integrations/RequiresIntegration.tsx` (mode any/all, loading skeleton)
  - [ ] `frontend/lib/log.ts` (shared tagged logger)
- [ ] **Single-source whole-screen gates** (verify provider from each component's API first)
  - [ ] Dentally/PMS: appointments, clinicians, treatments, patients, booking, chair, uda, leakage, day, workbench
  - [ ] GHL: ghl-dashboard, crm-today, inbox, pipeline, leads, crm-enquiries, crm-reports
  - [ ] QuickBooks: quickbooks
  - [ ] Xero: tax
  - [ ] Verify-then-decide: associates, staff, pay, contacts
- [ ] **Shared per-card prompts**
  - [ ] cashflow (Open Banking section)
  - [ ] marketing (name missing ad provider)
  - [ ] dashboard (paid-marketing card)
- [ ] **Error logging**
  - [ ] Frontend logging via `useProviderStatus` + gate + `ConnectPrompt` last_error surface
  - [ ] Backend pino logging on connect-fail / sync-fail (`markFailed`) / revoke
- [ ] **Integrations page / nav** — confirm management panels stay visible on failed/pending; nav untouched
- [ ] **Verification** — typecheck + lint + build green; manual QA matrix documented & run

## Reference (current state)

- Status source: `useIntegrations()` → `GET /api/integrations` → rows with
  `status: 'pending'|'verifying'|'active'|'failed'|'revoked'`
  (`frontend/features/integrations/hooks.ts`, `api.ts`).
- Disconnect invalidates: `['integrations','business-hub','cashflow','payments','payment-summary',
  'practices','finance-series','financial','marketing-roi','reviews','leads','appointments',
  'growth','overview']` (`useRevoke`).
- Backend data gating (revoked only): `backend/src/lib/integration-gating.js`.
- Nav array: `frontend/lib/nav.ts`; sidebar: `frontend/components/layout/sidebar.tsx`.

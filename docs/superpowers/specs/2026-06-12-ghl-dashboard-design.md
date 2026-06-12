# GHL CRM Dashboard — Design

Date: 2026-06-12
Branch: `feat/ghl-dashboard`

## Problem

GoHighLevel (GHL) data is synced per subaccount (one GHL Location per `integration_accounts` row, each mapped 1:1 to a practice) into `contacts`, `leads`, and `communications`. There is no consolidated view: no place that sums GHL activity across all subaccounts, no per-subaccount drill-down, and Group Overview shows no GHL figures. Users want a dedicated GHL dashboard in the Elevate CRM that aggregates every subaccount into KPI cards with a subaccount filter, plus GHL summary cards on Group Overview that open a per-subaccount breakdown.

## Goals

- New dedicated GHL dashboard page in the CRM section at `/ghl-dashboard`.
- KPI cards summed across ALL connected subaccounts by default.
- Filter to view a single subaccount's figures.
- Period filter (date range) consistent with existing CRM/scope patterns.
- Richer GHL data display: contacts, leads/pipeline (stages + value), conversations, sync health.
- Group Overview: GHL summary cards; clicking a card reveals a per-subaccount breakdown.
- All numbers are live aggregates (no stored rollups), org-scoped.

## Non-goals (deferred)

- GHL Calendars / appointments. Not currently synced from the GHL API; adding that connector is separate, larger work. Out of scope for this spec; noted as a follow-up.
- Retiring the legacy GHL `syncOneOrg` path (tracked elsewhere).

## Data sources (already synced)

- `contacts` — `organisation_id`, `practice_id`, `source`, `ghl_contact_id`, `created_at`.
- `leads` — `organisation_id`, `practice_id` (via scope stamping), `ghl_opportunity_id`, `ghl_pipeline_id`, `ghl_stage_name`, `estimated_value_pence`, `status` (open/won/lost), `source = 'gohighlevel'`, `created_at`.
- `communications` — GHL conversation messages with direction (inbound/outbound), `created_at`, linked to `contact_id` / `organisation_id`.
- `integration_accounts` — per-subaccount meta: `id`, `external_account_id` (GHL Location), `practice_id`, `label`, `status`, `last_sync_at`, `last_error`, `webhook_token`, `config`.

## Architecture

Follows the strict backend layering (routes → controllers → services → repositories) and the established `serviceClient` + explicit `organisation_id` filter pattern for tenant isolation (no RLS path).

### Backend

New live-aggregate endpoint (owner/manager-gated like other integration reads):

```
GET /api/integrations/gohighlevel/dashboard
  ?accountId=<integration_account uuid>   (optional; omit = all subaccounts)
  &practiceId=<uuid>                       (optional alt filter)
  &since=<ISO date>&until=<ISO date>       (optional; default trailing period)
```

Response shape:

```jsonc
{
  "period": { "since": "...", "until": "..." },
  "totals": {
    "contacts":      { "total": N, "new": N, "bySource": [{ "source": "...", "count": N }] },
    "leads":         { "total": N, "new": N, "open": N, "won": N, "lost": N,
                       "pipelineValuePence": N, "conversionPct": N,
                       "byStage": [{ "stage": "...", "count": N, "valuePence": N }] },
    "conversations": { "total": N, "inbound": N, "outbound": N, "last7d": N },
    "sync":          { "accounts": N, "active": N, "failed": N, "lastSyncAt": "..." }
  },
  "perAccount": [
    {
      "accountId": "...", "label": "...", "practiceId": "...", "practiceName": "...",
      "status": "active", "lastSyncAt": "...", "lastError": null,
      "contacts": N, "leads": N, "pipelineValuePence": N, "conversionPct": N,
      "conversations": N
    }
  ]
}
```

- `totals` powers the KPI cards. `perAccount` powers both the single-subaccount filter (client picks one) and every drill-down breakdown.
- When `accountId`/`practiceId` is supplied, `totals` is computed for that subaccount only; `perAccount` still returns the full list for the filter UI.
- Aggregation is grouped by `practice_id` (the subaccount↔practice 1:1 mapping). Rows with null `practice_id` (legacy/unmapped) fold into an "Unmapped" bucket so totals never silently drop data.

Layering:
- `routes/integrations.routes.js` — add the dashboard route under the existing GHL group, owner/manager gated.
- `controllers/integrations.controller.js` (or the GHL-specific controller) — parse + validate query with a new Zod schema (`GhlDashboardQuerySchema` in `models/`), call the service, shape response.
- `services/ghl-dashboard.service.js` (new) — orchestrates the aggregate queries, computes derived metrics (conversion %, value sums), assembles `totals` + `perAccount`.
- `repositories/` — add aggregate query methods (e.g. counts/sums grouped by practice) to the relevant repos (`ghl`/`contacts`/`leads`/`communications` + `integration-account`). Each MUST carry the explicit `.eq('organisation_id', orgId)` filter.

Money stays integer pence throughout; display conversion is frontend-only.

### Frontend

New feature slice `frontend/features/ghl/` (keeps it cohesive; the CRM section imports it):
- `api.ts` — `fetchGhlDashboard(params)` via the same-origin backend proxy.
- `hooks.ts` — React Query hook `useGhlDashboard({ accountId, since, until })`.
- `components/` —
  - `GhlDashboardScreen.tsx` — page composition: subaccount filter bar + period filter + cards + sections.
  - `SubaccountFilterBar.tsx` — "All subaccounts" + one chip/select per account (from existing accounts list).
  - `GhlKpiCards.tsx` — contacts, leads, pipeline value, conversion, conversations, sync health.
  - `PipelineByStage.tsx` — bar/list of `byStage`.
  - `SourceBreakdown.tsx` — contacts/leads `bySource`.
  - `ConversationActivity.tsx` — inbound/outbound + last-7d.
  - `SyncHealthTable.tsx` — `perAccount` status/last sync/errors/counts.

Route: `frontend/app/(dashboard)/ghl-dashboard/page.tsx` renders `GhlDashboardScreen`. Add a CRM-group sidebar entry. British English, light theme, £ formatting via `lib/format.ts`.

### Group Overview integration

In `frontend/features/overview/GroupOverviewScreen.tsx`:
- Add a GHL summary card cluster (contacts, leads, pipeline value, conversion) fed by the same `useGhlDashboard` (no filter = all subaccounts).
- Each card is clickable → opens a breakdown (modal or inline expand) rendering the `perAccount` rows for that metric. Reuses the dashboard's `perAccount` data; no new endpoint.

## Data flow

1. Page mounts → `useGhlDashboard` calls `GET /api/integrations/gohighlevel/dashboard` (proxy injects tenant bearer).
2. Backend `authenticate` sets `req.user.organisation_id`; controller validates query; service runs org-scoped aggregates grouped by practice; returns `totals` + `perAccount`.
3. Frontend renders cards from `totals`. Subaccount filter re-requests with `accountId` (or filters `perAccount` client-side for instant switch — service still authoritative).
4. Group Overview cards read the same hook; click → breakdown from `perAccount`.

## Error handling

- No GHL connected / no subaccounts → endpoint returns zero-value `totals` and empty `perAccount`; UI shows an empty state ("Connect GoHighLevel to see data") rather than erroring.
- Per-account sync errors surface in `sync` totals and the `SyncHealthTable` (`lastError`), never break aggregation.
- Aggregate query failure → 500 with logged error; React Query shows a retryable error state.
- Null `practice_id` rows bucketed as "Unmapped" (logged count), not dropped.

## Testing

- Backend (vitest): service aggregation correctness (totals = sum of perAccount), org isolation (cross-org rows excluded), period filtering, conversion math, empty-state (no accounts), null-practice bucketing. Mock repo layer / use the existing test harness with `.rpc`/`.from` support.
- Frontend: no test framework currently; verify via `npm run typecheck` + `npm run build` and manual dogfood.

## Rollout

- No migration required (live aggregates over existing tables).
- After any future hosted DDL: `NOTIFY pgrst, 'reload schema';` — N/A here.
- Update `docs/API.md` with the new endpoint.

## Follow-ups

- GHL Calendars/appointments sync + cards.
- Optionally cache aggregates if query cost grows (currently live).

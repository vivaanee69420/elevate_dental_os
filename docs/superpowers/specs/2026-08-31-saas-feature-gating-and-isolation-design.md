# SaaS feature gating + tenant isolation audit — design

**Date:** 2026-08-31
**Status:** Approved (owner, in-session)
**Sub-project:** A of the multi-tenant SaaS push. Sub-project B (direct Google/Meta ads lead
ingestion for tenants) gets its own spec.

## Context

Elevate is architecturally multi-tenant (every business table carries `organisation_id`,
repos filter on it), but several shipped features are bespoke to the Plan4Growth group and
must not be visible to other tenants of the SaaS product: the analyst Data Room, the
Emergent (Treatments Accepted) integration, the Google-Sheets-based Call Reporting
dashboard, the GHL→Dentally conversion sheet export, and the practice-mapping admin
surfaces. Today these are gated only by role/permission, so any future tenant owner would
see them.

Goal: hide the internal-only features from every org except our own — at the API layer,
not just navigation — behind per-org feature flags togglable from the platform console,
and run a systematic tenant-isolation audit over the data-access layer.

## Non-goals (this phase)

- No move of any feature into the platform console; everything stays in the tenant app.
- No platform `analyst` role work (deprioritised by owner).
- No hosted RLS enforcement / access-token-hook work (the app-layer `organisation_id`
  audit is this phase; DB-level RLS is a later phase — the 000129/000130 lockdown history
  shows it must be its own careful change).
- No ads-lead fetching (Sub-project B).
- No billing/plan tiers — `org_features` is an internal visibility switch, not a paywall.

## Feature keys

| Key | What it covers |
|---|---|
| `data_room` | Data Room API + all `/data-*` pages |
| `emergent` | Entire Emergent integration (connect, sync, mapping, panel) |
| `call_reporting` | Call Reporting dashboard + read-only Google Sheets integration |
| `sheet_export` | GHL→Dentally conversion export (Sheets writer) |
| `practice_mapping` | Practice-assignment admin controls across integrations |

The catalog lives in code (`backend/src/lib/features.js`) as the single source of valid
keys, mirroring how `lib/permissions.js` anchors RBAC.

## Data model — migration `20260101000133_org_features.sql`

```sql
CREATE TABLE IF NOT EXISTS org_features (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, feature)
);
```

- RLS enabled, zero policies (service-role-only access, same idiom as `platform_admins`
  hardening in 000104).
- **Seed: every org existing at migration time gets all five keys `enabled=true`**
  (`INSERT … SELECT CROSS JOIN … ON CONFLICT DO NOTHING`). All current orgs are ours
  (Plan4Growth + developer org), so nothing changes for us and no UUIDs are hardcoded.
- **Future orgs get no rows → every internal feature disabled by default.**
- Idempotent; re-applies cleanly on `supabase db reset`; ends with `NOTIFY pgrst`.

## Backend enforcement

New middleware `requireFeature(key)` in `middleware/auth.js` (or a sibling
`middleware/features.js`):

- Looks up `org_features` for `req.user.organisation_id` via `serviceClient`, through an
  in-process TTL cache (60s) keyed `orgId` → `Set<enabled keys>` so the hot path stays
  one cached lookup per org per minute.
- Disabled or missing row → `403 { error: 'Feature not enabled', code: 'FEATURE_DISABLED' }`.
- **Deny on lookup error** (these are internal features; fail-closed is safe and cannot
  lock an owner out of core product).
- Cache invalidated on platform toggle (best-effort: 60s TTL is the ceiling for staleness).

Gated surfaces (middleware inserted after the existing role gates):

- `data_room`: all of `routes/data-room.routes.js` (mounted `/api/data-room`).
- `emergent`: the six `/api/integrations/emergent*` endpoints in
  `routes/integrations.routes.js`. The public webhook `/webhooks/emergent/:token` is NOT
  gated — it is token-scoped and only resolves for orgs that hold a connection, which
  only feature-enabled orgs can create.
- `call_reporting`: `routes/call-reporting.routes.js` (mounted `/api/call-reporting`) +
  all `/api/integrations/google-sheets/*` (read-only provider) endpoints.
- `sheet_export`: all `/api/integrations/google-sheets-writer/*` endpoints. The
  `sheet-export-drain` worker and nightly `google-sheets-sync` worker additionally skip
  orgs without the flag (belt-and-braces; such orgs cannot connect anyway).
- `practice_mapping`: the mapping mutations —
  `PATCH /api/ad-attribution/subaccounts/:id`, `PATCH /api/ad-attribution/ad-accounts/:id`,
  `PUT /api/ad-attribution/pipelines/:accountId/:pipelineId`,
  `POST /api/integrations/emergent/practices` (doubly gated with `emergent` — fine),
  the Dentally site→practice mapping mutation(s), and the GHL
  subaccount→practice update. Read endpoints that feed tenant dashboards
  (`/ad-attribution/performance`, `/spend`, `/leads`, `/config`, `mapping-health`) stay
  ungated — tenants may see their data; they may not re-map it.

The implementation plan enumerates the exact route lines; any mapping mutation discovered
during implementation that is not listed above is gated under `practice_mapping` too.

## Frontend

- The auth bootstrap response (`/auth/me`, consumed by `useMe()`) gains
  `features: string[]` — the enabled keys for the caller's org. One shared
  `hasFeature(me, key)` helper.
- Hidden when the flag is off:
  - Sidebar: Data Room group/entries, Call Reporting entry.
  - `/data-*` pages and `/call-reporting` render the standard not-available state (or
    redirect to `/dashboard`) if reached directly.
  - Integrations page: Emergent panel (incl. `EmergentPracticeMapping`, `DailyReportCard`
    if Emergent-specific), `GoogleSheetsPanel`, `GoogleSheetsWriterPanel`.
  - Mapping controls everywhere: `AdAccountSelector` practice dropdown,
    `DentallyPracticeMapping`, the practice dropdown inside `GoHighLevelPanel`, the
    whole `/settings/ad-attribution` page (it is a mapping admin page; the read
    endpoints stay ungated because marketing dashboards consume them).
- With the flag on (our org), the UI is pixel-identical to today.
- Consequence for future tenants: connecting a GHL subaccount or ad account no longer
  asks for a practice — the account syncs with `practice_id = null` ("Unmapped" bucket,
  already supported) until a superadmin maps it (today: directly in DB or by enabling
  `practice_mapping` for that org; a console mapping UI is deliberately out of scope).

## Platform console

- `GET /api/platform/orgs/:orgId/features` → `{ feature, enabled }[]` (all catalog keys,
  absent rows reported `enabled:false`).
- `PATCH /api/platform/orgs/:orgId/features` body `{ feature, enabled }` → upsert row.
  Both `requirePlatformRole('superadmin')`. Toggles are audited (existing platform audit
  path).
- Org detail page in `(platform)/platform/orgs` gains a "Features" card of five toggles.

## Isolation audit (A4)

Scope: all ~56 files in `backend/src/repositories/` + every `.rpc(` call site + every
controller that derives an org id.

Method, per file:
1. Every query chains `.eq('organisation_id', …)` (or is intentionally global —
   platform courses catalog, `platform_admins`, worker-internal reads — each such
   exception listed explicitly in the audit doc).
2. Every RPC call passes `p_org` from `req.user.organisation_id` (never from body/query).
3. No tenant controller accepts an org id from the request.

Deliverables:
- `docs/ISOLATION_AUDIT.md` — one line per repository file: verdict + exceptions.
- Fixes for every gap found, each with a cross-org regression test (existing pattern in
  `backend/test`).

## Testing

- Unit: `requireFeature` (enabled / disabled / missing row / lookup error → deny / cache
  TTL behaviour).
- Integration: for each gated route family — org without flag → 403 `FEATURE_DISABLED`,
  org with flag → passes to the existing role gate; migration seed leaves existing orgs
  enabled.
- `/auth/me` carries `features`; platform GET/PATCH round-trip; PATCH rejected for
  non-superadmin.
- Cross-org tests added by the audit.
- Frontend: typecheck/lint/build (no FE test framework — unchanged).

## Rollout

1. Apply `000133` on hosted (seed grandfathers current orgs) + `NOTIFY pgrst`.
2. Deploy backend + frontend together (additive for us; new orgs simply see less).
3. Verify: our org sees today's UI; a scratch org (platform-created) sees no Data
   Room/Call Reporting/Emergent/Sheets/mapping surfaces and gets 403s on direct API hits.

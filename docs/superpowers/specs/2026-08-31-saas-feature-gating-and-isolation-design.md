# Agency + sub-accounts SaaS model, feature gating, isolation audit — design (v2)

**Date:** 2026-08-31 (v2 — supersedes the flat feature-flag v1 of the same day)
**Status:** Approved (owner, in-session)
**Sub-project:** A of the multi-tenant SaaS push. Sub-project B (direct Google/Meta ads
lead ingestion for tenants) gets its own spec; the Meta App Review kickoff checklist is
already committed (`docs/META_APP_REVIEW.md`).

## Context

Elevate becomes a sellable SaaS on the GoHighLevel pattern: **our org is the agency**;
every customer is a **sub-account** under it. One codebase, one integration layer. The
agency's own org changes nothing — its data, integrations, and full feature set stay
exactly as today. Sub-accounts start completely fresh (no data, no integrations — the
per-org model already guarantees this) and see only the modules the agency switches on
for them. Bespoke internal features (Data Room, Emergent, Call Reporting, sheet export)
stay agency-only by default. Practice-mapping admin controls become an **agency-user
power**, never visible to sub-account users.

## Non-goals (this phase)

- Cross-sub-account rollup dashboard (later phase — nothing to roll up until
  sub-accounts hold data).
- Per-sub-account billing/subscriptions (later phase; placeholder only).
- Hosted RLS enforcement / access-token-hook work (later phase; the 000129/000130
  lockdown history shows it must be its own careful change). Note: agency org-switching
  relies on the service-client + explicit-filter path, which is how all repos work
  today; the future RLS phase must account for the switched context.
- Ads-lead fetching (Sub-project B). Platform analyst role (deprioritised).
- Public self-serve signup as a growth channel — provisioning is agency-only; the
  existing signup/approval flow is left in place but is no longer the main path.

## Phases

- **A1** — schema (hierarchy + `org_features`) + `requireFeature` middleware + internal
  features hidden from non-agency orgs.
- **A2** — Agency menu: sub-account list, create sub-account, switch-into/exit.
- **A3** — per-sub-account module toggles (UI + enforcement on every module's routes).
- **A4** — tenant-isolation audit.

## Data model — migration `20260101000133_agency_org_features.sql`

```sql
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS parent_organisation_id UUID NULL REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS is_agency BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS org_features (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, feature)
);
```

- RLS enabled, zero policies (service-role-only, same idiom as `platform_admins`).
- Seeds: every org existing at migration time (all ours) gets `is_agency = true` and
  override rows `enabled = true` for the four internal feature keys. No UUIDs hardcoded.
- Sub-accounts created later get `parent_organisation_id = <agency org>`,
  `is_agency = false`, and no feature rows.
- Idempotent; ends with `NOTIFY pgrst`.

## Feature catalog — `backend/src/lib/features.js`

Single source of valid keys, mirroring how `lib/permissions.js` anchors RBAC. Two kinds
of key, each with a code-level default:

- **Internal features** (default **off**): `data_room`, `emergent`, `call_reporting`,
  `sheet_export`.
- **Module keys** (default **on**): one per top-level sidebar group / product area
  (Overview, Business Hub, CRM, Finance, Growth, Operations, Intelligence, Training,
  Wealth, …). The exact list is fixed during A1 by enumerating `sidebar.tsx` groups and
  mapping each to its route mounts in `app.js`; the catalog records both.

**Effective features for an org = catalog defaults overlaid with its `org_features`
rows.** Rows are overrides only — the table stays tiny, and new standard modules default
on for everyone without backfills. There is no `practice_mapping` key (v1 had one):
mapping is gated on *who you are* (agency actor), not on the org.

## Backend enforcement

`middleware/features.js`:

- `requireFeature(key)` — resolves the **acting org's** effective features via
  `serviceClient` behind an in-process TTL cache (60s), keyed by org. Disabled →
  `403 { error: 'Feature not enabled', code: 'FEATURE_DISABLED' }`. Lookup error →
  deny for internal features, **allow for module keys** (module keys default on; a
  transient DB blip must not blank the whole product).
- `requireAgencyActor` — passes when the authenticated user's *home* org is an agency
  (whether acting in the home org or switched into a sub-account).
- `requireAgencyOwner` — `requireAgencyActor` + role `owner` + **not** in a switched
  context (agency administration happens from home).

Gated surfaces:

- Internal features → `requireFeature`: `routes/data-room.routes.js` (all),
  the six `/api/integrations/emergent*` endpoints, `routes/call-reporting.routes.js` +
  `/api/integrations/google-sheets/*`, `/api/integrations/google-sheets-writer/*`.
  Workers (`google-sheets-sync`, `sheet-export-drain`) also skip orgs lacking the flag.
  The public `/webhooks/emergent/:token` stays ungated (token-scoped; only
  feature-enabled orgs can hold a connection).
- Module keys → `requireFeature` on each module's route mounts (A3; exact mapping in
  the implementation plan).
- Mapping mutations → `requireAgencyActor` (replacing v1's `practice_mapping` flag):
  `PATCH /api/ad-attribution/subaccounts/:id`, `PATCH /api/ad-attribution/ad-accounts/:id`,
  `PUT /api/ad-attribution/pipelines/:accountId/:pipelineId`,
  `POST /api/integrations/emergent/practices`, the Dentally site→practice mutation(s),
  and the GHL subaccount→practice update. Ad-attribution *read* endpoints stay ungated
  (marketing dashboards consume them). Any mapping mutation discovered during
  implementation is gated the same way.

## Agency menu & sub-account lifecycle (A2)

New `routes/agency.routes.js` mounted at `/api/agency`, all `requireAgencyOwner`:

- `GET /subaccounts` — child orgs with status + connected-integration summary.
- `POST /subaccounts` — `{ name, owner_email, owner_name }` → creates the org with
  `parent_organisation_id` set + provisions the owner via the existing
  `provisionOrgOwner` service (active now, one-time temp password returned once —
  same contract as the platform create-org path; no second implementation).
- `GET /subaccounts/:id/features` / `PATCH /subaccounts/:id/features`
  (`{ feature, enabled }` upsert; key must exist in the catalog; target must be a
  child of the caller's org).
- `POST /switch` `{ orgId }` / `POST /switch/exit` — see below.

The platform console is unchanged and remains for LMS authoring, audit, signups; the
agency menu becomes the normal provisioning path.

## Org switching (A2)

- `POST /api/agency/switch` validates the target is a child of the caller's agency org,
  then sets a signed httpOnly cookie (HMAC over `{ user_id, target_org, exp }`, ~12h,
  dedicated secret env var, same signing idiom as `webhook-token.js`/`oauth-state.js`).
  `/switch/exit` clears it.
- `authenticate` (middleware/auth.js), after loading the user: if the cookie is present
  and valid, the user's home org `is_agency`, and the target's
  `parent_organisation_id` equals the home org (re-validated against the DB each
  request, cached), then `req.user.organisation_id = target`, `req.user.role = 'owner'`,
  and `req.agencyContext = { actor_user_id, home_org_id }`. Invalid/stale cookie →
  ignored (home context).
- Every mutation in a switched context is audited with both the acting org and the real
  actor (`audit` middleware gains the `agencyContext` fields).
- `/auth/me` returns the acting org, effective features, and
  `agency: { isAgencyActor, switched, homeOrg }`.
- Frontend: account switcher in the topbar (agency users only) + a persistent
  "Viewing <sub-account> — Exit" banner while switched. The switched view is the
  sub-account owner's exact app **plus** agency extras (mapping controls); internal
  data features do NOT appear for orgs that lack them.

## Frontend gating

- `useMe()` exposes `features` + `agency`; one shared `hasFeature(me, key)` helper.
- Sidebar renders only enabled module groups; internal entries (Data Room group,
  Call Reporting) only when their feature is on. Direct hits on disabled pages render
  the standard not-available state.
- Integrations page: Emergent/Sheets panels behind their features; every practice-
  mapping control (`AdAccountSelector` practice dropdown, `DentallyPracticeMapping`,
  `EmergentPracticeMapping`, the GHL panel's practice dropdown, the whole
  `/settings/ad-attribution` page) renders only for agency actors.
- Agency menu UI: sub-account list/create/switch + per-sub-account feature toggle
  matrix, visible only to agency owners.
- For the agency org itself the UI is pixel-identical to today.

## Isolation audit (A4)

Scope: all ~56 files in `backend/src/repositories/` + every `.rpc(` call site + every
controller that derives an org id.

Per file: (1) every query chains `.eq('organisation_id', …)` or is an explicitly listed
intentional global (platform courses catalog, `platform_admins`, worker internals);
(2) every RPC call passes `p_org` from `req.user.organisation_id`, never from
body/query; (3) no tenant controller accepts an org id from the request (the agency
switch cookie being the single, validated exception).

Deliverables: `docs/ISOLATION_AUDIT.md` (one line per file: verdict + exceptions),
fixes for every gap, each with a cross-org regression test.

## Testing

- Unit: feature resolution (defaults + overrides, cache TTL, error paths),
  `requireFeature` / `requireAgencyActor` / `requireAgencyOwner`, switch-cookie
  sign/verify (expiry, forged, wrong user).
- Integration: sub-account without a feature → 403 `FEATURE_DISABLED`; agency org
  passes; create-sub-account provisions org+owner with parent set; switch succeeds
  only into own children (non-child, non-agency caller, forged cookie → refused);
  switched mutations audited with actor + acting org; module toggle round-trip;
  `/auth/me` shape.
- Cross-org additions from the audit. Frontend: typecheck/lint/build (no FE test
  framework — unchanged).

## Rollout

1. Apply `000133` on hosted + `NOTIFY pgrst` (existing orgs become agencies with
   internal features on — zero visible change).
2. Deploy backend + frontend together per phase; keep CI green; update `docs/API.md`
   for the new `/api/agency/*` endpoints.
3. Verify after A2/A3: create a scratch sub-account → sees only default modules, no
   internal features, no mapping controls; agency switch-into works and is audited;
   agency org unchanged.

## Later phases (recorded, not designed here)

- Cross-sub-account rollup dashboard for the agency.
- Per-sub-account billing/subscriptions.
- Hosted RLS enforcement compatible with the switched-context model.
- Sub-project B: direct Google Ads (`lead_form_submission_data`) + Meta
  (`leads_retrieval` post-App-Review) lead ingestion into contacts/leads.

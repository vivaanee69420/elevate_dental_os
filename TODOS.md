# TODOS

## Frontend `src/` migration (deferred)

**What:** Move `frontend/{app,components,features,lib,middleware.ts}` under `frontend/src/`.

**Why:** Cleaner repo root; standard Next.js layout. Deferred from the
feature-first restructure (commit `e7c1615`) to keep that diff safe while
deploy was being stabilised.

**Scope when picked up:**
- `tsconfig.json` path: `@/*` → `./src/*`
- Relocate `middleware.ts` → `src/middleware.ts` (Next supports natively)
- Verify `frontend/Dockerfile` build context still resolves (standalone copy)
- `npm run typecheck && npm run lint && npm run build` must stay green

**Depends on / blocked by:** Railway frontend deploy green first (don't stack
churn on an unstable deploy). Do as its own PR — no behaviour change.

**Context:** Decided in `/plan-eng-review` (D1 scope reduction). Feature-first
modules + `components/ui` primitives already landed; only the directory
wrapper remains. Strictly mechanical + path updates.

## Force password change on first login (`must_change_password`)

**What:** Add a `users.must_change_password` column, enforce it in
`authService.login()`, build a change-password screen, and set the flag when
an admin provisions or resets a member's password.

**Why:** Admin-set passwords are known to the admin forever. Until the member
changes it, the credential is effectively shared — weak audit story for
who-did-what. This closes that gap.

**Pros:** Real fix for the shared-credential risk; proper attribution.
**Cons:** Touches the login state machine and needs a new change-password UI
flow the app does not have yet.

**Depends on / blocked by:** a change-password / account-settings screen
existing (none today).

**Context:** Consciously deferred in `/plan-eng-review` (decision D3) as scope
creep past the bounded "admin can set passwords + invite fallback" ask. The
provision/reset endpoints intentionally create `status:'active'` members with
no forced change. Revisit when any password-change UI is built.

## Wire Treatments + Pay screens to real data (parked)

**What:** Replace the mock fixtures in `operations/components/TreatmentsScreen.tsx`
(`treatmentLeads`) and `PayScreen.tsx` (`PAY_RUN_INPUTS`) with real backend data
(`pay_runs`/`pay_run_lines` already exist for Pay; Treatments needs a
volume-by-`appointment_type` endpoint).

**Why:** Both are the last Dentally-consumer screens still on mock. Operations
view is otherwise live.

**Blocked by (in order):**
1. **Practitioner pull returns 0.** `pullPractitioners` synced 0 Dentally
   associates (`assoc_from_dentally=0`); the error is swallowed at
   `dentally-sync.js:574`. Until practitioners land in `associates` with
   `pms_external_id`, `associate_id` stays null on all appts (Associates + Pay
   read zero). Needs a live sync + log check — likely a `/practitioners` error
   or a `practitionerRow` field-name mismatch vs the live payload.
2. **One full re-sync** to backfill `appointment_type` + `pms_practitioner_id`
   on the existing ~329k appts (they predate both columns). After that, future
   gaps self-heal via `relink_dentally_appointment_associates` (shipped).
3. **No revenue/production £ source — hard ceiling.** Appointments carry no
   price; payments carry no associate/treatment link. So treatment
   revenue/margin and associate production/gross/net pay are NOT derivable from
   Dentally. Best achievable from Dentally alone: treatment **volume** by type +
   appointment **counts** per associate. The money columns need a price feed
   (CSV manual feed → `monthly_financials`/`pay_run_lines.production_pence`, or a
   Dentally treatment-plan / payment-line endpoint we don't currently pull).

**Pros:** Completes the operations cluster; turns two mock screens live.
**Cons:** Steps 1-2 need a live Dentally sync (can't be done offline); step 3 is
a separate data-source project, not frontend wiring.

**Already done (this branch):** `appointment_type` mapping + `pms_practitioner_id`
persistence + `relink_dentally_appointment_associates` RPC (migration `000026`,
applied on hosted) + tests. Frontend wiring intentionally NOT started — would
render empty/money-less screens until the above lands. See memory
`dentally-treatment-pay-data-wall`.

**Context:** Parked 2026-05-26. Investigation in this session proved the blocker
is missing data, not missing frontend code.

## Growth slice — follow-ups (opened 2026-05-26, branch feat/operations-chair-util-associates)

P1 (security): Gate the `/api/growth` router. `practice-patients` (names/emails/phones)
and `recent-bookings` (patient names) currently sit behind `authenticate` only, with
no `requireRole`. Rule 5 = Reception is CRM-only. Add `requireRole('owner','practice_manager')`
to the router (matches associate/chair routes). Decision this session: shipped ungated,
fix in follow-up.

P1 (tests): Extract `growth.routes.js` inline logic (`resolveWindow`, response shapers,
booking week math) into `growth.service.js` + add vitest coverage. The new growth
endpoints are working but untested (coverage gate accepted at 63% for this PR).

P2 (correctness): Booking `today`/`this_week` bounds are computed in the server TZ
(`new Date(y,m,d)` → UTC on Railway), not `Europe/London` — off-by-one for BST users.
Compute against Europe/London, or set `TZ=Europe/London`.

P2 (integrity): `chair_utilisation` create accepts a client-supplied `practice_id`
without verifying it belongs to the caller's org (confused-deputy; write-only, no
cross-tenant read). Verify `practice_id` ∈ org before insert.

P2 (perf): `payments` has no index on `processed_at`, which growth `aggregate()`,
`/marketing`, and `growth_practice_performance` now filter/aggregate on. Add
`CREATE INDEX idx_payments_org_processed ON payments(organisation_id, processed_at)`.

P3 (data): `growth_practice_performance` drops NULL-`practice_id` patients from the
per-practice patient count (undercount vs org total). Decide attribution / document.

P3 (data): Dentally practitioner sync overwrites owner-edited `associates.full_name`
and `primary_practice_id` each run. Confirm intended or preserve manual edits.

P3 (maintainability): `chair_utilisation` SLOTS list duplicated in 4 places
(model export, model enum, lib, frontend). Derive from one source.

P3 (design): Heatmap percentage labels are white on amber `#F59E0B` (~2:1) — fails
WCAG AA. Use dark ink on light buckets or darken the amber.

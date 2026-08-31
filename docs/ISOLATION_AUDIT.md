# Tenant Isolation Audit — phase A4

**Date:** 2026-08-31 · **Scope:** all 57 files in `backend/src/repositories/`, every `.rpc(` call site, all 42 controllers, and the unauthenticated webhook handlers.
**Spec:** `docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md`

## Why this audit exists

Repositories run on `serviceClient`, which **bypasses RLS**. There is no automatic isolation: every query must chain `.eq('organisation_id', …)` with an org id threaded down from `req.user.organisation_id`. This audit checked that invariant everywhere, and — more importantly — found that the invariant alone is *not sufficient*.

## The systemic finding

Every gap traced to one root cause, and it is **not** a missing `organisation_id` filter. Those were almost all present.

> **PostgREST embedded resources are joins, and a join inherits no org predicate.**
> `.from('payments').select('*, contact:contacts(...)').eq('organisation_id', orgId)` filters *payments* only. The embedded `contacts` row is resolved by following the foreign key under `service_role`, with RLS bypassed and no tenant filter of its own.

So any FK accepted from a request body and written without an ownership check became a **cross-org read primitive** on the next list call. The row was correctly stamped as yours; the thing it pointed at was not.

Every affected FK (`payments.contact_id`, `tasks.assigned_to`, `leads.contact_id`, `memberships.plan_id`, `appointments.practice_id`, …) is a plain, non-composite FK in the schema, so Postgres accepts a foreign-org id without complaint.

**Caveat, stated honestly:** exploiting the read side requires knowing a UUID from the victim org. These are random v4 — not guessable — but they are not secrets either: they appear in API responses, CSV/Excel exports, Data Room downloads, and are visible to anyone who has ever had access to that tenant. These are *escalation* primitives (turn a leaked id into live PII), not blind cross-org reads. The one write-side gap below needed no such precondition.

## Gaps found and fixed

| # | Severity | Gap | Fix |
|---|---|---|---|
| 1 | **Critical (write)** | `contactUpdateSchema` / `appointmentUpdateSchema` were `z.record(z.any())`, so `organisation_id` was a writable column. The UPDATE's WHERE was org-scoped (you could only select your own row) but the SET was not — any authenticated user, on routes carrying **no role gate**, could PATCH one of their own rows *into another organisation*, injecting attacker-controlled records into that tenant's patient database and dashboards, and colliding their Dentally/GHL dedup keys. | `stripImmutable` applied at the parse boundary (`lib/tenant-guard.js`), removing `organisation_id`/`id`/`created_at` from any freeform patch. |
| 2 | **High** | Nine services wrote body-supplied FKs unchecked → cross-org PII via embeds: patient names/emails (payments, appointments, leads, comms), plan names + pricing (memberships), practice names (contacts, review sources, Emergent map). For **tasks**, `assigned_to` additionally addressed a *reminder email to a user in another tenant*. | `assertOrgOwns(orgId, table, id, label)` before every such write; foreign ids 404 exactly like missing ones (no existence oracle). |
| 3 | **High** | `/api/admin/logs` was `requireRole('owner')`. It serves the **process-wide** pino files, which carry every tenant's org ids, user emails and integration/webhook diagnostics; the controller has no org concept and cannot filter what it reads. Once a second tenant existed, "owner" stopped being a boundary. | Restricted to agency actors (`requireAgencyActor`). |
| 4 | Low (hardening) | `{ organisation_id: orgId, ...input }` wrote the trusted key *before* the spread. Safe only because every top-level schema is a plain `z.object` (which strips unknown keys) — one `.passthrough()` away from a cross-org write. | Spread order flipped so the trusted org id always wins. |

Tests: `test/tenant-guard.test.mjs`, `test/isolation.mass-assignment.test.mjs`, `test/isolation.foreign-fk.test.mjs`, `test/isolation.logs-agency-only.test.mjs`.

## Verdicts

**Clean (org-scoped on every query):** 44 of 57 repositories, including all of `analytics` (24 table reads + 22 RPCs, filter preserved inside every paginated fallback loop), `cockpit`, `integration`, `permissions`, `sheet-export`, `quickbooks-finance`, `monthlyFinancial`, `plSheet`, `business-health`, `chair-utilisation`, `data-room`, `csv-import`, `treatment*`, `wealth`, `workflow`.

**Clean — intentional global (documented, not reachable from a tenant request):**

| File | Why |
|---|---|
| `platform-admin.repository.js` | Superadmin console. Mounted at `/api/platform` **before** the tenant router, behind a separate `PLATFORM_ADMIN_JWT_SECRET`; a tenant Supabase JWT cannot verify there. |
| `course.repository.js` | LMS catalogue is deliberately org-less (superadmin-authored). The two genuinely tenant tables it touches — `course_enrolments`, `lesson_progress` — filter org **and** user. |
| `auth.repository.js` | Creates orgs/users pre-org-context by definition. |
| `webhook.repository.js` | Settles by globally-unique Stripe ids, only after `constructEvent` verifies the signature. |
| `integration-account.repository.js` | `getByWebhookToken` — the random token *is* the credential. `SAFE_COLS` verified: `secrets` never returned by list/read paths. |
| `notification.repository.js` | Scoped by `user_id`, which is strictly tighter than org. |
| `whatsapp-report.repository.js` | `listEnabled()` is worker-only. **Note:** it returns *decrypted* webhook URLs for every org — the one global whose accidental reuse from a request path would leak secrets directly. |
| `agency.repository.js` | Child-org operations, validated by `assertChild` in the service. |
| `boardReport.repository.js` | `activeAcrossOrgs()` is the documented cron fan-out. |

**RPC call sites (51 across 20 files): no gaps.** Every `p_org` traces to `req.user.organisation_id` or a DB-iterated `org.id` in a worker. Where a user-supplied `p_practice`/`p_account_id`/`p_source` exists, it is ANDed *inside* the RPC with the org filter.

**Controllers (42): no gaps.** No handler derives an org id from `req.body`, `req.query`, or `req.params`. `agency.controller.js` correctly uses `agencyHomeOrgId(req)` and re-validates child-of-agency in the service.

**Webhooks (7 handlers): no gaps.** Every one verifies its credential — HMAC signature, signed token, or random per-account token — *before* the org id is used. None trusts an org id from the URL or body.

## Latent risks (not exploitable today — guard before reuse)

These are safe only because of their current single caller. Each is one careless wiring away from a real hole:

- `auth.repository.setUserStatus(id, status)` — no org filter. Today the id is server-derived from a completed sign-in. Wired to a request id, it would let one tenant set another org's owner to `rejected`, locking them out.
- `agency.repository.setParent(orgId, parentOrgId)` — no guard (validation is impossible there; the org isn't a child yet). If a future caller passes a request-supplied id, an agency could adopt an unrelated tenant and then switch into it. **Consider adding `.is('parent_organisation_id', null)`.**
- `boardReport.markSent(id)`, `notification` delivery writes — id-only writes fed by worker-internal ids.
- `csv-import.approveBatch` — upserts into a runtime-resolved table with no org predicate. Safe only while *both* invariants hold: `mapRow` stamps `organisation_id`, and every `TARGET.onConflict` key starts with `organisation_id`.
- `practice-cost-model.upsert` / `sheet.upsertLeads` — conflict targets omit the org; safe only because callers pre-validate the parent id against an org-filtered list.
- `file.repository.presignDownload(key)` — mints a signed S3 GET with no DB/org check. Currently only reachable for the global LMS catalogue; an org-file download route would need an org-scoped `getById` first.

## Explicitly out of scope

This was an **app-layer** audit. Hosted RLS is still off on many tables (see the `hosted-db-security-drift` note) — enforcing it is its own careful change, because the access-token hook and RLS lockdown have previously broken login. The app-layer org filter remains the operative boundary, which is exactly why the guards above matter.

## Re-running this audit

The checks are mechanical enough to repeat when adding a repository:

1. Every `.from()` chains `.eq('organisation_id', …)`, or is on this page's intentional-global list.
2. Every UPDATE/DELETE scopes **both** `id` and `organisation_id`.
3. Every FK arriving from a request body passes `assertOrgOwns` before it is written.
4. Every `select()` with an embed (`x:table(...)`) either has all its FKs guarded by rule 3, or resolves the label with a second org-scoped query.
5. Every `.rpc()` takes `p_org` from `req.user.organisation_id`.

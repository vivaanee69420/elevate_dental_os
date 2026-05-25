# API Reference — Elevate Dental OS

Base URL: `https://api.elevate.app` (production) · `https://staging-api.elevate.app` (staging)

All authenticated endpoints require `Authorization: Bearer <supabase_jwt>` header.

## Health check

### `GET /healthcheck`
Returns `{ status: 'ok', timestamp, version }`. No auth required.

## Authentication

### `POST /auth/signup`
Public self-registration. Creates organisation + owner user, but the owner is
created **`pending`** and CANNOT log in until a platform admin approves them
(see `POST /api/platform/signups/:id/approve`). Rate-limited 5/min/IP.
```json
Request:
{
  "email": "owner@example.com",
  "password": "...",
  "full_name": "Owner Name",
  "organisation_name": "My Dental Group"
}

Response:
{ "success": true, "organisation_id": "uuid", "status": "pending",
  "message": "Account created. Awaiting approval before you can log in." }
```

### `POST /auth/login`
Validates credentials + the provisioning/approval gate, returns a Supabase
session. Rate-limited 5/min/IP.
```json
Request:  { "email": "...", "password": "..." }
Response: { "access_token": "...", "refresh_token": "...", "expires_at": 0 }
```
Gate responses (403): `pending` → "Your account is awaiting approval.";
`rejected` → "Your account was not approved."; no `users` row → "Account not
provisioned."

> **Unified login (frontend):** the single `/login` page posts to the Next
> route `POST /auth/login`, which calls this endpoint first; on a plain `401`
> it falls back to `POST /api/platform/login` and, on success, sets the
> separate `platform_token` cookie. Tenants land on `/dashboard`, platform
> superadmins on `/platform/overview`. The two token systems stay isolated.

### `GET /auth/me`
Returns current user info (used by sidebar).
```json
Response:
{
  "id": "uuid",
  "email": "...",
  "role": "owner" | "practice_manager" | "reception",
  "organisation_id": "uuid",
  "organisation_name": "..."
}
```

### `POST /auth/invite` *(owner-only)*
Invites a team member.
```json
Request:
{
  "email": "...",
  "full_name": "...",
  "role": "owner" | "practice_manager" | "reception"
}
```

## Business Health

### `GET /api/health`
Returns current org's business health record.

### `PUT /api/health` *(owner-only)*
Saves partial wizard data. Merges with existing baseline/targets.
```json
Request (any subset):
{
  "setup_step": 3,
  "setup_completed": false,
  "baseline": { "revenue": 4590000, "profit": 459000 },
  "targets": { "years": 3, "profit_multiple": 2 }
}
```

### `GET /api/health/insights` *(owner-only)*
AI-generated 5-insight analysis using Claude Sonnet 4.6.
```json
Response:
{
  "insights": [
    {
      "title": "Conversion below benchmark",
      "severity": "warning",
      "finding": "11.5% lead-to-treatment vs 18% top-quartile",
      "impact": "+£35k/month",
      "action": "TCO training + treatment plan script"
    }
  ]
}
```

### `GET /api/health/progress`
Returns baseline → current → target for 8 metrics with progress %.

### `GET /api/health/snapshots`
Historical snapshots ordered chronologically.

### `POST /api/health/snapshots` *(owner-only)*
Manually capture a snapshot.

## Leads

### `GET /api/leads?status=new&practice_id=...&limit=100`
List leads with filters.

### `POST /api/leads`
Create new lead. Either provide `contact_id` or new `contact` data.
```json
{
  "contact_id": "uuid",
  "treatment": "Single tooth implant",
  "estimated_value_pence": 285000,
  "source": "instagram",
  "utm_campaign": "all-on-4-spring"
}
```

### `PATCH /api/leads/:id`
Update lead. Common: status changes, reassign.

### `GET /api/leads/funnel`
Returns counts + £ values per status (for pipeline header).

## Contacts

### `GET /api/contacts?type=patient&search=smith&limit=200`
### `GET /api/contacts/:id` — full contact with related leads/comms/appointments
### `POST /api/contacts` — create
### `PATCH /api/contacts/:id` — update

## Communications

### `GET /api/comms?contact_id=...&channel=email`
### `POST /api/comms/send` — send email/SMS
```json
{
  "contact_id": "uuid",
  "channel": "email" | "sms",
  "to": "patient@example.com",
  "subject": "...",
  "body": "..."
}
```

## Appointments

### `GET /api/appointments?from=...&to=...`
### `POST /api/appointments` — create
### `PATCH /api/appointments/:id` — reschedule/cancel

## Payments

### `GET /api/payments?status=settled&since=2026-01-01`
### `POST /api/payments/create-payment-link` — generates Stripe link
```json
Request:
{ "amount_pence": 28500, "description": "Consultation deposit", "contact_id": "uuid" }

Response:
{ "url": "https://buy.stripe.com/..." }
```

## Pay Runs *(owner-only)*

### `GET /api/pay-runs`
### `POST /api/pay-runs/calculate`
```json
{
  "period_start": "2026-04-01",
  "period_end": "2026-04-30",
  "lines": [
    { "associate_id": "uuid", "production_pence": 4500000, "lab_cost_pence": 320000 }
  ]
}
```
Returns calculated gross/lab deduction/net per line.

### `POST /api/pay-runs/:id/approve`

## Plan4Growth AI (AI)

### `POST /api/p4g-ai/chat`
```json
Request:
{
  "message": "What should I focus on this month?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

Response:
{
  "reply": "...",
  "usage": { "input_tokens": 234, "output_tokens": 567 }
}
```

## Analytics

### `GET /api/analytics/dashboard` — main dashboard rollup
### `GET /api/analytics/pl` — Profit & Loss using formulas.calculatePL()
### `GET /api/analytics/valuation` — 3-model valuation
### `GET /api/analytics/kpis` — 23-metric scorecard with traffic lights
### `GET /api/analytics/business-hub?days=90` — group + per-practice rollup (Business Hub): revenue (settled payments), appointments/no-show (appointments), conversion (leads), group margin/target from business_health baseline. finance.view.

## Files

### `POST /api/files/presign`
Returns S3 presigned upload URL (5min expiry, KMS encrypted).
```json
Request:
{ "filename": "lab-invoice-may.pdf", "content_type": "application/pdf" }

Response:
{ "uploadUrl": "https://s3.eu-west-2.amazonaws.com/...", "key": "...", "file": {...} }
```

## Memberships

### `GET /api/memberships/plans` — list plans
### `GET /api/memberships` — list active memberships
### `POST /api/memberships` — enrol new member

## Reviews

### `GET /api/reviews` — aggregated from Google/Trustpilot
### `POST /api/reviews/:id/respond`

## Workflows

### `GET /api/workflows`
### `POST /api/workflows`
### `PATCH /api/workflows/:id`
### `DELETE /api/workflows/:id`

## Tasks

### `GET /api/tasks?status=open&assigned_to=...`
### `POST /api/tasks`
### `PATCH /api/tasks/:id`

## Billing *(owner-only)*

### `POST /api/billing/portal`
Returns Stripe Customer Portal URL.

## Webhooks (public — signed)

### `POST /webhooks/stripe`
Validates `stripe-signature` header. Handles:
- `payment_intent.succeeded` → update payment status
- `customer.subscription.updated` → sync subscription_plan
- `customer.subscription.deleted` → mark cancelled

### `POST /webhooks/postmark/inbound`
Records inbound email as communication.

### `POST /webhooks/twilio/inbound`
Records inbound SMS as communication.

## Public OAuth callbacks (no auth — signed state)

### `GET /oauth/:provider/callback`
OAuth redirect target for integration providers. Public (mounted outside `/api`)
because the browser redirect carries no JWT. The org is recovered from the
HMAC-signed `state` param (`lib/oauth-state.js`), never `req.user`. On success
exchanges the `code` for tokens and redirects to `${FRONTEND_URL}/integrations?connected=<provider>`;
on failure redirects with `?error=<message>&provider=<provider>`. Used by GoHighLevel
(`gohighlevel`) and the OAuth provider stubs.

Requires env: `OAUTH_STATE_SECRET`, `BACKEND_PUBLIC_URL`, plus per-provider
`GHL_CLIENT_ID` / `GHL_CLIENT_SECRET`.

## Integrations (authenticated — owner only)

### `POST /api/integrations/connect`
Body `{ provider }`. For OAuth providers returns `{ redirectUrl }` (frontend
sends the browser there). GoHighLevel → `marketplace.leadconnectorhq.com/oauth/chooselocation`.

### `POST /api/integrations/:provider/refresh`
Forces an OAuth token refresh. For `gohighlevel`, guarded against concurrent
refresh (single-use token) via the `refresh_in_progress_at` claim; a non-claiming
caller returns `{ skipped: 'refresh_in_progress' }`.

### `POST /api/integrations/:provider/revoke`
Marks the integration `revoked` and clears stored secrets.

> GoHighLevel inbound sync (opportunities + contacts → leads/contacts) runs
> hourly in `workers/index.js`; not an HTTP endpoint.

## Error responses

All errors return:
```json
{ "error": "Human readable message" }
```

Status codes:
- `400` Validation failed (includes `issues` array)
- `401` Missing/invalid token
- `403` Insufficient permissions
- `404` Not found
- `429` Rate limited
- `500` Internal error

## Rate limits

- 100 requests/minute per IP (global, public routes)
- 50 requests/minute per authenticated user (`/api/*`, keyed by verified user id)
- 5 requests/minute per IP for `/auth/login`, `/auth/signup`, `/api/platform/login` (credential endpoints)
- 10 requests/minute for `/api/p4g-ai/chat` (AI)
- 20 requests/minute for `/api/files/presign` (uploads)

---

## Platform-admin surface (`/api/platform/*`)

**Auth model is completely separate from tenant auth.** Platform endpoints
authenticate against `platform_admins` using a dedicated JWT signed with
`PLATFORM_ADMIN_JWT_SECRET` (NOT the Supabase JWT). A tenant Supabase JWT will
be rejected with `401` here; a platform JWT will be rejected with `401` on
every tenant `/api/*` route. Every authenticated request writes one row to
`platform_audit_log` (fail-closed — a log error fails the request).

All endpoints accept `Authorization: Bearer <platform_jwt>` and respond JSON.

### `POST /api/platform/login`
Public, rate-limited to 5/min/IP. Returns a platform JWT + admin profile.
Reached via the unified `/login` page (see `POST /auth/login`), not a separate
admin login screen.
```json
Request:  { "email": "...", "password": "..." }
Response: { "token": "...", "admin": { "id", "email", "full_name", "role", "must_change_password" } }
```

### `POST /api/platform/orgs` *(superadmin)*
Creates a tenant organisation + owner directly (auto-approved, owner `active`).
Generates a one-time temp password returned ONCE (never persisted or audited).
```json
Request:  { "email": "...", "full_name": "...", "organisation_name": "..." }
Response: { "organisation_id": "uuid", "owner_id": "uuid", "email": "...", "temp_password": "..." }
```

### `GET /api/platform/signups`
Self-signup owners awaiting approval (status `pending`), with org name. Any admin.

### `POST /api/platform/signups/:id/approve` *(superadmin)*
Approves a pending owner → `active` (can now log in). `404` if `:id` is not an
owner, `409` if not `pending`. Audited.

### `POST /api/platform/signups/:id/reject` *(superadmin)*
Rejects a pending owner → `rejected` (row kept; login permanently blocked).
Same `404`/`409` guards. Audited.

### `POST /api/platform/change-password`
Authenticated. Verifies `current_password`, sets `new_password` (min 12 chars),
clears `must_change_password`.

### `GET /api/platform/me`
Returns the current platform admin record.

### `GET /api/platform/orgs?q=&limit=&offset=`
Lists all organisations (cross-tenant). Returns `{ rows, total }`.

### `GET /api/platform/orgs/:id`
Single org with `user_count`.

### `GET /api/platform/orgs/:id/users`
Users in that org (no RLS — service-client read).

### `GET /api/platform/orgs/:id/activity`
Tenant `audit_log` rows for that org, newest first.

### `GET /api/platform/users?q=&limit=`
Global user search by email substring (min 1 char from frontend; backend caps `limit` at 200).

### `GET /api/platform/metrics/overview?days=`
Cross-tenant counts and N-day deltas. Default `days=30`, max `365`.

### `GET /api/platform/metrics/integrations`
Per-provider connected/error/total counts across tenants.

### `GET /api/platform/audit?organisation_id=&user_id=&action=&limit=&offset=`
Cross-tenant tenant audit log.

### `GET /api/platform/audit/platform?limit=&offset=`
Platform-side audit log (who-did-what on `/api/platform/*`). Requires `superadmin` role.

### Roles
- `superadmin` — every endpoint, including `/audit/platform`, `POST /orgs`, and
  signup approve/reject.
- `support`    — read endpoints + `/me` + `/change-password`; NOT `/orgs`,
  signup approve/reject, or `/audit/platform`.
- `readonly`   — read endpoints only.

A platform admin with `must_change_password=true` is blocked (403) on every
route except `/me` and `/change-password` until they rotate their password.

### Env vars
- `PLATFORM_ADMIN_JWT_SECRET` (required at runtime, ≥32 chars)
- `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` + `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` — when both set
  AND the `platform_admins` table is empty, server boot creates the first
  superadmin with `must_change_password=true`. Idempotent thereafter.

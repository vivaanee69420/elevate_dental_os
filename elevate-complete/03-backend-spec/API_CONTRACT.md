# API Contract

REST · JSON · JWT auth (`Authorization: Bearer <token>` or `httpOnly` cookie) · all responses include `request_id` for correlating with audit logs.

Base URL: `https://api.elevateos.co/v1` (production) · `http://localhost:4000/v1` (dev)

---

## Conventions

- All IDs are UUIDs.
- Timestamps are ISO 8601 with timezone (`2026-05-25T14:30:00Z`).
- Money fields are decimal strings to avoid float drift: `"amount": "1450.00"`. Currency always GBP unless `currency` field present.
- Pagination: `?limit=50&cursor=<opaque>`. Responses include `next_cursor` and `has_more`.
- Errors: `{ "error": { "code": "string", "message": "string", "details": {...} } }` with appropriate HTTP status.
- Every mutating endpoint writes an audit event.
- Org scope is implicit from the JWT — clients never pass `organization_id`.
- RBAC enforcement: any endpoint a role can't access returns `403 Forbidden`.

---

## Auth

### `POST /auth/login`
```json
// Request
{ "email": "owner@gmdental.local", "password": "..." }

// Response 200 — MFA required
{ "mfa_required": true, "mfa_token": "<short-lived>" }

// Response 200 — MFA already verified this session
{ "user": { "id": "...", "role": "owner" }, "session_expires_at": "..." }
```

### `POST /auth/mfa/verify`
```json
{ "mfa_token": "...", "code": "123456" }
// Returns the same shape as a successful login.
```

### `POST /auth/mfa/enroll`
```json
// Response includes the otpauth URL for the QR code
{ "secret": "...", "qr_url": "otpauth://totp/Elevate:owner@gmdental.local?secret=..." }
```

### `POST /auth/logout`
Invalidates the session.

### `GET /auth/me`
Returns the current user + role + accessible pages.

---

## Permissions

### `GET /permissions`
Returns the full role × page matrix.

### `PUT /permissions/:role_code`
Owner only.
```json
{ "pages": { "page-id": { "can_view": true, "can_edit": false }, ... } }
```

---

## Organisations / Entities / Practices

### `GET /organizations/current`
Returns the org the user belongs to plus entity + practice lists.

### `GET /practices`
List visible practices (filtered by `user_practice_access` for non-owners).

### `GET /practices/:id`
Detail.

### `PUT /practices/:id`
Owner / Practice Manager. Edit name, chair count, address.

---

## Finance

### `GET /finance/monthly?entity_id=...&practice_id=...&from=2025-05&to=2026-04`
Returns the `monthly_financials` rows for the period. Powers the P&L, Cash Flow and Unified Dashboard pages.

### `GET /finance/pnl?entity_id=...&from=...&to=...`
Aggregated P&L grouped by revenue / COS / overhead / EBITDA buckets.

### `GET /finance/cashflow?entity_id=...&horizon=13w`
13-week or 26-week rolling cash projection. Used by the Run-Out Detector.

### `GET /finance/balance-sheet?entity_id=...&as_of=2026-04-30`
Latest snapshot.

### `GET /finance/valuation?entity_id=...`
Trailing 12-month normalised EBITDA, multiples, range.

---

## Clinical (Dentally mirror)

### `GET /patients?practice_id=...&q=...`
Search. Returns 50 by default, paginate via cursor.

### `GET /patients/:id`

### `GET /appointments?practice_id=...&from=...&to=...&status=...`

### `GET /appointments/today?practice_id=...`
Optimised for the dashboard's "today" view.

### `GET /utilisation?practice_id=...&from=...&to=...&granularity=day|week|month`
Chair utilisation derived from appointments + chair count + opening hours.

### `GET /associate-productivity?practice_id=...&from=...&to=...`

### `GET /treatments?practice_id=...&completed_from=...`
Returns aggregated treatment value by code.

### `GET /uda?practice_id=...&period=2025-04`
NHS UDA performance (data uploaded via CSV until BSA exposes an API).

---

## CRM (GoHighLevel mirror)

### `GET /crm/contacts?practice_id=...&q=...`

### `GET /crm/opportunities?practice_id=...&status=open`

### `GET /crm/inbox?practice_id=...`
Latest 50 conversations sorted by `occurred_at`.

### `GET /crm/deep-links/:practice_id/:module`
Returns the configured GHL URL to deep-link into.

### `PUT /crm/deep-links/:practice_id/:module`
Owner. Set the URL.

### `POST /crm/tasks` / `PUT /crm/tasks/:id`
Tasks shown on the CRM Today page. Some can be GHL-mirrored, some local.

---

## Launch Control

### `GET /launch/readiness`
Returns the 8-stage checklist with status + owner + notes.

### `GET /launch/integrations/health`
Returns connector status + last sync + recent webhook deliveries.

### `POST /launch/integrations/:id/test`
Owner. Runs a connectivity probe and returns the result.

### `GET /reconciliation/runs?control=...&from=...&to=...`

### `POST /reconciliation/run`
Owner / Finance Lead. Body: `{ "control_code": "cash_received" }`.
Returns the run + any exceptions created.

### `GET /reconciliation/exceptions?status=open`

### `POST /reconciliation/exceptions/:id/resolve`
Body: `{ "note": "...", "resolution_action": "..." }`. Writes audit.

### `POST /reconciliation/exceptions/:id/route`
Body: `{ "user_id": "...", "note": "..." }`.

### `GET /uploads`
Recent manual uploads.

### `POST /uploads`
Multipart form: `file`, `template`, `practice_id?`, `period?`.
Returns the parsed rows + validation errors. Status `pending` until approved.

### `POST /uploads/:id/approve`
Owner / Finance Lead. Promotes the upload's rows to normalized tables.

### `POST /uploads/:id/reject`
Body: `{ "reason": "..." }`.

### `GET /board-packs?period=2026-04`

### `POST /board-packs`
Owner / Finance Lead. Creates a draft for the given period.

### `POST /board-packs/:id/sign-off`
Owner. Locks the pack and triggers PDF generation.

### `GET /qoe/addbacks?period=2026-04`

### `POST /qoe/addbacks`

### `GET /audit-logs?from=...&to=...&action=...`
Owner only. Paginated.

### `GET /security/status`
MFA enrollment rates, recent suspicious events, token health summary.

---

## Webhook receivers (no auth — signature-verified)

### `POST /webhooks/dentally`
Persists raw payload, enqueues fetch-by-ID job.

### `POST /webhooks/xero`
Subscribed events: `INVOICE`, `CONTACT`, `PAYMENT` etc.

### `POST /webhooks/quickbooks`
CDC events.

### `POST /webhooks/ghl`
Contact / opportunity / conversation updates.

### `POST /webhooks/stripe`
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.

---

## Integration setup endpoints (owner only)

### `GET /integrations`
List configured integrations + status.

### `GET /integrations/:system/connect`
Returns the OAuth authorize URL (or shows instructions for API-key systems).

### `GET /integrations/:system/callback?code=...`
OAuth callback. Stores tokens, returns success.

### `POST /integrations/:id/disconnect`

### `POST /integrations/:id/refresh-token`
Manual refresh for debugging.

### `POST /integrations/:id/backfill`
Body: `{ "from": "2024-01-01", "to": "2026-05-01" }`. Queues a backfill job.

---

## KPI / dashboard

### `GET /kpis/today?practice_id=...`
Returns the dashboard KPIs computed live.

### `GET /kpis/series?practice_id=...&metric=revenue&from=2024-01&granularity=month`
Time series for charts.

### `GET /kpis/peer-benchmark?practice_id=...&metric=...`
Returns P25 / Median / P75 across the cohort (P&L benchmark cohort populated separately).

---

## Status codes used

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (queued for async processing) |
| 204 | No content (e.g. successful delete) |
| 400 | Validation failure |
| 401 | Not authenticated |
| 403 | Authenticated but not allowed |
| 404 | Not found / not visible to this role |
| 409 | Conflict (e.g. period already closed) |
| 422 | Semantically invalid (e.g. tolerance breach) |
| 429 | Rate limited |
| 500 | Server error |
| 502 | Upstream integration failure |
| 503 | Maintenance mode |

---

## Rate limits

- Per-user: 600 requests / minute
- Per-org: 6,000 requests / minute
- Webhook endpoints: not limited (signature-verified)
- Backfill triggers: 1 per integration per hour

---

## Versioning

The base path is `/v1`. Breaking changes ship under `/v2`. Non-breaking additions go into `/v1` with optional fields.

# API Reference — Elevate Dental OS

Base URL: `https://api.elevate.app` (production) · `https://staging-api.elevate.app` (staging)

All authenticated endpoints require `Authorization: Bearer <supabase_jwt>` header.

## Health check

### `GET /healthcheck`
Returns `{ status: 'ok', timestamp, version }`. No auth required.

## Authentication

### `POST /auth/signup`
Creates organisation + owner user.
```json
Request:
{
  "email": "owner@example.com",
  "password": "...",
  "full_name": "Owner Name",
  "organisation_name": "My Dental Group"
}

Response:
{ "success": true, "organisation_id": "uuid" }
```

### `GET /auth/me`
Returns current user info (used by sidebar).
```json
Response:
{
  "id": "uuid",
  "email": "...",
  "role": "owner" | "practice_manager" | "reception",
  "organisation_id": "uuid"
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

- 100 requests/minute per user (general)
- 10 requests/minute for `/api/p4g-ai/chat` (AI)
- 20 requests/minute for `/api/files/presign` (uploads)

# Dentally Setup

Step-by-step. Five days of work end-to-end.

**Current state:** zero. No connection exists. This document gets you to a working Dentally connector with real-time webhooks and a nightly backfill.

---

## Prerequisites

Before touching code:

1. **Confirm the Dentally account region.** UK/ROI uses `https://api.dentally.co`. APAC uses `https://api.apac.dentally.com`. Canada uses `https://api.ca.dentally.com`. Don't assume — ask the practice.
2. **Confirm access path.** You're starting on Dentally's v1 API. The NextGen API begins rolling out at the end of June 2026 to selected partners. v1 keeps working during the transition.
3. **Request sandbox access.** Sandbox base URL: `https://api.sandbox.dentally.co`. Use this for the entire build — never test against production until UAT.
4. **Get the practice's authorisation** to register an integration on their tenant. This needs the practice owner's sign-off in writing.

Official docs (last verified 25 May 2026):
- Developer site: https://developer.dentally.co/
- Webhooks help: https://help.dentally.com/en/articles/15031727-using-webhooks-in-dentally
- API collection: https://help.dentally.com/en/collections/13200453-dentally-api

---

## Day 1: Auth + base client

### Get credentials

In the practice's Dentally account, navigate to Settings → Developer → API Access. Generate an API key for your integration. Store it in the secrets manager (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager — never in `.env` committed to source).

### Build the HTTP client

`src/connectors/dentally/client.js`:

```js
const axios = require('axios');
const { getSecret } = require('../../config/secrets');

function makeClient(integrationId) {
  return axios.create({
    baseURL: process.env.DENTALLY_BASE_URL,  // e.g. https://api.sandbox.dentally.co
    headers: {
      'Authorization': `Bearer ${getSecret(`dentally.${integrationId}.token`)}`,
      'User-Agent': 'ElevateOS/1.1 (gaurav@gmdental.local)',  // mandatory
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30_000
  });
}
```

The `User-Agent` header is mandatory. Requests without it are rejected.

### Rate limiting

Dentally rate-limits per account. Use a token-bucket wrapper (`limiter` or `bottleneck` npm package) at 10 requests/second per integration. Back off on `429` with `Retry-After` header.

### Pagination helper

```js
async function fetchAllPages(client, path, params = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const { data } = await client.get(path, {
      params: { ...params, page, per_page: 100 }
    });
    results.push(...data[Object.keys(data)[0]]);  // Dentally wraps responses in a key
    if (data.meta?.total_pages && page >= data.meta.total_pages) break;
    if (!data.meta && data[Object.keys(data)[0]].length < 100) break;
    page++;
  }
  return results;
}
```

Never call this without a date filter — pulling all-time data is rejected.

---

## Day 2: Object pulls

The eight objects to sync, with reasoning:

| Object | Endpoint | Why |
|---|---|---|
| Patients | `GET /v1/patients` | Identity, contact, consent |
| Appointments | `GET /v1/appointments` | Utilisation, DNA, chair recovery |
| Payments | `GET /v1/payments` | Cash collection |
| Invoices | `GET /v1/invoices` | Revenue analysis |
| Invoice items | embedded | Treatment-level profitability |
| Treatment plans | `GET /v1/treatment_plans` | Open plans, conversion |
| Practitioners | `GET /v1/users` | Associate productivity |
| Rooms / Sites | `GET /v1/sites`, `GET /v1/rooms` | Chair filter, site grouping |

### Pull cadence

```js
// src/jobs/dentally-sync.js
const cron = require('node-cron');

// Real-time: webhook receivers handle this (Day 3)

// Every 15 minutes: today's diary
cron.schedule('*/15 * * * *', () => syncTodayAppointments());

// Nightly at 02:00: last 90 days backfill
cron.schedule('0 2 * * *', () => syncRolling90Days());

// Monthly: closed-month snapshot
cron.schedule('0 3 1 * *', () => syncClosedMonth());
```

Date filters are required. Dentally rejects appointment pulls covering more than ~3 months.

### Upsert pattern

```js
async function upsertPatient(p) {
  await db.query(`
    INSERT INTO patients (organization_id, practice_id, external_id, source_system, first_name, last_name, email, phone, date_of_birth, consent_marketing, consent_sms, consent_email)
    VALUES ($1, $2, $3, 'dentally', $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (source_system, external_id, practice_id)
    DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      date_of_birth = EXCLUDED.date_of_birth,
      consent_marketing = EXCLUDED.consent_marketing,
      consent_sms = EXCLUDED.consent_sms,
      consent_email = EXCLUDED.consent_email,
      updated_at = now()
  `, [orgId, practiceId, p.id, p.first_name, p.last_name, p.email, p.mobile_phone, p.date_of_birth, p.consent.marketing, p.consent.sms, p.consent.email]);
}
```

---

## Day 3: Webhooks

### Enable webhooks in Dentally

In Dentally: Settings → Developer → Webhooks. Add the receiver URL:

```
POST https://api.elevateos.co/v1/webhooks/dentally
```

Subscribe to all of these:

- `appointment.created`
- `appointment.updated`
- `appointment.deleted`
- `patient.created`
- `patient.updated`
- `patient.deleted`
- `payment.created`
- `payment.updated`
- `payment.deleted`

### Receiver

`src/webhooks/dentally.js`:

```js
const express = require('express');
const router = express.Router();

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // Step 1: Persist raw payload synchronously
  const event = JSON.parse(req.body);
  await db.query(`
    INSERT INTO raw_events (integration_id, event_type, external_id, payload, signature, received_at)
    VALUES ($1, $2, $3, $4, $5, now())
  `, [req.dentallyIntegrationId, event.event, event.id, req.body, req.get('X-Dentally-Signature')]);

  // Step 2: Acknowledge fast (Dentally retries if >5s)
  res.status(202).json({ received: true });

  // Step 3: Enqueue async processing
  await queue.add('dentally-normalize', { eventId: req.id });
});

module.exports = router;
```

The async worker fetches the full object by ID (webhooks contain a delta — pull the source of truth) and upserts.

### Failure handling

Dentally **deactivates** webhooks after repeated delivery failures. Wire monitoring:

- Alert if 3 consecutive `5xx` responses
- Alert if no webhook events in 24h (silent failure)
- Daily summary email to engineering with delivery stats

---

## Day 4: Field mapping for key Elevate features

| Elevate metric | Dentally fields |
|---|---|
| Chair utilisation | `appointment.start_time`, `appointment.end_time`, `appointment.room_id`, `appointment.user_id`, opening hours from `site.opening_times` |
| DNA rate | `appointment.state = 'no_show'` / total appointments completed |
| Associate productivity | Aggregated `invoice_items` by `practitioner_id` |
| Treatment profitability | `invoice_item.treatment_code` + cost mapping from Xero lab bills |
| Review request eligibility | `appointment.state = 'completed'` + `patient.consent.email = true` |
| Aged debt | `account.outstanding_balance` |

### Marketing consent

Dentally stores three consent flags per patient:
- `patient.consent.marketing`
- `patient.consent.sms`
- `patient.consent.email`

Mirror these to `patients` and check before triggering any review-request or marketing sequence. **If consent is `false` or unknown, do not contact.**

### NHS / UDA data

Some Dentally accounts expose UDA data via `nhs_claims` and related endpoints. Many don't. Confirm with the practice whether their account has this — if not, the UDA Tracker page falls back to monthly CSV upload via the manual feed.

---

## Day 5: Backfill + monitoring

### Initial backfill

Pull the last 12 months for the pilot practice (Ashford):

```bash
node scripts/backfill.js \
  --integration <dentally-integration-id> \
  --from 2025-05-25 \
  --to 2026-05-25 \
  --objects patients,appointments,invoices,payments,treatment_plans
```

Run in chunks of 60 days. Monitor for rate limit hits. A full year for one practice should take ~30 minutes.

### Monitoring dashboard

The Launch Control → Integration Health page reads from `sync_jobs` and `raw_events`. Make sure these are populated.

Metrics to alert on:
- Webhook delivery success rate < 95% over 1h
- Backfill job failed
- Token refresh failed (n/a for Dentally v1 — API key doesn't expire — but watch this for NextGen OAuth)
- Last sync `> 30 minutes` ago for any object during business hours

---

## Migration path: v1 → NextGen

Dentally's NextGen API rolls out to selected partners at the end of June 2026. When your account is enabled:

1. Get OAuth 2.0 credentials from Dentally
2. Build a parallel `dentally-nextgen` connector
3. Run both connectors against the same database for one week, compare outputs
4. Cut over once outputs match
5. Decommission v1 access

Plan one full week of developer time for this when it lands.

---

## Out of scope for v1

- Writing back to Dentally (Elevate is read-only in v1)
- Real-time chair availability lookup
- Treatment plan editing
- Patient creation
- Appointment booking

All of these stay in Dentally's own UI for now. Wire them in v1.1+.

---

## Acceptance criteria

Before this connector is "done":

- [ ] All eight objects sync nightly for one practice with no errors
- [ ] All eight webhook event types deliver to the receiver
- [ ] Webhook signature verification works (when Dentally publishes the verification mechanism for your account)
- [ ] A new appointment in Dentally appears in the Elevate UI within 15 minutes
- [ ] Backfill of 12 months runs in under 60 minutes
- [ ] `raw_events` log is populated and readable
- [ ] `sync_jobs` log shows success/failure with reasonable error messages
- [ ] Failed webhook deliveries alert via PagerDuty / email
- [ ] All consent flags propagate to `patients`

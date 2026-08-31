# Dentally API — endpoints we use and what we fetch

Everything below is what `backend/src/lib/integrations/dentally-sync.js` and
`dentally-provider.js` actually call and read, as of this commit. Inbound
webhooks (Dentally → us) are at the bottom.

## Connection basics

| Thing | Value |
|---|---|
| Data base URL | `https://api.dentally.co/v1` (per-org override via `integrations.config.base_url`, restricted to `https://*.dentally.co`) |
| OAuth base URL | `https://api.dentally.co` (`DENTALLY_AUTH_BASE` override) |
| Auth header | `Authorization: Bearer <token>` — either a pasted long-lived API key or an OAuth access token (~2h life, rotating refresh token) |
| Mandatory headers | `User-Agent: ElevateOS/1.0 (integrations@elevate.app)` (requests without it are rejected), `Accept: application/json` |
| Pagination | `page` + `per_page=100`; response is wrapped in a collection key (e.g. `{ patients: [...], meta }`) with `meta.total_pages` (often omitted — we stop when a page returns < 100 rows) |
| Rate limits | ~10 req/s; we pace at ~8 req/s (120ms between pages). Signalled as **429** (with `Retry-After`) *or* as **403** with body `{ error: { type: 'invalid_access_error', message: 'Rate limit exceeded' } }` (the sustained/hourly cap, no Retry-After) — both retried with backoff |
| Request timeout | 30s abort per request |
| Date filter | Mandatory on the big collections — we always pass `updated_after` (or `dated_after` for payments) |

### Sync windows (what `updated_after` is set to)

- **Incremental (30-min poll / nightly)**: `integrations.last_sync_at` (default: last 30 days on first run).
- **On-connect bootstrap** (`recent`): last **12 months**, page-capped at 900 pages/resource; plus a separate `after=now` pull so the upcoming diary always lands.
- **One-time full backfill** (`full`, first nightly run after connect): last **6 months**, page cap 15,000/resource.

## OAuth endpoints

### `GET /oauth/authorize` (browser redirect)

Query params we send:

```
response_type=code
client_id=<DENTALLY_CLIENT_ID>
redirect_uri=<BACKEND_PUBLIC_URL>/oauth/dentally/callback
state=<signed org state>
scope=patient:read appointment:read user:read practice:read financials:read treatments
```

`scope` is **required** by Dentally's Doorkeeper server (omitting it →
`invalid_request`; an unregistered scope name → 500). `financials:read` covers
both payments and invoices; `treatments` is a flat scope; `practice:read`
covers sites. Override via `DENTALLY_SCOPES`.

### `POST /oauth/token` (form-encoded)

Two grants:

```
# code exchange
client_id, client_secret, grant_type=authorization_code, code, redirect_uri

# refresh (single-use rotating refresh token — row is claimed first to avoid races)
client_id, client_secret, grant_type=refresh_token, refresh_token
```

Response fields we persist: `access_token`, `refresh_token` (encrypted into
`integrations.secrets`), `token_type`, `scope`, `expires_in` → `expires_at`.
We refresh ~5 min before expiry, and retry once on a mid-pull 401.

## Data endpoints (all GET, all paginated unless noted)

| Endpoint | Query params we send | Lands in table |
|---|---|---|
| `/patients` | `updated_after` | `contacts` |
| `/appointments` | `updated_after`, `cancelled=true`; also `after` (+`before`) | `appointments` |
| `/payments` | `dated_after` (+`dated_before` for reconcile) — **no** `updated_after` support | `payments` |
| `/practitioners` | *(none — full roster every sync)* | `associates` |
| `/users` | *(none — full roster every sync)* | `staff` |
| `/treatment_plans` | `updated_after` | `treatment_plans` |
| `/treatment_plan_items` | `updated_after` (the only filter Dentally honours) | `dentally_treatment_items` |
| `/invoices` | `updated_after` | `invoices` |
| `/invoice_items` | `updated_after` | `invoice_items` |
| `/sites` (fallback `/practices`) | *(one page only — site discovery)* | `practices` (auto-created on connect) |
| `/webhooks` | *(unpaginated list — health check only)* | not stored (UI status) |

Sync phase order: practitioners → users → patients → appointments (+ upcoming
`after=now` on bootstrap, + delete-reconcile) → payments (+ delete-reconcile) →
treatment_plans → invoices → invoice_items → treatment_plan_items → relink RPCs.

---

### `GET /v1/patients`

Params: `updated_after=<ISO>`, `page`, `per_page=100`.

Fields we read (→ `contacts` row, upsert key `organisation_id,source,pms_external_id`):

- **Identity**: `id`, `title`, `first_name`, `middle_name`, `last_name`, `preferred_name`, `gender` (boolean: true = male), `date_of_birth`
- **Contact**: `email_address` (there is no `email` field), `mobile_phone` / `home_phone` / `work_phone` (first non-null wins for `contacts.phone`), `preferred_phone_number`
- **Comms prefs**: `recall_method`, `use_email`, `use_sms`, `marketing`
- **Address**: `address_line_1`, `address_line_2`, `town`, `county`, `postcode`
- **Identifiers / misc**: `nhs_number`, `ni_number`, `occupation`, `payment_plan_id`, `active`, `acquisition_source_id`, `image_url`
- **Recalls**: `dentist_id`, `dentist_recall_date`, `dentist_recall_interval`, `hygienist_id`, `hygienist_recall_date`, `hygienist_recall_interval`
- **Emergency contact**: `emergency_contact_name`, `emergency_contact_relationship`, `emergency_contact_phone_normalized` (fallback `emergency_contact_phone`)
- **Clinical flag**: `medical_alert`, `medical_alert_text` (display-only; excluded from the AI context snapshot)
- **Attribution**: `site_id` → `practice_id` via `practices.pms_site_id`
- **Timestamps**: `created_at` (fallback `registered_at`, `date_of_registration`) → `pms_registered_at` (drives the "new patients" metric); `updated_at`

The whitelisted set above is also stored verbatim as the `pms_patient` JSONB
blob (patient detail dialog). Nothing outside the whitelist is persisted.

### `GET /v1/appointments`

Params: `updated_after=<ISO>`, `cancelled=true`, `page`, `per_page=100`.

`cancelled=true` is **required**: Dentally defaults to `cancelled=false`, which
silently withholds both cancelled *and* did-not-attend rows (no-show rate would
read zero and totals would understate by ~19% at a busy site).

Two extra call shapes on the same endpoint:

- **Upcoming diary** (bootstrap only): `after=<now ISO>`, `cancelled=true` — a small pull so future bookings can't be crowded out by history.
- **Delete reconciliation** (nightly, ±35-day window padded ±1 day): `after`, `before`, `cancelled=true` — pulls the authoritative id set; our `source='dentally'` rows in the window whose id Dentally no longer returns are deleted (fail-closed: aborts on any partial page, empty remote set, or a >50% delete share).

Fields we read (→ `appointments`, upsert key `organisation_id,source,pms_external_id`):

- `id`, `patient_id` (→ `contact_id` via contact map; kept raw as `pms_patient_id`), `practitioner_id` (→ `associate_id`; kept raw as `pms_practitioner_id`)
- `practitioner_site_id` (fallback `site_id`) → `practice_id` — rows with no matching practice are skipped (`practice_id` is NOT NULL)
- `start_time` (fallback `start`) → `starts_at` — rows with no start are skipped
- `finish_time` (fallbacks `finish`, `end_time`, else `starts_at`) → `ends_at`
- `state` (fallback `status`) → mapped status. Live values are Title-Case with spaces ("Did not attend", "In surgery"): confirmed → `confirmed`; arrived / in surgery / in progress → `in_progress`; completed / finished → `completed`; cancelled → `cancelled`; did not attend / DNA / FTA → `no_show`; anything else → `scheduled`
- `appointment_type` (fallback `reason`) → treatment label for Treatment Mix

### `GET /v1/payments`

Params: `dated_after=<YYYY-MM-DD>` (+ `dated_before` for the reconcile pull),
`page`, `per_page=100`. **This endpoint has no `updated_after`** — it filters
only on the payment date `dated_on`; an unknown param is silently ignored and
the whole history comes back. Back-dated edits to old payments are caught by
the periodic full backfill, and voided/deleted payments by the same fail-closed
delete-reconciliation as appointments (voids otherwise inflate Takings).

Fields we read (→ `payments`, upsert key `organisation_id,source,external_id`):

- `id`, `site_id` → `practice_id` (unmatched → skipped), `patient_id` → `contact_id`
- `amount` — **pounds decimal**, converted to integer pence (`Math.round(amount * 100)`)
- `method` (fallback `payment_method`) — free-text Title-Case ("Credit Card", "BACS"…), normalised to `card | cash | cheque | bank_transfer | direct_debit | finance | apple_pay | google_pay | pay_link` or a slug of the raw value
- `paid`, `status` (fallback `state`) → mapped status. Live vocabulary is `paid | unexplained | partially_explained`; unexplained/partially_explained are money **received** (unallocated credit) so they map to `settled`, not pending; failed/declined → `failed`; refunded/reversed → `refunded`; unknown → `pending`
- `deleted === true` rows are never ingested (soft-deletes)
- `dated_on` (fallbacks `payment_date`, `paid_at`, `created_at`) → `processed_at`

### `GET /v1/practitioners`

Params: none (full roster every sync — the set is tiny, and windowing by
`updated_after` dropped historical clinicians, which nulled practice
attribution on their treatment items).

Fields we read (→ `associates`, upsert key `organisation_id,pms_external_id`;
owner-set `pay_pct`/`lab_split_pct` are never touched):

- `id`; nested `user.{id, title, first_name, last_name, email, role}` — the human name lives on `user`, not the practitioner record; `user.id` → `pms_user_id` (the key that collapses one person's per-site practitioner rows)
- `site_id` → `primary_practice_id` (the "home site" used to attribute treatment plans/items to a practice)
- `active`, `gdc_number`, `nhs_number`, `colour`
- `contract_targets[]` — array of NHS contracts; `uda_target`/`uoa_target` are summed across them

### `GET /v1/users`

Params: none (whole-practice team, one unfiltered pull each sync).

Fields we read (→ `staff`, upsert key `organisation_id,source,pms_external_id`):
`id`, `title`, `first_name`, `last_name`, `email`, `mobile_phone`, `role`
(kept verbatim as `pms_role`, coarse-bucketed into reception / nurse /
hygienist / therapist / tco / manager / other), `site_id` → `practice_id`,
`last_login`. HR data (rates/hours) is not in Dentally — those columns stay
owner-entered.

### `GET /v1/treatment_plans`

Params: `updated_after=<ISO>`, `page`, `per_page=100`.

Fields we read (→ `treatment_plans`, upsert key `organisation_id,source,pms_external_id`):
`id`, `practitioner_id` (→ `associate_id` + home-site `practice_id`; the feed
carries **no site**), `patient_id` (→ `contact_id`), `private_treatment_value`
(money → pence), `nhs_uda_value`, `nhs_completed_uda_value`, `completed`,
`completed_at`, `start_date`, `end_date`. This is the per-practitioner
production feed the Associate Pay Run uses.

### `GET /v1/treatment_plan_items`

Params: `updated_after=<ISO>`, `page`, `per_page=100`. **Only `updated_after`
is honoured server-side** — `completed`/date/site filters are silently ignored
and the whole collection (~725k rows for the live group) comes back, so we page
everything and keep only `completed === true` rows. A resumable, page-cursor
backfill (`treatment_items_backfill_page` in config, 3,000 pages/run) exists
for orgs connected before this feed shipped.

Fields we read (→ `dentally_treatment_items`, completed rows only):
`id`, `completed`, `completed_at`, `base_chart` (charting noise flag — stored,
filtered by the rollup RPC), `price` (money **string** → pence), `duration`,
`practitioner_id` (→ home-site `practice_id` + `associate_id`), `patient_id`
(→ `contact_id`), `treatment_plan_id`, `treatment_appointment_id`,
`invoice_id`, `charged`, `appear_on_invoice`, `patient_nomenclature`
(fallback `nomenclature`) → `treatment_name`.

**Deliberately NOT read** (data minimisation): `teeth`, `surfaces`, `notes`,
`custom_fields` — sensitive clinical detail never leaves the API response.

This is the feed behind Dentally's Practitioner Activity report /
"Treatments Completed" card.

### `GET /v1/invoices`

Params: `updated_after=<ISO>`, `page`, `per_page=100`.

Fields we read (→ `invoices`, upsert key `organisation_id,source,external_id`):
`id`, `site_id` → `practice_id` (unmatched → skipped), `patient_id` →
`contact_id`, `amount` (→ pence), `amount_outstanding` (→ pence), `dated_on`,
`due_on`, `paid`, `patient_name`, and embedded `invoice_items[]` (used to
derive a one-line treatment label: single item's name, else "Multiple items").

The same pull also builds the transient invoice map
(`invoice_id → {practice_id, contact_id, dated_on, paid}`) that invoice items
resolve through — items carry no site/date of their own.

### `GET /v1/invoice_items`

Params: `updated_after=<ISO>`, `page`, `per_page=100`.

Fields we read (→ `invoice_items`, upsert key `organisation_id,source,pms_external_id`):
`id`, `name` → `treatment_name`, `item_price` (money **string** → pence,
unit price), `total_price` (qty-inclusive, fallback `item_price`) →
`fee_pence`, `quantity`, `nhs_charge`, `invoice_id` (resolves practice /
contact / `invoiced_on` / `invoice_paid` via the invoice map),
`practitioner_id` → `associate_id`, `treatment_plan_id`.

This is the real per-treatment fee feed (Revenue by Line, workbench case
fees). Dentally bumps a paid invoice's `updated_at` but not its items', so the
`propagate_invoice_paid` RPC reconciles `invoice_paid` after each sync.

### `GET /v1/sites` (fallback `GET /v1/practices`)

One page, no filters — connect-time site discovery only. We read `id` and
`name` (fallbacks `title`, `label`) and combine with a one-page sample of
`/patients`, `/appointments`, `/payments` (tallying their `site_id`s) so the
owner sees "Ashford (1,204 records)" instead of a raw id. On connect, one
`practices` row is auto-created per unmapped `site_id`.

### `GET /v1/webhooks`

Unpaginated list, read-only health check (`getWebhookHealth`). We read per
webhook: `id`, `url` (matched to ours via the base64url org token in the
path), `active` (Dentally auto-disables after repeated failures), `events`,
`failed_deliveries`, `successful_deliveries`, `last_delivered_at` — classified
into `unregistered | disabled | delivering | failing | idle` for the
Integrations panel. Note: a read-only API key gets a 403 here (webhook
management is registered manually in Dentally; we never POST webhooks).

---

## Inbound webhook (Dentally → us)

`POST /webhooks/dentally/:token` — `:token` is our signed base64url org token;
the body is raw JSON, verified with HMAC-SHA256 against the per-org
`config.webhook_secret` (header `X-Dentally-Signature` or `X-Signature`, raw
hex or `sha256=`-prefixed). Missing secret or bad signature → 401 (and the
failure reason is recorded for the owner UI).

Event parsing is tolerant: the event label comes from
`event | topic | resource_type | type | action`; the record(s) from
`data | payload | resource | record | <resource key> | the bare body`. Labels
matching `delet|destroy|remov` delete by external id; everything else upserts
through the **same row builders as the poller** (identical field mapping).

Resource types handled → tables:

| Resource | Table (delete key) |
|---|---|
| `patient` | `contacts` (`pms_external_id`) — then relinks that patient's orphaned appointments |
| `appointment` | `appointments` (`pms_external_id`) |
| `payment` | `payments` (`external_id`) |
| `invoice` | `invoices` (`external_id`) — embedded `invoice_items[]` are persisted inline |
| `invoice_item` | `invoice_items` (`pms_external_id`) — parent context looked up from stored invoices |
| `treatment_plan` | `treatment_plans` (`pms_external_id`) |

The 30-min/nightly poll remains the reconciliation backstop for anything a
webhook misses; per-record failures are logged and skipped (never 5xx'd —
Dentally auto-disables a webhook after sustained failures).

## Source files

- `backend/src/lib/integrations/dentally-provider.js` — OAuth/key connect, refresh, scopes
- `backend/src/lib/integrations/dentally-sync.js` — all data pulls, field mappers, delete reconciliation, webhook apply, webhook health
- `backend/src/services/webhook.service.js` — inbound webhook verification + event parsing
- `backend/src/services/integration.service.js` — connect/sync orchestration, webhook secret storage

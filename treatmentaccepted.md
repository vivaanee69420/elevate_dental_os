# Treatment Accepted — Emergent Integration Plan

## Status (2026-06-15) — display side SCAFFOLDED, ingest still blocked

Built on the Dental-os side now (Business Hub "Treatments Accepted" card):
- Migration `supabase/migrations/20260101000096_treatment_accepted.sql` — table +
  `treatment_accepted_aggregate(p_org,p_since,p_until,p_practice)` RPC.
  **NOT applied on hosted** (blocked on Emergent + the aggregate is gated, so not needed yet).
- `repositories/treatment-accepted.repository.js` — upsert / listByOrg / aggregate.
- `lib/integrations/emergent-sync.js` — `mapRecord` (pence conv) implemented; `syncOrg`/`syncAllOrgs` are skeletons that throw/no-op until the contract lands. NOT cron-wired.
- `lib/integration-gating.js` `emergentConnected(orgId)` — gates the aggregate so a
  never-connected org skips the RPC entirely (card shows "Connect Emergent" placeholder).
- Business Hub: `analyticsRepository.treatmentAcceptedRollup` → `group.treatmentsAcceptedCount`
  + `treatmentsAcceptedValuePence`; frontend "Treatments Accepted" card renders count + £ value.

Connect UI + config routes + webhook endpoint now built (store-only):
- `GET/POST/DELETE /api/integrations/emergent` (emergent.service.js) — stores base URL +
  encrypted API key, exposes the signed webhook URL. **Applied: migration 000096 IS now on hosted**
  (table + `treatment_accepted_aggregate`; same DB local+prod). treatmentAcceptedRollup also
  hardened to degrade to zeros if the RPC is ever absent.
- `EmergentPanel.tsx` in Settings → Integrations (connect form + webhook URL copy + disconnect).
- `POST /webhooks/emergent/:token` — token resolves the org, acks 202; **does NOT persist yet.**

Still TODO once Emergent returns the contract (base URL/key already storable): HMAC verify on the
webhook (add express.raw + signing secret), `mapRecord` field names, `syncOrg` pull loop + worker
cron. Resume at build-order step 4 (the connector body in emergent-sync.js).

## ⚠ Action items — BLOCKED on Emergent (chase these)

Cannot start coding the Dental-os side until Emergent returns:

- [ ] Base URL + `dops_live_...` API key
- [ ] Webhook shared secret + signature header name + algorithm (HMAC-SHA256?)
- [ ] Exact emitted JSON field names + types (money format, date timezone)
- [ ] Patient link key — Dentally patient id ideal; else name + practice + date
- [ ] `status` enum values (accepted / declined / pending / …)

Once all five are in, start at **Build order step 2** (migration).

---


Pull "treatment accepted" records that staff enter manually in the **Emergent** app
(Emergent.sh-built ops app) into Dental-os, and display them.

Dentally has **no** proposed/accepted flag (only a `completed` boolean — verified against
the live `/v1/treatment_plans` API). So acceptance is sourced from Emergent, where staff log
it by hand.

Two transports, both consumed by Dental-os:
- **Pull** — Dental-os calls Emergent's read API on a schedule (backstop / reconcile).
- **Push** — Emergent fires a webhook to Dental-os on every save (near-real-time).

Webhook is the primary path; the scheduled pull catches anything a missed/failed webhook dropped.

---

## Emergent side (their build — for reference, not ours)

Emergent will build:
- **API Key feature** — long-lived scoped key `dops_live_xxxxx`, sent as `X-API-Key`, read-only, revocable.
- **Read endpoint** — `GET /api/treatment-accepted?updated_after=<ISO>&cursor=<c>` → `{ data: [...], next_cursor }`.
- **Webhook** — on save of a treatment-accepted record, `POST` the record JSON to a URL we configure.

**What we must get from Emergent before coding our side:**
1. Base URL + the `dops_live_...` API key.
2. A **shared secret** for webhook signing (HMAC), or confirm they sign payloads — so we can verify authenticity.
3. The **exact JSON field names** they emit (map below assumes our target names; adjust on confirmation).
4. A **patient link key** — ideally the Dentally patient id (`pms_external_id`); else patient name + practice + date for fuzzy match.

Assumed record shape from Emergent:
```json
{
  "id": "emg_abc123",
  "patient_name": "Jane Doe",
  "patient_external_id": "12345",
  "practice_name": "Ashford",
  "practitioner_name": "Dr Smith",
  "treatment_name": "Invisalign Full",
  "value_gbp": 4200.00,
  "accepted_date": "2026-06-10",
  "status": "accepted",
  "created_at": "2026-06-10T09:12:00Z",
  "updated_at": "2026-06-10T09:12:00Z"
}
```

---

## Dental-os side — implementation

Follows existing integration patterns (Dentally/GHL): connector in `lib/integrations/`,
secrets encrypted via `crypto.js`, webhook routed by per-org token, repos use `serviceClient`
+ explicit `organisation_id` filter, money stored as **integer pence**.

### 1. Migration — new table

New file `supabase/migrations/20260101000089_treatment_accepted.sql` (bump to next free number),
idempotent. After applying on hosted, run `NOTIFY pgrst, 'reload schema';`.

```sql
create table if not exists public.treatment_accepted (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  source              text not null default 'emergent',
  external_id         text not null,                 -- Emergent record id
  patient_name        text,
  patient_external_id text,                           -- maps to dentally pms_external_id
  contact_id          uuid references public.contacts(id) on delete set null,
  practice_id         uuid references public.practices(id) on delete set null,
  practitioner_name   text,
  associate_id        uuid references public.associates(id) on delete set null,
  treatment_name      text,
  value_pence         bigint not null default 0,      -- value_gbp * 100, rounded
  accepted_date       date,
  status              text,                           -- accepted | declined | pending (Emergent's own)
  raw                 jsonb,                           -- full original payload for audit/replay
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, source, external_id)       -- upsert key
);

create index if not exists treatment_accepted_org_date_idx
  on public.treatment_accepted (organisation_id, accepted_date);
create index if not exists treatment_accepted_org_practice_idx
  on public.treatment_accepted (organisation_id, practice_id);

alter table public.treatment_accepted enable row level security;
-- RLS policy mirrors other business tables (org-isolation). App path uses serviceClient + .eq filter.
```

**Config storage:** reuse the `integrations` table with a new provider key `emergent`.
Store `{ base_url, api_key (encrypted), webhook_token, last_synced_at }` in its encrypted
`config`/secret column via `crypto.js` — do **not** put the API key in plaintext or env.
Per-org `webhook_token` is a random opaque string used in the webhook URL (GHL pattern).

### 2. Connector — `backend/src/lib/integrations/emergent-sync.js`

- `syncOrg(orgId)`:
  - load `emergent` integration row → decrypt `api_key`, `base_url`, read `last_synced_at`.
  - loop `GET {base_url}/api/treatment-accepted?updated_after={last_synced_at}&cursor=...`
    with header `X-API-Key: {api_key}`, follow `next_cursor` until null (page ~100).
  - for each record: `mapRecord()` → upsert into `treatment_accepted` on
    `(organisation_id, source, external_id)`.
  - on success, set `last_synced_at = max(updated_at)` (or now()).
- `mapRecord(rec, orgId)`:
  - `value_pence = Math.round(Number(rec.value_gbp) * 100)`.
  - resolve `practice_id` by matching `practice_name` against `practices` for the org.
  - resolve `contact_id` / `associate_id` by `patient_external_id` / `practitioner_name` where possible (best-effort, null if no match).
  - keep `raw = rec`.
- `syncAllOrgs()` — fan out over all orgs with an active `emergent` integration (worker entry).

Repo: `backend/src/repositories/treatment-accepted.repository.js` — `upsert`, `listByOrg({since, until, practiceId})`, `aggregate(...)`. Every query carries `.eq('organisation_id', orgId)`. `SAFE_COLS` excludes nothing sensitive (no secrets stored here), but never select `raw` on list endpoints.

### 3. Webhook receiver (primary path)

Route `POST /webhooks/emergent/:token` mounted **before** auth (public webhooks group in `app.js`).
- look up org by `:token` via `getByWebhookToken` (matches stored per-org `webhook_token`).
- **verify authenticity**: HMAC-SHA256 of the raw body against the shared secret, compared to
  an `X-Emergent-Signature` header (use `lib/crypto.js` / `webhook-token.js` helpers). Reject `401` on mismatch.
  - needs the raw body — register `express.raw` for this path before the global JSON parser
    (same ordering rule as the Stripe webhook).
- on valid: `mapRecord()` → upsert one row. Return `200` fast; do heavy resolves async if needed.
- log to `audit_log` (mutation).

### 4. Routes (config UI + manual sync) — `integrations.routes.js`

Owner-only (`requireRole('owner','practice_manager')`):
- `POST /api/integrations/emergent` — save `base_url` + `api_key` (encrypt), generate `webhook_token`, validate key with one test `GET`.
- `GET  /api/integrations/emergent` — status + masked key + the webhook URL to paste into Emergent.
- `POST /api/integrations/emergent/sync` — trigger `syncOrg` now.
- `DELETE /api/integrations/emergent` — disconnect (clear secrets).

### 5. Worker — backstop pull

Add a cron to `backend/src/workers/index.js` (e.g. hourly `0 * * * *`) calling `emergentSync.syncAllOrgs()`
via `serviceClient`. Reconciles any webhook misses. (Or a one-shot `workers/emergent-sync-once.js`
for a Railway Cron Schedule service — do not run both for the same job.)

### 6. Aggregate RPC (for display)

`supabase/migrations/...0090_treatment_accepted_rpc.sql`:
`treatment_accepted_aggregate(p_org uuid, p_since date, p_until date, p_practice uuid)` →
returns totals `{ accepted_count, accepted_value_pence }` and `perPractice[]`, grouping by
`practice_id`, filtered to `status='accepted'` and the date window. Windowed by ScopePeriod.

### 7. Frontend — display

New slice `frontend/features/treatment-accepted/` (api + hooks + components):
- card on **Business Hub / Treatments** screen: Accepted count + £ value for the current
  ScopePeriod window + practice scope (`useScopePeriod`, UUID-guarded → `practice_id`).
- optional table: per-practice / per-treatment breakdown, click-through.
- money displayed `(value_pence/100).toLocaleString('en-GB')`. British English. No emojis.
- React Query hook hitting the same-origin proxy `app/api/backend/[...path]`.
- Integration connect/config UI under Settings → Integrations (base URL + API key + copy webhook URL).

---

## Security / correctness checklist

- API key **encrypted at rest** (`crypto.js`); never logged, masked in UI/responses.
- Webhook **HMAC-verified** against shared secret; raw-body parser ordered before JSON parser.
- Per-org random `webhook_token` in the URL; org resolved from it.
- Tenant isolation: explicit `.eq('organisation_id', orgId)` on every query (serviceClient path).
- Money: `value_gbp → Math.round(*100)` pence; never floats downstream.
- Free-text (`patient_name`, `treatment_name`) **sanitized** before any AI-context use
  (`lib/ai/sanitize.js`) — and excluded from AI snapshots like other patient notes.
- Idempotent upsert on `(org, source, external_id)` — webhook + pull can't double-count.
- Every mutation audited to `audit_log`.
- British English UI, light mode only, no emojis (project rules).

## Tests (vitest, `backend/test/`)

- `mapRecord` pence conversion (4200.00 → 420000).
- Upsert idempotency (same `external_id` twice → one row, fields updated).
- Webhook signature: valid passes, tampered body → 401, unknown token → 404/401.
- Pull pagination follows `next_cursor` to exhaustion; `updated_after` advances `last_synced_at`.
- Cross-org isolation (org A cannot read org B's records).
- Aggregate RPC totals + practice scoping + date window.

## Docs

- `docs/API.md` — new endpoints + webhook.
- `docs/FORMULAS.md` — only if any new financial calc is added (aggregate is a plain sum → probably none).

---

## Build order

1. Get base URL + API key + webhook secret + field names from Emergent.
2. Migration (table + config storage) → apply on hosted → `NOTIFY pgrst`.
3. Connector + repo + `mapRecord`.
4. Webhook receiver (primary) + signature verify.
5. Config routes + manual sync.
6. Worker backstop cron.
7. Aggregate RPC.
8. Frontend slice + card + Settings connect UI.
9. Tests + docs.

## Open questions for Emergent

- Exact emitted field names + types (esp. money format and date timezone).
- Does it sign webhooks? What header + algorithm? Shared secret available?
- Patient link key — Dentally patient id available, or name+practice+date only?
- `status` enum values (accepted / declined / pending / …) so we map cleanly.
- Retry behaviour on webhook failure (so we know how hard the pull backstop must work).

# Emergent → Practice Mapping + Real-Time Webhook

Date: 2026-06-16
Status: Design (awaiting review)

## Problem

Two gaps in the existing Emergent (Treatments Accepted) integration:

1. **No explicit practice mapping.** `treatment_accepted` rows resolve `practice_id` by
   fuzzy substring match of the Emergent `business_name` against `practices.name`
   (`resolvePractice` in `emergent-sync.js`). Ambiguous/no match → `null` → folds into the
   "unmapped" bucket. The owner has no way to fix or confirm the mapping from the UI.
2. **Webhook is a stub.** `/webhooks/emergent/:token` verifies the org token then returns
   `202 { processed: false, reason: 'emergent_ingest_pending_contract' }` and persists
   nothing. Data only lands via the nightly/manual pull, so there is no real-time path.

We now have the Emergent webhook contract (below), so both can be built.

## Emergent webhook contract (provided)

```
POST <per-org webhook URL>
Content-Type: application/json
X-Webhook-Event: treatment.accepted        # also .updated / .deleted — fires on all events
X-Webhook-Signature: sha256=<hmac-hex>     # HMAC-SHA256(secret, rawBody), hex

{
  "event": "treatment.accepted",
  "fired_at": "2026-06-15T10:00:00Z",
  "data": {
    "business_id": "...",
    "business_name": "Ashford",
    "date": "2026-06-15",
    "patient_name": "Emma Wilson",
    "treatment_accepted": "Dental Implant",
    "amount": 15108.00,
    "source": "google",
    "campaign": "Implant Campaign",
    "dentist": "Dr. Sarah Johnson",
    "comments": ""
  }
}
```

`data` is identical to one row of the pull endpoint, so the existing `mapRecord()` already
handles it. Signature scheme is byte-identical to the live Dentally webhook
(`sha256=` hex over the raw body, verified against a per-org `config.webhook_secret`).

## Decisions (from brainstorming)

- **Webhook contract**: real spec above (not assumed).
- **Mapping model**: separate `emergent_practice_map` table (not a `practices` column) —
  flexible if one practice ever spans multiple Emergent businesses.
- **Backfill on save**: yes — re-stamp existing `treatment_accepted` rows for that
  `business_id` when a mapping changes, so the practice link flips instantly with no re-sync.
- **Unmapped default**: keep the current fuzzy fallback when no explicit map row exists, so
  nothing regresses for already-connected orgs. Explicit map row always wins over fuzzy.

## Component 1 — Practice mapping

### Schema (migration `000100_emergent_practice_map.sql`)

```sql
create table if not exists public.emergent_practice_map (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  business_id     text not null,                                   -- Emergent business id
  business_name   text,                                            -- cached label for UI
  practice_id     uuid references public.practices(id) on delete set null,  -- null = intentionally unmapped
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, business_id)
);
create index if not exists emergent_practice_map_org_idx
  on public.emergent_practice_map (organisation_id);
alter table public.emergent_practice_map enable row level security;
-- App path uses serviceClient + explicit .eq('organisation_id', orgId) (rule 3).
notify pgrst, 'reload schema';
```

Idempotent, additive. Applied on hosted with `NOTIFY pgrst, 'reload schema';` after.

### Resolution change (`emergent-sync.js`)

- New `loadPracticeMap(orgId)` returns `{ explicit: Map<business_id, practice_id>, fuzzy: Map<name, id> }`
  — load `emergent_practice_map` rows alongside the existing practices-by-name map.
- `mapRecord(rec, orgId, maps)` resolves `practice_id`:
  1. explicit map by `rec.business_id` (including an explicit `null` → unmapped on purpose);
  2. else fuzzy `resolvePractice(rec.business_name, fuzzyMap)` (unchanged) as fallback.
- **Business discovery**: every sync upserts the distinct `(business_id, business_name)` it
  sees into `emergent_practice_map` with `practice_id` left `null` (only on insert — never
  clobber an existing mapping). So the mapping UI lists every business that has sent data,
  even before an owner maps it. Webhook deliveries do the same upsert (new business shows up
  in the UI the moment its first event lands).

### Repository (`emergent-practice-map.repository.js`)

Org-scoped (serviceClient + explicit `organisation_id` filter, rule 3):
- `list(orgId)` → rows joined to practice name for display.
- `discover(orgId, [{business_id, business_name}])` → insert-if-absent (no clobber).
- `setMapping(orgId, business_id, practice_id)` → upsert the `practice_id`.

### Backfill on save (`emergent.service.js`)

`setMapping(orgId, business_id, practice_id)`:
1. upsert the map row;
2. `update treatment_accepted set practice_id = $practice_id where organisation_id = $org and raw->>'business_id' = $business_id` — instant re-stamp.

Returns the refreshed list. Owner-only.

### Routes (`integrations.routes.js`, owner / practice_manager read, owner write)

```
GET   /api/integrations/emergent/practices            -> list businesses + current mapping
PUT   /api/integrations/emergent/practices/:businessId -> { practice_id } set + backfill
```

### Frontend (`EmergentPracticeMapping.tsx`)

Mirrors `DentallyPracticeMapping.tsx`: a `CollapsibleCard` table — Emergent business name |
practice `<select>` (org practices + "Unmapped") | Save. Badge shows `N unmapped` count.
Rendered under `EmergentPanel` on the Integrations screen, only when Emergent is connected.

## Component 2 — Real-time webhook

### Raw body mount (`app.js`)

Add alongside the existing raw mounts, before the global JSON parser:
```js
app.use('/webhooks/emergent', express.raw({ type: '*/*', limit: '1mb' }));
```

### Webhook secret storage

The owner sets a signing secret in Emergent and pastes it into Dental-os. Stored as
`config.webhook_secret` on the `emergent` integration row (plaintext in config, same as
Dentally — it is a verification secret, not a credential to a third party). Set via:
- a new optional field in `EmergentPanel` ("Webhook signing secret"), wired to
- `POST /api/integrations/emergent/webhook-secret { secret }` (owner-only) →
  `emergentService.setWebhookSecret`.

If no secret is configured, the webhook is **rejected 401** (no unauthenticated ingest) —
the panel shows a "set a signing secret to enable real-time" hint. The signed URL token
still gates which org; HMAC gates payload integrity.

### Controller (`webhook.controller.js`)

Replace the stub: read `X-Webhook-Signature` + `X-Webhook-Event`, pass the raw `req.body`
Buffer (now raw-mounted) to `webhookService.emergent(token, body, signature, event)`.

### Service (`webhook.service.js` → `async emergent`)

Mirror `dentally`:
1. `verifyWebhookToken(token)` → orgId (401 on tamper).
2. Load `emergent` integration; 404 if missing/revoked.
3. `config.webhook_secret` required → HMAC-SHA256 hex over the raw body, `timingSafeHexEqual`
   against the `sha256=`-stripped header. Sanitized self-diagnostic warn on mismatch (8-char
   prefixes only), 401. (Lift the helper already used by `dentally`.)
4. `JSON.parse` raw → `{ event, data }`.
5. `discover(orgId, [{business_id, business_name}])` so a new business appears in the UI.
6. Route by `event` (suffix after `treatment.`):
   - `accepted` / `updated` → `mapRecord(data, orgId, maps)` → `treatmentAcceptedRepository.upsert`.
   - `deleted` → compute `externalId(data)` → `treatmentAcceptedRepository.deleteByExternalId(orgId, 'emergent', externalId)`.
   - unknown event → `{ received: true, ignored: true }`.
7. `integrationRepository.setSyncTime(orgId, 'emergent')` so "last sync" reflects live webhooks.

**Known limitation (documented, not solved here):** `externalId` is a hash of
business/date/patient/treatment/amount (no stable Emergent id). A `treatment.updated` that
changes one of those fields hashes to a *new* id → upsert inserts a new row and orphans the
old one. Acceptable: matches the existing pull-path behaviour; flagged for a future stable-id
contract. `treatment.deleted` only cleanly removes a row whose fields are unchanged since
creation.

### Repository addition (`treatment-accepted.repository.js`)

`deleteByExternalId(orgId, source, externalId)` — `delete ... where organisation_id = $org
and source = $source and external_id = $externalId`.

## Testing

- `mapRecord` resolution: explicit map wins over fuzzy; explicit `null` forces unmapped;
  fuzzy fallback intact when no map row.
- `setMapping` backfill re-stamps existing rows by `raw->>'business_id'`.
- Webhook: valid signature → accepted/updated upsert; deleted removes; bad signature → 401;
  missing secret → 401; tampered token → 401; unknown event → ignored; new business →
  discovered into `emergent_practice_map`.
- Cross-org isolation on the new routes + repo.

## Out of scope

- Stable Emergent record id / clean update-with-changed-fields (needs an Emergent contract change).
- Patient/associate linkage (`patient_external_id`, `associate_id` stay null — no link key).
- Any change to the Business Hub Treatments Accepted card (already reads the aggregate; it
  just gets better practice attribution for free).
```

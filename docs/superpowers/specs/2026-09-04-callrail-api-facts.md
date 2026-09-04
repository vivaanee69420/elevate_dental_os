# CallRail API + webhook facts

Source: https://apidocs.callrail.com/ (official v3 docs), read 2026-09-04.
These are FACTS from the vendor docs, not assumptions. Where something is
still unknown it says so explicitly.

Moved here from the gitignored `.superpowers/sdd/2026-09-03-callrail-integration/`
scratch directory (2026-09-04 review round) so a fresh clone can actually read
it — every in-code pointer to it now targets this path.

## 0. Account -> Company -> Calls (the hierarchy — settled during the same review)

`/v3/a/{id}` always takes the CallRail **ACCOUNT** id (shaped
`ACC8154748ae6bd4e278a7cddd38a662f4f`). Companies live under an account:
`GET /v3/a/{account_id}/companies.json` lists them, and
`GET /v3/a/{account_id}/companies/{company_id}.json` fetches one.
`GET /v3/a/{account_id}/calls.json` accepts a `company_id` filter — "if
provided, only return calls to tracking numbers belonging to this company."
Do not conflate the two ids: an earlier implementation of this integration
treated a pasted company id as the account id everywhere, which 404'd the
one-company-per-key connect flow described in §1 below, and which — when an
owner pasted the account id instead, the only value that passed — pulled
every company's calls under one company's practice_id.

## 1. CallRail DOES sign its webhooks

- Header name: **`Signature`** (exactly that, confirmed from the docs' own code element).
- Algorithm: **HMAC-SHA1** — *not* SHA256. Do not copy the Dentally/Emergent
  SHA256 helper without changing the digest.
- Key: the **per-COMPANY signing key**. CallRail's words: "CallRail generates a
  secret, random token for every company that can be viewed on the Webhooks
  configuration page inside the application."
- Encoding: **Base64**, strict. Reference implementation from the docs:

  ```ruby
  hmac = OpenSSL::HMAC.digest(OpenSSL::Digest.new('sha1'), YOUR_COMPANY_SIGNING_KEY, request_payload)
  signature = Base64.strict_encode64(hmac)
  ```

  Node equivalent: `crypto.createHmac('sha1', key).update(rawBody).digest('base64')`.
- Computed over the **raw request body**, so the raw-body mount in `app.js` is
  required, exactly as the plan says.
- Compare with a **timing-safe** comparison (`crypto.timingSafeEqual` on equal-length
  buffers), never `===`.

**The docs hand you a test vector. Use it as a fixture — do not invent one.**
Signing key `072e77e426f92738a72fe23c4d1953b4` over the JSON body quoted in the
docs' "Validating Payloads" section must produce `UZAHbUdfm3GqL7qzilGozGzWV64=`.
A test built on that vector proves the implementation against the vendor, not
against itself. The body is long; fetch it from the docs page rather than
retyping it.

**Where the signing key is stored: `integration_accounts.config`, per account.**
It is per-COMPANY, which is why `'callrail'` was removed from `WEBHOOK_PROVIDERS`
(commit `7e73336`) — the org-level `config.webhook_secret` on the `integrations`
marker row would force all four of the owner's companies to share one signature.
The random path token stays the primary authentication; the signature is a
second factor, verified only when a key has been configured for that account.

- The payload carries a **`timestamp`** field, which the docs offer explicitly
  for replay prevention. Reject deliveries older than a sane window.

## 2. Delivery semantics — why the nightly pull is not optional

- **"CallRail does not resend webhooks."** One delivery, ever. Anything lost to a
  deploy, restart or transient error is gone from the webhook path permanently.
- **"Repeated failed webhooks could result in an automated disabling of the
  webhook integration."** So the handler must return 2xx quickly and must not
  fail the response on downstream trouble. Do the cheap idempotent thing, respond,
  then let the pull reconcile.
- The **post-call webhook can lag up to 20 minutes** after hangup — it waits for
  recording/transcription. It is not real-time; do not build UI copy claiming it is.

## 3. IDENTITY TRAP — read this before writing either ingest path

API v3 returns a call `id` as a **string**: `"CAL8154748ae6bd4e278a7cddd38a662f4f"`.
The webhook example payload in the docs' own "Validating Payloads" section shows
`"id":766970532` — a **legacy numeric** id. The docs say the webhook "sends the
call object ... as specified in the call endpoint" but also that "for legacy
purposes some additional fields are returned".

If the webhook path stores `766970532` and the pull path stores `CAL8154…` for
the same call, `UNIQUE (organisation_id, callrail_id)` does not fire and **every
call double-counts**. That is the same shape of bug that inflated Emergent's
accepted value by ~£1m (see `synthesised-identity-raw-hash` in memory).

**RULING — the webhook is a TRIGGER, not the source of truth.**

1. Verify the path token, then the `Signature` if a key is configured.
2. Take the id from the payload and **fetch the canonical call from the API**:
   `GET https://api.callrail.com/v3/a/{callrailAccountId}/calls/{id}.json?fields=…`
3. Upsert THAT object. Both paths then write the identical `id` form, from the
   same source, through the same `upsertCalls`.
4. If the fetch fails, **do not store a half-identity**. Return 2xx anyway — a
   non-2xx risks CallRail disabling the integration — and let the nightly pull
   collect the call. Log it.

The cost is one extra API call per real call. The owner's volume is ~50 calls a
month against a 1,000/hour limit, so this is free in practice.

## 4. Field selection is MANDATORY on the pull

The default `calls.json` response contains only: `answered`,
`business_phone_number`, `customer_city`, `customer_country`, `customer_name`,
`customer_phone_number`, `customer_state`, `direction`, `duration`, `id`,
`recording`, `recording_duration`, `recording_player`, `start_time`,
`tracking_phone_number`, `voicemail`, `agent_email`.

**Every attribution field this feature exists for is absent by default** and must
be requested with `?fields=`: `gclid`, `keywords`, `campaign`, `source`,
`first_call`, `company_id`, `medium`, `landing_page_url`, `referring_url`,
`tracker_id`, `lead_status`, `utm_source`, `utm_medium`, `utm_campaign`,
`utm_term`, `utm_content`.

Omit `fields=` and the sync silently stores rows with a null `gclid` and null
`source` — a working-looking integration that answers no question it was built
for. Use ONE shared field list constant across the webhook fetch and the pull so
the two cannot drift.

## 5. Column mapping (`callrail_calls` ← CallRail)

| Column | CallRail field |
|---|---|
| `callrail_id` | `id` (string, canonical API form) |
| `tracking_number` | `tracking_phone_number` |
| `caller_number` | `customer_phone_number` (E.164) |
| `caller_phone10` | `normalisePhone(customer_phone_number)` |
| `caller_name` | `customer_name` (caller ID, often shouty or a place name) |
| `caller_email` / `caller_email_norm` | **nothing — always NULL** |
| `started_at` | `start_time` |
| `duration_seconds` | `duration` |
| `answered` | `answered` |
| `first_call` | `first_call` (selected field) |
| `gclid` | `gclid` (selected field) |
| `keywords` | `keywords` (selected field) |
| `campaign` | `campaign` (selected field) |
| `source` | `source` (selected field) |
| `raw` | the whole object as received |

**A call carries no email address.** CallRail has no email for a phone call, so
`caller_email` is null on every row. The cross-source dedup against GoHighLevel
leads therefore keys on `phone10` alone for calls — the email branch of the
matcher can never fire for them. Worth a comment where it matters, so nobody
later reads the null as a sync bug.

## 6. Pull mechanics

- Auth header: `Authorization: Token token="YOUR_API_KEY"` (note the inner quotes).
- Send `Request-From: elevate_dental_os` — the docs ask third-party integrations
  to identify themselves this way.
- **Use relative pagination for calls**, which the docs recommend for larger sets:
  `relative_pagination=true`, then follow `next_page` and stop when
  `has_next_page` is false. `per_page` max 250 on this endpoint.
  Do NOT mix relative and offset pagination in one traversal.
- Date filtering: `date_range` (see the docs' "Filtering by Date").
- **Rate limits: 1,000/hour and 10,000/day**, and an exceeded limit returns
  **HTTP 429**. Back off on 429. (Note this differs from Dentally, which signals
  rate limiting as a 403 — see `dentally-403-rate-limit` in memory. Do not copy
  that connector's 403 handling here.)

## 7. Still unknown

- Whether the post-call webhook's `id` is the numeric legacy form or the `CAL…`
  string. The RULING above makes this moot: we never trust the payload's shape,
  we re-fetch. If you find hard evidence either way while implementing, record it
  here rather than changing the ruling on a guess.

# Daily WhatsApp Report via GoHighLevel — Design

Date: 2026-07-19
Status: Approved, ready for implementation plan

## Problem

The owner has no daily pulse on the numbers that matter. Everything lives in the
dashboard and requires logging in. We want one WhatsApp message per day, readable
in under a minute, covering leads, ad spend and efficiency split by Google vs Meta,
plus headline Dentally and QuickBooks figures.

## Solution summary

A nightly-scheduled backend job builds a single-line report string from existing
services and POSTs a flat JSON payload to a GoHighLevel **Inbound Webhook** URL.
A GHL Workflow writes the line into a Contact custom field and sends it as an
approved WhatsApp template with one variable. Recipient management lives entirely
in GHL — this system never handles phone numbers.

An owner-only "Send now" button triggers the identical code path on demand.

## Key constraint driving the design

WhatsApp template parameters **cannot contain newlines, tabs, or 4+ consecutive
spaces** (Meta Cloud API restriction, enforced downstream of GHL). Therefore the
report is a single pipe-separated line, not a formatted multi-line block. This is
settled — no newline verification is needed.

The GHL Multi line custom field holds up to **12,000 characters** (verified), so
field size is not a constraint. The report is nonetheless capped at **350
characters** — a deliberate readability choice, meeting the original "readable in
under a minute" goal. The cap is enforced in code with a section drop order, which
in practice should never trigger.

Field size does not unlock multi-line layout: that remains blocked by Meta's
template-parameter rule, which is independent of storage.

Byte-vs-character note: if GHL counts bytes rather than characters, `£` and `·`
cost 2 bytes each in UTF-8. Separators are therefore plain ASCII (`|`, `,`) and
`£` is used only where it carries meaning, buying headroom for free.

## Scope

In scope:
- Group-level totals only. No per-practice breakdown.
- Previous full day's data. Delivered 18:00 Europe/London daily.
- One webhook URL per organisation.
- Manual send + preview.

Out of scope (deliberate):
- Per-practice lines. Adding a practice would force WhatsApp template re-approval;
  revisit only if requested.
- Trend/comparison figures (e.g. `LEADS 24 (7d avg 19)`). Likely the first
  follow-up once the boss asks "is that good or bad?".
- Any recipient/phone-number handling. Owned by GHL.

## Reporting window

Delivery is 18:00 Europe/London; the **content is the previous full day**.

Rationale: all upstream feeds sync overnight — Google Ads 02:45, Meta Ads 02:50,
Dentally 03:00, Emergent cash-up 03:20, GHL 22:00. At 18:00 today, only GHL leads
are live; ad spend is ~20 hours stale. Computing CPL/CPA from today's leads over
yesterday's spend would produce a wrong headline efficiency metric — the single
number most likely to be acted on. Reporting a complete, internally consistent
yesterday is the only trustworthy option without adding a second daily ad sync.

The report is explicitly dated (`Daily 21 Jul`) so there is no ambiguity
about which day it describes.

## Architecture

```
18:00 Europe/London
  cron `daily-whatsapp-report` (workers/index.js, via scheduleMonitored)
    → for each org with settings.enabled
        → dailyReportService.send(orgId, { date: yesterday, trigger: 'cron' })
             ├─ buildDailyReport()  — composes existing services, no new queries
             ├─ formatReportLine()  — pure fn → single pipe-separated line
             └─ ghlWebhook.post(url, payload)   ← plain POST, no auth
                  → GHL Workflow: Inbound Webhook trigger
                       → Update Contact Field  dental_os = {{payload.report_line}}
                       → Send WhatsApp template {{contact.dental_os}}
```

Manual send calls the same `dailyReportService.send` with `trigger: 'manual'`,
so the button cannot drift from the cron.

### Data sources

`buildDailyReport` composes what already exists. No new SQL, no new RPCs.

| Metric | Source |
|---|---|
| leads, conversions, CPL, CPA, conversion rate, per-channel | `adAttributionService.getPerformance(orgId, { since, until })` |
| spend split Google/Meta | same call's `channels[].spendPence` |
| cash in | `cockpitService.build(...)` → `revenue.month.todayPence` |
| appointments, DNA, DNA rate, new patients, margin | `analyticsService.businessHub(orgId, { since, until })` |

Note `adAttributionService` channel keys are `google_ads` / `meta_ads`.
(`leadAttributionService` uses `google` / `facebook` — do not mix the two.)

## Data model

One migration, one table:

```sql
whatsapp_report_settings
  organisation_id  uuid  PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE
  webhook_url      text        NOT NULL   -- encrypted via lib/crypto encryptSecret
  enabled          boolean     NOT NULL DEFAULT false
  last_sent_at     timestamptz
  last_status      text                   -- 'ok' | 'failed' | 'skipped'
  last_error       text
  last_payload     jsonb                  -- last payload sent, for debugging
  created_at       timestamptz NOT NULL DEFAULT now()
  updated_at       timestamptz NOT NULL DEFAULT now()
```

RLS enabled per house convention; repository additionally applies an explicit
`.eq('organisation_id', orgId)` filter on every query, matching the existing
service-client pattern.

The webhook URL is encrypted at rest: possession of it allows anyone to push an
arbitrary message to the owner's WhatsApp.

`board_report_schedules` is deliberately **not** reused. It is email/recipient
shaped and carries frequency logic irrelevant at a fixed 18:00. Its *cron pattern*
(`activeAcrossOrgs` + `markSent`) is copied; the table is not.

## Payload contract

Both the assembled line and every raw field are sent. Mapping one field in GHL
works today; moving to a multi-variable template later requires no backend change.

```json
{
  "report_date": "2026-07-21",
  "report_date_label": "Tue 21 Jul",
  "organisation": "Plan4growth",
  "report_line": "Daily 21 Jul | Leads 24 (Google 14, Meta 10) | Spend £412 ...",

  "leads_total": 24, "leads_google": 14, "leads_meta": 10,
  "spend_total": "£412", "spend_google": "£412", "spend_meta": "not reporting",
  "cpl_total": "£17.17", "cpl_google": "£29.43", "cpl_meta": "n/a",
  "conversions": 6, "conversion_rate": "25%", "cpa": "£68.67",
  "cash_in": "£6,240",
  "appointments": 118, "dna": 7, "dna_rate": "5.9%", "new_patients": 12,
  "qbo_revenue_mtd": "£142k", "qbo_margin": "18.4%"
}
```

Formatter rules:

1. **Money is pre-formatted as display strings.** Pence→`£6,240` happens in our
   formatter. Raw pence integers are excluded from the payload entirely, so no one
   can accidentally map `624000` into a message.
2. **Null spend renders `"not reporting"`, never `£0`.** `adAttributionService`
   returns `spendPence: null` when a feed reports nothing; that guard is why the
   currently-dead Meta feed is visible rather than silently reporting zero spend.
   Dependent metrics render `n/a`. Covered by a test.
3. **`report_line` is guaranteed free of newlines, tabs and 4+ consecutive spaces.**
4. **`report_line` is capped at 350 characters.** This is an enforced guard, not an
   assumption: the typical line is ~215 chars, but wide values (six-figure spend,
   `not reporting` on both channels) can reach ~280. When the cap would be exceeded,
   sections are dropped in this order:
   1. QuickBooks (`QBO MTD ...`)
   2. Dentally (`Appts ...`)

   Ad metrics and cash in are never dropped — they are the reason the report exists.
5. Separators are ASCII (`|` between sections, `,` within them). `£` only where
   it carries meaning. See the byte-vs-character note above.

## Example output

```
Daily 21 Jul | Leads 24 (Google 14, Meta 10) | Spend £412 (Google £412,
Meta not reporting) | CPL £17.17 | Conv 6 (25%), CPA £68.67 | Cash in
£6,240 | Appts 118, DNA 7 (5.9%), New pts 12 | QBO MTD £142k, margin 18.4%
```

Shown wrapped for readability; sends as one unbroken line. ~215 characters.

## UI

A new card inside the existing `GoHighLevelPanel` on the Integrations page — this
is GHL plumbing and belongs with GHL rather than in a new settings area.

```
Daily WhatsApp Report                          [ Enabled ● ]
Sends group totals for the previous day at 18:00 UK, every day.

Inbound webhook URL
[ https://services.leadconnectorhq.com/hooks/…        ] [Save]
Paste the URL from your GHL Workflow's Inbound Webhook trigger.

Preview  ─────────────────────────────────────────────────
Daily Report Tue 21 Jul | LEADS 24 (Google 14 · Meta 10) | …

Last sent  Tue 21 Jul 18:00 · Delivered
                                          [ Send now ]
```

- **Preview** renders the live line without sending, so the real text and its
  length can be checked before submitting the WhatsApp template for approval.
- **Send now** is the manual trigger. Owner-only, rate-limited to a small number
  per hour.
- **Last sent** surfaces the real delivery outcome including failure reason, so a
  broken webhook is visible in the UI, not only in Sentry.

British English throughout, light theme only, no emojis, per project rules.

### Routes

All owner-only (`requireRole('owner')`), under the existing GHL namespace:

- `GET  /api/integrations/gohighlevel/daily-report` — settings (URL masked)
- `PUT  /api/integrations/gohighlevel/daily-report` — save URL + enabled
- `POST /api/integrations/gohighlevel/daily-report/preview` — build, do not send
- `POST /api/integrations/gohighlevel/daily-report/send` — manual send

Static paths must be registered before any `/:provider/*` route, matching the
existing GHL dashboard route ordering.

## Error handling

- Webhook POST: 10s timeout, 2 retries with backoff. Non-2xx is a failure,
  recorded in `last_status` / `last_error`.
- **A failed send never throws out of the cron.** Per-org try/catch collecting
  `{ orgId, ok, error }`, matching `syncAllOrgs` isolation — one org's bad URL
  cannot stop the rest.
- **Empty-data orgs send nothing** and record `last_status = 'skipped'`. A digest
  full of £0 trains the reader to ignore it.
- **Same-day duplicate protection** via `last_sent_at`, so a worker restart at
  18:05 cannot double-send. Manual send bypasses this guard deliberately.
- Mutations audited to `audit_log` per house rule 9.

## Testing

Vitest, backend. Value concentrates in the pure functions.

- `formatReportLine`: null spend → `not reporting`; dependent metrics → `n/a`;
  pence→£ formatting; output contains no newline/tab/4-space run; truncation at
  the 350-char cap drops QuickBooks first, then Dentally, and never the ad metrics
  or cash in; a worst-case wide-value line still fits.
- `buildDailyReport`: correct window — yesterday in Europe/London, not UTC. A
  naive `new Date()` would select the wrong day for part of the year.
- Cron: one org failing does not abort the others; same-day resend is blocked;
  manual send bypasses the block.
- Settings repository: cross-org isolation.

Frontend has no test framework; the card is verified by typecheck/lint/build.

## Estimated size

One migration, ~4 new backend files (service, repository, `lib/integrations/ghl-webhook.js`,
routes), one worker cron entry, one frontend card. Roughly half a day, most of it
the formatter and its tests.

## Open items before implementation

None blocking. All three earlier questions are resolved:

1. Newlines — avoided entirely by using pipe separators on a single line.
2. Custom field value cap — verified at 12,000 characters. The 350-char cap is a
   readability choice, not a technical limit.
3. Boss as a GHL Contact — confirmed handled on the GHL side.

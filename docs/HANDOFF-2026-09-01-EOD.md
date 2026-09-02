# Handoff — 1 September 2026 (end of day)

Marketing section, part two. **Supersedes `HANDOFF-2026-09-01.md`**, which was written
mid-day at `58a4030` and describes the section as two screens. It is now six.
Earlier context: `HANDOFF-2026-08-27.md`.

## State

| | |
|---|---|
| `HEAD` / `origin/main` | `261e6f9` — in sync, working tree clean |
| Commits since the mid-day handoff | 7 (`d7e2b97` → `261e6f9`) |
| Migrations | `000140`–`000143` applied on hosted (`mkfhpzjbijbachoonytt`) |
| Frontend typecheck | clean (re-run at EOD) |
| Backend tests | 2,018 passing / 216 files (re-run at EOD) |

`main` auto-deploys to app.elevate.app via the Railway GitHub integration.

## First thing tomorrow

1. **Confirm the deploy landed.** Open `/marketing-overview` on app.elevate.app and check
   all six nav items render. The last push was late; the rollout may not have completed.
2. Pick up from "What to build next" below.

## What shipped today (after the mid-day handoff)

The Marketing section went from 2 screens to 6, and the numbers behind them were corrected.

### Screens

| Route | What it answers |
|---|---|
| `/marketing-overview` | Spend, leads, cost per lead, new patients, cost per new patient |
| `/marketing-channels` | Facebook vs Google, split rather than blended |
| `/marketing-campaigns` | One row per campaign with spend, ordered by spend |
| `/marketing-practices` | Every practice side by side — own spend, leads, channel mix, cost per new patient |
| `/marketing-leads` | The named people behind the counts; filter by channel and outcome, paged server-side |
| `/marketing-health` | Every blank on the other pages, explained with its number |

Endpoints: `GET /api/marketing/{performance,trend,leads}`, all `requirePermission('marketing.view')`.
Reception can never see this section (project rule 5).

### Correctness fixes, in the order they were found

- **`ad_metrics.practice_id` was never stamped** (`08a3ed2`, migration `000140`) — every
  per-practice spend figure read £0. Stamped at the write choke point plus a restamp RPC.
  Without this the Practices screen was not buildable at all.
- **PostgREST's 1000-row cap** on `ad_lead_conversions` (`d7e2b97`) — a set-returning
  function is capped exactly like a table. Paged.
- **Leads who were already patients were dropped** (`bcce144`) — and then, separately,
  counted as acquisition. Migration `000142` adds `is_new_patient`: converted **and** no
  appointment starting before the window opened. In Plan4growth's August window, 236
  matches split into 174 new and 62 existing — **26% of what was reported as acquisition
  was not acquisition.**
- **Cache key versioned** (`c76da7a`) — a payload shape change would otherwise have been
  served from the old cache.

### Performance findings worth keeping

- `marketing_monthly_rollup` (migration `000143`) exists because the trend screen needs a
  year, and the row-level `ad_lead_conversions` is 10,429 rows at 2.8s a call — which the
  1000-row cap turns into eleven calls, ~30s to draw a 36-point chart. Aggregate in SQL
  when the screen wants aggregates; the row-level function stays right for a single month.
- **Channel resolution is duplicated** between `marketing_monthly_rollup` (SQL) and
  `marketing.service.js` (JS). They must keep matching. If you change one, change both —
  order is: a campaign id we hold spend for names its own provider (definitive), then
  attribution source.

## What to build next

Ranked. Everything in the first group joins tables that already hold the data.

### 1. Funnel — spend → lead → consult booked → attended → new patient
The one stage nothing measures. `ghl_appointments.contact_id` (migration `000088`) joins
straight to `contacts.ad_campaign_id` (`000137`); `marketing.repository.js` does not
reference `ghl_appointments` at all today. Without it you can see that a campaign is
expensive but not *where* it leaks — booking or attendance.

### 2. Return on ad spend in pounds
Every screen stops at "became a new patient" and never reaches money. `invoice_items`
holds real fees and Emergent `treatment_accepted` holds accepted value. Extending
`ad_lead_conversions` to carry revenue gives true ROAS and payback per campaign. This is
the number an owner actually asks for, and the section cannot answer it.

### 3. Reviews — wire up what is already written
`frontend/features/growth/components/ReviewsScreen.tsx` and `ReviewSourcesPanel.tsx` are
complete and **orphaned**: no route, no nav entry, referenced by nothing
(`grep -rn ReviewsScreen` returns only its own definition). Backed by the live `reviews`
table and Google Places. Roughly a ten-line job to surface under Marketing.

### 4. Landing pages
`contacts.landing_page_url` is captured on every GHL sync by
`lib/integrations/ghl-attribution.js` and read by nothing.

### 5. Speed to lead, cut by campaign
`sheet_leads.called_3m` / `called_10m` plus `communications` timestamps. Exists today as
Call Reporting under Elevate CRM with no ad dimension.

### Blocked on new platform data — do not plan these as if they were near
- **Ad set / creative performance.** `contacts` carries `ad_id` and `ad_set_id`, but
  `ad_metrics` stores spend only at campaign grain (unique key is
  `org, provider, customer_id, campaign_id, metric_date`). Needs the sync to pull
  ad-group/ad-level rows plus a schema change before any cost-per-creative exists.
- **Search terms / keywords** — not synced at all.
- **Budget pacing** — no budget field anywhere.

## Open question worth deciding

Three marketing screens still live outside the Marketing section: `ad-performance` (under
Overview), `marketing` "Marketing & ROI" (under Growth), and `call-reporting` (under
Elevate CRM). `ad-performance` overlaps the new Channels and Practices screens
substantially. Decide whether to move, merge, or retire them before adding a seventh page —
otherwise the section grows while the duplicates stay.

## Traps this work re-confirmed

- A comment rationalising a zero is a smell. `ad_metrics.practice_id` had one.
- PostgREST caps set-returning RPCs exactly like tables. Page on a unique key; stop on an
  empty page, not a short one.
- The frontend proxy forwards the path verbatim — a missing `/api` prefix 404s **silently**
  into an empty state.
- After any hosted DDL: `NOTIFY pgrst, 'reload schema';`

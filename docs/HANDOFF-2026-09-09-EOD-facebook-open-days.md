# EOD — 2026-09-09 · Facebook report: open days vs always-on

**Commit:** `cb037f7` on `main` (pushed).
**Sibling handoff:** `HANDOFF-2026-09-09-EOD.md` covers a separate session
(Finance section audit). This one does not supersede it — different work.
**State:** backend 327 files / 3,715 tests green · 0 lint errors (13 pre-existing
warnings) · typecheck clean · frontend typecheck, lint and production build
clean · ggshield clean across the pushed range.

---

## Where it started: "0 leads for an open day is impossible"

The Facebook report showed **£4,053 spent** on *Mint | Dental Implant Open Day
July 26* against **0 leads, 0 booked, 0 patients**. The owner's reading was that
the report was broken. It was not, and the answer matters more than the screen
did.

Measured, not inferred:

| Fact | Value |
|---|---|
| Campaign id | `120244119161520688` |
| Lifetime spend / clicks | £7,375.88 · 8,105 clicks (3 Jun – 23 Jul) |
| **Meta's own reported conversions** | **860** |
| Contacts in the org carrying that campaign id | **0** |
| Ads under the campaign in `ad_meta_ads` | 40 |
| Contacts carrying **any** of those 40 ad ids | **0** |

The resolution path itself works — the control (Sept open day
`120247375001150688`) has 13 ads and 50 contacts resolving by ad id. This one
campaign simply has no counterpart anywhere in the CRM.

**Where those leads actually are.** Rochester's GoHighLevel pipeline
**"Open Day Archive - IMPLANTS"** took **128 leads in July 2026**, and **111 of
the 128 carry no ad attribution at all** — no campaign id, no ad id. The 17 that
are attributed point at always-on campaigns, never the open day.

So there are two gaps, and only one is ours:

1. **Ours.** The practice retires each finished open day into an archive
   pipeline — `Open Day Archive - IMPLANTS` / `- COSMETIC` at Rochester, and the
   equivalents at Ashford, Barnet and FTS, **4,056 leads between them**. None of
   those pipelines is mapped to `meta_ads` or to an open day, so
   `ad_meta_funnel`'s pool excludes them and they never reach the Facebook
   report at any grain. Mapping them on the Integrations page is a one-off fix.
2. **Not ours.** Those leads carry no attribution from GoHighLevel. Mapping the
   archives moves them into the report's *unmatched* bucket — it will **not**
   put them on the July campaign row, because nothing links them to it. That row
   will still read 0.

Working theory for the missing attribution, **not yet verified**: a Meta Instant
Form lead never visits the website, so GoHighLevel has no web session and
therefore no attribution record to hand us. Probe the GHL side before asserting
it.

---

## What shipped: one filter, applied everywhere

Open days are named **events** promoted by a handful of campaigns. Their
economics are nothing like an always-on campaign's — a burst of spend before a
date, a rush of leads around it, then nothing — so blended together they average
into a number describing neither. Measured on Rochester, 1 Jul – 9 Sep:

| Bucket | Spend | Leads | Booked | Patients | Cost/lead |
|---|---|---|---|---|---|
| All | £16,362.40 | 712 | 88 | 17 | £22.98 |
| Always-on | £10,467.18 | 643 | 78 | 17 | £16.28 |
| Open days | £5,895.22 | 69 | 10 | 0 | £85.44 |

A segmented control — **All · Always-on · Open days** — sits above the cards,
held in the URL (`?bucket=`) beside `?tab=` so a view is shareable and the back
button works. It filters the cards, the per-practice rows, the campaign
highlights, the comparison period, **all four tabs**, and the leads drawer. The
drawer gained an "Open day" column naming the event.

**Server-side, not in the browser.** The partition rule already exists once, in
`lib/marketing/open-days.js` — spend's event comes from its **Meta campaign**, a
lead's from its **GoHighLevel pipeline**. Filtering five surfaces client-side
would have been five re-implementations of that rule, free to drift.

**No migration.** `ad_grain_rollup` already returns `campaign_id` at every
grain, so ad sets and ads inherit their campaign's event; ledger rows already
carry `open_day_id`.

**The partition is asserted, not asserted-to.** `alwaysOn + openDays == all`,
metric for metric, verified on live data for one practice and for the group,
across the cards, the per-practice rows, Collected, the drawer row counts and
the tab totals — and pinned by tests. Unfiltered figures are unchanged.

Note the split makes the original problem *visible* rather than burying it:
open-day leads cost £85.44 against always-on's £16.28 almost entirely because
that July campaign's £4,053 bought nothing traceable.

---

## Three defects found while building it

1. **A bucket with leads and no spend priced out at £0.00** — the best cost per
   patient in the group, from the bucket with no data. Now `null` (em dash),
   matching the guard the split rows below the cards already applied.
2. **An empty bucket reported a broken sync.** On the tabs it would have said
   "no Meta spend in the selected period" beside a period that plainly has some,
   or on the deep-grain tabs that the ad-set sync had never run — a false alarm
   about infrastructure, raised by a filter the reader chose. New `empty_bucket`
   state; a genuinely unsynced tenant is still reported honestly.
3. **`leadPerformance` decided "the window is empty" from the FILTERED rows**,
   so choosing an empty bucket collapsed the whole payload into the
   not-connected shape, losing the per-practice rows and campaign table. The
   emptiness test now reads the unfiltered window.

---

## Deliberately not done

- **`withLeadCosts` has the same latent £0.00-on-zero-spend behaviour, and it is
  live on the Google report today** — the code comments already record Ashford
  and Barnet reading "£0.00" there. It is shared code, so fixing it moves
  numbers on a page nobody asked to change. Small change, owner's call.
- **The archive-pipeline mapping** (item 1 above) is a data/setup action on the
  Integrations page, not code.
- **Verifying the GHL attribution theory** — needs a probe of the GoHighLevel
  API, per rule 11.

---

## Repo housekeeping — READ BEFORE PULLING

`TASKS.md` and the committed `frontend/.next/` build output (87 files across 3
commits) were purged from the full history with `git filter-repo`, and all **17
branches and 1 tag were force-pushed**. The repo dropped **44M → 8.9M**.

Consequences for anyone with a checkout:

- Every branch SHA changed. `main` is now `3605f65`.
- Four spec/plan commits made by a parallel session during the rewrite were
  rescued with `git rebase --onto origin/main` and are on `main` — nothing lost.
- **Each of the 8 worktrees must re-sync** once its session is idle:
  `git fetch origin && git reset --hard origin/<branch>` (commit or stash first
  — `feat/open-days-exec` had 2 uncommitted files at the time of writing).
- `feat/open-days-exec` is **local-only, never pushed**, so its history still
  contains pre-rewrite commits. It needs
  `git rebase --onto origin/main <its-old-base>` before it is ever pushed, or it
  would reintroduce the purged blobs.
- Pre-rewrite backup bundle (all 63 refs):
  `~/dental-os-prepurge-20260909-192414/full-repo.bundle`.

---

## Files touched

**Backend** — `lib/marketing/open-days.js` (the shared bucket predicates),
`services/facebook-report.service.js`, `controllers/marketing.controller.js`
(`bucket` enum on `FacebookQuerySchema`), `repositories/marketing.repository.js`
(`practice_id` widened into the campaign-spend select), and
`test/facebook-bucket.test.mjs` (23 new tests).

**Frontend** — `features/marketing/_shared/AdBucketFilter.tsx` (new: control +
`?bucket=` URL hook), `facebook/api.ts`, `facebook/hooks.ts`,
`FacebookReportScreen.tsx`, `FacebookPerformancePanel.tsx`, `FacebookAdsTab.tsx`,
`FacebookOpenDaysTab.tsx`, `FacebookStateNotice.tsx`.

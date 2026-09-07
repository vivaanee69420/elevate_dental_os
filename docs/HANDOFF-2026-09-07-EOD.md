# Handoff — 2026-09-07 EOD

Everything below is on `main` and pushed. A second Claude session ran in this
repo for most of the day; **the last section names what was theirs**, because
the commit log interleaves the two and it matters when tracing a regression.

---

## 1. Agency: a switcher that only switches

`a202763`

The sub-account control did two jobs. Switching account — done several times a
day — opened a dialog whose contents were tab-access toggles, a user-creation
form and a Delete button, so the frequent action arrived wrapped in the rare and
dangerous ones.

- Sidebar control is now a **switcher**: search, recents, pins, agency first, a
  tick on where you are.
- Everything done **to** a sub-account moved to **Settings → Sub-accounts**.
- The panel is `position: fixed`, measured off its trigger. The sidebar sets
  `overflow-hidden` because it animates its own width, so an in-flow popover
  wider than the rail is clipped to nothing — it would render and be invisible.
- The rail entry hangs off the per-user agency grant, **not** a permission key,
  and sits outside the Settings feature filter on purpose: an agency actor
  switched into a sub-account with Settings off must still be able to turn it
  back on.

**Live data change:** `organisations.name` for the agency org
(`1a5f888a-0dfe-4802-acf8-6003665089ad`) renamed `Plan4growth` → **GM Dental
Group**, with migration `20260101000173` so a local reset matches. Nothing joins
on the name; the delete-confirmation echoes the row's current name and follows
automatically.

---

## 2. Dentally: the sub-account incident, and what it exposed

This began as "why is the Rochester sub-account pulling everything" and turned
into five separate defects.

### 2.1 A Dentally grant is group-wide (`a68b5c6`, `5328d1e`)

Connecting Dentally inside a sub-account hands us a token that can read **every**
practice. The bootstrap created a practice per detected site and pulled the lot:
**9,446 contacts, 21,800 appointments, 218 practitioners, 270 staff** belonging
to four other practices, with nobody asked at any point.

- `bootstrapOnConnect` now **stops** when it detects more than one site and waits
  for a choice. One site is not a decision, so a single-site tenant is never
  asked; an org that never chose keeps pulling everything.
- The selection gates the **rows**, not just the practice list. Appointments,
  payments and invoices were already safe (NOT NULL `practice_id` drops an
  unmapped row); patients, practitioners and staff set `practice_id: null` and
  inserted regardless.
- Measured before building: `site_id` narrows **every** collection — patients
  9,553→4,108, appointments 33,828→12,675, payments 13,138→5,103, invoices
  23,721→9,294, practitioners 218→75, users 270→99. Expansion lives at the fetch
  layer, so N selected sites is N filtered passes and there is no unfiltered
  fallback.

> **Trap:** Dentally caps `per_page` at **100**. Asking for 250/500/1000
> silently returns **25**. Raising it would have made the pull 4x slower.

> **Reconcilers:** both sides are scoped together or neither is. Narrowing only
> the remote set would mark every row of the other practices as deleted-upstream
> and erase real clinical history as a side effect of a settings change. The
> invoice pair is the sharpest case — `reconcileMissingInvoices` hands its
> collected ids straight to the delete prune.

### 2.2 Unattributable rows (`63044c8`, then `cd93ced`)

`treatment_plans`, `dentally_treatment_items` and `invoice_items` have a
**nullable** `practice_id`. In the sub-account: **64,165 / 10,792 / 7,700** rows
with no practice. Treatments Completed counted them all — **1,981 for June
against 775** that were Rochester's, and **341 for a September week against
Dentally's own 96**.

**I got the first fix wrong and shipped it.** I resolved practice from the
practitioner alone and dropped what didn't resolve — which also deleted the
account's own work whenever the practitioner was missing from `associates` (a
locum, a leaver). The figure went from too high to too low.

The correct rule is **practitioner first, patient second**: contacts are pulled
site-filtered, so a patient we hold is a patient of a practice we selected. A row
is dropped only when neither is ours. `invoice_items` keep the strict rule —
they take practice from their invoice, and `invoices.practice_id` is NOT NULL.

### 2.3 A first pull now survives a restart (`cf11fb1`)

The pull is an in-process job, so a deploy kills it and **nothing records that** —
`last_sync_at` only advances on completion. My own pushes killed it twice.

- The per-phase checkpoint existed but was fenced to the full backfill; the
  bootstrap is the *first* pull and needed it more.
- `config.bootstrap` marks a run in flight; `resumeInterruptedImports` picks up
  stale markers on boot (45s in) and from the nightly cron. A fresh marker is
  never touched, and attempts cap at four.
- The panel says **why** it stopped and offers **Resume**. An upstream failure
  records itself; a killed process cannot — so an absent error beside a stale
  marker *is* the diagnosis.

### 2.4 Honest import state (`aa88377`, `4d1ccb3`, `6b3bd12`, `6a1a59b`, `0d22aec`)

"Synced never" was true and useless: a pull 4,000 rows in, one that never
started, and one that died at 90% all read identically.

- **Data in this account** panel: row counts per resource, live while running.
  Generalised to every provider via a registry (`import-summary.repository.js`).
- Polling is driven by the **server's** running flag and continues in a
  background tab. Chrome throttles background timers and React Query pauses
  `refetchInterval` on blur, so switching tabs froze the overlay on its last
  payload for ever.
- Progress is in-memory and per-process. An absent record now reports `missing`
  rather than "idle at 0%", so a deploy mid-sync no longer leaves the overlay
  waiting for a `done` that cannot arrive.
- `google_ads`, `meta_ads` and `xero` named the callback `_onProgress` and never
  called it — hence "Starting… 0%" for an entire run that landed 2,961 rows.

> **My bug:** the Google tile's id is `google` (it fronts three Google
> connections) but the registry key is `google_ads`, so the panel said "Nothing
> pulled yet" over real data. An unknown provider now renders **nothing** rather
> than claiming emptiness.

### 2.5 Live data removed

Deleted from `gm dental Rochester` (`b0c4f2df-…`) at the owner's instruction:
21,800 appointments, 9,446 contacts, 218 associates, 270 staff, 4 practices, then
64,165 / 10,792 / 7,700 unattributed rows. Users, permissions, plans and audit
log kept. **Parent org verified untouched** (118,165 appointments, 49,313
contacts, 5 practices).

The Dentally OAuth token for that sub-account was **revoked at Dentally** to stop
the runaway pull without restarting the backend. Its token differed from the
parent's, verified before revoking.

---

## 3. Migration `20260101000174` — FK indexes on contacts

Postgres does not index the referencing side of a foreign key. Deleting 9,446
contacts timed out repeatedly, and **1,000-row batches still timed out**:
`dentally_treatment_items.contact_id` (256k rows) and `leads.contact_id` (22.8k)
had no index, so each deletion scanned ~279k rows. Indexed, the same 9,446 went
in one statement. Eight FK indexes added.

This is not only a cleanup concern — contact merges and any GDPR erasure walk the
same path.

---

## 4. Ad performance, rebuilt

`339c45f` (backend), then `bdd6a64` → `8ec9158` (UI, ten commits of iteration).

**The numbers were wrong for a structural reason.** The page had its own
implementation measuring acceptance by joining **Emergent** treatments, while the
Facebook and Google report pages measure **settled payments over £40**. Two
definitions of one word on two screens — and this page's produced zeros: 0
conversions, 0.0% rate, "Not reporting" CPA and £0 accepted beside £7,103.97 of
spend, while Emergent held 10 acceptances that month.

Now: each channel **delegates** to the service its marketing page uses, so the
surfaces cannot disagree. The only figure computed here is the cross-channel one.

> **The dedup limit, stated not hidden:** the ledgers identify people
> differently — Meta by `contact_id`, Google by `phone10`, because much of
> Google's volume arrives via CallRail which carries **no email**. Email is the
> only shared key, so the overlap is a genuine **lower bound** and the panel
> reports how many rows can never be matched.

**UI**, after a lot of back-and-forth with the owner:

- Two sub-pages (Facebook / Google) rather than stacked blocks. Global **period**
  at the top; **accounts** per channel, under the tab that selects them.
- The Business Hub's own `HeadlineCard`, so the three surfaces are one product.
- CPL / CPB / CPA as tags on the card each prices. Arrows always on, never behind
  a button, coloured by **polarity** — a rising cost per patient is a red
  up-arrow.
- A winner named at every grain. **The two channels rank on different measures
  and each card says which**: Meta reports no conversions below campaign level,
  so Facebook ranks on cost per patient and Google on tracked conversions.
- Two silent traps in that ranking: the `totals` row (null id, sum of its own
  competitors) wins every ranking if not excluded; and ads/keywords/search terms
  **paginate**, so ranking `data.rows` names the best of whichever page loaded
  first.

---

## 5. Marketing section brought in line

`91ecd32`, `fcd4ead`, `5498dee`, `8ec9158`

- Both report panels use `HeadlineCard`. They keep their **own** comparison
  badge — `HeadlineCard` gained an optional prebuilt `badge` — because those
  panels guard deltas with `sourcesComparable()`, and a rebuilt badge would drop
  the guard silently.
- Card drill-down opens in a **dialog**, not inline: expanding pushed the report
  down and cost the reader their place.
- Facebook's lead table rebuilt to Google's standard — practice and campaign as a
  sub-line, tags instead of "Yes", `5 Sep` instead of `05/09/2026`, every column
  sortable, **date sorted on the instant** (printed text sorts into nonsense).
- Comparison windows read `2–31 Aug 2026`. Both ends parse at **midday UTC** —
  these are London days and a midnight parse shifts across the BST boundary.
- Five stacked headings and notes between the cards and the tabs became **one
  disclosure**. Nothing deleted.
- The blue box on the active tab was the browser's default focus outline
  persisting after a click; now `focus-visible` only.

---

## 6. Open items

- **Rochester needs a re-pull.** Its treatment rows were deleted under the wrong
  (practitioner-only) rule. Hit **Pull full history** so they refill under the
  corrected attribution.
- **`x-gmref-secret` should be rotated.** It is hardcoded in the `gmref_doorbell()`
  Postgres function, readable by anyone who can query `pg_proc` — including
  `gm_referral_reader` itself. It was read into a session transcript today.
- **The `gmref_doorbell` trigger has no org condition**, so it fires for every
  tenant's completions. It leaks no data (body is `{source, table, at}`) but gets
  noisier per client. Should carry the same `org_features` condition the RLS
  policies now have.
- **Parent org has ~150k treatment items with a null practice.** Its org-wide
  total is right, but any per-practice breakdown undercounts. Separate backfill,
  untouched.
- **Dentally OAuth cannot be connected from localhost.** Dentally's edge WAF
  rejects any `redirect_uri` on a loopback or RFC1918 address with a bare 403
  (verified: `example.com` 302, `localhost`/`127.0.0.1`/`192.168.x` all 403). Use
  **Connect with API key** locally.
- **I have not seen most of the Ad performance / marketing UI rendered.** The
  logic is shared with pages already in use, but the grids and density are
  unverified judgement.

---

## 7. Not mine — the parallel session

A second session committed into this repo today. Interleaved in the log, and
worth knowing when bisecting:

`5163c52` `29f6376` `388a9ed` `1f2d0b6` `62bd412` `b2c53a0` `a59091a` (the tax
module) · `6668bdd` `2343987` `29d3447` `56ff390` `76d7c74` (Business Hub) ·
`fb3c7eb` `a4d4900` `fe799f9` (marketing definitions) · `427545f` `51e666a`
(GoHighLevel contacts) · `4eda09c` `d6b834b` (integration delete) · `ba78a49`
(AI patient-data guard) · `09a0dee` `b28aba2` `52a3ad0` (Dentally sync) ·
`ff079a0` (exit plan).

They replaced the `ad_account_marketing` RPC with `adAccountFunnel` mid-session,
which briefly failed `marketing-roi-account-scope.test.mjs` while both were in
flight.

---

## Verification at close

Backend **293 files / 3,242 tests** green · lint 0 errors (12 pre-existing
warnings) · frontend typecheck, lint and build clean · `ggshield` clean on every
commit.

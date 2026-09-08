# Chair Utilisation — rebuild: real capacity, usable entry, honest metrics

**Date:** 2026-09-08
**Branch:** `worktree-feat+chair-utilisation`
**Status:** design approved, spec for review

---

## 1. The problem, measured

Every figure below was read from the live hosted database or probed from the
Dentally API on 2026-09-08. Nothing here is inferred.

### 1.1 The feature is uncompletable, so it is unused

The entire platform holds **nine** chair-utilisation cells:

| Org | Practice | Cells | Distinct chair names | Last edit |
|---|---|---|---|---|
| GM Dental Group | Ashford | 8 | 2 | 2026-06-16 |
| GM Dental Group | Barnet | 1 | 1 | 2026-06-22 |

Fourteen other practices across four organisations have never had a cell
entered. A typical week for **one** chair is 28 cells (7 weekdays × 4 slots);
Ashford's two chairs need 56. Entry is one cell at a time through a seven-field
form, each submission a separate `POST`, each triggering a full snapshot
rewrite. The table above is what that interface produces.

**All nine cells are trial data.** The chair names are `Test Surgery 1`,
`Test Surgery 2` and `test`. Nobody has ever entered a real week. That is worth
stating plainly: there is no production data to protect, no migration risk from
reshaping it, and no user habit to preserve.

### 1.2 Occupancy and money are computed from different capacities

`analyticsService.chairAnalytics` takes occupancy from the entered cells but
takes capacity from `chair_config` (`chairs × openHrs × weeksYr × daysWk`),
which never reads the `available_minutes` that were actually entered. The two
definitions of "open hours" disagree and nothing reconciles them:

- Ashford's grid says its chairs are open **28 h/week**. The config says
  **80 h/week** (2 chairs × 8 h × 5 days). Cost-of-empty and Recoverable are
  computed off the 80.
- Ashford therefore reports 71.4% occupancy derived from 8 of 56 cells, and
  **"Recoverable to 88%" of ~£230,041/yr** — against a grid describing
  £346,380 of annual booked work. A 66% uplift claim from 14% coverage.
- Barnet is the sharper case. **One cell** — one Monday morning, 120 of 120
  minutes — makes the practice report **100% occupancy and £0 cost of empty
  chairs**. A practice reads perfect because exactly one busy slot was typed in.

### 1.3 Coverage is invisible

Neither screen shows how much of a practice's week has been entered. A practice
with 1 cell and a practice with 56 render with identical confidence.

### 1.4 The chair count is free text

Chair count is `DISTINCT chair_name` over the grid. `"Surgery 1"` and
`"Surgery 1 "` are two chairs, and capacity silently doubles. The
`practices.chairs` fallback is `1` for **all 19 practices** — a default that was
never set, so the fallback is fiction.

### 1.5 One page, two permissions

`/chair` renders `ChairEfficiencyScreen` (gated `finance.view`) above
`ChairScreen` (gated `operations.view`). A practice manager without finance
access gets a half-broken page.

---

## 2. What Dentally actually provides

Probed live against GM Dental Group's connected Dentally account
(read-only; field names and non-patient configuration only, per rules.md rule 6).

### 2.1 Real opening hours — `GET /sites`

Each site returns an `opening_hours` object keyed by weekday name:

| Site | Opening hours |
|---|---|
| GM Dental & Implant Centre | Mon–Fri 08:30–17:30, Sat 09:00–17:30 |
| Fixed Teeth Solutions by GM Dental | Mon–Fri 08:30–18:30, Sat 09:00–14:00 |
| GM Dental & Implant Centre Ashford | Mon–Sat 09:00–17:00 |
| GM Dental & Implant Centre - Rochester | Mon–Fri 08:30–17:30 (Thu to 20:00), Sat 08:30–17:30 |

Ashford is open **48 h/week per chair**. The config assumes 40. The grid claims
28. The real number was one API call away.

Two shape notes taken from the payload, not assumed:
- **Sunday is absent** from all four sites — an absent weekday means closed.
- Times are **not zero-padded consistently**: `"9:00"` appears alongside
  `"08:30"`. The parser must accept one- and two-digit hours.

### 2.2 Per-chair actuals are impossible for this group

Appointments carry a `room_id` field, but it is **null on 160 of 160**
appointments sampled, and `GET /rooms` returns `total: 0`. This group has never
used Dentally's rooms feature. Building chair-level actuals on that field would
ship code against data nobody populates.

`GET /surgeries`, `/chairs` and `/practice_rooms` all 404 — the collection does
not exist under another name.

### 2.3 Per-practice actuals do work, backward-looking only

`duration` is populated on 160/160 sampled appointments and
`practitioner_site_id` partitions cleanly by site. But durations on
non-completed rows are unusable — measured over Jun–Aug 2026:

| Practice | Status | Appts | Avg minutes |
|---|---|---|---|
| Barnet | confirmed | 1,606 | **451** |
| Bexleyheath | scheduled | 787 | **366** |
| Ashford | scheduled | 389 | 112 |
| Ashford | completed | 1,678 | 38 |
| Rochester | completed | 2,275 | 51 |

Completed rows average a believable 38–54 minutes; `confirmed` and `scheduled`
rows carry diary-block or placeholder finish times. Actuals must therefore stay
**completed-only**, which makes them backward-looking: upcoming bookings cannot
be counted.

### 2.4 Consequence

**Use what Dentally provides; build what it does not.**

| Concept | Source |
|---|---|
| Practice opening hours | Dentally `/sites.opening_hours`, manual editor as fallback |
| Chairs | **Ours** — Dentally has none for this group |
| Booked time per chair per slot | **Ours** — manual entry |
| Actual booked time per practice | Dentally completed appointments |

---

## 3. Design

### 3.1 Capacity stops being an assumption

New table `practice_opening_hours`, one row per practice per weekday:

```
id                uuid pk
organisation_id   uuid not null -> organisations
practice_id       uuid not null -> practices
weekday           smallint not null check (weekday between 1 and 7)   -- ISO Mon..Sun
open_minute       smallint     -- minutes from local midnight; NULL = closed
close_minute      smallint
source            text not null check (source in ('dentally','manual'))
created_at, updated_at
unique (organisation_id, practice_id, weekday)
```

Times are stored as **minutes from local midnight**, never as timestamps. These
are wall-clock opening times, not instants — storing them as instants would make
them shift across the BST boundary (see the `window-conventions-must-be-shared`
and `bst-month-detection-by-utc-date` precedents).

A cell's **available minutes = the overlap between its slot window and that
weekday's opening hours**. Ashford Monday (09:00–17:00): morning 120,
midday 180, afternoon 180, evening 0 — derived, correct, per chair, with nothing
typed.

`chair_config.openHrs` and `daysWk` stop feeding capacity. `weeksYr` stays:
holiday allowance is a genuine assumption, unlike opening hours which are a fact.

**Slot windows move to the backend.** They currently exist only in
`frontend/features/operations/chair-util.ts` for display. The server becomes the
single definition (`backend/src/lib/chair-slots.js`) and returns slot boundaries
in the grid payload; the frontend renders what it is sent. Two copies of a
window convention drift invisibly — that is the exact failure the
`window-conventions-must-be-shared` memory records.

**Open-ended end slots.** The morning slot runs `[start-of-day, 11:00)` and the
evening slot `[17:00, end-of-day]`, rather than 08:00–11:00 and 17:00–20:00.
This guarantees `Σ slot available == close − open` for **any** opening hours. A
site opening at 07:00 or closing at 21:00 would otherwise silently lose an hour
of capacity to the fixed envelope.

### 3.2 Chairs become rows

New table `practice_chairs`:

```
id                uuid pk
organisation_id   uuid not null -> organisations
practice_id       uuid not null -> practices
name              text not null
display_order     int not null default 0
active            boolean not null default true
created_at, updated_at
unique (organisation_id, practice_id, lower(btrim(name)))
```

The unique index is on the **normalised** name, so `"Surgery 1"` and
`"Surgery 1 "` can no longer become two chairs and double capacity. This follows
the natural-key precedent set by migration `000149` for Emergent.

`chair_utilisation` gains `chair_id` (FK, `ON DELETE CASCADE`), backfilled from
the existing `chair_name` values, and its unique index moves to
`(organisation_id, practice_id, chair_id, weekday, slot)`.

`chair_name` is retained and kept populated: the snapshot JSON in
`chair_utilisation_snapshots.cells` already stores it, and two snapshots exist on
hosted that must stay readable.

**`available_minutes` becomes deprecated, not dropped.** The read path stops
reading it entirely; a `COMMENT ON COLUMN` records that it is dead, and a test
asserts the aggregator never touches it. Dropping the column is a separate
migration requiring the owner's explicit sign-off (rules.md rule 9 — no
destructive statement without confirmation of that exact statement).

### 3.3 Metrics: one capacity, stated coverage

The £230k defect is that occupancy comes from entered cells while money comes
from full config capacity. The fix is that **both come from the same cell set**.

For each practice:

- `openCells` — every (active chair × weekday × slot) whose opening hours give
  it a non-zero available window.
- `enteredCells` — those with a saved booked figure.
- `coveragePct = enteredCells / openCells`.
- `occupancyPct = Σ booked / Σ available` **over entered cells only**. A cell
  nobody has filled in is *unknown*, not empty; counting it as empty would
  understate occupancy in proportion to how little has been entered.
- `emptyMinutesWk = Σ (available − booked)` over **entered cells only**.
- `lostPotentialYrPence = emptyMinutesWk / 60 × weeksYr × benchRevHrPence`.
- `recoverRevYrPence` — unchanged formula, on entered-cell capacity.

**Worked against the live rows, with real opening hours.** Ashford opens
09:00–17:00, so its evening slot has zero available minutes and each chair has
3 open slots × 6 days = 18 open cells; two chairs give **36**. Seven of its eight
stored cells fall in open slots. Derived available across those seven is
1,020 min/week against 990 booked (clamped), so Ashford reads **97.1% occupancy
on 19% coverage** — below threshold, so cost-of-empty and recoverable render as
em dashes rather than £315,300.

Barnet maps to a site open Mon–Fri 08:30–17:30 and Sat 09:00–17:30 — 4 open
slots × 6 days = **24 open cells**. Its single cell is Monday morning, 120
booked against a derived 150 available. Barnet therefore reports **80%
occupancy, 1 of 24 slots entered**, with money em-dashed — instead of today's
"100% occupancy, £0 cost of empty chairs".

**Coverage badge, and null below threshold.** Every practice row and KPI states
`7 of 36 slots entered`. Below **50% coverage**, `lostPotentialYrPence` and
`recoverRevYrPence` return `null` — occupancy is still shown, with the badge.

Note what this exposes in the existing rows: **four of Ashford's eight cells
record more booked time than the practice is open for**, and one sits on Friday
evening when the practice is shut. That is edge case 8 arriving on day one, not
a hypothetical — it is what happens when available minutes are typed by hand
with nothing to check them against.

`null`, never `0`. `formatPence` accepts `number | null | undefined` and renders
null as a confident `£0.00` with no TypeScript warning, so the em-dash guard goes
at every call site, not in the helper (the `formatpence-renders-null-as-zero`
memory).

Barnet stops reporting "100% occupancy, £0 cost of empty chairs" from one cell.

Group rollup sums entered-cell minutes across in-scope practices; blended
occupancy is `Σ booked / Σ available` over those cells; group coverage is
`Σ entered / Σ open`.

### 3.4 Data entry page

New route `/chair-utilisation`, gated `operations.view` (read) and
`operations.edit` (write). `/chair` keeps Chair Efficiency alone.

Layout:

1. **Practice selector.** The organisation is always `req.user.organisation_id`
   (or the server-resolved `req.agencyOrgId`) — never a body or query parameter.
2. **Opening hours strip** — the week's hours with a `From Dentally` or `Manual`
   badge and an Edit control. A practice with no hours shows a *set your opening
   hours* call to action, never a £0.
3. **Chairs** — add, rename, retire, reorder.
4. **The week grid for the selected chair** — 7 columns × 4 slot rows. Closed
   cells are greyed and disabled, labelled `Closed`. Open cells show the derived
   available minutes and take a booked-hours input plus revenue.
5. **Fillers** — *apply Monday across the week*, *copy from another chair*,
   *clear chair*.
6. **Coverage meter** — `38 of 56 open slots entered`.
7. **One Save** for the whole chair-week.

New endpoint `PUT /api/chair-utilisation/bulk` taking
`{ practice_id, chair_id, cells: [{weekday, slot, booked_minutes, revenue_pence, notes}] }`
and upserting them in **one transaction**, so a half-saved week is not
representable.

This also fixes a live defect: `chairUtilisationService` calls `captureGrid`
after **every** single-record write, and `captureGrid` re-lists the whole
practice and rewrites the snapshot. Saving a 56-cell week through today's API
would perform 56 full list-and-rewrite cycles. The bulk endpoint captures once.

### 3.5 Plan versus actual

Per practice, for the selected window: planned booked hours from the grid beside
actual completed-appointment minutes from Dentally.

Both limits are **displayed, not hidden**:
- *Completed appointments only* — upcoming bookings are excluded, because
  non-completed durations are unusable (§2.3).
- *Practice level only* — no per-chair split, because `room_id` is null on every
  appointment (§2.2).

The existing `chair_booked_minutes_by_practice` RPC (migration `000037`, never
called from application code) is the starting point but needs two fixes before
first use:

- It is `LANGUAGE sql` + `SECURITY DEFINER` + `SET search_path`, which never
  inlines, so it is planned with `p_org` UNKNOWN — the generic-plan trap that
  measured 11.1 s against 55 ms elsewhere in this codebase. Rewrite as
  `plpgsql` with `RETURN QUERY EXECUTE ... USING`.
- Its window bounds must adopt the shared London window convention from
  migration `000163` rather than raw `>= since` / `<= until`.

### 3.6 Access

Reads: `operations.view`, as today.

Writes: a **new `operations.edit` permission key**. Today `operations.view`
grants both viewing and rewriting the grid — anyone who can look can overwrite
it. Default `true` for owner and practice manager, `false` for reception
(rule 5: Reception is CRM only).

Per the owner's decision, chair utilisation is a **both** feature: the
sub-account's own owner or practice manager maintains it, **and** an agency
actor switched into that sub-account may edit it. So writes require
`operations.edit` **or** agency-actor status — not `requireAgencyActor` alone,
which would make a tenant unable to maintain their own operational data.

Route gates are asserted by **running** them in tests, not by reading them:
`requirePermission` and `requireRole` both return anonymous closures and a name
check cannot tell them apart (the precedent set by `test/open-day.routes.test.mjs`).

`/chair` and `/chair-utilisation` become two nav entries under Operations, each
independently gated, which resolves §1.5.

### 3.7 Dentally sync

On connect and on the nightly sync, fetch `/sites`, map each site to a practice
through the existing `practices.pms_site_id` mapping, and upsert
`practice_opening_hours` with `source = 'dentally'`.

A row with `source = 'manual'` is **never overwritten** by a sync. An owner who
has corrected their hours keeps that correction.

Mapping is by **id**, never by name — `practices.pms_site_id` already exists for
exactly this (rules.md rule 1).

---

## 4. Edge cases

Each is handled explicitly and covered by a test.

1. **No opening hours at all** (no Dentally, nothing manual) → capacity unknown;
   every figure `null` with a *set your opening hours* prompt. Never £0.
2. **Weekday closed** (Sunday, for all four sites measured) → all four slots
   closed; excluded from the open-cell count and from the coverage denominator,
   so a six-day practice is not penalised for not opening on Sunday.
3. **Opening hours outside 08:00–20:00** → open-ended morning and evening slots
   make `Σ available == close − open` exactly, for any hours.
4. **Unpadded time strings** (`"9:00"`, observed live) → parser accepts one- and
   two-digit hours; a value it cannot parse is recorded as an error, never
   silently treated as closed.
5. **Chair retired** → excluded from capacity and coverage from that point;
   its historical cells are retained and remain readable in snapshots.
6. **Chair renamed** → `chair_id` is stable, so history follows the rename. The
   free-text `DISTINCT` count that this replaces could not do that.
7. **Duplicate chair names in existing data** → the backfill normalises and
   merges; a collision that would merge two chairs with *different* cell data
   fails the migration loudly rather than silently combining them. Measured
   today: Ashford 2, Barnet 1 — small enough to verify row-by-row after backfill.
8. **Booked exceeds available** → possible retrospectively if opening hours are
   later shortened. Occupancy stays capped at 100%; the entry grid flags the cell
   as *exceeds open hours* rather than rejecting a save the owner cannot fix.
9. **Zero booked minutes across all entered cells** → yield per hour is `null`,
   not `0`. Revenue ÷ zero hours is unknowable, not free.
10. **Zero coverage** → occupancy `null`, not `0%`.
11. **Cross-organisation isolation** → every new table carries
    `organisation_id`; every repository query chains `.eq('organisation_id', …)`
    explicitly, because `serviceClient` bypasses RLS; no PostgREST embed is used
    anywhere in this feature. A cross-org isolation test per table, actually run.
12. **Old snapshots** → the two existing `chair_utilisation_snapshots` rows have
    no `chair_id` in their `cells` JSON. The as-of reader tolerates their absence.
13. **Partial bulk save** → one transaction; a half-written week is not
    representable.
14. **The 1000-row cap** → `chairUtilisationRows(orgId)` selects every cell for
    an organisation, unpaged. A 50-chair group is 1,400 rows and PostgREST
    truncates at 1,000 **in silence**, under-reporting capacity with no error.
    The read is paged on a unique key, stopping on an empty page, never a short
    one (the `monthly-financials-1000-row-truncation` memory).
15. **Agency actor switched into a sub-account** → writes are attributed to that
    sub-account's organisation and audited with `diff.via_agency`, as every
    other switched mutation is.

---

## 5. Out of scope

- **Dropping `chair_utilisation.available_minutes`** — deferred to its own
  migration with explicit owner sign-off (rule 9).
- **Per-chair actuals from Dentally** — impossible today; `room_id` is null on
  every appointment. If GM Dental ever adopts Dentally rooms, §2.2 records what
  would need to change.
- **OCPSPD and profit-per-chair-hour** — still pending per-practice opex and
  treatment-minute sourcing, as the existing code comment states.
- **Backfilling historical grids** — there is no historical data to backfill;
  nine cells exist in total.

---

## 6. Testing

- Pure slot-overlap arithmetic, unit-tested in isolation: every opening-hours
  shape in §4, including hours outside the slot envelope and a closed weekday.
- Coverage and null-below-threshold behaviour, asserted as `null` rather than
  `0` — the assertion distinguishes them.
- The nine live cells from §1.1 and the four real opening-hours shapes from
  §2.1 as **regression fixtures**, asserted exactly: Ashford 97.1% occupancy on
  7 of 36 cells with money `null`; Barnet 80% on 1 of 24 with money `null`.
  Today those same inputs produce 71.4%/£230,041 and 100%/£0.
- Warwick Lodge as the **no-opening-hours fixture**: its `pms_site_id` is null,
  so it has no Dentally site and never will until one is mapped. Every figure
  `null`, with the *set your opening hours* prompt — never a £0.
- Cross-org isolation per new table, run.
- Route gates run, not name-checked.
- Bulk save atomicity, including a mid-batch failure.
- Paged read: assert the **number of reads**, not just the row total — the
  vitest `.rpc()` mock does not slice by `.range()`, so a fixed-array provider
  hangs a paged reader rather than failing cleanly
  (`vitest-rpc-mock-no-range-slicing`).

---

## 7. Migrations

`20260101000180_chair_capacity.sql` — `practice_chairs`,
`practice_opening_hours`, `chair_utilisation.chair_id` + backfill + new unique
index, `operations.edit` seeding, RLS enabled on both new tables with the
`current_org_id()` policy, and the revoke idiom on any new RPC
(`REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`).

`20260101000181_chair_booked_minutes_plpgsql.sql` — rewrite
`chair_booked_minutes_by_practice` as `plpgsql` with `RETURN QUERY EXECUTE …
USING` and the London window convention.

Neither is applied to hosted without the owner's confirmation. Both end with
`NOTIFY pgrst, 'reload schema';`. After deploy, sweep every `.rpc('…')` in
`backend/src` against `pg_proc` — the ledger's `version` values are apply-time
timestamps, so a gap is only visible by **name**.

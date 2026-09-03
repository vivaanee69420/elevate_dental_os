# First-party practice data entry — design

**Status:** design only. Nothing built. Approved scope, not scheduled.
**Date:** 2026-09-03
**Decision owner:** Ruhith

## Why

Three of the Daily Cockpit's feeds arrive from the Emergent ops app: accepted
treatments, daily cash-up and monthly P&L. Emergent is the interim arrangement.
The intent is for practices to key this data straight into Elevate, retiring the
integration.

There is also a correctness argument. Emergent sends **no stable record id**, so
identity has to be synthesised from the record's contents. That caused real
double-counting: 975 rows for 745 real records on Plan4growth and £1,014,647 of
overstated accepted value, fixed in migration `000149` by moving identity into a
DB-enforced natural key. First-party entry removes the whole problem class,
because a row created in Elevate has a real primary key from the moment it
exists. Correcting a patient's name stops minting a new record.

## Scope (decided)

All three feeds get in-app entry — a full Emergent replacement.

| Feed | Table | Entry fields | Shape |
|---|---|---|---|
| Accepted treatments | `treatment_accepted` | 17 (≈8 that matter) | one record per patient/treatment |
| Daily cash-up | `emergent_daily_cashup` | 29 | one record per practice per day |
| Monthly P&L | `emergent_monthly_pl` | 37 | one record per practice per month |

**Manual rows are separate from Emergent rows.** Entry creates and edits only
its own records; synced rows stay read-only and keep arriving until the
integration is switched off. No override/provenance model — if an Emergent
figure is wrong it is still fixed in Emergent. This keeps a per-practice cutover
free of migrations and avoids the hardest half of the problem (what happens when
a feed later changes a field a human has pinned).

## Traps found while investigating — read before building

These are the things that will bite, discovered by reading the live schema.

### 1. Only `treatment_accepted` has a `source` column

`emergent_daily_cashup` and `emergent_monthly_pl` are unique on
`(organisation_id, business_id, cashup_date | period_month)` with **no `source`
in the key**. A manual row and an Emergent row for the same practice and date
would therefore collide.

**Resolution:** namespace manual rows by `business_id = 'manual:' || practice_id`.
`business_id` is `text` on all three tables, so this needs no change to the
existing unique indexes and can never collide with an Emergent business uuid.
Add a real `source` column to both tables anyway, for filtering and for honest
provenance in the Data Room — but do not rely on it for uniqueness.

### 2. `practice_id` is NOT in `treatment_accepted`'s natural key

The key is `(organisation_id, source, business_id, accepted_date, patient_norm,
treatment_norm)` with `NULLS NOT DISTINCT`. For Emergent rows `business_id`
carries the practice. A manual row with a **null** `business_id` would collide
across practices — two sites entering the same patient/date/treatment would
reject the second.

**Resolution:** the same `'manual:' || practice_id` namespacing fixes this too.
Do **not** simply add `practice_id` to the shared key: an unmapped Emergent row
that later gains a practice would change identity and fork.

### 3. A half-entered month must not read as a real £0

The cockpit falls back to the latest available `emergent_monthly_pl` month and
sums typed columns. A P&L someone has started but not finished would render as
genuine zeroes across revenue, cost and net profit — worse than showing nothing.

**Resolution:** add `entry_status text NOT NULL DEFAULT 'final'` (`draft` |
`final`) to `emergent_monthly_pl` and `emergent_daily_cashup`. Reads default to
`final` only. Existing Emergent rows keep `final`, so nothing changes for them.
`treatment_accepted` needs no draft state — a treatment is a single record, not
a sheet.

### 4. Money is integer pence, and forms are where that breaks

Every money field on these tables is `*_pence`. A form collects pounds. Convert
once, at the controller boundary, via the existing `poundsToPence` helper, and
never let a float reach a service. Rule 2.

### 5. The dedup guard will now fire at humans

The natural-key index was built against a machine feed where a genuinely
repeated identical treatment never occurred. A receptionist entering the same
patient, date and treatment twice is plausible — sometimes a real second
treatment, sometimes a slip. A raw `23505` constraint error is not an
acceptable UI.

**Resolution:** the entry endpoint checks for an existing record first and
returns a **soft warning** with the matching record, letting the user confirm
"yes, this is a second one" or open the existing row. Only on explicit confirm
does it write — and because the key would still reject it, a deliberate second
identical treatment needs a discriminator. Cheapest option: include a
sequence/occurrence integer in the manual `business_id` namespace
(`'manual:' || practice_id || ':' || n`). Decide this when building; it is the
one genuinely unresolved design question.

## Architecture

Follows the existing layering with no new patterns:

```
routes/practice-entry.routes.js
  -> controllers/practice-entry.controller.js   (Zod parse, pounds->pence)
    -> services/practice-entry.service.js       (validation, dedup check, audit)
      -> repositories/*.repository.js           (reuse the three existing repos)
```

Reuse the existing `treatmentAcceptedRepository`, `emergentDailyCashupRepository`
and `emergentMonthlyPlRepository` rather than adding parallel ones — the tables
are the same, only provenance differs. Add `models/practice-entry.model.js` for
the three Zod schemas.

Frontend: a new `features/data-entry/` slice with three screens under a single
**Data Entry** nav section, plus a section key in `ROUTE_PERMISSION` and
`SECTIONS` in `middleware/section-lock.js` (see below).

## Multi-tenant considerations

- **Permission key.** Add `data.entry` to the catalog. Entering practice figures
  is a distinct capability from viewing them: a practice manager who may not see
  group finance can still be the person who keys the daily cash-up. Default it
  ON for `owner` and `practice_manager`, OFF for `reception` and `analyst`. Do
  NOT gate on `finance.view` — that would force finance visibility on whoever
  does data entry.
- **Section lock.** Add the `/practice-entry` mount to `SECTIONS` in
  `middleware/section-lock.js` keyed on `data.entry`, or the coverage test in
  `test/section-lock.test.mjs` fails — by design.
- **Feature flag.** Add a `practice_entry` module key to `FEATURE_CATALOG` so
  it can be enabled per sub-account. Default OFF until a tenant is cut over;
  a tenant still on Emergent should not see an entry form that would create
  rows competing with its feed.
- **Audit.** Every write goes through the existing `audit` middleware (rule 9).
  For hand-entered financials this is the difference between a figure someone
  can stand behind and a number of unknown origin.
- **Tenant isolation.** `organisation_id` from `req.user`, never the body, and
  an `assertOrgOwns` check on the submitted `practice_id` — a body-supplied FK
  written unchecked is how the PostgREST embed leak happened
  (`docs/ISOLATION_AUDIT.md`).

## Phasing

Each phase is independently shippable and useful on its own.

1. **Accepted treatments.** One form, ~8 real fields. Proves the whole pattern:
   permission key, feature flag, section lock, audit, pounds→pence, the dedup
   soft-warning, and the `'manual:'` namespace. Highest value — it is the feed
   that drives conversions and marketing attribution.
2. **Daily cash-up.** 29 fields, one row per practice per day. Wants a
   week-at-a-glance grid rather than a single-record form, plus the `draft`
   state and the existing manager-total-vs-patient-detail variance surfaced
   live so a mis-key is caught at entry rather than in the cockpit.
3. **Monthly P&L.** 37 fields — a structured accounting sheet: revenue, net
   profit, 5 cost lines, 11 opex lines, custom lines, per-line notes. Needs the
   `draft`/`final` gate, a running "does this reconcile" total, and the
   previous month alongside for sanity.
4. **Cutover.** Per-tenant switch: disable the Emergent integration, flip the
   `practice_entry` feature on. Emergent rows stay as history; the `source`
   column keeps the two distinguishable forever.

## Out of scope

- Editing or overriding Emergent-sourced rows (decided against; would need
  per-field provenance and a feed-vs-human conflict rule).
- Retiring `lib/integrations/emergent-sync.js` or the webhook. They keep working
  through the cutover and are removed only once no tenant reads them.
- Bulk CSV import into these three tables. `csv-import.routes.js` exists and is
  the right home if it is ever wanted; it is not part of this.

## Open question for whoever builds it

Trap 5: how to represent a deliberate second identical treatment on one day.
An occurrence counter in the `business_id` namespace is the cheapest answer and
is probably right, but it deserves five minutes against real practice
behaviour before it is baked into an identity.

# One definition of "existing patient"

**Date:** 2026-09-09
**Status:** design, awaiting owner review
**Owner decisions taken:** cut-off, attendance rule, scope, Family B translation, history handling — all recorded below with who chose what.

---

## 1. The problem

This codebase has **four** different answers to "is this person an existing
patient", and two of them contradict each other on the same screen family.

| # | Where | Rule today |
|---|---|---|
| 1 | Identity | `contacts.type = 'patient'`, backed by `pms_external_id IS NOT NULL` |
| 2 | Growth / Business Health | `contacts.pms_registered_at` falls in the window |
| 3 | Facebook report | `converted AND NOT EXISTS(appointment with starts_at < p_since)` |
| 4 | Google report | `NOT EXISTS(appointment with starts_at < this lead's own London day)` |

3 and 4 ask different questions of the same person. The practical
consequence: on **Facebook**, widening or shifting the date range flips people
between new and existing, because the cut-off *is* the window edge. On
**Google** it cannot, because each lead carries its own cut-off. A patient who
attended in March is existing on both pages for a June window; for an
April–June window they are existing on Google and **new** on Facebook.

Neither 3 nor 4 filters on appointment status, so a single **cancelled**
appointment already marks someone existing — while that same row is explicitly
excluded from counting as a booking a few lines away in the same function.

---

## 2. The rule (owner's words, 2026-09-09)

> If the person has a treatment completed before, he is considered an existing
> patient. A person who has no appointment booked, nor a treatment completed
> before, nor has paid any invoice, is considered a new patient.

Formally — a person is **existing** at a cut-off if ANY of:

- an **attended** appointment before the cut-off, or
- a **completed treatment** before the cut-off, or
- a **settled payment** or **paid invoice** before the cut-off.

**New** is the absence of all four. Existing wins on any single signal.

### 2.1 Decisions the owner made

| Question | Decision | Consequence |
|---|---|---|
| "Before" what? | **The lead's own enquiry day** (London) | The cut-off travels with the person, so their status never changes when the date range moves. Fixes the Facebook instability. |
| Does a cancelled / DNA appointment make someone existing? | **No — they must have attended** | Narrows today's behaviour, which has no status filter at all. |
| Which screens? | **Everywhere the phrase appears** | 13 live functions, two families — see §3. |
| Family B's cut-off (no lead exists there) | **First real activity falls in the window** | Headline KPI moves; see §5.2. |
| History | **Change it, and report the shift per month** | Nothing is rewritten — every figure here is computed at read time. |

### 2.2 Decisions taken in design, stated for challenge

- **"Paid an invoice" means a settled payment OR an invoice marked paid** — the
  union. They cover different people (9,355 vs 7,414 contacts) and erring
  toward *existing* is the conservative direction: over-calling someone new
  inflates apparent acquisition, which is the number acted on.
- **"Attended" means `status = 'completed'`, and nothing else.** `in_progress`
  exists but holds 20 rows group-wide and is an unresolved state, so it is
  excluded. Every measurement in §5 was taken on `'completed'` alone, so the
  figures and the rule describe the same thing.
- **A paid invoice is dated by `dated_on`, which is the invoice date, not the
  date it was paid.** An invoice raised in March and settled in June counts
  this person as existing from March. This is a known approximation: `invoices`
  carries no settlement date, and the settled-payment signal — which does carry
  `processed_at` — covers the same person correctly in most cases. It only
  distorts someone whose *only* signal is a paid invoice with no linked
  payment row.
- **Family A keeps requiring conversion.** `new_patients` stays
  `converted AND not-existing-before`, so a lead who never became a patient is
  not counted as a new patient. Only the *existing* test changes.

---

## 3. Scope — the 13 live functions

Verified against `pg_proc` on the hosted project, not against the repo: the
migration ledger's numbers are apply-time timestamps and a superseded repo file
is not evidence of what is running.

### Family A — lead-scoped (the chosen cut-off exists here)

| Function | Role |
|---|---|
| `ad_lead_conversions` | **Root definition** of `is_new_patient`; Meta side |
| `ad_meta_lead_ledger` | Inherits the flag from the root |
| `ad_google_lead_ledger` | **Own** definition (per-lead day) |
| `ad_meta_funnel` | Aggregates the flag |
| `ad_campaign_funnel` | Aggregates the flag |
| `ad_account_marketing` | Aggregates both ledgers |

### Family B — patient-scoped (no lead, no enquiry day)

| Function | Role |
|---|---|
| `growth_practice_performance` | Per-practice new patients |
| `org_new_patients_count` | Org total |
| `org_new_patients_registered_by_practice` | Per-practice registrations |
| `health_patient_actuals` | Feeds `new_patients_month`, **target 220** |
| `marketing_monthly_rollup` | Monthly marketing rollup |
| `data_room_practice_day` | Analyst dataset |
| `data_room_practice_month` | Analyst dataset |

### Application consumers

**Backend:** `lib/marketing/{lead-performance,open-days,accepted-ledger}.js`,
`lib/health-metrics.js`, `lib/data-room/{registry,dictionary}.js`,
`repositories/{analytics,marketing}.repository.js`,
`services/{analytics,facebook-report,daily-report}.service.js`,
`routes/growth.routes.js`.

**Frontend:** `features/growth/{api.ts,components/PatientsScreen.tsx}`,
`features/marketing/{api.ts,google/api.ts,facebook/api.ts}`,
`features/marketing/google/components/{CampaignLeads,GooglePerformancePanel}.tsx`,
`features/marketing/facebook/components/FacebookPerformancePanel.tsx`,
`features/marketing/components/MarketingLeadsTable.tsx`,
`features/overview/components/BusinessHubScreen.tsx`.

**Docs:** `docs/DATA_ROOM_DICTIONARY.md` is generated — regenerate via
`npm run data-room:dictionary`; `validateRegistry()` fails on any undocumented
column.

---

## 4. Design

### 4.1 One shared definition

A single function is the only place the rule is written:

```sql
public.patient_first_activity(p_org uuid)
  RETURNS TABLE (contact_id uuid, first_activity_at timestamptz)
```

`first_activity_at` = the earliest of: an appointment's `starts_at` where
`status = 'completed'`, a completed non-`base_chart` treatment item's
`completed_at`, a settled payment's `processed_at`, a paid invoice's
`dated_on` (see the dating caveat in §2.2).

Both families read that one function, differently:

- **Family A:** `is_new_patient = converted AND (first_activity_at IS NULL OR first_activity_at >= london_day_start(first_lead_at))`
- **Family B:** a patient is new in a window when `first_activity_at` falls
  inside it.

One definition, two readings — so the families cannot drift apart again. This
is the same reasoning `ad_meta_funnel` already relies on to keep `booked`,
`attended` and `converted` in one place rather than re-deriving them per grain.

### 4.2 Multi-tenancy

`p_org` is the only tenant input and is always `req.user.organisation_id` (or
the server-resolved `req.agencyOrgId`) — never a body or query value. Every
one of the four source reads carries its own `organisation_id = p_org`
predicate; **no PostgREST embed is used anywhere**, since an embed resolves the
FK as a join with no org predicate under `serviceClient`. `SECURITY DEFINER`
with the standard revoke idiom:

```sql
REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ... TO service_role;
```

A cross-org isolation test is required, run rather than reasoned about.

### 4.3 Performance — measured, and it needs an index

The aggregate as written costs **699 ms and 96,904 buffers** for one
organisation (`EXPLAIN (ANALYZE, BUFFERS)`, 2026-09-09). 500 ms of that is
`dentally_treatment_items`: the scan discards **209,543 rows** because the
existing partial index is on `(organisation_id, practice_id, completed_at)` and
does not serve a `contact_id` lookup.

Required before this goes near a report path:

```sql
CREATE INDEX idx_dentally_treatment_items_org_contact_completed
  ON dentally_treatment_items (organisation_id, contact_id, completed_at)
  WHERE completed IS TRUE AND base_chart IS FALSE;
```

Re-measure after; if the function still exceeds ~200 ms it moves to a stamped
`contacts.first_activity_at` column maintained at the sync write choke points
plus a restamp RPC — the pattern already used for `ad_metrics.practice_id` and
`treatment_plans.practice_id`. Given this database's history, an unindexed read
on the report path is not acceptable.

Reads must be **paged on a unique key, stopping on an empty page**: PostgREST
truncates set-returning functions at 1000 rows exactly as it does tables, and
15,819 contacts have activity.

---

## 5. Measured impact

All figures live, agency organisation, 2026-09-09.

### 5.1 Family A — Jun–Aug 2026, 3,340 leads, 743 converted

| | count |
|---|---|
| new patients today | 572 |
| new patients under the new rule | **627** (+9.6%) |

It **rises**, because the change pulls two ways: the per-lead cut-off inspects
more history (marking more people existing), while requiring real attendance
marks fewer. Exclusions: 89 attended, 68 paid, 50 treated, 35 invoiced.

### 5.2 Family B — 12 months

| Month | now | proposed |
|---|---|---|
| Sep 2025 | 567 | 347 |
| Oct 2025 | 545 | 313 |
| Nov 2025 | 529 | 359 |
| Dec 2025 | 391 | 238 |
| Jan 2026 | 731 | 433 |
| Feb 2026 | 448 | 298 |
| Mar 2026 | 569 | 331 |
| Apr 2026 | 565 | 359 |
| May 2026 | 352 | 229 |
| Jun 2026 | 465 | 282 |
| Jul 2026 | 432 | 339 |
| Aug 2026 | 387 | 262 |
| **Total** | **5,981** | **3,790 (−36.6%)** |

Every month falls, between 21% and 43%. This is `new_patients_month` on
Business Health, whose **target is 220** — that target was set against the old
definition and should be revisited, but changing it is the owner's call and is
**not** part of this work.

### 5.3 Coverage limits — honest caveats

- **Contact linkage is incomplete on every signal**: 13.6% of completed
  treatment items, 13% of settled payments and 21% of paid invoices carry no
  `contact_id`, so they can never mark anyone existing. A data gap, not
  something this rule can close.
- **808 contacts** have a treatment, payment or paid invoice and **no
  appointment row at all**. These are the people today's rule calls new
  forever; they are the concrete win here.
- **22,597 past-dated appointments** sit unresolved at `scheduled`/`confirmed`.
  The risk that "must have attended" would call those people new was measured
  in the converted-lead population and is **zero** — every one of them also has
  an attended, treated or paid signal. Re-check this if it is ever reused for a
  different population.

---

## 6. Edge cases to handle explicitly

| Case | Required behaviour |
|---|---|
| Contact with no activity at all | `first_activity_at IS NULL` → new, never existing |
| Lead that never converted | Not counted as a new patient (Family A keeps the conversion requirement) |
| Tenant with no Dentally connection | Empty result, surfaced as "not connected" — never a confident 0 |
| Window with no rows | Empty, not zero-filled |
| Payment `processed_at` is midnight-only | Date-compare it; never compare against an instant |
| `invoices.dated_on` is a DATE | Cast at the London day boundary, not UTC midnight |
| London vs UTC | All day boundaries via the existing `london_day_start`; a calendar day is not an instant |
| Same person under two contact rows | Out of scope — deduplication is a separate, known problem |
| Result set over 1000 rows | Paged on a unique key, stop on an empty page |
| Zero denominator | Cost/rate figures return `null`, rendered as an em dash, never `£0.00` |

---

## 7. Rollout

1. Index + `patient_first_activity`, with the revoke idiom. Re-measure cost.
2. Family A: rewrite the existing test in `ad_lead_conversions` and
   `ad_google_lead_ledger`. Aggregators are untouched — they read the flag by
   name.
3. Family B: rewrite the seven functions to read `first_activity_at`.
4. Backend + frontend + regenerate the data-room dictionary.
5. Tests, including cross-org isolation, run not reasoned about.
6. Apply to hosted only on explicit confirmation of the exact statements, then
   `NOTIFY pgrst, 'reload schema';` and sweep every `.rpc(...)` name in
   `backend/src` against `pg_proc`.
7. Re-measure §5.1 and §5.2 after, and report the difference.

**Migration numbering:** next free is `20260101000191`. Amend from the **last**
migration that defines each function, never the first that names it.

---

## 8. Out of scope

- Changing the `new_patients_month` target of 220.
- Contact deduplication.
- Backfilling the missing `contact_id` on treatments, payments and invoices.
- The `TO PUBLIC` RLS policy targeting flagged separately on 2026-09-09.

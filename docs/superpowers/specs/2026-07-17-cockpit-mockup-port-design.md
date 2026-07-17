# Daily Command Cockpit — porting `elevate-cockpit-mockup_1.html`

Date: 2026-07-17
Status: approved, ready for planning
Target org: **Plan4growth** (`1a5f888a-0dfe-4802-acf8-6003665089ad`), owner `dev.ruhithpasha@gmail.com`

## What this is

`elevate-cockpit-mockup_1.html` is a target-state mockup written *for the developer*: its
numbers are invented, its blue callouts are instructions, and its "NEW MODULE" badge marks
the one section that doesn't exist. This spec ports the mockup's **cards and sections** into
the live cockpit at `/cockpit`.

The mockup's own annotations (blue callouts, `NEW` badges, the "One-line summary for the dev"
card, the `src` chips) are notes to the reader. They are **not** built as UI.

## What already exists

The cockpit is not a blank page. `frontend/features/cockpit/` + `backend/src/services/cockpit.service.js`
already implement mockup sections 1–5 in some form, and **§4 Cash up already matches the mockup
card-for-card** (cash taken / till detail / variance + tolerance tag). Several of the mockup's
"FIX" callouts are already done — the per-practice lead attribution it complains about was
fixed in commit `1aad39b`.

The real gaps are §6 (doesn't exist), the extra cards on §1 and §5, per-practice ad spend on
§3, and §7 not being on this page.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Keep the app's existing look.** Port cards/sections only, using `KpiTile`/`Panel`, slate-on-white. | The mockup's Georgia/dark-green styling would make the cockpit diverge from the other ~60 dashboard screens. Rule 1 (no dark mode) still holds. |
| 2 | **Correct the breakeven formula.** | See "The formula the mockup got wrong" below. |
| 3 | **Per-practice cost inputs, historised** in a new `practice_cost_model` table, read as-of the window. | Matches the precedent set for business-health baseline/targets (memory `manual-input-history`). A rent rise must not rewrite March. |
| 4 | **Daily target typed into the card**, per-practice; group = sum, read-only. | User instruction: "targets will be manually added on the card itself". Group-as-sum means the group figure can never drift from its parts. |
| 5 | **Per-practice ad spend via the `ad_accounts.practice_id` join, with unmapped shown as its own row.** | Never invent attribution; make the gap visible so it gets fixed. |
| 6 | **Rename the practice rows to site names**, and create Warwick Lodge with an explicit "Not reporting" state. | See "The naming problem" below. A £0 would read as "traded nothing"; the truth is "no feed configured". |
| 7 | **Keep the existing "New leads" card**; do not build "New patients seen". | Emergent sends no new-vs-existing field. The existing card already reconciles keyed-in vs GoHighLevel. |
| 8 | **Add "Revenue by line" to the cockpit.** | The mockup shows it on this page. |

## The formula the mockup got wrong

The mockup specifies:

```
contribution_margin = 1 − fixed/breakeven_mid = 1 − 31000/83500 = 0.629
breakeven_day       = (fixed/20) / margin     = 1550 / 0.629 = £2,464
```

`1 − fixed/breakeven` is **not** the contribution margin — it is the *variable-cost ratio*.
With fixed costs of £31k/mo and breakeven revenue of £83.5k/mo, variable costs at breakeven
are £52.5k, so variable = 62.9% and **contribution margin = 31000/83500 = 37.1%**.

The mislabel is self-detonating: the mockup's own `breakeven_day` of £2,464 implies a monthly
breakeven of £49,280, contradicting the £81–86k/mo it states two lines earlier. With the correct
37.1%, `breakeven_day = 1550/0.371 = £4,175`, which reconciles exactly to £83,500 ÷ 20.

It is not cosmetic. Re-running the mockup's own table:

| Practice | Revenue | Mockup says | Correct |
|---|---|---|---|
| Ashford | £4,900 | £1,532 Above | £268 Above |
| Rochester | £3,780 | £828 Above | −£148 Below |
| Barnet | £2,100 | −£229 Below | −£771 Below |
| Bexleyheath | £1,700 | −£481 Below | −£919 Below |
| Fixed Teeth Solutions | £3,220 | £476 Above | −£355 Below |
| **Group** | **£15,700** | **£2,125 Above** | **−£1,925 Below** |

The specced version reports the group £4,050/day better than reality, and flips it from Below
to Above. **We build the corrected formula.**

## The naming problem

The mockup's FIX #5 ("add Barnet/Warwick/Academy/Lab") reads as missing practices. It is mostly
a **naming** problem. `emergent_practice_map` for Plan4growth shows:

| Emergent business | Practice row the app shows | Cash-up rows | Latest |
|---|---|---|---|
| Ashford | GM Dental & Implant Centre Ashford | 165 | 16 Jul 2026 |
| **Barnet** | **GM Dental & Implant Centre** | 98 | 16 Jul 2026 |
| **Bexleyheath** | **Fixed Teeth Solutions by GM Dental** | 39 | 2 Jun 2026 |
| Rochester | GM Dental & Implant Centre - Rochester | 128 | 17 Jul 2026 |
| Elevate360 Academy | *(unmapped — correct, not a practice)* | 1 | 3 Mar 2026 |
| Webhook Test Ping | *(unmapped — test artifact)* | 0 | — |

Barnet is already on the cockpit, under a name nobody recognises.

**Bexleyheath and Fixed Teeth Solutions are the same site** (confirmed by the owner, 2026-07-17).
The current map is therefore correct: the Bexleyheath business belongs on the FTS practice row, and
the Meta account "GM - FTS" maps to that same practice. The mockup listing them as two separate
practices was an error. QuickBooks independently corroborates this — one of the four live
companies is "Gmd Bexleyheath Ltd".

**Warwick Lodge is a real practice** (confirmed by the owner, 2026-07-17) but has no data feed of
any kind: no Emergent business, no cash-up, no ad account, no GoHighLevel subaccount. See
"Warwick Lodge" under Phase 0.

A fifth practice row, `675c4bfc-fa5f-480e-a120-876a81ddcc0c` "GM Dental And Implant Centre",
has **zero** cash-up rows, zero GHL accounts and zero ad accounts. This is the dead duplicate
recorded in memory `cockpit-lead-attribution` as the cause of the phantom Google leads.

## Phase 0 — data fixes (no code)

Run against Plan4growth only.

1. Rename practices to site names. Ids are unchanged, so no mapping re-points:
   - `bf70e504…` → `Ashford`
   - `853affdd…` → `Barnet`
   - `a0ddc392…` → `Rochester`
   - `03117019…` → `Bexleyheath (Fixed Teeth Solutions)` — one site, two names both in active use
     (Emergent says Bexleyheath, Meta says FTS), so the compound name keeps both recognisable.
2. Delete the dead duplicate practice `675c4bfc…` after re-verifying it still has zero
   dependent rows.
3. **Create the Warwick Lodge practice row.** See below.
4. Reconnect the three GoHighLevel subaccounts currently `status = 'failed'` (Barnet,
   Rochester, Ashford). Only Bexleyheath/FTS is `active`; §3's lead counts are going stale.
5. Populate `ad_accounts.practice_id` via the Phase C UI once it ships.

### Warwick Lodge

A real practice with **no data feed of any kind** — no Emergent business, no cash-up, no ad
account, no GoHighLevel subaccount. Its row is created now so the gap is visible and gets fixed,
rather than the practice being silently invisible.

Every section that reads a Warwick Lodge figure must render an explicit **"Not reporting —
Emergent isn't sending a Warwick Lodge business"** state, *never* `£0`. A zero would read as "traded
nothing today", which is precisely the £0.00 failure the mockup is complaining about; the truth is
"nobody has configured the feed".

Consequently Warwick Lodge is **excluded from the Group row** in §6 and from the group sums in §1
(it has no cash-up days, so `working_days_in_window = 0` and it falls out naturally — the same
guard that handles a practice with no cost model). It appears in the scope selector.

Nothing else can substitute: §5 reads `emergent_monthly_pl`, not QuickBooks, so mapping Warwick
Lodge to a QuickBooks company would not populate the cockpit.

**Owner action required:** configure Emergent to send a Warwick Lodge business. The Emergent map
auto-discovers businesses on every sync, so the row will light up on its own once cash-up arrives.

## Phase A — cards from existing data

No migration. All data is already in the `/api/cockpit` payload or one RPC away.

### §1 Revenue — one card becomes four

| Card | Definition |
|---|---|
| Cash taken today | The latest cash-up day in the month; sub-label carries its date. |
| Cash MTD | Sum of `cash_up_money_taken_pence` from month start; sub = `N working days · £X/day`. |
| Projected month | `MTD ÷ working_days_elapsed × working_days_per_month`; sub = "at current run-rate". |
| Daily target | Phase B. Editable. |

**Definitions** (these were ambiguous on first draft; pinning them down):

- `working_days_elapsed` — the count of **distinct cash-up days for that practice** in the month
  so far, i.e. days it actually traded. Not calendar weekdays: a practice that didn't trade
  shouldn't be projected as though it did.
- `working_days_per_month` — the practice's own value from `practice_cost_model` (default 20).
- **Group scope projects per practice and sums**, rather than projecting the group aggregate.
  Same principle as the target: the group is always the sum of its parts, so it cannot drift.
- `working_days_elapsed = 0` → projection is `null`, rendered "—". Never divide by zero, never
  show £0 for "we can't know yet".

**Time-base decision:** these four cards are anchored to the **month containing the window's
end**, not to the window. "MTD" and "Projected" are meaningless against an arbitrary window.
Each card is labelled with that month explicitly. The existing per-practice table, trend chart
and drill-down remain window-driven. Two time bases on one page is a smell; the explicit month
label is what keeps it honest.

### §2 Treatment & close — one addition

Keep all four cards as they are. Add the close-rate note to Attended:
`accepted ÷ tx plans given`, guarded against division by zero (render nothing when
`txPlansGiven = 0`).

The mockup puts value in the headline and count in the note; the shipped cards do the reverse.
Not churning reviewed, shipped UI for a mockup's arbitrary preference.

### §5 Monthly P&L — two cards + a margin tag

- **Clinician fees** = `principal_fees_pence + hygienist_therapist_pence`. Sub = % of revenue.
- **Lab + overhead** = every other cost line + all opex lines + custom lines.
- **Net profit** gains a margin tag: `net_profit ÷ revenue`.

These reconcile: `revenue − clinician_fees − lab_overhead` should equal `net_profit`. Where
Emergent's own lines don't add up, **surface the residual** rather than forcing the arithmetic —
a silent plug would hide a broken feed.

The mockup's "45% of production" is fiction (£28,996/£226,698 = 12.8%). Show % of revenue.

Note: the latest Emergent P&L for Plan4growth is **June 2026**, not July. The existing
`latestMonthlyPl` fallback already handles this correctly.

### §7 Revenue by line

Port the horizontal bar chart onto the cockpit, reusing the existing treatment-mix RPC, scoped
to the same `ScopePeriodBar`. **Known limitation:** `invoice_items` for Plan4growth only runs
from 10 Jun 2026, so windows before that render empty. The empty state must say so rather than
implying zero revenue.

## Phase B — Profit vs Breakeven (the core ask)

### Migration: `practice_cost_model`

```sql
create table if not exists public.practice_cost_model (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations(id) on delete cascade,
  practice_id               uuid not null references public.practices(id) on delete cascade,
  effective_from            date not null,
  fixed_cost_pence_month    bigint,
  breakeven_low_pence       bigint,
  breakeven_high_pence      bigint,
  working_days_per_month    int not null default 20,
  revenue_target_pence_month bigint,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (practice_id, effective_from)
);
```

Idempotent, additive, RLS enabled, `organisation_id` on every row (rule 3). After applying on
hosted: `NOTIFY pgrst, 'reload schema';` (recurring gotcha).

**As-of read:** the latest row per practice where `effective_from <= window.since`. A practice
with no row yet has no cost model — §6 shows it as "not set", never as £0 profit.

**Write semantics:** editing writes a row at `effective_from = today`, upserting on
`(practice_id, effective_from)` so two edits in one day don't create two rows.

### Formula — `lib/formulas.js`

```
breakeven_mid       = (breakeven_low + breakeven_high) / 2
contribution_margin = fixed_cost_month / breakeven_mid
fixed_day           = fixed_cost_month / working_days_per_month
breakeven_day       = fixed_day / contribution_margin          ( = breakeven_mid / working_days )
contribution        = revenue × contribution_margin
profit              = contribution − fixed_day × working_days_in_window
status              = profit >= 0 ? 'above' : 'below'
```

`working_days_in_window` — the count of **distinct cash-up days for that practice** inside the
window, i.e. days it traded. A day with no cash-up row contributes neither revenue nor fixed
cost, so a practice that failed to key a cash-up shows a smaller window rather than a phantom
loss. This is the same basis as `working_days_elapsed` in §1, so the two sections agree.

Guards: `breakeven_mid = 0` → no margin, section renders "not set". `contribution_margin` outside
`(0, 1]` → reject the input at the API with a clear message; a breakeven below fixed cost is
nonsense.

Per project rule, any new formula updates `docs/FORMULAS.md` **and** adds a unit test — the
accountant reviews `FORMULAS.md` before launch, and this is precisely the formula the mockup
got wrong.

### §6 table

Window-driven, so it reads exactly as the mockup when the window is one day:

`Practice | Revenue | Breakeven | Contribution | Fixed | Profit | Status`, plus a Group row.
Revenue per practice comes from the same `cashupRollup` that already feeds §1, so §6 and §1
reconcile by construction.

A practice with **no cost model** is listed with its revenue but shows "not set" for the derived
columns, and is **excluded from the Group row**, which carries a count of how many were excluded.
Folding a costless practice into the group as £0 fixed would silently overstate group profit —
the exact failure mode this section exists to prevent.

Per-practice cost inputs are edited from §6 via a row-level edit opening a small form
(fixed cost, breakeven low/high, working days). Consistent with editing the target on §1's card.

### §1 Daily target card

Editable when scoped to a single practice; read-only sum when scoped to All practices.
`daily_target = revenue_target_pence_month / working_days_per_month`.

### API

```
GET   /api/cockpit                        (extended: breakeven block)
GET   /api/cockpit/cost-model             list as-of, per practice
PUT   /api/cockpit/cost-model/:practiceId upsert at effective_from = today
```

Reads follow the existing `finance.view` gate. **Writes are `requireRole('owner')`** — delegable
later via the permissions catalog. Note rule 5: Practice Manager finance access is Owner-toggled,
so owner-only is the safe default rather than assuming a manager may set targets.

## Phase C — per-practice ad attribution

### The join

`ad_metrics` already has a nullable `practice_id`; it is null on every live row. `ad_accounts`
carries the real map (migration `000069`), and `ad_metrics.customer_id` is the documented join
key:

```
ad_metrics ⋈ ad_accounts on (organisation_id, provider, customer_id) → practice_id
```

Resolve practice at read time through `ad_accounts` rather than backfilling `ad_metrics.practice_id`,
so re-mapping an account is instant and doesn't need a re-sync (same reasoning as the Emergent
`restampPractice` design).

### State of the map (verified 2026-07-17, Plan4growth)

All six accounts have `practice_id = null`. The names map cleanly and line up with the mockup's
§3 table (Ashford/Meta, Barnet/Meta, Rochester/Google, FTS/Meta):

| Provider | Account | All-time spend | Maps to |
|---|---|---|---|
| meta_ads | GM Dental Ashford | £90,752.08 | Ashford |
| meta_ads | GM Dental Barnet | £45,710.55 | Barnet |
| meta_ads | GM Dental And Implant Centre I | £94,585.84 | **ambiguous — needs Gaurav** |
| meta_ads | GM - FTS | £0.00 | Bexleyheath (Fixed Teeth Solutions) — same site, confirmed |
| google_ads | GM-Dental-Rochester | £41,291.60 | Rochester |
| google_ads | *(unnamed, 9074914150)* | £0.00 | unknown |

Four of the six map on sight. The two that don't stay unmapped and surface in the unmapped row —
the £94,585.84 account is the largest spender, so leaving it unattributed is materially better than
guessing which practice it belongs to.

### Known data hazard — spend split across two orgs

The same ad accounts exist under both `developer` and `Plan4growth`, **with real spend in each**
(Meta Ashford: £38,172.84 under developer, £90,752.08 under Plan4growth; Meta "GM - FTS":
£16,768.65 under developer, £0 under Plan4growth). Plan4growth's spend is therefore incomplete —
FTS in particular reads £0 — until the connector is reconnected under one org
(memory `ad-sync-window-and-robustness`).

This is a data problem, not a code problem. §3 must not paper over it: a channel with leads but
zero spend renders CPL/ROAS as "—", never as `£0` or `∞`.

### UI

- §3's per-practice table gains `Ad spend | CPL | ROAS`.
- Unmapped accounts get their **own row**, labelled with the account name — never spread across
  practices, never silently dropped.
- New mapping UI under System → Integrations: account → practice, mirroring the existing Emergent
  business→practice mapping panel.
- The group ChannelCards stay as they are.

Null-guards: `cpl = null` when `leads = 0`; `roas = null` when `spend = 0`. Both render "—".

## Testing

Backend (vitest, `backend/test/`):

- `formulas.js` breakeven: the corrected margin; the mockup's own table reproduced with correct
  outputs; zero/negative/inverted breakeven guards.
- `practice_cost_model` as-of reads: a March window uses March's model after a July edit;
  same-day double edit upserts rather than duplicating.
- Per-practice spend join: mapped accounts attribute; unmapped land in the unmapped row and are
  excluded from practice CPL/ROAS.
- Null-guards: leads=0 → CPL null; spend=0 → ROAS null.
- Cross-org isolation for every new repo method (explicit `organisation_id` filter — there is no
  automatic isolation on the `serviceClient` path).

Frontend has no test framework; not gated by CI. Verify via `npm run typecheck` + `lint` + `build`.

## Out of scope

- The mockup's blue callouts, `NEW` badges, `src` chips and dev-summary card.
- **FIX #6** (a target reading "£50.8M/£80M"). That is the **Business Hub**, not the cockpit —
  `revenueTargetPence` comes from a business-health baseline via `analytics.service.js:2818`
  (`b.revenue * 100`). It looks like a pounds/pence data-entry error in that baseline and wants
  its own investigation.
- "New patients seen" / new-vs-existing split (decision 7). Derivable from Dentally's 109k
  appointments if ever wanted, but not now.
- Restyling the cockpit or the app to the mockup's green/serif language.
- Mapping QuickBooks companies to practices. The four live companies (G Mehta Limited, Gmd
  Bexleyheath Ltd, Gmvalley Limited, Smilevalley Limited) have no practice mapping by design
  (memory `quickbooks-multi-account`), and the cockpit doesn't read them — §5 uses
  `emergent_monthly_pl`.

## Resolved by the owner, 2026-07-17

1. **Bexleyheath and Fixed Teeth Solutions are the same site.** The existing map is correct; the
   mockup listing them separately was an error. Practice count stays at 4 reporting + Warwick Lodge.
2. **Warwick Lodge is real.** Its row is created in Phase 0 with an explicit "Not reporting" state
   until Emergent is configured to send it.

## Open questions (need Gaurav, not blocking any phase)

1. **Which practice is the Meta account "GM Dental And Implant Centre I"?** It is the largest
   spender at £94,585.84 and its name matches no practice cleanly. Stays in the unmapped row until
   answered — its spend is excluded from every practice's CPL/ROAS rather than guessed at.
2. **Which practice, if any, is the unnamed Google account `9074914150`?** £0 spend, so immaterial
   for now.
3. **What are the real per-practice daily targets?** The mockup's card says £40,000 while its own
   note says "£2M/mo ÷ 20 · £100k/day". Moot for the build — the figure is typed into the card —
   but the real numbers are needed before §1's target card means anything.
4. **Should Elevate360 Academy be surfaced anywhere?** It is an Emergent business (1 cash-up row,
   3 Mar 2026) and correctly not a dental practice, so it is excluded from the cockpit. The
   mockup's FIX #5 mentions "Academy/Lab", which may mean Gaurav wants them reported somewhere —
   but not, on the evidence, as practices on this page.

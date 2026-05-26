# Chair Utilisation from Real Dentally Data — Design

**Date:** 2026-05-26
**Status:** Approved (pending spec review)
**Area:** Operations → Schedule / Chair utilisation

## Problem

The Operations "Chair Utilisation" heatmap (`frontend/features/operations/components/ChairScreen.tsx`)
renders a hardcoded 5-day × 4-slot grid from `CHAIR_UTIL` mock data. Real Dentally
appointments are already synced (`starts_at`, `ends_at`, `status`, `practice_id`) but
nothing aggregates them into a utilisation view. The only existing utilisation number
(`chairUtilisationPct` in `analytics.service.js` KPIs) is an owner-set baseline estimate,
not computed from real appointments.

Wire the heatmap to real Dentally appointment data, computed as **true % utilisation
against per-practice capacity**.

## Constraints (what Dentally does/doesn't give us)

- Dentally sync (`backend/src/lib/integrations/dentally-sync.js`) captures: site→`practice_id`,
  `starts_at`, `ends_at`, `status`. It does **not** map practitioner, chair, or room.
- Therefore: **no per-chair and no per-associate split is possible.** The view stays a
  practice × weekday × time-slot grid. Per-chair/per-associate splits are explicitly out of scope.
- Capacity (chairs, opening hours) is not in Dentally — it must be configured per practice.

## Decisions (from brainstorming)

- **Metric:** True % = booked minutes / available capacity minutes. (Not relative density, not raw counts.)
- **Capacity granularity:** Per-practice — chair count + a single daily open/close window + a working-days set.
- **View scope:** Practice selector (pick one practice), matching the Appointments page pattern.
- **Window:** Trailing 4 weeks of past appointments. Booked time counts statuses
  `scheduled | confirmed | in_progress | completed | no_show` (chair was reserved); `cancelled` excluded.
- **Time display:** 12-hour format in all UI (e.g. `8:00am–11:00am`). DB stores native `TIME` (24h).

## Time slots (fixed)

Four blocks covering 08:00–20:00. Labels keep the existing `CHAIR_SLOTS` names.

| Slot | Window (24h, internal) | Display (12h) |
|------|------------------------|---------------|
| Morning   | 08:00–11:00 | 8:00am–11:00am |
| Midday    | 11:00–14:00 | 11:00am–2:00pm |
| Afternoon | 14:00–17:00 | 2:00pm–5:00pm |
| Evening   | 17:00–20:00 | 5:00pm–8:00pm |

Each slot's available capacity is trimmed by the practice's open/close window, so a
practice open 09:00–17:00 has partial morning capacity and zero evening capacity. Real
opening hours are handled by interval overlap, not by hardcoding which slots exist.

## Architecture

### 1. Capacity config — `practices` table migration

New migration `supabase/migrations/20260101000023_practice_capacity.sql` (next in ledger).
Add nullable columns to `practices`:

- `chairs SMALLINT` — number of treatment chairs/surgeries
- `open_time TIME` — daily opening time
- `close_time TIME` — daily closing time
- `working_days SMALLINT[]` — ISO weekday numbers (1=Mon … 7=Sun)
- `chair_hour_rate_pence INT` — optional, for the lost-revenue KPI

All nullable. A practice with incomplete config (no chairs / no hours / no working days)
is treated as **unconfigured** → API returns `configured: false` and the UI shows a
"Set capacity" empty state instead of fake numbers. Idempotent (`ADD COLUMN IF NOT EXISTS`).
After applying on hosted: `NOTIFY pgrst, 'reload schema';`. Keep `db/01_schema.sql` in sync.

### 2. Pure computation — `backend/src/lib/utilisation.js`

A pure, dependency-free function (testable in isolation, in the spirit of `lib/formulas.js`):

```
computeChairUtilisation({ appointments, capacity, windowFrom, windowTo }) -> { days, slots, grid, kpis }
```

Inputs:
- `appointments`: `[{ starts_at, ends_at, status }]` already filtered to the practice + window by the repo.
- `capacity`: `{ chairs, openTime, closeTime, workingDays, chairHourRatePence }`.
- `windowFrom`, `windowTo`: the trailing-4-week bounds.

Logic, per `(weekday, slot)` cell where `weekday ∈ workingDays`:
- `availableMin = chairs × overlapMinutes(slot, [openTime, closeTime]) × weekdayOccurrences(weekday, windowFrom, windowTo)`
- `bookedMin = Σ overlapMinutes([appt.starts_at, appt.ends_at], slot)` over appts whose
  weekday = this weekday, status ∈ booked set (`cancelled` excluded)
- `utilPct = availableMin > 0 ? min(100, round(100 × bookedMin / availableMin)) : null`
- A cell with `availableMin = 0` (slot outside opening hours) → `null` (rendered as closed/blank).

`grid` is indexed `[dayIndex][slotIndex]` over the configured working days only.

KPIs:
- `avgUtilPct` — mean of non-null cells
- `peakSlot` / `lowestSlot` — `{ day, slot, pct }` of max / min non-null cells
- `idleChairHours` — `Σ(availableMin − bookedMin) / 60` over cells
- `lostRevenuePence` — `idleChairHours × chairHourRatePence`, or `null` if rate unset

`overlapMinutes(intervalA, intervalB)` = `max(0, min(endA,endB) − max(startA,startB))` in minutes.
For appointments, only the time-of-day portion is intersected with the slot; the date
determines which weekday cell it lands in.

### 3. Backend wiring (routes → controller → service → repo)

- `backend/src/routes/operations.routes.js` (new) — `GET /chair-utilisation`, mounted at
  `/api/operations` in `app.js`, behind `authenticate`. Gated to owner + practice_manager
  (`requireRole('owner','practice_manager')`) — operational data, not finance-gated.
- `backend/src/controllers/operations.controller.js` (new) — validate query with a new Zod
  schema `chairUtilisationQuerySchema` (`practice_id` uuid required, `weeks` int default 4, max 12)
  in `backend/src/models/operations.model.js`; call service; shape response.
- `backend/src/services/operations.service.js` (new) — `chairUtilisation(orgId, practiceId, weeks)`:
  1. Load practice capacity via practice repo (`getCapacity(orgId, practiceId)`); if incomplete,
     return `{ practice: { id, name, configured: false } }`.
  2. Compute `windowFrom = now − weeks·7d`, `windowTo = now`.
  3. Fetch appointments via appointment repo (new `listForUtilisation(orgId, practiceId, windowFrom, windowTo)`
     — org + practice + `starts_at` range, statuses ≠ `cancelled`, no pagination, selects
     `starts_at, ends_at, status` only).
  4. Call `computeChairUtilisation(...)`, return `{ practice: {id,name,configured:true}, days, slots, grid, kpis }`.

Org isolation: every repo query carries the explicit `.eq('organisation_id', orgId)` filter
(service-client path, per the project's manual-isolation convention).

**Response shape:**
```json
{
  "practice": { "id": "...", "name": "...", "configured": true },
  "days": ["Mon","Tue","Wed","Thu","Fri"],
  "slots": ["Morning","Midday","Afternoon","Evening"],
  "grid": [[82, 91, 77, null], [ ... ]],
  "kpis": {
    "avgUtilPct": 79,
    "peakSlot": { "day": "Tue", "slot": "Midday", "pct": 91 },
    "lowestSlot": { "day": "Fri", "slot": "Evening", "pct": 41 },
    "idleChairHours": 36,
    "lostRevenuePence": 540000
  }
}
```
Unconfigured practice: `{ "practice": { "id": "...", "name": "...", "configured": false } }`.

### 4. Frontend — `ChairScreen.tsx`

- Add a practice selector (reuse the Appointments page pattern / existing practices fetch).
- React Query fetch `GET /api/backend/operations/chair-utilisation?practice_id=<id>&weeks=4`.
- Render the heatmap grid from `grid`/`days`/`slots`; `null` cells render as a neutral
  "closed" cell. Colour scale keyed to %.
- KPI cards driven by `kpis` (avg util, peak, lowest, lost revenue — hide lost-revenue card
  if `lostRevenuePence` is null).
- Slot/time labels and any displayed open/close times use 12-hour format via a small helper
  (extend `lib/format.ts` if no time formatter exists).
- Empty state when `configured: false`: message + link to Practice settings.
- Remove the `CHAIR_UTIL` / `CHAIR_DAYS` / `CHAIR_SLOTS` mock usage from `data.ts` once wired.

### 5. Practice settings UI — capacity fields

Add capacity inputs to the practice settings/edit surface (under `(dashboard)` practices /
`features/practices`): chairs (number), open/close time (12h pickers), working-days
multi-select, optional £/chair-hour. Persists via the practices update endpoint (extend its
controller/service/repo + Zod schema to accept the new fields). Owner-editable.

## Error handling

- Missing/invalid `practice_id` → 400 (Zod).
- Practice not in caller's org → repo returns none → 404.
- Unconfigured capacity → 200 with `configured: false` (not an error; UI shows empty state).
- `weeks` out of range (≤0 or >12) → clamped/400 via schema.

## Testing

- **Unit (vitest)** — `backend/test/utilisation.test.js` for `computeChairUtilisation`:
  overlap maths (partial slot overlap), capping at 100%, closed slot → null,
  `no_show` counted as booked, `cancelled` excluded, weekday-occurrence count over window,
  idle-hours + lost-revenue (rate set vs unset → null), unconfigured short-circuit.
- **Service test** — capacity-incomplete short-circuit returns `configured:false`; happy path
  shape. Cross-org isolation (appointments from another org excluded).

## Docs to update

- `docs/API.md` — new `GET /api/operations/chair-utilisation` endpoint.
- `docs/FORMULAS.md` — utilisation formula + lost-revenue (per the project rule: any new
  formula updates FORMULAS.md and adds a unit test).

## Out of scope

- Per-chair utilisation (no chair/resource id from Dentally).
- Per-associate/practitioner split (Dentally sync doesn't map practitioner → associate).
- Per-weekday distinct opening hours (single daily window only, by decision).
- Backfilling practitioner data into the Dentally sync.

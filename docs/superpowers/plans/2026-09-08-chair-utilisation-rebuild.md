# Chair Utilisation Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chair utilisation usable and its numbers honest — capacity derived from real Dentally opening hours, chairs as first-class rows, a whole-week bulk entry page, and metrics that state their coverage instead of extrapolating a £230k claim from 14% of a week.

**Architecture:** Three new pure libraries hold all the arithmetic (slot/opening-hours overlap, Dentally payload parsing, coverage-aware metrics) so it is unit-testable with no I/O. Two new tables — `practice_chairs` and `practice_opening_hours` — make capacity a fact rather than a `chair_config` assumption; `chair_utilisation` keeps only booked time and revenue. One bulk endpoint saves a chair's whole week in a single transaction.

**Tech Stack:** Node 22 native ESM (`import`, `.js` extensions on relative imports), Express, Zod, Supabase Postgres via `serviceClient`, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-08-chair-utilisation-rebuild-design.md`

**Worktree:** `.claude/worktrees/feat+chair-utilisation`, branch `worktree-feat+chair-utilisation`. Backend deps are installed; `backend/.env` is present and gitignored.

## Global Constraints

Copied verbatim from `rules.md` and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Multi-tenant always.** Every business table carries `organisation_id`. `serviceClient` bypasses RLS, so the explicit `.eq('organisation_id', orgId)` chained on every query **is** the isolation.
- **The organisation comes from `req.user.organisation_id`** (or the server-resolved `req.agencyOrgId`) — never from a request body, query parameter, or payload row.
- **Never use a PostgREST embed** (`contact:contacts(...)`) on the service client. An embed resolves the FK as a join with **no org predicate**.
- **No `z.record(z.any())` update schemas.** They make `organisation_id` writable.
- **RPCs take `p_org`, are `SECURITY DEFINER`, and get the revoke idiom:** `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`
- **Never match on a name where an id exists.** Mapping is explicit, stored, per-tenant.
- **Money is integer pence**, never floats. Display `(pence/100).toLocaleString('en-GB')`.
- **Null is not zero.** A cost per nothing is an em dash, never "£0.00". `formatPence` accepts `number | null | undefined` and renders null as `£0.00` with no TypeScript warning, so the guard goes **at the call site**.
- **Reads are paged.** PostgREST silently truncates at 1000 rows — tables and set-returning RPCs alike. Page on a unique key and stop on an **empty** page, never a short one.
- **British English in all UI** (organisation, colour, optimise, centre, utilisation). No emojis in code or UI. No dark mode — light/white only.
- **Reception sees CRM only** (rule 5).
- **Every mutation audited** to `audit_log` by the existing `audit` middleware.
- **No keys in any file.** Run `ggshield secret scan pre-commit` before **every** commit.
- **No patient records.** Never read patient-identifying data into a transcript, test fixture, or log.
- **Migrations are NOT applied to hosted** in this plan. Both end with `NOTIFY pgrst, 'reload schema';` and wait for the owner.
- **Backend is native ESM.** Never reintroduce `require` / `module.exports`. Relative imports carry `.js` extensions.

---

## File Structure

**New — pure libraries (no I/O, unit-tested in isolation):**
- `backend/src/lib/chair-slots.js` — slot boundaries and the slot↔opening-hours overlap. The single definition of a slot window; the frontend renders what the server sends.
- `backend/src/lib/dentally-opening-hours.js` — parses Dentally's `opening_hours` payload into weekday rows.
- `backend/src/lib/chair-metrics.js` — coverage, occupancy, and the null-below-threshold money rules.

**New — data access (org-scoped, paged):**
- `backend/src/repositories/practice-chair.repository.js`
- `backend/src/repositories/practice-opening-hours.repository.js`

**New — services:**
- `backend/src/services/chair-capacity.service.js` — composes chairs + opening hours into the open-cell set every other consumer reads.

**New — frontend:**
- `frontend/app/(dashboard)/chair-utilisation/page.tsx`
- `frontend/features/operations/components/ChairEntryScreen.tsx`
- `frontend/features/operations/components/ChairWeekGrid.tsx`
- `frontend/features/operations/components/OpeningHoursPanel.tsx`
- `frontend/features/operations/components/ChairsPanel.tsx`
- `frontend/features/operations/chair-entry-api.ts`
- `frontend/features/operations/chair-entry-hooks.ts`

**New — migrations:**
- `supabase/migrations/20260101000180_chair_capacity.sql`
- `supabase/migrations/20260101000181_chair_booked_minutes_plpgsql.sql`

**Modified:**
- `backend/src/lib/permissions.js` — add `operations.edit`
- `backend/src/middleware/agency.js` — add `requirePermissionOrAgencyActor`
- `backend/src/models/chair-utilisation.model.js` — bulk, chair, opening-hours schemas
- `backend/src/repositories/chair-utilisation.repository.js` — `chair_id`, paged read, bulk upsert
- `backend/src/services/chair-utilisation.service.js` — bulk save, one snapshot per save
- `backend/src/services/analytics.service.js:93-207` — `chairAnalytics` onto `chair-metrics`
- `backend/src/repositories/analytics.repository.js:396-404` — paged `chairUtilisationRows`
- `backend/src/controllers/chair-utilisation.controller.js`, `backend/src/routes/chair-utilisation.routes.js`
- `backend/src/lib/integrations/dentally-sync.js` — opening-hours pull
- `frontend/features/operations/components/ChairEfficiencyScreen.tsx` — coverage badges, null guards
- `frontend/app/(dashboard)/chair/page.tsx` — Chair Efficiency only
- `frontend/lib/nav.ts`, `frontend/lib/permissions.ts`
- `docs/API.md`, `docs/FORMULAS.md`

---

## Reference data (measured 2026-09-08 — use these exact values in fixtures)

**Real Dentally opening hours** (`GET /sites`, minutes from local midnight):

| Practice | `pms_site_id` | Mon–Fri | Sat | Sun |
|---|---|---|---|---|
| Ashford | `f5792c95-ab93-4579-afde-dd5680d02086` | 09:00–17:00 (540–1020) | 09:00–17:00 | closed |
| Barnet | `6d4e5747-352c-424a-9733-6f92d78847b0` | 08:30–17:30 (510–1050) | 09:00–17:30 (540–1050) | closed |
| Bexleyheath | `cd54e48f-ba2a-49b1-b08b-756cdcefe246` | 08:30–18:30 (510–1110) | 09:00–14:00 (540–840) | closed |
| Rochester | `52ae4391-8434-4382-ab28-48a425e665cc` | 08:30–17:30, **Thu 08:30–20:00** | 08:30–17:30 | closed |
| Warwick Lodge | `null` | — no Dentally site — | | |

Sunday is **absent** from every payload. Times are **not zero-padded consistently**: `"9:00"` appears alongside `"08:30"`.

**The nine live `chair_utilisation` cells** (all trial data — names are `Test Surgery 1`, `Test Surgery 2`, `test`):

| Practice | Chair | Weekday | Slot | Booked | Stored available | Revenue (pence) |
|---|---|---|---|---|---|---|
| Ashford | Test Surgery 1 | 1 Mon | morning | 150 | 180 | 95000 |
| Ashford | Test Surgery 1 | 1 Mon | afternoon | 180 | 240 | 110000 |
| Ashford | Test Surgery 1 | 2 Tue | morning | 120 | 180 | 72000 |
| Ashford | Test Surgery 1 | 3 Wed | afternoon | 210 | 240 | 130000 |
| Ashford | Test Surgery 2 | 1 Mon | morning | 180 | 180 | 120000 |
| Ashford | Test Surgery 2 | 2 Tue | afternoon | 150 | 240 | 90000 |
| Ashford | Test Surgery 2 | 4 Thu | morning | 120 | 240 | 76000 |
| Ashford | Test Surgery 2 | 5 Fri | **evening** | 90 | 180 | 60000 |
| Barnet | test | 1 Mon | morning | 120 | 120 | 29900 |

**Expected outcomes after this plan** (the regression fixtures):

- **Ashford** — evening slot has 0 available (closes 17:00), so 3 open slots × 6 days × 2 chairs = **36 open cells**. Seven of eight stored cells are in open slots; the Friday-evening one is a **closed-cell entry**. Four cells (Mon morning ×2, Wed afternoon, and the Friday evening one) record **more booked time than the practice is open for**. Derived available over the seven = 1,020 min/wk; booked clamped = 990 → **97.1% occupancy, 7 of 36 entered (19% coverage)**, money `null`. *Today: 71.4% and £230,041 recoverable.*
- **Barnet** — 4 open slots × 6 days × 1 chair = **24 open cells**. One entered: Monday morning, 120 booked against a derived 150 → **80% occupancy, 1 of 24 (4% coverage)**, money `null`. *Today: 100% occupancy and £0 cost of empty chairs.*
- **Warwick Lodge** — no `pms_site_id`, so no opening hours. Every figure `null` with a *set your opening hours* prompt. Never £0.

---

## Task 1: Slot windows and the opening-hours overlap

**Files:**
- Create: `backend/src/lib/chair-slots.js`
- Test: `backend/test/chair-slots.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `SLOTS: string[]` (`['morning','midday','afternoon','evening']`), `SLOT_EDGES: number[]`, `slotWindow(slotIndex, openMinute, closeMinute) -> {start, end}`, `slotAvailableMinutes(slotIndex, openMinute, closeMinute) -> number`, `daySlotMinutes(openMinute, closeMinute) -> number[]` (one entry per slot), `slotIndexOf(slot) -> number`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-slots.test.mjs`:

```js
// Slot/opening-hours overlap. The whole point of the open-ended first and last
// slots is the invariant asserted in every case below: the slot minutes for a
// day must sum to exactly (close - open), for ANY opening hours. A fixed
// 08:00-20:00 envelope silently loses capacity outside it.
import { describe, it, expect } from 'vitest';
import {
    SLOTS, slotAvailableMinutes, daySlotMinutes, slotIndexOf,
} from '../src/lib/chair-slots.js';

const sumEqualsSpan = (open, close) => {
    const mins = daySlotMinutes(open, close);
    expect(mins.reduce((a, b) => a + b, 0)).toBe(close - open);
    return mins;
};

describe('chair-slots', () => {
    it('exposes the four slots in order', () => {
        expect(SLOTS).toEqual(['morning', 'midday', 'afternoon', 'evening']);
        expect(slotIndexOf('afternoon')).toBe(2);
        expect(slotIndexOf('nope')).toBe(-1);
    });

    it('Ashford 09:00-17:00 -> evening is closed, day sums to 480', () => {
        // 540..1020. The real Ashford hours; its evening slot having zero
        // available is why Ashford has 3 open slots a day, not 4.
        expect(sumEqualsSpan(540, 1020)).toEqual([120, 180, 180, 0]);
    });

    it('Barnet 08:30-17:30 -> a 30-minute evening, day sums to 540', () => {
        expect(sumEqualsSpan(510, 1050)).toEqual([150, 180, 180, 30]);
    });

    it('Rochester Thursday 08:30-20:00 -> full evening, sums to 690', () => {
        expect(sumEqualsSpan(510, 1200)).toEqual([150, 180, 180, 180]);
    });

    it('hours OUTSIDE the 08:00-20:00 envelope lose nothing', () => {
        // 07:00-21:00. Under a fixed envelope this would report 720 of 840
        // minutes and silently drop two hours of capacity.
        expect(sumEqualsSpan(420, 1260)).toEqual([240, 180, 180, 240]);
    });

    it('a one-hour morning-only day puts everything in the first slot', () => {
        expect(sumEqualsSpan(540, 600)).toEqual([60, 0, 0, 0]);
    });

    it('an evening-only day puts everything in the last slot', () => {
        expect(sumEqualsSpan(1080, 1200)).toEqual([0, 0, 0, 120]);
    });

    it('closed day (null) -> all zero, never negative', () => {
        expect(daySlotMinutes(null, null)).toEqual([0, 0, 0, 0]);
        expect(daySlotMinutes(540, null)).toEqual([0, 0, 0, 0]);
        expect(daySlotMinutes(null, 1020)).toEqual([0, 0, 0, 0]);
    });

    it('close at or before open -> all zero, not a negative span', () => {
        expect(daySlotMinutes(1020, 540)).toEqual([0, 0, 0, 0]);
        expect(daySlotMinutes(600, 600)).toEqual([0, 0, 0, 0]);
    });

    it('slotAvailableMinutes agrees with daySlotMinutes per index', () => {
        for (let i = 0; i < SLOTS.length; i++) {
            expect(slotAvailableMinutes(i, 510, 1050)).toBe(daySlotMinutes(510, 1050)[i]);
        }
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-slots.test.mjs` from `backend/`
Expected: FAIL — `Failed to resolve import "../src/lib/chair-slots.js"`

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/chair-slots.js`:

```js
// ============================================================================
// Chair slot windows — the SINGLE definition of what a slot spans.
//
// These boundaries used to live only in the frontend (chair-util.ts) for
// display, while the backend had none at all. Two copies of a window
// convention drift invisibly, so the server owns them and returns slot
// boundaries in its payloads; the frontend renders what it is sent.
//
// The first slot starts at the day's OPENING time and the last ends at its
// CLOSING time, rather than at a fixed 08:00/20:00 envelope. That is what
// guarantees the invariant the tests assert: the slot minutes for a day sum
// to exactly (close - open) for ANY opening hours. Under a fixed envelope a
// practice opening at 07:00 would silently lose an hour of capacity, and the
// loss would look like low occupancy rather than a bug.
//
// Times are MINUTES FROM LOCAL MIDNIGHT, never instants. These are wall-clock
// opening times; storing them as instants would shift them across the BST
// boundary. Pure module — no I/O.
// ============================================================================

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];

// The three INTERIOR boundaries only. The outer two come from the day's hours.
export const SLOT_EDGES = [11 * 60, 14 * 60, 17 * 60]; // 11:00, 14:00, 17:00

/** Index of a slot key in SLOTS, or -1 for an unknown key. */
export function slotIndexOf(slot) {
    return SLOTS.indexOf(slot);
}

/**
 * The [start, end) minute window a slot occupies on a day open
 * `openMinute`..`closeMinute`. The first slot starts at the open, the last
 * ends at the close.
 */
export function slotWindow(slotIndex, openMinute, closeMinute) {
    const start = slotIndex === 0 ? openMinute : SLOT_EDGES[slotIndex - 1];
    const end = slotIndex === SLOTS.length - 1 ? closeMinute : SLOT_EDGES[slotIndex];
    return { start, end };
}

/** Minutes of a slot that fall inside the day's opening hours. Never negative. */
export function slotAvailableMinutes(slotIndex, openMinute, closeMinute) {
    if (openMinute == null || closeMinute == null) return 0;
    if (closeMinute <= openMinute) return 0;
    if (slotIndex < 0 || slotIndex >= SLOTS.length) return 0;
    const { start, end } = slotWindow(slotIndex, openMinute, closeMinute);
    const from = Math.max(start, openMinute);
    const to = Math.min(end, closeMinute);
    return Math.max(0, to - from);
}

/** Available minutes for every slot on one day, in SLOTS order. */
export function daySlotMinutes(openMinute, closeMinute) {
    return SLOTS.map((_, i) => slotAvailableMinutes(i, openMinute, closeMinute));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/chair-slots.test.mjs` from `backend/`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/lib/chair-slots.js backend/test/chair-slots.test.mjs
git commit -m "feat(chair): slot windows that never lose capacity outside 08:00-20:00"
```

---

## Task 2: Parse Dentally's opening-hours payload

**Files:**
- Create: `backend/src/lib/dentally-opening-hours.js`
- Test: `backend/test/dentally-opening-hours.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseTimeToMinutes(raw) -> number | null`, `parseOpeningHours(payload) -> { rows, errors }` where `rows` is always **7** entries `{ weekday: 1..7, openMinute: number|null, closeMinute: number|null }` and `errors` is `[{ weekday, day, reason }]`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/dentally-opening-hours.test.mjs`:

```js
// Parsing Dentally's /sites opening_hours. Every shape below was observed in
// the live payload on 2026-09-08 — the unpadded "9:00" and the absent Sunday
// are real, not defensive guesses.
import { describe, it, expect } from 'vitest';
import { parseTimeToMinutes, parseOpeningHours } from '../src/lib/dentally-opening-hours.js';

describe('parseTimeToMinutes', () => {
    it('accepts both padded and unpadded hours (both occur live)', () => {
        expect(parseTimeToMinutes('08:30')).toBe(510);
        expect(parseTimeToMinutes('9:00')).toBe(540);
        expect(parseTimeToMinutes('17:30')).toBe(1050);
        expect(parseTimeToMinutes('20:00')).toBe(1200);
        expect(parseTimeToMinutes(' 09:00 ')).toBe(540);
    });

    it('returns null for anything it cannot parse', () => {
        for (const bad of ['', 'closed', '9', '25:00', '09:75', '9:0', null, undefined, 900]) {
            expect(parseTimeToMinutes(bad)).toBeNull();
        }
    });
});

describe('parseOpeningHours', () => {
    it('parses the real Ashford payload; Sunday is absent, so Sunday is closed', () => {
        const { rows, errors } = parseOpeningHours({
            Monday: { open: '09:00', close: '17:00' },
            Tuesday: { open: '09:00', close: '17:00' },
            Wednesday: { open: '09:00', close: '17:00' },
            Thursday: { open: '09:00', close: '17:00' },
            Friday: { open: '09:00', close: '17:00' },
            Saturday: { open: '09:00', close: '17:00' },
        });
        expect(errors).toEqual([]);
        expect(rows).toHaveLength(7);
        for (let d = 1; d <= 6; d++) {
            expect(rows[d - 1]).toEqual({ weekday: d, openMinute: 540, closeMinute: 1020 });
        }
        expect(rows[6]).toEqual({ weekday: 7, openMinute: null, closeMinute: null });
    });

    it('handles the real GM Dental payload: unpadded Saturday, late Thursday', () => {
        const { rows, errors } = parseOpeningHours({
            Monday: { open: '08:30', close: '17:30' },
            Thursday: { open: '08:30', close: '20:00' },
            Saturday: { open: '9:00', close: '17:30' },
        });
        expect(errors).toEqual([]);
        expect(rows[0]).toEqual({ weekday: 1, openMinute: 510, closeMinute: 1050 });
        expect(rows[3]).toEqual({ weekday: 4, openMinute: 510, closeMinute: 1200 });
        expect(rows[5]).toEqual({ weekday: 6, openMinute: 540, closeMinute: 1050 });
        // Tuesday/Wednesday/Friday absent -> closed, and that is NOT an error.
        expect(rows[1]).toEqual({ weekday: 2, openMinute: null, closeMinute: null });
    });

    it('is case-insensitive about weekday keys', () => {
        const { rows } = parseOpeningHours({ monday: { open: '09:00', close: '17:00' } });
        expect(rows[0]).toEqual({ weekday: 1, openMinute: 540, closeMinute: 1020 });
    });

    it('records an unparseable time as an ERROR, never as a silent closure', () => {
        // The distinction matters: a closed day is a fact, an unparseable day is
        // a bug we must be told about. Both render as closed, only one reports.
        const { rows, errors } = parseOpeningHours({
            Monday: { open: 'half nine', close: '17:00' },
        });
        expect(rows[0]).toEqual({ weekday: 1, openMinute: null, closeMinute: null });
        expect(errors).toEqual([
            { weekday: 1, day: 'Monday', reason: 'unparseable open/close time' },
        ]);
    });

    it('rejects a close at or before the open', () => {
        const { rows, errors } = parseOpeningHours({
            Monday: { open: '17:00', close: '09:00' },
        });
        expect(rows[0]).toEqual({ weekday: 1, openMinute: null, closeMinute: null });
        expect(errors[0].reason).toBe('close is not after open');
    });

    it('a missing or non-object payload gives seven closed days, no errors', () => {
        for (const empty of [null, undefined, {}, 'nope', 42]) {
            const { rows, errors } = parseOpeningHours(empty);
            expect(rows).toHaveLength(7);
            expect(rows.every((r) => r.openMinute === null)).toBe(true);
            expect(errors).toEqual([]);
        }
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/dentally-opening-hours.test.mjs` from `backend/`
Expected: FAIL — `Failed to resolve import "../src/lib/dentally-opening-hours.js"`

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/dentally-opening-hours.js`:

```js
// ============================================================================
// Dentally /sites `opening_hours` -> per-weekday minute rows.
//
// Shape observed live on 2026-09-08 across all four connected sites:
//   { "Monday": {"open":"08:30","close":"17:30"}, ..., "Saturday": {...} }
//
// Two things the live payload does that a guessed parser would get wrong:
//   1. SUNDAY IS ABSENT from every site. An absent weekday means closed, and
//      that is a fact rather than an error — a six-day practice must not be
//      penalised for not opening on Sunday.
//   2. TIMES ARE NOT CONSISTENTLY ZERO-PADDED: "9:00" appears alongside
//      "08:30" in the same account.
//
// An unparseable time is recorded as an ERROR and rendered closed. Silently
// treating it as closed would turn an upstream change into invisible lost
// capacity. Pure module — no I/O.
// ============================================================================

// ISO weekday numbering: Monday = 1 .. Sunday = 7.
const WEEKDAY_NAMES = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** "08:30" | "9:00" -> minutes from local midnight. Null for anything else. */
export function parseTimeToMinutes(raw) {
    if (typeof raw !== 'string') return null;
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
    if (!m) return null;
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

/**
 * Parse a site's opening_hours object.
 * Always returns SEVEN rows in weekday order, so a caller can upsert the whole
 * week without reasoning about which days were present.
 */
export function parseOpeningHours(payload) {
    const rows = [];
    const errors = [];
    const source = payload && typeof payload === 'object' ? payload : {};

    // Case-insensitive lookup: the live payload is Title-Case, but nothing in
    // the API contract promises that, and a case change would silently close
    // every practice in the group.
    const byLowerKey = new Map(
        Object.entries(source).map(([k, v]) => [String(k).toLowerCase(), v]),
    );

    for (let weekday = 1; weekday <= 7; weekday++) {
        const day = WEEKDAY_NAMES[weekday - 1];
        const entry = byLowerKey.get(day.toLowerCase());
        const closed = { weekday, openMinute: null, closeMinute: null };

        // Absent day = closed. Not an error.
        if (entry == null || typeof entry !== 'object') {
            rows.push(closed);
            continue;
        }

        const openMinute = parseTimeToMinutes(entry.open);
        const closeMinute = parseTimeToMinutes(entry.close);
        if (openMinute == null || closeMinute == null) {
            errors.push({ weekday, day, reason: 'unparseable open/close time' });
            rows.push(closed);
            continue;
        }
        if (closeMinute <= openMinute) {
            errors.push({ weekday, day, reason: 'close is not after open' });
            rows.push(closed);
            continue;
        }
        rows.push({ weekday, openMinute, closeMinute });
    }

    return { rows, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/dentally-opening-hours.test.mjs` from `backend/`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/lib/dentally-opening-hours.js backend/test/dentally-opening-hours.test.mjs
git commit -m "feat(chair): parse Dentally opening hours, absent day is closed not an error"
```

---

## Task 3: Coverage-aware metrics

This task holds the fix for the £230,041 defect. Occupancy and money must come from the **same** cell set; today occupancy comes from entered cells while money comes from `chair_config`'s full-year capacity, and nothing reconciles them.

**Files:**
- Create: `backend/src/lib/chair-metrics.js`
- Test: `backend/test/chair-metrics.test.mjs`

**Interfaces:**
- Consumes: `SLOTS`, `daySlotMinutes`, `slotIndexOf` from `backend/src/lib/chair-slots.js`.
- Produces:
  - `COVERAGE_THRESHOLD_PCT = 50`
  - `practiceChairMetrics({ chairs, openingHours, cells, weeksYr, benchOccPct, benchRevHrPence }) -> PracticeChairMetrics`
  - `rollupChairMetrics(rows, { weeksYr, benchOccPct, benchRevHrPence }) -> PracticeChairMetrics`

  `chairs`: `[{ id, active }]`. `openingHours`: `[{ weekday, openMinute, closeMinute }]`. `cells`: `[{ chair_id, weekday, slot, booked_minutes, revenue_pence }]`.

  `PracticeChairMetrics` = `{ hasOpeningHours, chairs, openCells, enteredCells, coveragePct, closedCellEntries, overbookedCells, availableMinutesWk, bookedMinutesWk, emptyMinutesWk, revenuePence, occupancyPct, revPerBookedHrPence, lostPotentialYrPence, recoverRevYrPence }`. The last four and `coveragePct` are `number | null`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-metrics.test.mjs`:

```js
// Coverage-aware chair metrics.
//
// The Ashford and Barnet cases below are the NINE REAL cells that exist on
// hosted, run against the REAL opening hours those practices have in Dentally.
// They are regression fixtures: today the same inputs produce 71.4% / GBP
// 230,041 recoverable for Ashford and 100% / GBP 0 for Barnet.
import { describe, it, expect } from 'vitest';
import {
    COVERAGE_THRESHOLD_PCT, practiceChairMetrics, rollupChairMetrics,
} from '../src/lib/chair-metrics.js';

const CFG = { weeksYr: 46, benchOccPct: 88, benchRevHrPence: 30000 };

// Ashford: open 09:00-17:00 (540-1020) Mon-Sat, closed Sunday.
const ASHFORD_HOURS = [1, 2, 3, 4, 5, 6]
    .map((weekday) => ({ weekday, openMinute: 540, closeMinute: 1020 }))
    .concat([{ weekday: 7, openMinute: null, closeMinute: null }]);

const ASHFORD_CELLS = [
    { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 150, revenue_pence: 95000 },
    { chair_id: 'c1', weekday: 1, slot: 'afternoon', booked_minutes: 180, revenue_pence: 110000 },
    { chair_id: 'c1', weekday: 2, slot: 'morning', booked_minutes: 120, revenue_pence: 72000 },
    { chair_id: 'c1', weekday: 3, slot: 'afternoon', booked_minutes: 210, revenue_pence: 130000 },
    { chair_id: 'c2', weekday: 1, slot: 'morning', booked_minutes: 180, revenue_pence: 120000 },
    { chair_id: 'c2', weekday: 2, slot: 'afternoon', booked_minutes: 150, revenue_pence: 90000 },
    { chair_id: 'c2', weekday: 4, slot: 'morning', booked_minutes: 120, revenue_pence: 76000 },
    { chair_id: 'c2', weekday: 5, slot: 'evening', booked_minutes: 90, revenue_pence: 60000 },
];

const ashford = () => practiceChairMetrics({
    chairs: [{ id: 'c1', active: true }, { id: 'c2', active: true }],
    openingHours: ASHFORD_HOURS,
    cells: ASHFORD_CELLS,
    ...CFG,
});

describe('Ashford — the live cells against real opening hours', () => {
    it('counts 36 open cells: the evening slot is shut, so 3 slots x 6 days x 2 chairs', () => {
        expect(ashford().openCells).toBe(36);
    });

    it('the Friday-evening entry lands in a CLOSED slot and is excluded', () => {
        const m = ashford();
        expect(m.closedCellEntries).toBe(1);
        expect(m.enteredCells).toBe(7);
    });

    it('flags the three open cells booked beyond the practice opening hours', () => {
        // Mon morning on both chairs and Wed afternoon record more booked time
        // than the practice is open for. This is what hand-typed available
        // minutes with nothing to check them against produces.
        expect(ashford().overbookedCells).toBe(3);
    });

    it('clamps booked to available, giving 97.1% on 990 of 1020 minutes', () => {
        const m = ashford();
        expect(m.availableMinutesWk).toBe(1020);
        expect(m.bookedMinutesWk).toBe(990);
        expect(m.emptyMinutesWk).toBe(30);
        expect(m.occupancyPct).toBe(97.1);
    });

    it('reports 19% coverage and SUPPRESSES money below the threshold', () => {
        const m = ashford();
        expect(m.coveragePct).toBe(19);
        // null, not 0. A zero here reads as "nothing is being lost", which is
        // the opposite of "we do not know yet".
        expect(m.lostPotentialYrPence).toBeNull();
        expect(m.recoverRevYrPence).toBeNull();
    });

    it('still reports yield per booked hour, which does not depend on coverage', () => {
        expect(ashford().revPerBookedHrPence).toBe(42000);
    });
});

describe('Barnet — one cell must stop reading as a perfect practice', () => {
    const barnet = () => practiceChairMetrics({
        chairs: [{ id: 'b1', active: true }],
        openingHours: [1, 2, 3, 4, 5]
            .map((weekday) => ({ weekday, openMinute: 510, closeMinute: 1050 }))
            .concat([
                { weekday: 6, openMinute: 540, closeMinute: 1050 },
                { weekday: 7, openMinute: null, closeMinute: null },
            ]),
        cells: [{ chair_id: 'b1', weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 29900 }],
        ...CFG,
    });

    it('24 open cells, one entered', () => {
        const m = barnet();
        expect(m.openCells).toBe(24);
        expect(m.enteredCells).toBe(1);
        expect(m.coveragePct).toBe(4);
    });

    it('reads 80% off a 150-minute morning, NOT the 100% it reports today', () => {
        const m = barnet();
        expect(m.availableMinutesWk).toBe(150);
        expect(m.bookedMinutesWk).toBe(120);
        expect(m.occupancyPct).toBe(80);
    });

    it('money is null, not the GBP 0 cost-of-empty it reports today', () => {
        const m = barnet();
        expect(m.lostPotentialYrPence).toBeNull();
        expect(m.recoverRevYrPence).toBeNull();
    });
});

describe('above the coverage threshold, money is computed', () => {
    // One chair open Monday only, 09:00-17:00 -> 3 open cells, 2 entered = 67%.
    const m = () => practiceChairMetrics({
        chairs: [{ id: 'x', active: true }],
        openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
        cells: [
            { chair_id: 'x', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 30000 },
            { chair_id: 'x', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 },
        ],
        ...CFG,
    });

    it('coverage clears the threshold', () => {
        expect(m().coveragePct).toBe(67);
        expect(COVERAGE_THRESHOLD_PCT).toBe(50);
    });

    it('cost of empty = idle hours x weeks x benchmark rate', () => {
        // 60 idle min/wk = 1 h -> 1 x 46 x GBP 300 = GBP 13,800.
        expect(m().lostPotentialYrPence).toBe(1380000);
    });

    it('recoverable climbs to the benchmark at the practice OWN yield', () => {
        // capacity 300 min/wk = 5 h -> 5 x 46 x (88-80)/100 = 18.4 h @ GBP 300.
        expect(m().revPerBookedHrPence).toBe(30000);
        expect(m().recoverRevYrPence).toBe(552000);
    });
});

describe('edge cases', () => {
    it('no opening hours at all -> everything null, never a confident zero', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }], openingHours: [], cells: [], ...CFG,
        });
        expect(m.hasOpeningHours).toBe(false);
        expect(m.openCells).toBe(0);
        expect(m.coveragePct).toBeNull();
        expect(m.occupancyPct).toBeNull();
        expect(m.lostPotentialYrPence).toBeNull();
        expect(m.recoverRevYrPence).toBeNull();
        expect(m.revPerBookedHrPence).toBeNull();
    });

    it('open hours but nothing entered -> occupancy null, not 0%', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [], ...CFG,
        });
        expect(m.openCells).toBe(3);
        expect(m.coveragePct).toBe(0);
        expect(m.occupancyPct).toBeNull();
        expect(m.lostPotentialYrPence).toBeNull();
    });

    it('retired chairs contribute no capacity and no coverage denominator', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'live', active: true }, { id: 'gone', active: false }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'gone', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0 }],
            ...CFG,
        });
        expect(m.chairs).toBe(1);
        expect(m.openCells).toBe(3);
        expect(m.enteredCells).toBe(0); // the retired chair's cell is not counted
    });

    it('zero booked minutes -> yield is null, not free', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [
                { chair_id: 'x', weekday: 1, slot: 'morning', booked_minutes: 0, revenue_pence: 0 },
                { chair_id: 'x', weekday: 1, slot: 'midday', booked_minutes: 0, revenue_pence: 0 },
            ],
            ...CFG,
        });
        expect(m.bookedMinutesWk).toBe(0);
        expect(m.revPerBookedHrPence).toBeNull();
    });

    it('occupancy at or above the benchmark clamps recoverable to zero', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [
                { chair_id: 'x', weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 60000 },
                { chair_id: 'x', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 },
                { chair_id: 'x', weekday: 1, slot: 'afternoon', booked_minutes: 180, revenue_pence: 90000 },
            ],
            ...CFG,
        });
        expect(m.occupancyPct).toBe(100);
        expect(m.recoverRevYrPence).toBe(0);
        expect(m.lostPotentialYrPence).toBe(0);
    });

    it('an unknown slot key is ignored rather than crashing the practice', () => {
        const m = practiceChairMetrics({
            chairs: [{ id: 'x', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'x', weekday: 1, slot: 'teatime', booked_minutes: 60, revenue_pence: 0 }],
            ...CFG,
        });
        expect(m.enteredCells).toBe(0);
    });
});

describe('rollupChairMetrics', () => {
    it('sums the entered-cell minutes and re-derives blended occupancy', () => {
        const a = practiceChairMetrics({
            chairs: [{ id: 'a', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'a', weekday: 1, slot: 'midday', booked_minutes: 90, revenue_pence: 45000 }],
            ...CFG,
        });
        const b = practiceChairMetrics({
            chairs: [{ id: 'b', active: true }],
            openingHours: [{ weekday: 1, openMinute: 540, closeMinute: 1020 }],
            cells: [{ chair_id: 'b', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 }],
            ...CFG,
        });
        const g = rollupChairMetrics([a, b], CFG);
        expect(g.chairs).toBe(2);
        expect(g.openCells).toBe(6);
        expect(g.enteredCells).toBe(2);
        expect(g.availableMinutesWk).toBe(360);
        expect(g.bookedMinutesWk).toBe(270);
        expect(g.occupancyPct).toBe(75);
        expect(g.coveragePct).toBe(33);
    });

    it('an empty group is null everywhere, not zero', () => {
        const g = rollupChairMetrics([], CFG);
        expect(g.occupancyPct).toBeNull();
        expect(g.coveragePct).toBeNull();
        expect(g.lostPotentialYrPence).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-metrics.test.mjs` from `backend/`
Expected: FAIL — `Failed to resolve import "../src/lib/chair-metrics.js"`

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/chair-metrics.js`:

```js
// ============================================================================
// Chair metrics — occupancy, coverage, and the cost of empty chairs.
//
// THE DEFECT THIS FIXES. The previous implementation took occupancy from the
// cells someone had entered, but took capacity from chair_config
// (chairs x openHrs x weeksYr x daysWk) and never read the entered minutes at
// all. Ashford's grid described 28 open hours a week; the config asserted 80;
// the money came off the 80. That produced a GBP 230,041 "recoverable" claim
// from 14% coverage, and let Barnet report 100% occupancy with GBP 0 cost of
// empty chairs off a SINGLE Monday-morning cell.
//
// Here, occupancy and money come from the SAME cell set: the open cells that
// actually have an entry. That makes the ratio honest and bounds the money by
// what is genuinely known, and the coverage figure travels with every number
// so a reader can see what it is based on.
//
// NULL IS NOT ZERO, everywhere. A cost per nothing is unknowable, not free.
// Pure module — no I/O.
// ============================================================================
import { daySlotMinutes, slotIndexOf } from './chair-slots.js';

/** Below this coverage, the MONEY figures are withheld. Occupancy still shows,
 *  carrying its coverage badge — a ratio over a small sample is weak evidence,
 *  but an annualised pound figure over one is an invention. */
export const COVERAGE_THRESHOLD_PCT = 50;

const round1 = (n) => Math.round(n * 10) / 10;

/** Available minutes per (weekday, slotIndex) for one chair, from opening hours. */
function availabilityByDay(openingHours) {
    const byWeekday = new Map();
    for (const h of openingHours ?? []) {
        byWeekday.set(Number(h.weekday), daySlotMinutes(h.openMinute, h.closeMinute));
    }
    return byWeekday;
}

export function practiceChairMetrics({
    chairs = [],
    openingHours = [],
    cells = [],
    weeksYr,
    benchOccPct,
    benchRevHrPence,
} = {}) {
    const activeChairs = (chairs ?? []).filter((c) => c.active !== false);
    const availability = availabilityByDay(openingHours);

    // Open cells: every (active chair x weekday x slot) with a non-zero window.
    // A weekday the practice is shut contributes nothing to the denominator, so
    // a six-day practice is not penalised for not opening on Sunday.
    let openSlotsPerChair = 0;
    for (const mins of availability.values()) {
        for (const m of mins) if (m > 0) openSlotsPerChair++;
    }
    const openCells = openSlotsPerChair * activeChairs.length;
    const hasOpeningHours = openCells > 0;

    const activeIds = new Set(activeChairs.map((c) => c.id));
    let enteredCells = 0;
    let closedCellEntries = 0;
    let overbookedCells = 0;
    let availableMinutesWk = 0;
    let bookedMinutesWk = 0;
    let revenuePence = 0;

    for (const cell of cells ?? []) {
        // A retired chair's history stays readable but contributes no capacity.
        if (!activeIds.has(cell.chair_id)) continue;
        const slotIndex = slotIndexOf(cell.slot);
        if (slotIndex < 0) continue;
        const mins = availability.get(Number(cell.weekday));
        const available = mins ? mins[slotIndex] : 0;

        if (available <= 0) {
            // An entry in a slot the practice is shut for. Counted and surfaced
            // rather than silently dropped: it usually means the opening hours
            // changed under data that had already been entered.
            closedCellEntries++;
            continue;
        }

        const rawBooked = Math.max(0, Number(cell.booked_minutes) || 0);
        if (rawBooked > available) overbookedCells++;
        // Clamp: occupancy over 100% is not a real reading, and shortening the
        // opening hours must not retroactively invent booked time.
        const booked = Math.min(rawBooked, available);

        enteredCells++;
        availableMinutesWk += available;
        bookedMinutesWk += booked;
        revenuePence += Math.max(0, Number(cell.revenue_pence) || 0);
    }

    return finalise({
        hasOpeningHours,
        chairs: activeChairs.length,
        openCells,
        enteredCells,
        closedCellEntries,
        overbookedCells,
        availableMinutesWk,
        bookedMinutesWk,
        revenuePence,
    }, { weeksYr, benchOccPct, benchRevHrPence });
}

/** Group rollup. Sums the entered-cell minutes across practices and re-derives
 *  the blended figures from those sums — never an average of averages, which
 *  would weight a one-cell practice equally with a fully-entered one. */
export function rollupChairMetrics(rows = [], { weeksYr, benchOccPct, benchRevHrPence } = {}) {
    const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
    return finalise({
        hasOpeningHours: rows.some((r) => r.hasOpeningHours),
        chairs: sum((r) => r.chairs),
        openCells: sum((r) => r.openCells),
        enteredCells: sum((r) => r.enteredCells),
        closedCellEntries: sum((r) => r.closedCellEntries),
        overbookedCells: sum((r) => r.overbookedCells),
        availableMinutesWk: sum((r) => r.availableMinutesWk),
        bookedMinutesWk: sum((r) => r.bookedMinutesWk),
        revenuePence: sum((r) => r.revenuePence),
    }, { weeksYr, benchOccPct, benchRevHrPence });
}

/** Derive every ratio and money figure from the accumulated minutes, applying
 *  the null rules in one place so a practice row and a group rollup cannot
 *  disagree about when a number is unknowable. */
function finalise(base, { weeksYr, benchOccPct, benchRevHrPence }) {
    const { openCells, enteredCells, availableMinutesWk, bookedMinutesWk, revenuePence } = base;

    const coveragePct = openCells > 0 ? Math.round((100 * enteredCells) / openCells) : null;
    const emptyMinutesWk = Math.max(0, availableMinutesWk - bookedMinutesWk);

    const occupancyPct = availableMinutesWk > 0
        ? round1((100 * bookedMinutesWk) / availableMinutesWk)
        : null;

    const bookedHrsWk = bookedMinutesWk / 60;
    const revPerBookedHrPence = bookedHrsWk > 0 ? Math.round(revenuePence / bookedHrsWk) : null;

    // Money is withheld below the threshold. Returning 0 would read as "nothing
    // is being lost" when the truth is "we have not been told enough to say".
    const moneyKnown = coveragePct != null
        && coveragePct >= COVERAGE_THRESHOLD_PCT
        && occupancyPct != null;

    let lostPotentialYrPence = null;
    let recoverRevYrPence = null;
    if (moneyKnown) {
        lostPotentialYrPence = Math.round((emptyMinutesWk / 60) * weeksYr * benchRevHrPence);
        const gapPct = Math.max(0, benchOccPct - occupancyPct);
        const recoverHrsYr = (availableMinutesWk / 60) * weeksYr * (gapPct / 100);
        recoverRevYrPence = Math.round(recoverHrsYr * (revPerBookedHrPence ?? 0));
    }

    return {
        ...base,
        coveragePct,
        emptyMinutesWk,
        occupancyPct,
        revPerBookedHrPence,
        lostPotentialYrPence,
        recoverRevYrPence,
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/chair-metrics.test.mjs` from `backend/`
Expected: PASS — 20 tests

- [ ] **Step 5: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/lib/chair-metrics.js backend/test/chair-metrics.test.mjs
git commit -m "feat(chair): occupancy and money from the same cell set, coverage stated"
```

---

## Task 4: Migration 000180 — chairs and opening hours

**NOT applied to hosted.** This task writes and locally verifies the migration only. Applying it is the owner's call (rules.md rule 9).

**Files:**
- Create: `supabase/migrations/20260101000180_chair_capacity.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `practice_chairs` (`id, organisation_id, practice_id, name, display_order, active, created_at, updated_at`) and `practice_opening_hours` (`id, organisation_id, practice_id, weekday, open_minute, close_minute, source, created_at, updated_at`); column `chair_utilisation.chair_id UUID NOT NULL`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260101000180_chair_capacity.sql`:

```sql
-- ============================================================================
-- 20260101000180_chair_capacity.sql
--
-- Chairs become rows, and capacity becomes a fact.
--
-- WHY practice_chairs: the chair count was DISTINCT chair_name over the grid,
-- so "Surgery 1" and "Surgery 1 " were two chairs and capacity silently
-- doubled. The unique index below is on the NORMALISED name, so that class of
-- error is now impossible rather than merely unlikely. The practices.chairs
-- fallback it replaces is 1 for all 19 practices -- a default nobody ever set.
--
-- WHY practice_opening_hours: available minutes were typed by hand with
-- nothing to check them against, and were never read by the money figures
-- anyway (those came from chair_config's chairs x 8h x 230 days). Dentally's
-- /sites returns real per-weekday opening hours, so capacity is derived and
-- only booked time is entered.
--
-- Times are MINUTES FROM LOCAL MIDNIGHT, never timestamps. These are
-- wall-clock opening times; as instants they would shift across the BST
-- boundary.
--
-- Idempotent; re-applies cleanly. NOT applied to hosted -- owner's call.
-- ============================================================================

-- ── 1. practice_chairs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS practice_chairs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  display_order   INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- The normalised-name key IS the fix for the doubling bug. Case and
-- surrounding whitespace can no longer create a second chair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_chairs_norm_name
  ON practice_chairs(organisation_id, practice_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_practice_chairs_practice
  ON practice_chairs(organisation_id, practice_id) WHERE active;

DROP TRIGGER IF EXISTS practice_chairs_updated_at ON practice_chairs;
CREATE TRIGGER practice_chairs_updated_at BEFORE UPDATE ON practice_chairs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE practice_chairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_chairs_org ON practice_chairs;
CREATE POLICY practice_chairs_org ON practice_chairs
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());

-- ── 2. practice_opening_hours ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS practice_opening_hours (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO Mon..Sun
  -- Minutes from LOCAL midnight. NULL/NULL means closed that day -- which is a
  -- fact, not missing data: Sunday is absent from every Dentally site payload.
  open_minute     SMALLINT CHECK (open_minute BETWEEN 0 AND 1440),
  close_minute    SMALLINT CHECK (close_minute BETWEEN 0 AND 1440),
  -- 'dentally' rows are refreshed by the sync; 'manual' rows never are, so an
  -- owner's correction survives every future sync.
  source          TEXT NOT NULL CHECK (source IN ('dentally', 'manual')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT practice_opening_hours_span_chk CHECK (
    (open_minute IS NULL AND close_minute IS NULL)
    OR (open_minute IS NOT NULL AND close_minute IS NOT NULL AND close_minute > open_minute)
  ),
  UNIQUE (organisation_id, practice_id, weekday)
);

DROP TRIGGER IF EXISTS practice_opening_hours_updated_at ON practice_opening_hours;
CREATE TRIGGER practice_opening_hours_updated_at BEFORE UPDATE ON practice_opening_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE practice_opening_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_opening_hours_org ON practice_opening_hours;
CREATE POLICY practice_opening_hours_org ON practice_opening_hours
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());

-- ── 3. chair_utilisation.chair_id ───────────────────────────────────────────
-- Every guard below RAISES rather than proceeding. A backfill that silently
-- merged two chairs' cells would destroy real data in a way nothing downstream
-- could detect. Measured on hosted 2026-09-08: 9 rows, 3 distinct chair names,
-- no collisions -- so all three guards pass, and they exist for the tenant this
-- migration meets next.

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM chair_utilisation
   WHERE chair_name IS NULL OR btrim(chair_name) = '';
  IF n > 0 THEN
    RAISE EXCEPTION 'chair_utilisation has % row(s) with no chair name; cannot derive a chair', n;
  END IF;
END $$;

INSERT INTO practice_chairs (organisation_id, practice_id, name)
SELECT DISTINCT cu.organisation_id, cu.practice_id, btrim(cu.chair_name)
  FROM chair_utilisation cu
ON CONFLICT (organisation_id, practice_id, lower(btrim(name))) DO NOTHING;

ALTER TABLE chair_utilisation
  ADD COLUMN IF NOT EXISTS chair_id UUID REFERENCES practice_chairs(id) ON DELETE CASCADE;

UPDATE chair_utilisation cu
   SET chair_id = pc.id
  FROM practice_chairs pc
 WHERE pc.organisation_id = cu.organisation_id
   AND pc.practice_id     = cu.practice_id
   AND lower(btrim(pc.name)) = lower(btrim(cu.chair_name))
   AND cu.chair_id IS DISTINCT FROM pc.id;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM chair_utilisation WHERE chair_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'chair_id backfill left % row(s) unresolved', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT 1 FROM chair_utilisation
     GROUP BY organisation_id, practice_id, chair_id, weekday, slot
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION
      'backfill would merge % cell group(s) from differently-spelled chair names; resolve the spellings first', n;
  END IF;
END $$;

ALTER TABLE chair_utilisation ALTER COLUMN chair_id SET NOT NULL;

-- Identity moves from the free-text name to the chair row, so a rename keeps
-- its history instead of forking a new chair.
DROP INDEX IF EXISTS uq_chair_util_cell;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chair_util_cell_chair
  ON chair_utilisation(organisation_id, practice_id, chair_id, weekday, slot);

-- ── 4. available_minutes is now dead, but NOT dropped ───────────────────────
-- Capacity comes from practice_opening_hours. The read path stops reading this
-- column entirely and a test asserts it. Dropping it is a separate migration
-- needing the owner's explicit sign-off on that exact statement (rule 9).
COMMENT ON COLUMN chair_utilisation.available_minutes IS
  'DEPRECATED (migration 000180). Capacity is derived from practice_opening_hours; nothing reads this. Drop pending owner sign-off.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it locally and verify**

Run from the repository root:

```bash
supabase db reset
```

Expected: the reset completes with no `RAISE EXCEPTION`. Then verify the three properties that matter, in `psql` against the local database:

```sql
-- a) the normalised-name key rejects a whitespace-only difference
INSERT INTO practice_chairs (organisation_id, practice_id, name)
SELECT organisation_id, practice_id, name || ' ' FROM practice_chairs LIMIT 1;
-- Expected: ERROR duplicate key value violates unique constraint

-- b) an opening-hours row cannot close before it opens
INSERT INTO practice_opening_hours (organisation_id, practice_id, weekday, open_minute, close_minute, source)
SELECT organisation_id, id, 1, 1020, 540, 'manual' FROM practices LIMIT 1;
-- Expected: ERROR violates check constraint "practice_opening_hours_span_chk"

-- c) RLS is on and each table has exactly one policy
SELECT relname, relrowsecurity FROM pg_class
 WHERE relname IN ('practice_chairs','practice_opening_hours');
-- Expected: both true
```

- [ ] **Step 3: Commit**

```bash
ggshield secret scan pre-commit
git add supabase/migrations/20260101000180_chair_capacity.sql
git commit -m "feat(chair): chairs as rows and opening hours as data (000180, not applied)"
```

---

## Task 5: Paged select helper, and the two new repositories

**Files:**
- Create: `backend/src/lib/paged-select.js`
- Create: `backend/src/repositories/practice-chair.repository.js`
- Create: `backend/src/repositories/practice-opening-hours.repository.js`
- Test: `backend/test/chair-repositories.test.mjs`

**Interfaces:**
- Consumes: `serviceClient` from `backend/src/lib/supabase.js`.
- Produces:
  - `pageAll(buildQuery, { cursorCol = 'id', pageSize = 1000 }) -> Promise<rows[]>`
  - `practiceChairRepository`: `listForPractice(orgId, practiceId)`, `listAll(orgId)`, `create(orgId, { practice_id, name, display_order })`, `update(orgId, id, patch)`, `remove(orgId, id)`
  - `practiceOpeningHoursRepository`: `listForPractice(orgId, practiceId)`, `listAll(orgId)`, `upsertWeek(orgId, practiceId, rows, source)`, `manualWeekdays(orgId, practiceId)`

  Chair rows: `{ id, organisation_id, practice_id, name, display_order, active }`. Opening-hours rows: `{ id, organisation_id, practice_id, weekday, open_minute, close_minute, source }`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-repositories.test.mjs`:

```js
// The two new chair repositories. serviceClient bypasses RLS, so the explicit
// organisation_id filter on every query IS the tenant isolation -- these tests
// exist to make its absence impossible to miss.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { practiceChairRepository } = await import('../src/repositories/practice-chair.repository.js');
const { practiceOpeningHoursRepository } = await import('../src/repositories/practice-opening-hours.repository.js');
const { pageAll } = await import('../src/lib/paged-select.js');

const ORG = 'org-aaaaaaaa';
const OTHER = 'org-bbbbbbbb';
const orgOf = (q) => q.eqs.find((e) => e.col === 'organisation_id')?.val;

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.calls = [];
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('tenant isolation', () => {
    it('every chair read carries the organisation filter', async () => {
        await practiceChairRepository.listForPractice(ORG, 'prac-1');
        expect(supaRec.last.table).toBe('practice_chairs');
        expect(orgOf(supaRec.last)).toBe(ORG);
        expect(supaRec.last.eqs.find((e) => e.col === 'practice_id').val).toBe('prac-1');
    });

    it('every opening-hours read carries the organisation filter', async () => {
        await practiceOpeningHoursRepository.listForPractice(ORG, 'prac-1');
        expect(supaRec.last.table).toBe('practice_opening_hours');
        expect(orgOf(supaRec.last)).toBe(ORG);
    });

    it('an update is scoped by org AND id, so another tenant row cannot be hit', async () => {
        supaRec.resultProvider = () => ({ data: { id: 'c1' }, error: null });
        await practiceChairRepository.update(ORG, 'c1', { name: 'Surgery 2' });
        expect(orgOf(supaRec.last)).toBe(ORG);
        expect(supaRec.last.eqs.find((e) => e.col === 'id').val).toBe('c1');
    });

    it('a cross-org read returns the other org filter, never a merged set', async () => {
        await practiceChairRepository.listAll(OTHER);
        expect(orgOf(supaRec.last)).toBe(OTHER);
    });

    it('create injects the caller organisation, ignoring any body-supplied one', async () => {
        supaRec.resultProvider = () => ({ data: { id: 'c9' }, error: null });
        await practiceChairRepository.create(ORG, {
            practice_id: 'prac-1', name: 'Surgery 1',
            organisation_id: 'org-attacker', // must be overwritten, never honoured
        });
        expect(supaRec.last.insertVals.organisation_id).toBe(ORG);
    });
});

describe('pageAll', () => {
    it('keeps reading until an EMPTY page, not a short one', async () => {
        // A short page is NOT the end: PostgREST can return fewer rows than
        // asked for and still have more. Stopping on short silently truncates.
        const pages = [
            [{ id: 'a' }, { id: 'b' }],
            [{ id: 'c' }],          // SHORT but not last -- must not stop here
            [{ id: 'd' }],
            [],                     // empty: the only real terminator
        ];
        let reads = 0;
        supaRec.resultProvider = () => ({ data: pages[reads++] ?? [], error: null });

        const rows = await pageAll(
            () => supaRec.client.from('practice_chairs').select('*').eq('organisation_id', ORG),
            { pageSize: 2 },
        );
        expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(reads).toBe(4); // assert the READ COUNT, not just the row total
    });

    it('advances the cursor past the last id of the previous page', async () => {
        const seen = [];
        let reads = 0;
        supaRec.resultProvider = (q) => {
            seen.push(q.gts?.[0]?.val ?? null);
            return { data: reads++ === 0 ? [{ id: 'a' }, { id: 'b' }] : [], error: null };
        };
        await pageAll(
            () => supaRec.client.from('practice_chairs').select('*').eq('organisation_id', ORG),
            { pageSize: 2 },
        );
        expect(seen).toEqual([null, 'b']); // second read starts after 'b'
    });
});

describe('practiceOpeningHoursRepository.upsertWeek', () => {
    it('stamps the org and source on every row and upserts on the weekday key', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        await practiceOpeningHoursRepository.upsertWeek(ORG, 'prac-1', [
            { weekday: 1, openMinute: 540, closeMinute: 1020 },
            { weekday: 7, openMinute: null, closeMinute: null },
        ], 'dentally');
        const vals = supaRec.last.upsertVals;
        expect(vals).toHaveLength(2);
        expect(vals[0]).toMatchObject({
            organisation_id: ORG, practice_id: 'prac-1',
            weekday: 1, open_minute: 540, close_minute: 1020, source: 'dentally',
        });
        expect(vals[1]).toMatchObject({ weekday: 7, open_minute: null, close_minute: null });
        expect(supaRec.last.upsertOpts?.onConflict)
            .toBe('organisation_id,practice_id,weekday');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-repositories.test.mjs` from `backend/`
Expected: FAIL — `Failed to resolve import "../src/lib/paged-select.js"`

- [ ] **Step 3: Write the paged-select helper**

Create `backend/src/lib/paged-select.js`:

```js
// ============================================================================
// Keyset pager for PostgREST table reads.
//
// PostgREST silently truncates a select at 1000 rows -- no error, no flag, just
// fewer rows. An in-Node aggregate over a truncated read reports a confidently
// wrong total, which is exactly the failure this codebase has already shipped
// once (see the monthly_financials truncation).
//
// Two rules, both load-bearing:
//   1. Page on a UNIQUE key, so no row is skipped or repeated across pages.
//   2. Stop on an EMPTY page, never a short one. A short page is not proof of
//      the end; treating it as one silently truncates.
//
// Keyset, not OFFSET: OFFSET makes the server re-walk every skipped row, which
// made a whole-org map build quadratic in row count here before.
// ============================================================================

const DEFAULT_PAGE_SIZE = 1000;

/**
 * @param buildQuery () => PostgrestFilterBuilder — called fresh per page, so
 *        each page gets its own builder rather than mutating a shared one.
 */
export async function pageAll(buildQuery, { cursorCol = 'id', pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const out = [];
    let cursor = null;
    for (;;) {
        let query = buildQuery().order(cursorCol, { ascending: true }).limit(pageSize);
        if (cursor != null) query = query.gt(cursorCol, cursor);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        out.push(...data);
        cursor = data[data.length - 1][cursorCol];
    }
    return out;
}
```

- [ ] **Step 4: Write the two repositories**

Create `backend/src/repositories/practice-chair.repository.js`:

```js
// ============================================================================
// Chairs (surgeries) per practice. serviceClient bypasses RLS, so the explicit
// .eq('organisation_id', orgId) on every query IS the tenant isolation.
//
// These rows replace `DISTINCT chair_name` as the chair count. A rename now
// keeps the chair's history, and a stray space can no longer invent a second
// chair and double the practice's capacity.
// ============================================================================
import { serviceClient } from "../lib/supabase.js";
import { pageAll } from "../lib/paged-select.js";

const COLS = 'id, organisation_id, practice_id, name, display_order, active';

export const practiceChairRepository = {
    async listForPractice(orgId, practiceId) {
        const { data, error } = await serviceClient
            .from('practice_chairs')
            .select(COLS)
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .order('display_order', { ascending: true })
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // Whole-org read for the analytics rollup. Paged: a 50-chair group is
    // already 1,400 grid rows, and this table grows with it.
    listAll(orgId) {
        return pageAll(() => serviceClient
            .from('practice_chairs')
            .select(COLS)
            .eq('organisation_id', orgId));
    },

    async create(orgId, input) {
        // The organisation is the caller's, never the payload's.
        const row = {
            practice_id: input.practice_id,
            name: input.name,
            display_order: input.display_order ?? 0,
            organisation_id: orgId,
        };
        return serviceClient.from('practice_chairs').insert(row).select(COLS).single();
    },

    update(orgId, id, patch) {
        return serviceClient
            .from('practice_chairs')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select(COLS)
            .maybeSingle();
    },

    remove(orgId, id) {
        return serviceClient
            .from('practice_chairs')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select('id, practice_id')
            .maybeSingle();
    },
};
```

Create `backend/src/repositories/practice-opening-hours.repository.js`:

```js
// ============================================================================
// Per-practice opening hours -- the capacity source. serviceClient bypasses
// RLS, so the explicit .eq('organisation_id', orgId) IS the tenant isolation.
//
// Minutes from LOCAL midnight, never instants. A row with source='manual' is
// an owner's correction and the Dentally sync must never overwrite it.
// ============================================================================
import { serviceClient } from "../lib/supabase.js";
import { pageAll } from "../lib/paged-select.js";

const COLS = 'id, organisation_id, practice_id, weekday, open_minute, close_minute, source';

export const practiceOpeningHoursRepository = {
    async listForPractice(orgId, practiceId) {
        const { data, error } = await serviceClient
            .from('practice_opening_hours')
            .select(COLS)
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .order('weekday', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    listAll(orgId) {
        return pageAll(() => serviceClient
            .from('practice_opening_hours')
            .select(COLS)
            .eq('organisation_id', orgId));
    },

    /** Weekdays an owner has hand-corrected. The sync reads this and leaves
     *  them alone -- a correction must survive every future sync. */
    async manualWeekdays(orgId, practiceId) {
        const { data, error } = await serviceClient
            .from('practice_opening_hours')
            .select('weekday')
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .eq('source', 'manual');
        if (error) throw new Error(error.message);
        return new Set((data ?? []).map((r) => Number(r.weekday)));
    },

    /** Upsert whole weekdays. `rows` are {weekday, openMinute, closeMinute}. */
    async upsertWeek(orgId, practiceId, rows, source) {
        if (!rows?.length) return [];
        const payload = rows.map((r) => ({
            organisation_id: orgId,
            practice_id: practiceId,
            weekday: Number(r.weekday),
            open_minute: r.openMinute ?? null,
            close_minute: r.closeMinute ?? null,
            source,
        }));
        const { data, error } = await serviceClient
            .from('practice_opening_hours')
            .upsert(payload, { onConflict: 'organisation_id,practice_id,weekday' })
            .select(COLS);
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/chair-repositories.test.mjs` from `backend/`
Expected: PASS — 8 tests

If `supaRec.client` is not exported by `test/setup.js`, read that file and use whatever it exposes as the mocked Supabase client; the assertions do not otherwise change.

- [ ] **Step 6: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/lib/paged-select.js backend/src/repositories/practice-chair.repository.js backend/src/repositories/practice-opening-hours.repository.js backend/test/chair-repositories.test.mjs
git commit -m "feat(chair): chair and opening-hours repositories, paged and org-scoped"
```

---

## Task 6: Page the chair-utilisation reads and add a bulk upsert

**Files:**
- Modify: `backend/src/repositories/chair-utilisation.repository.js`
- Modify: `backend/src/repositories/analytics.repository.js:396-404` (`chairUtilisationRows`)
- Test: `backend/test/chair-utilisation-bulk.test.mjs`

**Interfaces:**
- Consumes: `pageAll` from `backend/src/lib/paged-select.js`.
- Produces: `chairUtilisationRepository.bulkUpsertChairWeek(orgId, { practice_id, chair_id, chair_name, cells })`, `chairUtilisationRepository.listAll(orgId)`. `analyticsRepository.chairUtilisationRows(orgId)` now returns rows including `chair_id` and is paged.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-utilisation-bulk.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { chairUtilisationRepository } = await import('../src/repositories/chair-utilisation.repository.js');
const { analyticsRepository } = await import('../src/repositories/analytics.repository.js');

const ORG = 'org-aaaaaaaa';

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('bulkUpsertChairWeek', () => {
    it('stamps org, practice, chair and chair_name on every cell', async () => {
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1',
            cells: [
                { weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 30000 },
                { weekday: 2, slot: 'midday', booked_minutes: 60, revenue_pence: 0, notes: 'half day' },
            ],
        });
        const vals = supaRec.last.upsertVals;
        expect(vals).toHaveLength(2);
        for (const v of vals) {
            expect(v.organisation_id).toBe(ORG);
            expect(v.practice_id).toBe('prac-1');
            expect(v.chair_id).toBe('c1');
            expect(v.chair_name).toBe('Surgery 1');
        }
        expect(vals[1].notes).toBe('half day');
    });

    it('upserts on the chair-scoped cell key, so a re-save updates in place', async () => {
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1',
            cells: [{ weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 0 }],
        });
        expect(supaRec.last.upsertOpts?.onConflict)
            .toBe('organisation_id,practice_id,chair_id,weekday,slot');
    });

    it('NEVER writes available_minutes -- capacity is derived, not stored', async () => {
        // Migration 000180 deprecated the column. Writing it would recreate the
        // second, drifting definition of capacity this rebuild exists to remove.
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1',
            cells: [{ weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 0 }],
        });
        expect(supaRec.last.upsertVals[0]).not.toHaveProperty('available_minutes');
    });

    it('an empty cell list writes nothing at all', async () => {
        supaRec.last = undefined;
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1', cells: [],
        });
        expect(supaRec.last).toBeUndefined();
    });
});

describe('analyticsRepository.chairUtilisationRows', () => {
    it('pages until an empty page and selects chair_id, not chair_name', async () => {
        const pages = [[{ id: '1', chair_id: 'c1' }], [{ id: '2', chair_id: 'c1' }], []];
        let reads = 0;
        supaRec.resultProvider = () => ({ data: pages[reads++] ?? [], error: null });

        const rows = await analyticsRepository.chairUtilisationRows(ORG);
        expect(rows).toHaveLength(2);
        expect(reads).toBe(3);
        expect(supaRec.last.selectCols).toContain('chair_id');
    });

    it('carries the organisation filter on every page', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        await analyticsRepository.chairUtilisationRows(ORG);
        expect(supaRec.last.eqs.find((e) => e.col === 'organisation_id').val).toBe(ORG);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-utilisation-bulk.test.mjs` from `backend/`
Expected: FAIL — `chairUtilisationRepository.bulkUpsertChairWeek is not a function`

- [ ] **Step 3: Add the bulk upsert and paged read**

In `backend/src/repositories/chair-utilisation.repository.js`, add the import and two methods:

```js
import { pageAll } from "../lib/paged-select.js";
```

```js
    // Whole-org cell read for the analytics rollup. Paged, because a 50-chair
    // group is 1,400 rows and PostgREST truncates at 1000 without saying so.
    listAll(orgId) {
        return pageAll(() => supabase_1.serviceClient
            .from('chair_utilisation')
            .select('id, practice_id, chair_id, chair_name, weekday, slot, booked_minutes, revenue_pence')
            .eq('organisation_id', orgId));
    },

    // One chair's whole week in a single statement. The per-record API path
    // this replaces fired one POST -- and one full snapshot rewrite -- per
    // cell, so saving a 56-cell week meant 56 list-and-rewrite cycles.
    //
    // available_minutes is deliberately NOT written: capacity is derived from
    // practice_opening_hours, and storing a second copy would let the two
    // drift, which is the defect this rebuild exists to remove.
    async bulkUpsertChairWeek(orgId, { practice_id, chair_id, chair_name, cells }) {
        if (!cells?.length) return [];
        const payload = cells.map((c) => ({
            organisation_id: orgId,
            practice_id,
            chair_id,
            chair_name,
            weekday: Number(c.weekday),
            slot: c.slot,
            booked_minutes: Math.max(0, Number(c.booked_minutes) || 0),
            revenue_pence: Math.max(0, Number(c.revenue_pence) || 0),
            notes: c.notes ?? null,
        }));
        const { data, error } = await supabase_1.serviceClient
            .from('chair_utilisation')
            .upsert(payload, { onConflict: 'organisation_id,practice_id,chair_id,weekday,slot' })
            .select();
        if (error) throw new Error(error.message);
        return data ?? [];
    },
```

- [ ] **Step 4: Page the analytics read**

Replace `chairUtilisationRows` in `backend/src/repositories/analytics.repository.js:396-404` with:

```js
    // Paged, and selecting chair_id rather than chair_name: the chair count now
    // comes from practice_chairs, so a stray space in a name can no longer
    // invent a second chair and double a practice's capacity. LIMIT_GUARD is
    // not protection here -- PostgREST caps the response regardless of the
    // limit asked for, and does it silently.
    chairUtilisationRows(orgId) {
        return pageAll(() => supabase_1.serviceClient
            .from('chair_utilisation')
            .select('id, practice_id, chair_id, weekday, slot, booked_minutes, revenue_pence')
            .eq('organisation_id', orgId));
    },
```

and add to that file's imports:

```js
import { pageAll } from "../lib/paged-select.js";
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/chair-utilisation-bulk.test.mjs` from `backend/`
Expected: PASS — 6 tests

If `supaRec` does not record `selectCols`, assert instead that the `select` argument string contains `chair_id` using whatever field `test/setup.js` records for the select projection.

- [ ] **Step 6: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/repositories/chair-utilisation.repository.js backend/src/repositories/analytics.repository.js backend/test/chair-utilisation-bulk.test.mjs
git commit -m "feat(chair): bulk week upsert, and page the reads past the silent 1000-row cap"
```

---

## Task 7: Capacity service — the one place chairs, hours and cells meet

**Files:**
- Create: `backend/src/services/chair-capacity.service.js`
- Test: `backend/test/chair-capacity.service.test.mjs`

**Interfaces:**
- Consumes: `practiceChairRepository`, `practiceOpeningHoursRepository`, `chairUtilisationRepository.listAll`, `daySlotMinutes`/`SLOTS` from `chair-slots.js`, `practiceChairMetrics`/`rollupChairMetrics` from `chair-metrics.js`.
- Produces:
  - `chairCapacityService.practiceWeek(orgId, practiceId) -> { chairs, openingHours, slots, weekByChair, coverage }` — powers the entry page. `weekByChair` is `{ [chairId]: { [weekday]: { [slot]: { availableMinutes, bookedMinutes, revenuePence, notes, overbooked } } } }`.
  - `chairCapacityService.metricsByPractice(orgId, practiceIds, config) -> Map<practiceId, PracticeChairMetrics>` — powers `chairAnalytics`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-capacity.service.test.mjs`:

```js
// The capacity service composes chairs + opening hours + entered cells. It is
// the only place those three meet, so it is where a practice with no opening
// hours must resolve to "unknown" rather than to a confident zero.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/practice-chair.repository.js', () => ({
    practiceChairRepository: { listForPractice: vi.fn(), listAll: vi.fn() },
}));
vi.mock('../src/repositories/practice-opening-hours.repository.js', () => ({
    practiceOpeningHoursRepository: { listForPractice: vi.fn(), listAll: vi.fn() },
}));
vi.mock('../src/repositories/chair-utilisation.repository.js', () => ({
    chairUtilisationRepository: { list: vi.fn(), listAll: vi.fn() },
}));

const { practiceChairRepository } = await import('../src/repositories/practice-chair.repository.js');
const { practiceOpeningHoursRepository } = await import('../src/repositories/practice-opening-hours.repository.js');
const { chairUtilisationRepository } = await import('../src/repositories/chair-utilisation.repository.js');
const { chairCapacityService } = await import('../src/services/chair-capacity.service.js');

const ORG = 'org-a';
const CFG = { weeksYr: 46, benchOccPct: 88, benchRevHrPence: 30000 };

// Ashford's real hours: 09:00-17:00 Mon-Sat, closed Sunday.
const ASHFORD_HOURS = [1, 2, 3, 4, 5, 6]
    .map((weekday) => ({ practice_id: 'p1', weekday, open_minute: 540, close_minute: 1020 }))
    .concat([{ practice_id: 'p1', weekday: 7, open_minute: null, close_minute: null }]);

beforeEach(() => vi.clearAllMocks());

describe('practiceWeek', () => {
    it('derives available minutes per cell from the opening hours', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([
            { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 20000, notes: null },
        ]);

        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        const mon = out.weekByChair.c1[1];
        expect(mon.morning.availableMinutes).toBe(120);
        expect(mon.midday.availableMinutes).toBe(180);
        expect(mon.afternoon.availableMinutes).toBe(180);
        expect(mon.evening.availableMinutes).toBe(0); // shut at 17:00
        expect(mon.morning.bookedMinutes).toBe(60);
        expect(mon.morning.revenuePence).toBe(20000);
    });

    it('marks a cell booked beyond the opening hours as overbooked', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([
            // The real Ashford row: 150 booked into a 120-minute morning.
            { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 150, revenue_pence: 95000, notes: null },
        ]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.weekByChair.c1[1].morning.overbooked).toBe(true);
        expect(out.weekByChair.c1[1].morning.bookedMinutes).toBe(150); // shown as entered, not silently clamped
    });

    it('reports coverage over OPEN cells: 1 of 18 for one chair', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.list.mockResolvedValue([
            { chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0, notes: null },
        ]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.coverage).toEqual({ openCells: 18, enteredCells: 1, coveragePct: 6 });
    });

    it('no opening hours -> every cell zero-available and coverage null', async () => {
        // Warwick Lodge: no pms_site_id, so no Dentally site and no hours.
        practiceChairRepository.listForPractice.mockResolvedValue([
            { id: 'c1', name: 'Surgery 1', display_order: 0, active: true },
        ]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue([]);
        chairUtilisationRepository.list.mockResolvedValue([]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.openingHours).toEqual([]);
        expect(out.coverage).toEqual({ openCells: 0, enteredCells: 0, coveragePct: null });
    });

    it('returns the slot keys so the client never defines its own', async () => {
        practiceChairRepository.listForPractice.mockResolvedValue([]);
        practiceOpeningHoursRepository.listForPractice.mockResolvedValue([]);
        chairUtilisationRepository.list.mockResolvedValue([]);
        const out = await chairCapacityService.practiceWeek(ORG, 'p1');
        expect(out.slots).toEqual(['morning', 'midday', 'afternoon', 'evening']);
    });
});

describe('metricsByPractice', () => {
    it('reproduces the live Ashford reading: 97.1% on 7 of 36, money withheld', async () => {
        practiceChairRepository.listAll.mockResolvedValue([
            { id: 'c1', practice_id: 'p1', active: true },
            { id: 'c2', practice_id: 'p1', active: true },
        ]);
        practiceOpeningHoursRepository.listAll.mockResolvedValue(ASHFORD_HOURS);
        chairUtilisationRepository.listAll.mockResolvedValue([
            { practice_id: 'p1', chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 150, revenue_pence: 95000 },
            { practice_id: 'p1', chair_id: 'c1', weekday: 1, slot: 'afternoon', booked_minutes: 180, revenue_pence: 110000 },
            { practice_id: 'p1', chair_id: 'c1', weekday: 2, slot: 'morning', booked_minutes: 120, revenue_pence: 72000 },
            { practice_id: 'p1', chair_id: 'c1', weekday: 3, slot: 'afternoon', booked_minutes: 210, revenue_pence: 130000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 1, slot: 'morning', booked_minutes: 180, revenue_pence: 120000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 2, slot: 'afternoon', booked_minutes: 150, revenue_pence: 90000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 4, slot: 'morning', booked_minutes: 120, revenue_pence: 76000 },
            { practice_id: 'p1', chair_id: 'c2', weekday: 5, slot: 'evening', booked_minutes: 90, revenue_pence: 60000 },
        ]);

        const byPractice = await chairCapacityService.metricsByPractice(ORG, ['p1'], CFG);
        const m = byPractice.get('p1');
        expect(m.openCells).toBe(36);
        expect(m.enteredCells).toBe(7);
        expect(m.occupancyPct).toBe(97.1);
        expect(m.coveragePct).toBe(19);
        expect(m.lostPotentialYrPence).toBeNull();
    });

    it('a practice with no rows at all is present and null, never absent', async () => {
        // An absent key would make the caller render nothing; a null-valued one
        // makes it render "not set up yet", which is the honest state.
        practiceChairRepository.listAll.mockResolvedValue([]);
        practiceOpeningHoursRepository.listAll.mockResolvedValue([]);
        chairUtilisationRepository.listAll.mockResolvedValue([]);
        const byPractice = await chairCapacityService.metricsByPractice(ORG, ['p9'], CFG);
        expect(byPractice.has('p9')).toBe(true);
        expect(byPractice.get('p9').hasOpeningHours).toBe(false);
        expect(byPractice.get('p9').occupancyPct).toBeNull();
    });

    it('reads each table ONCE for the whole org, not once per practice', async () => {
        practiceChairRepository.listAll.mockResolvedValue([]);
        practiceOpeningHoursRepository.listAll.mockResolvedValue([]);
        chairUtilisationRepository.listAll.mockResolvedValue([]);
        await chairCapacityService.metricsByPractice(ORG, ['p1', 'p2', 'p3'], CFG);
        expect(practiceChairRepository.listAll).toHaveBeenCalledTimes(1);
        expect(practiceOpeningHoursRepository.listAll).toHaveBeenCalledTimes(1);
        expect(chairUtilisationRepository.listAll).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-capacity.service.test.mjs` from `backend/`
Expected: FAIL — `Failed to resolve import "../src/services/chair-capacity.service.js"`

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/chair-capacity.service.js`:

```js
// ============================================================================
// Chair capacity — the single place chairs, opening hours and entered cells
// meet. Both consumers read it: the entry page (which needs the derived
// available minutes per cell) and chairAnalytics (which needs the metrics).
// One composition means the page you type into and the page you read cannot
// disagree about how much capacity a practice has.
//
// Three whole-org reads, joined in memory -- never one read per practice.
// ============================================================================
import { practiceChairRepository } from "../repositories/practice-chair.repository.js";
import { practiceOpeningHoursRepository } from "../repositories/practice-opening-hours.repository.js";
import { chairUtilisationRepository } from "../repositories/chair-utilisation.repository.js";
import { SLOTS, daySlotMinutes } from "../lib/chair-slots.js";
import { practiceChairMetrics } from "../lib/chair-metrics.js";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Repository rows use snake_case columns; the metrics library takes camelCase
 *  minutes. One adapter, so the shape conversion lives in exactly one place. */
const toHours = (rows) => (rows ?? []).map((h) => ({
    weekday: Number(h.weekday),
    openMinute: h.open_minute,
    closeMinute: h.close_minute,
}));

export const chairCapacityService = {
    /** One practice's editable week: every chair, every weekday, every slot,
     *  with available minutes derived and booked minutes as entered. */
    async practiceWeek(orgId, practiceId) {
        const [chairs, hourRows, cells] = await Promise.all([
            practiceChairRepository.listForPractice(orgId, practiceId),
            practiceOpeningHoursRepository.listForPractice(orgId, practiceId),
            chairUtilisationRepository.list(orgId, practiceId),
        ]);

        const openingHours = toHours(hourRows);
        const minutesByWeekday = new Map(
            openingHours.map((h) => [h.weekday, daySlotMinutes(h.openMinute, h.closeMinute)]),
        );

        const entered = new Map();
        for (const c of cells) {
            entered.set(`${c.chair_id}|${c.weekday}|${c.slot}`, c);
        }

        const activeChairs = chairs.filter((c) => c.active !== false);
        const weekByChair = {};
        let openCells = 0;
        let enteredCells = 0;

        for (const chair of activeChairs) {
            const byWeekday = {};
            for (const weekday of WEEKDAYS) {
                const mins = minutesByWeekday.get(weekday) ?? SLOTS.map(() => 0);
                const bySlot = {};
                SLOTS.forEach((slot, i) => {
                    const availableMinutes = mins[i];
                    const row = entered.get(`${chair.id}|${weekday}|${slot}`);
                    const bookedMinutes = row ? Math.max(0, Number(row.booked_minutes) || 0) : null;
                    if (availableMinutes > 0) {
                        openCells++;
                        if (row) enteredCells++;
                    }
                    bySlot[slot] = {
                        availableMinutes,
                        // null (not 0) when nothing has been entered: an empty
                        // cell is unknown, and rendering it as a booked zero
                        // would be a claim nobody made.
                        bookedMinutes,
                        revenuePence: row ? Math.max(0, Number(row.revenue_pence) || 0) : null,
                        notes: row?.notes ?? null,
                        overbooked: bookedMinutes != null && bookedMinutes > availableMinutes,
                    };
                });
                byWeekday[weekday] = bySlot;
            }
            weekByChair[chair.id] = byWeekday;
        }

        return {
            chairs: activeChairs.map((c) => ({
                id: c.id, name: c.name, displayOrder: c.display_order ?? 0,
            })),
            openingHours: hourRows ?? [],
            // The server owns the slot vocabulary; the client renders what it
            // is sent rather than keeping a second copy that can drift.
            slots: [...SLOTS],
            weekByChair,
            coverage: {
                openCells,
                enteredCells,
                coveragePct: openCells > 0 ? Math.round((100 * enteredCells) / openCells) : null,
            },
        };
    },

    /** Coverage-aware metrics for every requested practice. A practice with no
     *  data is PRESENT with null figures, never absent — an absent key renders
     *  as nothing, a null one renders as "not set up yet". */
    async metricsByPractice(orgId, practiceIds, config) {
        const [chairs, hourRows, cells] = await Promise.all([
            practiceChairRepository.listAll(orgId),
            practiceOpeningHoursRepository.listAll(orgId),
            chairUtilisationRepository.listAll(orgId),
        ]);

        const group = (rows) => {
            const m = new Map();
            for (const r of rows ?? []) {
                if (!m.has(r.practice_id)) m.set(r.practice_id, []);
                m.get(r.practice_id).push(r);
            }
            return m;
        };
        const chairsBy = group(chairs);
        const hoursBy = group(hourRows);
        const cellsBy = group(cells);

        const out = new Map();
        for (const practiceId of practiceIds) {
            out.set(practiceId, practiceChairMetrics({
                chairs: (chairsBy.get(practiceId) ?? []).map((c) => ({ id: c.id, active: c.active })),
                openingHours: toHours(hoursBy.get(practiceId) ?? []),
                cells: cellsBy.get(practiceId) ?? [],
                ...config,
            }));
        }
        return out;
    },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/chair-capacity.service.test.mjs` from `backend/`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/services/chair-capacity.service.js backend/test/chair-capacity.service.test.mjs
git commit -m "feat(chair): one composition of chairs, hours and cells for both consumers"
```

---

## Task 8: The `operations.edit` permission and its gate

Today `operations.view` grants both viewing and rewriting the grid — anyone who can look can overwrite it.

**Files:**
- Modify: `backend/src/lib/permissions.js:33` (catalog) and `:189-198` (`DEFAULT_ROLE_PERMISSIONS.practice_manager`)
- Modify: `backend/src/middleware/agency.js`
- Test: `backend/test/chair-permission-gate.test.mjs`

**Interfaces:**
- Consumes: `isAgencyActor` from `backend/src/middleware/agency.js`.
- Produces: catalog key `'operations.edit'`; `requirePermissionOrAgencyActor(permissionKey)` returning a **named** middleware (`requirePermissionOrAgencyActor:<key>`) so a structural route test can identify it.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-permission-gate.test.mjs`:

```js
// The write gate for chair data. Chair utilisation is a "both" feature: the
// sub-account's own owner or practice manager maintains it, AND an agency
// actor switched into that sub-account may edit it. requireAgencyActor alone
// would leave a tenant unable to maintain their own operational data.
import { describe, it, expect, vi } from 'vitest';
import { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } from '../src/lib/permissions.js';
import { requirePermissionOrAgencyActor } from '../src/middleware/agency.js';

const res = () => {
    const r = { status: vi.fn(() => r), json: vi.fn(() => r) };
    return r;
};

describe('operations.edit catalog entry', () => {
    it('exists and is distinct from operations.view', () => {
        expect(PERMISSION_CATALOG['operations.edit']).toBeTruthy();
        expect(PERMISSION_CATALOG['operations.view']).toBeTruthy();
    });

    it('owner and practice manager hold it; reception does not (rule 5)', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner['operations.edit']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['operations.edit']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.reception['operations.edit']).toBeUndefined();
        expect(DEFAULT_ROLE_PERMISSIONS.analyst['operations.edit']).toBeUndefined();
    });
});

describe('requirePermissionOrAgencyActor', () => {
    const gate = requirePermissionOrAgencyActor('operations.edit');

    it('passes a tenant user holding the key', async () => {
        const next = vi.fn();
        await gate({ user: { permissions: { 'operations.edit': true } } }, res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('passes an agency actor who does NOT hold the key', async () => {
        const next = vi.fn();
        await gate({ user: { is_agency_admin: true, permissions: {} } }, res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('passes inside a validated switched agency context', async () => {
        const next = vi.fn();
        await gate({ agencyContext: { homeOrgId: 'org-agency' }, user: { permissions: {} } }, res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('rejects a reception user with 403 and does not call next', async () => {
        const next = vi.fn();
        const r = res();
        await gate({ user: { role: 'reception', permissions: { 'crm.view': true } } }, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });

    it('rejects an anonymous request', async () => {
        const next = vi.fn();
        const r = res();
        await gate({}, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });

    it('is NAMED, so a route test can tell it apart from another closure', () => {
        // requirePermission and requireRole both return anonymous closures; a
        // name check on an anonymous function cannot distinguish them, which is
        // how a route can silently carry the wrong gate.
        expect(gate.name).toBe('requirePermissionOrAgencyActor:operations.edit');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-permission-gate.test.mjs` from `backend/`
Expected: FAIL — `requirePermissionOrAgencyActor is not a function`

- [ ] **Step 3: Add the catalog key**

In `backend/src/lib/permissions.js`, directly after the `'operations.view'` entry, add:

```js
  // Viewing operations and REWRITING them are different powers. Until this key
  // existed, operations.view granted both, so anyone who could read the chair
  // grid could also overwrite a practice's whole week.
  'operations.edit': 'Edit operations data (chair utilisation, opening hours, chairs)',
```

and add to `DEFAULT_ROLE_PERMISSIONS.practice_manager`, beside `'operations.view': true`:

```js
    'operations.edit': true,
```

(`owner` needs no change: it is built from `PERMISSION_KEYS`, so it picks the new key up automatically. `reception` and `analyst` omit it, and an omitted key defaults to false.)

- [ ] **Step 4: Add the gate**

Append to `backend/src/middleware/agency.js`:

```js
// Chair utilisation is a BOTH feature. The sub-account's own owner or practice
// manager maintains their operational data, and an agency actor switched into
// that sub-account may edit it too. requireAgencyActor alone would make a
// tenant unable to maintain their own week; requirePermission alone would stop
// an agency admin helping a client who has not granted them a role.
//
// Named, because requirePermission and requireRole both return ANONYMOUS
// closures — a structural route test cannot tell two anonymous gates apart, so
// a route can silently carry the wrong one.
export function requirePermissionOrAgencyActor(permissionKey) {
    const fn = async (req, res, next) => {
        if (req.user?.permissions?.[permissionKey] === true) return next();
        try {
            if (await isAgencyActor(req)) return next();
        } catch (err) {
            req.log?.warn({ err }, 'operations edit gate lookup failed');
        }
        return res.status(403).json({ error: 'Insufficient permissions' });
    };
    Object.defineProperty(fn, 'name', {
        value: `requirePermissionOrAgencyActor:${permissionKey}`,
    });
    return fn;
}
```

- [ ] **Step 5: Run the test and the permission suites**

Run: `npx vitest run test/chair-permission-gate.test.mjs test/page-permissions.test.mjs test/operations.permission-gates.test.mjs` from `backend/`
Expected: PASS. If a suite asserts an exact catalog key count or a full key list, update it to include `operations.edit` — that is the assertion doing its job, not a regression.

- [ ] **Step 6: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/lib/permissions.js backend/src/middleware/agency.js backend/test/chair-permission-gate.test.mjs
git commit -m "feat(chair): operations.edit, so viewing the grid no longer grants rewriting it"
```

---

## Task 9: Schemas, service methods, controller and routes

**Files:**
- Modify: `backend/src/models/chair-utilisation.model.js`
- Modify: `backend/src/services/chair-utilisation.service.js`
- Modify: `backend/src/controllers/chair-utilisation.controller.js`
- Modify: `backend/src/routes/chair-utilisation.routes.js`
- Modify: `frontend/app/(dashboard)/chair/page.tsx` (drop `<ChairScreen />` — the routes it writes through are removed here)
- Test: `backend/test/chair-routes.test.mjs`

**Interfaces:**
- Consumes: `chairCapacityService`, `practiceChairRepository`, `practiceOpeningHoursRepository`, `chairUtilisationRepository.bulkUpsertChairWeek`, `requirePermissionOrAgencyActor`.
- Produces these endpoints under `/api/chair-utilisation`:

| Method | Path | Gate |
|---|---|---|
| GET | `/week?practice_id=` | `operations.view` |
| PUT | `/week` | `operations.edit` or agency actor |
| GET | `/chairs?practice_id=` | `operations.view` |
| POST | `/chairs` | `operations.edit` or agency actor |
| PATCH | `/chairs/:id` | `operations.edit` or agency actor |
| DELETE | `/chairs/:id` | `operations.edit` or agency actor |
| GET | `/opening-hours?practice_id=` | `operations.view` |
| PUT | `/opening-hours` | `operations.edit` or agency actor |

  The per-record `POST /`, `PATCH /:id` and `DELETE /:id` write routes are **removed**: they keyed a cell by free-text chair name and fired a full snapshot rewrite per cell. `GET /` and `GET /grid` stay.

- [ ] **Step 1: Write the failing test**

Create `backend/test/chair-routes.test.mjs`:

```js
// Chair routes: which gate each carries, and where the organisation comes from.
// The gates are asserted by RUNNING them. requirePermission and requireRole
// both return anonymous closures, so a name check cannot tell them apart --
// which is exactly how a route ends up silently carrying the wrong one.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/chair-utilisation.service.js', () => ({
    chairUtilisationService: {
        week: vi.fn(async () => ({ chairs: [], slots: [], weekByChair: {}, coverage: {} })),
        saveWeek: vi.fn(async () => ({ saved: 0 })),
        listChairs: vi.fn(async () => ({ chairs: [] })),
        createChair: vi.fn(async () => ({ id: 'c1' })),
        updateChair: vi.fn(async () => ({ id: 'c1' })),
        removeChair: vi.fn(async () => ({ ok: true })),
        listOpeningHours: vi.fn(async () => ({ days: [] })),
        saveOpeningHours: vi.fn(async () => ({ days: [] })),
        list: vi.fn(async () => []),
        grid: vi.fn(async () => ({})),
    },
}));

const { chairUtilisationService } = await import('../src/services/chair-utilisation.service.js');
const router = (await import('../src/routes/chair-utilisation.routes.js')).default;

const layersFor = (method, path) => router.stack
    .filter((l) => l.route && l.route.path === path && l.route.methods[method])
    .flatMap((l) => l.route.stack.map((s) => s.handle));

const res = () => {
    const r = { json: vi.fn(() => r), status: vi.fn(() => r) };
    return r;
};

/** Run every gate on a route against a request, reporting whether it passed. */
async function passes(method, path, req) {
    const gates = layersFor(method, path).slice(0, -1); // all but the handler
    for (const gate of gates) {
        let allowed = false;
        await new Promise((resolve) => {
            const out = gate(req, { status: () => ({ json: () => resolve() }) }, () => {
                allowed = true; resolve();
            });
            if (out?.then) out.then(() => resolve());
        });
        if (!allowed) return false;
    }
    return true;
}

const owner = { user: { id: 'u1', organisation_id: 'org-a', role: 'owner', permissions: { 'operations.view': true, 'operations.edit': true } } };
const reception = { user: { id: 'u2', organisation_id: 'org-a', role: 'reception', permissions: { 'crm.view': true } } };
const viewer = { user: { id: 'u3', organisation_id: 'org-a', role: 'analyst', permissions: { 'operations.view': true } } };
const agency = { user: { id: 'u4', organisation_id: 'org-a', is_agency_admin: true, permissions: {} } };

beforeEach(() => vi.clearAllMocks());

describe('mounts', () => {
    it('exposes the week, chairs and opening-hours routes', () => {
        for (const [m, p] of [
            ['get', '/week'], ['put', '/week'],
            ['get', '/chairs'], ['post', '/chairs'],
            ['patch', '/chairs/:id'], ['delete', '/chairs/:id'],
            ['get', '/opening-hours'], ['put', '/opening-hours'],
        ]) {
            expect(layersFor(m, p), `${m} ${p}`).not.toHaveLength(0);
        }
    });

    it('the per-record write routes are GONE', () => {
        // They keyed a cell by free-text chair name and rewrote the whole
        // practice snapshot per cell.
        expect(layersFor('post', '/')).toHaveLength(0);
        expect(layersFor('patch', '/:id')).toHaveLength(0);
        expect(layersFor('delete', '/:id')).toHaveLength(0);
    });
});

describe('gates, actually run', () => {
    it('a viewer may read the week but NOT save it', async () => {
        expect(await passes('get', '/week', viewer)).toBe(true);
        expect(await passes('put', '/week', viewer)).toBe(false);
    });

    it('an owner may save the week, chairs and opening hours', async () => {
        expect(await passes('put', '/week', owner)).toBe(true);
        expect(await passes('post', '/chairs', owner)).toBe(true);
        expect(await passes('put', '/opening-hours', owner)).toBe(true);
    });

    it('an agency actor may save even without the tenant permission', async () => {
        expect(await passes('put', '/week', agency)).toBe(true);
    });

    it('reception is refused everywhere, read included (rule 5)', async () => {
        expect(await passes('get', '/week', reception)).toBe(false);
        expect(await passes('put', '/week', reception)).toBe(false);
        expect(await passes('delete', '/chairs/:id', reception)).toBe(false);
    });
});

describe('the organisation is never taken from the request', () => {
    it('saveWeek receives the session organisation, ignoring a body-supplied one', async () => {
        const { chairUtilisationController } = await import('../src/controllers/chair-utilisation.controller.js');
        await chairUtilisationController.saveWeek({
            user: { organisation_id: 'org-a' },
            body: {
                organisation_id: 'org-attacker',
                practice_id: '11111111-1111-1111-1111-111111111111',
                chair_id: '22222222-2222-2222-2222-222222222222',
                cells: [{ weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0 }],
            },
        }, res());
        expect(chairUtilisationService.saveWeek).toHaveBeenCalledWith('org-a', expect.anything());
        // The Zod schema is strict, so the stray key never reaches the service.
        expect(chairUtilisationService.saveWeek.mock.calls[0][1]).not.toHaveProperty('organisation_id');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/chair-routes.test.mjs` from `backend/`
Expected: FAIL — the `/week` route does not exist, so `layersFor('get','/week')` has length 0.

- [ ] **Step 3: Add the schemas**

Append to `backend/src/models/chair-utilisation.model.js`:

```js
const SLOT_ENUM = zod_1.z.enum(['morning', 'midday', 'afternoon', 'evening']);

export const chairPracticeQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
});

// One chair's whole week. Capped at 28 (7 weekdays x 4 slots): a larger body
// is not a bigger week, it is a mistake or an attack.
export const chairWeekSaveSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    chair_id: zod_1.z.string().uuid(),
    cells: zod_1.z.array(zod_1.z.object({
        weekday: zod_1.z.coerce.number().int().min(1).max(7),
        slot: SLOT_ENUM,
        booked_minutes: zod_1.z.coerce.number().int().min(0).max(1440),
        revenue_pence: zod_1.z.coerce.number().int().min(0).default(0),
        notes: zod_1.z.string().trim().max(500).optional(),
    })).min(1).max(28),
}).strict();

export const practiceChairCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    name: zod_1.z.string().trim().min(1).max(120),
    display_order: zod_1.z.coerce.number().int().min(0).max(999).optional(),
}).strict();

// .strict(), never z.record(z.any()): a freeform patch makes organisation_id
// writable, which is a cross-org write dressed as an update.
export const practiceChairUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    display_order: zod_1.z.coerce.number().int().min(0).max(999).optional(),
    active: zod_1.z.boolean().optional(),
}).strict();

// Minutes from LOCAL midnight. Both null means closed that day, which is a
// legitimate state and the reason these are nullable rather than optional.
export const openingHoursSaveSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    days: zod_1.z.array(zod_1.z.object({
        weekday: zod_1.z.coerce.number().int().min(1).max(7),
        openMinute: zod_1.z.coerce.number().int().min(0).max(1440).nullable(),
        closeMinute: zod_1.z.coerce.number().int().min(0).max(1440).nullable(),
    }).refine(
        (d) => (d.openMinute == null && d.closeMinute == null)
            || (d.openMinute != null && d.closeMinute != null && d.closeMinute > d.openMinute),
        { message: 'Closing time must be after opening time, or both left blank for a closed day' },
    )).min(1).max(7),
}).strict();
```

- [ ] **Step 4: Add the service methods**

In `backend/src/services/chair-utilisation.service.js`, add the imports and methods. Replace the per-record `create`/`update`/`remove` with these:

```js
import { chairCapacityService } from "./chair-capacity.service.js";
import { practiceChairRepository } from "../repositories/practice-chair.repository.js";
import { practiceOpeningHoursRepository } from "../repositories/practice-opening-hours.repository.js";
```

```js
    week(orgId, practiceId) {
        return chairCapacityService.practiceWeek(orgId, practiceId);
    },

    listChairs: async (orgId, practiceId) => ({
        chairs: await practiceChairRepository.listForPractice(orgId, practiceId),
    }),

    async createChair(orgId, input) {
        const { data, error } = await practiceChairRepository.create(orgId, input);
        if (error) {
            // The normalised-name unique index is what stops "Surgery 1" and
            // "Surgery 1 " becoming two chairs and doubling capacity. Say so,
            // rather than surfacing a Postgres constraint name.
            const conflict = /duplicate key|unique constraint/i.test(error.message);
            throw new errors_1.AppError(
                conflict ? 'A chair with that name already exists at this practice' : error.message,
                conflict ? 409 : 400,
            );
        }
        return data;
    },

    async updateChair(orgId, id, patch) {
        const { data, error } = await practiceChairRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Chair not found', 404);
        return data;
    },

    async removeChair(orgId, id) {
        const { data, error } = await practiceChairRepository.remove(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Chair not found', 404);
        await captureGrid(orgId, data.practice_id);
        return { ok: true };
    },

    listOpeningHours: async (orgId, practiceId) => ({
        days: await practiceOpeningHoursRepository.listForPractice(orgId, practiceId),
    }),

    async saveOpeningHours(orgId, { practice_id, days }) {
        // Hand-edited hours are stamped 'manual' so the Dentally sync leaves
        // them alone for ever after. An owner's correction must not be undone
        // by tonight's sync.
        const saved = await practiceOpeningHoursRepository.upsertWeek(orgId, practice_id, days, 'manual');
        return { days: saved };
    },

    /** One chair's whole week, one statement, ONE snapshot. */
    async saveWeek(orgId, { practice_id, chair_id, cells }) {
        // The chair must belong to this organisation AND this practice. The id
        // arrives in the request body, so without this check a caller could
        // name another tenant's chair and write cells against it.
        const chairs = await practiceChairRepository.listForPractice(orgId, practice_id);
        const chair = chairs.find((c) => c.id === chair_id);
        if (!chair) throw new errors_1.AppError('Chair not found at this practice', 404);

        const saved = await chairUtilisationRepository.bulkUpsertChairWeek(orgId, {
            practice_id, chair_id, chair_name: chair.name, cells,
        });
        // ONE snapshot for the whole save. The per-record path this replaces
        // re-listed the practice and rewrote the snapshot on every single cell.
        await captureGrid(orgId, practice_id);
        return { saved: saved.length };
    },
```

Update `captureGrid` in the same file to carry `chair_id` into the snapshot payload:

```js
    const cells = rows.map((r) => ({
        chair_id: r.chair_id, chair_name: r.chair_name, weekday: r.weekday, slot: r.slot,
        booked_minutes: r.booked_minutes, available_minutes: r.available_minutes,
        revenue_pence: r.revenue_pence ?? 0,
    }));
```

- [ ] **Step 5: Add the controller methods**

Replace the `create`/`update`/`remove` methods in `backend/src/controllers/chair-utilisation.controller.js` with:

```js
    async week(req, res) {
        const q = chairPracticeQuerySchema.parse(req.query);
        res.json(await chairUtilisationService.week(req.user.organisation_id, q.practice_id));
    },
    async saveWeek(req, res) {
        const body = chairWeekSaveSchema.parse(req.body);
        res.json(await chairUtilisationService.saveWeek(req.user.organisation_id, body));
    },
    async listChairs(req, res) {
        const q = chairPracticeQuerySchema.parse(req.query);
        res.json(await chairUtilisationService.listChairs(req.user.organisation_id, q.practice_id));
    },
    async createChair(req, res) {
        const body = practiceChairCreateSchema.parse(req.body);
        res.status(201).json(await chairUtilisationService.createChair(req.user.organisation_id, body));
    },
    async updateChair(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = practiceChairUpdateSchema.parse(req.body);
        res.json(await chairUtilisationService.updateChair(req.user.organisation_id, id, body));
    },
    async removeChair(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await chairUtilisationService.removeChair(req.user.organisation_id, id));
    },
    async openingHours(req, res) {
        const q = chairPracticeQuerySchema.parse(req.query);
        res.json(await chairUtilisationService.listOpeningHours(req.user.organisation_id, q.practice_id));
    },
    async saveOpeningHours(req, res) {
        const body = openingHoursSaveSchema.parse(req.body);
        res.json(await chairUtilisationService.saveOpeningHours(req.user.organisation_id, body));
    },
```

Update the import block at the top of that file to pull the new schemas from the model.

- [ ] **Step 6: Rewire the routes**

Replace the route table in `backend/src/routes/chair-utilisation.routes.js` (keeping the existing `gate` definition and the two read routes):

```js
import { requirePermissionOrAgencyActor } from "../middleware/agency.js";

// Reading operations data and REWRITING it are different powers. Until
// operations.edit existed, operations.view granted both, so anyone who could
// read a practice's chair grid could also overwrite its whole week.
//
// Writes take operations.edit OR agency-actor status, because chair
// utilisation is a BOTH feature: the sub-account's own owner or practice
// manager maintains it, and an agency actor switched in may edit it too.
const gateEdit = requirePermissionOrAgencyActor('operations.edit');

router.get('/', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.list));
router.get('/grid', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.grid));

router.get('/week', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.week));
router.put('/week', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.saveWeek));

router.get('/chairs', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.listChairs));
router.post('/chairs', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.createChair));
router.patch('/chairs/:id', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.updateChair));
router.delete('/chairs/:id', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.removeChair));

router.get('/opening-hours', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.openingHours));
router.put('/opening-hours', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.saveOpeningHours));
```

- [ ] **Step 7: Stop the old screen calling removed routes**

Edit `frontend/app/(dashboard)/chair/page.tsx` to render Chair Efficiency alone:

```tsx
import { ChairEfficiencyScreen } from '@/features/operations/components/ChairEfficiencyScreen';

// /chair is the Chair Efficiency read-only view. Data entry moved to its own
// page, /chair-utilisation: this page is gated on finance.view and that one on
// operations.view, so stacking them left a practice manager without finance
// access looking at a half-broken screen.
export default function ChairPage() {
  return <ChairEfficiencyScreen />;
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run test/chair-routes.test.mjs test/chair-utilisation.service.test.mjs test/section-lock.test.mjs` from `backend/`
Expected: `chair-routes` PASS. `chair-utilisation.service.test.mjs` will fail on its `create`/`update`/`remove` describes — those methods are gone. Replace those three describes with equivalents against `createChair` / `updateChair` / `removeChair`, keeping the two `list` org-scoping tests unchanged.

Then: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
ggshield secret scan pre-commit
git add backend/src/models/chair-utilisation.model.js backend/src/services/chair-utilisation.service.js backend/src/controllers/chair-utilisation.controller.js backend/src/routes/chair-utilisation.routes.js backend/test/chair-routes.test.mjs backend/test/chair-utilisation.service.test.mjs "frontend/app/(dashboard)/chair/page.tsx"
git commit -m "feat(chair): week, chairs and opening-hours endpoints behind operations.edit"
```

---

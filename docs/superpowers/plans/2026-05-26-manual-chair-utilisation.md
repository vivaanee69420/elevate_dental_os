# Manual Chair Utilisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `CHAIR_UTIL` heatmap with a fully manual, owner-managed chair-utilisation feature at practice + chair + weekday + slot grain (booked vs available minutes → computed %), with full add/edit/delete UI.

**Architecture:** New `chair_utilisation` table + standard backend layering (routes → controller → service → repository → model). A pure `aggregateGrid()` function builds the weekday×slot heatmap by summing booked/available minutes across chairs. Frontend `ChairScreen.tsx` gains a practice selector, a live heatmap from `GET /chair-utilisation/grid`, and a records table with an add/edit/delete form.

**Tech Stack:** Express (native ESM), Zod, Supabase (`serviceClient` + manual `organisation_id` filter), vitest, Next.js 14 + React Query.

**Reference:** spec `docs/superpowers/specs/2026-05-26-chair-utilisation-dentally-design.md` (Track A).

---

### Task 1: Migration — `chair_utilisation` table

**Files:**
- Create: `supabase/migrations/20260101000023_chair_utilisation.sql`
- Modify: `db/01_schema.sql` (append the same `CREATE TABLE`, keep the source copy in sync)

- [ ] **Step 1: Write the migration**

```sql
-- 20260101000023_chair_utilisation.sql
-- Manual chair utilisation: owner-entered booked vs available minutes per
-- practice + chair + weekday + slot. No Dentally involvement. Idempotent.

CREATE TABLE IF NOT EXISTS chair_utilisation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  chair_name TEXT NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO 1=Mon..7=Sun
  slot TEXT NOT NULL CHECK (slot IN ('morning','midday','afternoon','evening')),
  booked_minutes INT NOT NULL DEFAULT 0 CHECK (booked_minutes >= 0),
  available_minutes INT NOT NULL DEFAULT 0 CHECK (available_minutes >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chair_util_cell
  ON chair_utilisation(organisation_id, practice_id, chair_name, weekday, slot);
CREATE INDEX IF NOT EXISTS idx_chair_util_org_practice
  ON chair_utilisation(organisation_id, practice_id);

DROP TRIGGER IF EXISTS chair_utilisation_updated_at ON chair_utilisation;
CREATE TRIGGER chair_utilisation_updated_at BEFORE UPDATE ON chair_utilisation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 2: Mirror into `db/01_schema.sql`** — append the same `CREATE TABLE chair_utilisation (...)`, indexes, and trigger near the other operational tables (after `appointments`). This file is the unmanaged source copy; keep it in sync (CLAUDE.md rule).

- [ ] **Step 3: Apply locally**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset`
Expected: all migrations `000001`→`000023` apply with no error; final line reports success.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000023_chair_utilisation.sql db/01_schema.sql
git commit -m "feat(db): chair_utilisation table for manual utilisation entry"
```

> After applying on hosted later: run `NOTIFY pgrst, 'reload schema';` (PostgREST cache).

---

### Task 2: Zod model

**Files:**
- Create: `backend/src/models/chair-utilisation.model.js`

- [ ] **Step 1: Write the model**

```js
// ============================================================================
// Chair utilisation model — Zod schemas for the manual chair-utilisation domain.
// ============================================================================
import * as zod_1 from "zod";

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];

export const chairUtilisationListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
});

export const chairUtilisationCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    chair_name: zod_1.z.string().trim().min(1).max(120),
    weekday: zod_1.z.coerce.number().int().min(1).max(7),
    slot: zod_1.z.enum(['morning', 'midday', 'afternoon', 'evening']),
    booked_minutes: zod_1.z.coerce.number().int().min(0),
    available_minutes: zod_1.z.coerce.number().int().min(0),
    notes: zod_1.z.string().trim().max(500).optional(),
});

// Partial for PATCH; practice_id is immutable on update (delete + recreate to move).
export const chairUtilisationUpdateSchema = chairUtilisationCreateSchema
    .omit({ practice_id: true })
    .partial();
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/models/chair-utilisation.model.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/chair-utilisation.model.js
git commit -m "feat(chair-util): Zod model"
```

---

### Task 3: Pure aggregation helper + unit test (TDD)

**Files:**
- Create: `backend/src/lib/chair-utilisation.js`
- Test: `backend/test/chair-utilisation.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// Chair utilisation — pure grid aggregation (no I/O).
import { describe, it, expect } from 'vitest';
import { aggregateGrid, SLOTS } from '../src/lib/chair-utilisation.js';

const rec = (o) => ({ weekday: 1, slot: 'morning', booked_minutes: 0, available_minutes: 0, ...o });

describe('aggregateGrid', () => {
    it('exposes 7 weekdays x 4 slots, null where no capacity', () => {
        const { days, slots, grid } = aggregateGrid([]);
        expect(slots).toEqual(SLOTS);
        expect(days).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(grid).toHaveLength(SLOTS.length);
        expect(grid[0]).toHaveLength(7);
        expect(grid[0][0].pct).toBeNull(); // no records -> available 0 -> null
    });

    it('sums booked/available across chairs in the same cell and caps at 100', () => {
        const { grid } = aggregateGrid([
            rec({ chair_name: 'S1', weekday: 2, slot: 'midday', booked_minutes: 180, available_minutes: 240 }),
            rec({ chair_name: 'S2', weekday: 2, slot: 'midday', booked_minutes: 240, available_minutes: 240 }),
        ]);
        const cell = grid[SLOTS.indexOf('midday')][1]; // weekday 2 -> index 1
        expect(cell.bookedMin).toBe(420);
        expect(cell.availableMin).toBe(480);
        expect(cell.pct).toBe(88); // round(100*420/480)
    });

    it('caps utilisation at 100 when booked exceeds available', () => {
        const { grid } = aggregateGrid([
            rec({ weekday: 1, slot: 'morning', booked_minutes: 300, available_minutes: 180 }),
        ]);
        expect(grid[0][0].pct).toBe(100);
    });

    it('kpis: avg over non-null cells, peak/lowest, idle chair-hours', () => {
        const { kpis } = aggregateGrid([
            rec({ weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180 }),  // 50%
            rec({ weekday: 2, slot: 'midday', booked_minutes: 180, available_minutes: 200 }),   // 90%
        ]);
        expect(kpis.avgUtilPct).toBe(70); // (50+90)/2
        expect(kpis.peakSlot).toEqual({ weekday: 2, slot: 'midday', pct: 90 });
        expect(kpis.lowestSlot).toEqual({ weekday: 1, slot: 'morning', pct: 50 });
        // idle = (180-90)+(200-180) = 110 min -> 1.8333h -> round1 = 1.8
        expect(kpis.idleChairHours).toBe(1.8);
    });

    it('all-empty kpis are null/0, not NaN', () => {
        const { kpis } = aggregateGrid([]);
        expect(kpis.avgUtilPct).toBeNull();
        expect(kpis.peakSlot).toBeNull();
        expect(kpis.lowestSlot).toBeNull();
        expect(kpis.idleChairHours).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/chair-utilisation.test.mjs`
Expected: FAIL — cannot import `aggregateGrid` (module/function not defined).

- [ ] **Step 3: Write the implementation**

```js
// ============================================================================
// Chair utilisation — pure grid aggregation. Sums manual booked/available
// minutes per (weekday, slot) across all chairs, computes utilisation % and
// KPIs. No I/O; unit-tested in isolation (lib/formulas.js philosophy).
// ============================================================================

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]; // ISO Mon..Sun

// records: [{ weekday, slot, booked_minutes, available_minutes }]
export function aggregateGrid(records) {
    // grid[slotIndex][weekdayIndex] -> { bookedMin, availableMin, pct }
    const grid = SLOTS.map(() =>
        WEEKDAYS.map(() => ({ bookedMin: 0, availableMin: 0, pct: null })),
    );
    for (const r of records) {
        const si = SLOTS.indexOf(r.slot);
        const di = WEEKDAYS.indexOf(Number(r.weekday));
        if (si < 0 || di < 0) continue; // ignore malformed rows defensively
        const cell = grid[si][di];
        cell.bookedMin += Number(r.booked_minutes) || 0;
        cell.availableMin += Number(r.available_minutes) || 0;
    }

    let idleMin = 0;
    const pcts = []; // { weekday, slot, pct } for non-null cells
    for (let si = 0; si < SLOTS.length; si++) {
        for (let di = 0; di < WEEKDAYS.length; di++) {
            const cell = grid[si][di];
            idleMin += Math.max(0, cell.availableMin - cell.bookedMin);
            if (cell.availableMin > 0) {
                cell.pct = Math.min(100, Math.round((100 * cell.bookedMin) / cell.availableMin));
                pcts.push({ weekday: WEEKDAYS[di], slot: SLOTS[si], pct: cell.pct });
            }
        }
    }

    const avgUtilPct = pcts.length
        ? Math.round(pcts.reduce((s, p) => s + p.pct, 0) / pcts.length)
        : null;
    const peakSlot = pcts.length
        ? pcts.reduce((a, b) => (b.pct > a.pct ? b : a))
        : null;
    const lowestSlot = pcts.length
        ? pcts.reduce((a, b) => (b.pct < a.pct ? b : a))
        : null;
    const idleChairHours = Math.round((idleMin / 60) * 10) / 10;

    return {
        days: [...WEEKDAYS],
        slots: [...SLOTS],
        grid,
        kpis: { avgUtilPct, peakSlot, lowestSlot, idleChairHours },
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/chair-utilisation.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/chair-utilisation.js backend/test/chair-utilisation.test.mjs
git commit -m "feat(chair-util): pure aggregateGrid helper + tests"
```

---

### Task 4: Repository

**Files:**
- Create: `backend/src/repositories/chair-utilisation.repository.js`

- [ ] **Step 1: Write the repository**

```js
// ============================================================================
// Chair utilisation repository — Supabase data access. serviceClient bypasses
// RLS, so every query carries the explicit organisation_id tenant filter.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const chairUtilisationRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('chair_utilisation')
            .select('*')
            .eq('organisation_id', orgId)
            .order('chair_name', { ascending: true })
            .order('weekday', { ascending: true });
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async create(row) {
        return supabase_1.serviceClient.from('chair_utilisation').insert(row).select().single();
    },

    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('chair_utilisation')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .maybeSingle();
    },

    async remove(orgId, id) {
        return supabase_1.serviceClient
            .from('chair_utilisation')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select('id')
            .maybeSingle();
    },
};
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/repositories/chair-utilisation.repository.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/chair-utilisation.repository.js
git commit -m "feat(chair-util): repository"
```

---

### Task 5: Service (CRUD + grid) + isolation test

**Files:**
- Create: `backend/src/services/chair-utilisation.service.js`
- Test: `backend/test/chair-utilisation.service.test.mjs`

- [ ] **Step 1: Write the service**

```js
// ============================================================================
// Chair utilisation service — CRUD + heatmap grid aggregation.
// ============================================================================
import { chairUtilisationRepository } from "../repositories/chair-utilisation.repository.js";
import { aggregateGrid } from "../lib/chair-utilisation.js";
import * as errors_1 from "../middleware/errors.js";

export const chairUtilisationService = {
    list(orgId, practiceId) {
        return chairUtilisationRepository.list(orgId, practiceId);
    },

    async grid(orgId, practiceId) {
        const records = await chairUtilisationRepository.list(orgId, practiceId);
        return aggregateGrid(records);
    },

    async create(orgId, input) {
        const { data, error } = await chairUtilisationRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },

    async update(orgId, id, patch) {
        const { data, error } = await chairUtilisationRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Record not found', 404);
        return data;
    },

    async remove(orgId, id) {
        const { data, error } = await chairUtilisationRepository.remove(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Record not found', 404);
        return { ok: true };
    },
};
```

- [ ] **Step 2: Write the isolation/grid test**

```js
// Chair utilisation service — org-scoping + grid aggregation over the fake client.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/chair-utilisation.service.js')).chairUtilisationService;

const ORG = 'org-aaaaaaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('chairUtilisationService.list', () => {
    it('always filters by organisation_id (serviceClient bypasses RLS)', async () => {
        await svc.list(ORG, undefined);
        expect(supaRec.last.table).toBe('chair_utilisation');
        expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    });

    it('adds practice_id filter when supplied', async () => {
        await svc.list(ORG, 'prac-1');
        expect(supaRec.last.eqs.find((e) => e.col === 'practice_id')).toEqual({ col: 'practice_id', val: 'prac-1' });
    });
});

describe('chairUtilisationService.grid', () => {
    it('aggregates listed records into a weekday x slot grid', async () => {
        supaRec.resultProvider = () => ({
            data: [
                { weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180 },
                { weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180 },
            ],
            error: null,
        });
        const out = await svc.grid(ORG, 'prac-1');
        // two chairs same cell: booked 180 / available 360 = 50%
        expect(out.grid[0][0].pct).toBe(50);
        expect(out.kpis.avgUtilPct).toBe(50);
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd backend && npx vitest run test/chair-utilisation.service.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/chair-utilisation.service.js backend/test/chair-utilisation.service.test.mjs
git commit -m "feat(chair-util): service + org-isolation/grid tests"
```

---

### Task 6: Controller

**Files:**
- Create: `backend/src/controllers/chair-utilisation.controller.js`

- [ ] **Step 1: Write the controller**

```js
import { chairUtilisationService } from "../services/chair-utilisation.service.js";
import {
    chairUtilisationListQuerySchema,
    chairUtilisationCreateSchema,
    chairUtilisationUpdateSchema,
} from "../models/chair-utilisation.model.js";

export const chairUtilisationController = {
    async list(req, res) {
        const q = chairUtilisationListQuerySchema.parse(req.query);
        const records = await chairUtilisationService.list(req.user.organisation_id, q.practice_id);
        res.json({ records });
    },
    async grid(req, res) {
        const q = chairUtilisationListQuerySchema.parse(req.query);
        const grid = await chairUtilisationService.grid(req.user.organisation_id, q.practice_id);
        res.json(grid);
    },
    async create(req, res) {
        const body = chairUtilisationCreateSchema.parse(req.body);
        res.status(201).json(await chairUtilisationService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const body = chairUtilisationUpdateSchema.parse(req.body);
        res.json(await chairUtilisationService.update(req.user.organisation_id, req.params.id, body));
    },
    async remove(req, res) {
        res.json(await chairUtilisationService.remove(req.user.organisation_id, req.params.id));
    },
};
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/controllers/chair-utilisation.controller.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/chair-utilisation.controller.js
git commit -m "feat(chair-util): controller"
```

---

### Task 7: Routes + mount in app.js

**Files:**
- Create: `backend/src/routes/chair-utilisation.routes.js`
- Modify: `backend/src/app.js` (import + mount under `/api/chair-utilisation`)

- [ ] **Step 1: Write the routes**

```js
// ============================================================================
// Chair utilisation routes — manual utilisation CRUD + heatmap grid.
// Mounted at /api/chair-utilisation. Owner + practice_manager only.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { chairUtilisationController } from "../controllers/chair-utilisation.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.list));
router.get('/grid', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.grid));
router.post('/', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.create));
router.patch('/:id', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.update));
router.delete('/:id', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.remove));

export default router;
```

- [ ] **Step 2: Wire into app.js** — add the import alongside the other route imports (near line 46, after `practices_routes_1`):

```js
import * as chair_utilisation_routes_1 from "./routes/chair-utilisation.routes.js";
```

And mount it in the authenticated `/api` block (after `api.use('/appointments', ...)`, around line 181):

```js
    api.use('/chair-utilisation', chair_utilisation_routes_1.default);
```

- [ ] **Step 3: Syntax check + boot the app**

Run: `cd backend && node --check src/routes/chair-utilisation.routes.js && node --check src/app.js`
Expected: no output.

- [ ] **Step 4: Run the full backend test suite (no regressions)**

Run: `cd backend && npm test`
Expected: all tests pass (existing suite + the new chair-utilisation tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/chair-utilisation.routes.js backend/src/app.js
git commit -m "feat(chair-util): routes mounted at /api/chair-utilisation"
```

---

### Task 8: Docs — API.md + FORMULAS.md

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/FORMULAS.md`

- [ ] **Step 1: Add the endpoints to `docs/API.md`** (follow the file's existing format; place near the appointments/operations section):

```markdown
### Chair utilisation (manual)  — owner / practice_manager

- `GET  /api/chair-utilisation?practice_id=<uuid>` — list manual records.
- `GET  /api/chair-utilisation/grid?practice_id=<uuid>` — aggregated weekday×slot heatmap
  `{ days:[1..7], slots:['morning','midday','afternoon','evening'], grid, kpis }`.
- `POST /api/chair-utilisation` — body `{ practice_id, chair_name, weekday(1-7), slot, booked_minutes, available_minutes, notes? }`.
- `PATCH /api/chair-utilisation/:id` — partial update (practice_id immutable).
- `DELETE /api/chair-utilisation/:id`.
```

- [ ] **Step 2: Add the formula to `docs/FORMULAS.md`**:

```markdown
## Chair utilisation (manual)

Per (weekday, slot) cell, summed across all chairs of the selected practice:

    bookedMin    = Σ booked_minutes
    availableMin = Σ available_minutes
    utilPct      = availableMin > 0 ? min(100, round(100 * bookedMin / availableMin)) : null  (null = no capacity)

KPIs: `avgUtilPct` = mean of non-null cell %s; `peakSlot`/`lowestSlot` = max/min non-null cells;
`idleChairHours` = Σ max(0, availableMin − bookedMin) / 60, rounded to 1dp.
Source of truth: `backend/src/lib/chair-utilisation.js` (`aggregateGrid`), unit-tested in
`backend/test/chair-utilisation.test.mjs`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/API.md docs/FORMULAS.md
git commit -m "docs(chair-util): API + FORMULAS for manual chair utilisation"
```

---

### Task 9: Frontend — 12-hour time helper + slot labels

**Files:**
- Modify: `frontend/lib/format.ts`
- Create: `frontend/features/operations/chair-util.ts` (shared constants/labels for the feature)

- [ ] **Step 1: Add a 12-hour formatter to `frontend/lib/format.ts`** (append):

```ts
/** Format a 24h "HH:MM" string as 12-hour, e.g. "08:00" -> "8:00am". */
export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = Number(hStr);
  const m = mStr ?? '00';
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}
```

- [ ] **Step 2: Create the feature constants** `frontend/features/operations/chair-util.ts`:

```ts
import { formatTime12h } from '@/lib/format';

// Slot keys must match the backend enum (chair-utilisation.model.js SLOTS).
export const SLOT_KEYS = ['morning', 'midday', 'afternoon', 'evening'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

// Display windows (24h internal -> 12h label). Pure presentation.
const SLOT_WINDOWS: Record<SlotKey, [string, string]> = {
  morning: ['08:00', '11:00'],
  midday: ['11:00', '14:00'],
  afternoon: ['14:00', '17:00'],
  evening: ['17:00', '20:00'],
};

export const SLOT_LABEL: Record<SlotKey, string> = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

export function slotTimeLabel(slot: SlotKey): string {
  const [a, b] = SLOT_WINDOWS[slot];
  return `${formatTime12h(a)}–${formatTime12h(b)}`;
}

// ISO weekday 1..7 -> short label. Columns render Mon..Sun.
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

// Heatmap cell colour by utilisation %. null (no capacity) -> neutral grey.
export function chairUtilColour(pct: number | null): string {
  if (pct == null) return '#E5E7EB';
  if (pct >= 90) return '#10B981';
  if (pct >= 75) return '#0E7C7B';
  if (pct >= 60) return '#F59E0B';
  return '#EF4444';
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/format.ts frontend/features/operations/chair-util.ts
git commit -m "feat(chair-util): 12h time helper + slot/weekday constants"
```

---

### Task 10: Frontend — API client + React Query hooks

**Files:**
- Create: `frontend/features/operations/chair-api.ts`
- Create: `frontend/features/operations/chair-hooks.ts`

- [ ] **Step 1: Write the API client** `frontend/features/operations/chair-api.ts`:

```ts
import { api } from '@/lib/api';
import type { SlotKey } from './chair-util';

export type ChairRecord = {
  id: string;
  practice_id: string;
  chair_name: string;
  weekday: number;
  slot: SlotKey;
  booked_minutes: number;
  available_minutes: number;
  notes: string | null;
};

export type ChairCell = { bookedMin: number; availableMin: number; pct: number | null };

export type ChairGrid = {
  days: number[];
  slots: SlotKey[];
  grid: ChairCell[][]; // [slotIndex][dayIndex]
  kpis: {
    avgUtilPct: number | null;
    peakSlot: { weekday: number; slot: SlotKey; pct: number } | null;
    lowestSlot: { weekday: number; slot: SlotKey; pct: number } | null;
    idleChairHours: number;
  };
};

export type ChairInput = {
  practice_id: string;
  chair_name: string;
  weekday: number;
  slot: SlotKey;
  booked_minutes: number;
  available_minutes: number;
  notes?: string;
};

export function listChairRecords(practiceId: string) {
  return api<{ records: ChairRecord[] }>(`/api/chair-utilisation?practice_id=${practiceId}`);
}
export function getChairGrid(practiceId: string) {
  return api<ChairGrid>(`/api/chair-utilisation/grid?practice_id=${practiceId}`);
}
export function createChairRecord(input: ChairInput) {
  return api<ChairRecord>('/api/chair-utilisation', { method: 'POST', body: JSON.stringify(input) });
}
export function updateChairRecord(id: string, patch: Partial<Omit<ChairInput, 'practice_id'>>) {
  return api<ChairRecord>(`/api/chair-utilisation/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function deleteChairRecord(id: string) {
  return api<{ ok: boolean }>(`/api/chair-utilisation/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Write the hooks** `frontend/features/operations/chair-hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listChairRecords, getChairGrid, createChairRecord, updateChairRecord, deleteChairRecord,
  type ChairInput,
} from './chair-api';

export function useChairRecords(practiceId: string | undefined) {
  return useQuery({
    queryKey: ['chair-records', practiceId],
    queryFn: () => listChairRecords(practiceId!),
    enabled: !!practiceId,
  });
}

export function useChairGrid(practiceId: string | undefined) {
  return useQuery({
    queryKey: ['chair-grid', practiceId],
    queryFn: () => getChairGrid(practiceId!),
    enabled: !!practiceId,
  });
}

function useInvalidate(practiceId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['chair-records', practiceId] });
    qc.invalidateQueries({ queryKey: ['chair-grid', practiceId] });
  };
}

export function useCreateChairRecord(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({ mutationFn: (input: ChairInput) => createChairRecord(input), onSuccess: invalidate });
}
export function useUpdateChairRecord(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<ChairInput, 'practice_id'>> }) =>
      updateChairRecord(id, patch),
    onSuccess: invalidate,
  });
}
export function useDeleteChairRecord(practiceId: string | undefined) {
  const invalidate = useInvalidate(practiceId);
  return useMutation({ mutationFn: (id: string) => deleteChairRecord(id), onSuccess: invalidate });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/operations/chair-api.ts frontend/features/operations/chair-hooks.ts
git commit -m "feat(chair-util): frontend api client + hooks"
```

---

### Task 11: Frontend — rewrite ChairScreen (selector + live heatmap + records CRUD)

**Files:**
- Modify: `frontend/features/operations/components/ChairScreen.tsx` (full rewrite)

- [ ] **Step 1: Replace `ChairScreen.tsx` with the live version**

```tsx
'use client';
// Chair Utilisation — manual, owner-managed. Records (practice + chair +
// weekday + slot, booked vs available minutes) drive a weekday x slot heatmap.
// All data is entered here; nothing comes from Dentally.

import { useMemo, useState } from 'react';
import { usePractices } from '@/features/integrations/hooks';
import { formatNumber } from '@/lib/format';
import {
  SLOT_KEYS, SLOT_LABEL, slotTimeLabel, WEEKDAYS, WEEKDAY_LABEL, chairUtilColour,
  type SlotKey,
} from '../chair-util';
import {
  useChairRecords, useChairGrid, useCreateChairRecord, useUpdateChairRecord, useDeleteChairRecord,
} from '../chair-hooks';
import type { ChairRecord } from '../chair-api';

type FormState = {
  id: string | null;
  chair_name: string;
  weekday: number;
  slot: SlotKey;
  booked_hours: string;     // entered in hours; converted to minutes on submit
  available_hours: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  id: null, chair_name: '', weekday: 1, slot: 'morning',
  booked_hours: '', available_hours: '', notes: '',
};

export default function ChairScreen() {
  const { data: practicesData } = usePractices();
  const practices = practicesData?.practices ?? [];
  const [practiceId, setPracticeId] = useState<string>('');
  const selected = practiceId || practices[0]?.id || '';

  const { data: grid } = useChairGrid(selected || undefined);
  const { data: recordsData } = useChairRecords(selected || undefined);
  const records = recordsData?.records ?? [];

  const create = useCreateChairRecord(selected || undefined);
  const update = useUpdateChairRecord(selected || undefined);
  const del = useDeleteChairRecord(selected || undefined);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const editing = form.id != null;

  const kpis = grid?.kpis;
  const slotKeyOf = (s: string) => s as SlotKey;

  const peakLabel = useMemo(() => {
    if (!kpis?.peakSlot) return '—';
    return `${WEEKDAY_LABEL[kpis.peakSlot.weekday]} ${SLOT_LABEL[slotKeyOf(kpis.peakSlot.slot)]}`;
  }, [kpis]);
  const lowestLabel = useMemo(() => {
    if (!kpis?.lowestSlot) return '—';
    return `${WEEKDAY_LABEL[kpis.lowestSlot.weekday]} ${SLOT_LABEL[slotKeyOf(kpis.lowestSlot.slot)]}`;
  }, [kpis]);

  function startEdit(r: ChairRecord) {
    setForm({
      id: r.id, chair_name: r.chair_name, weekday: r.weekday, slot: r.slot,
      booked_hours: String(r.booked_minutes / 60),
      available_hours: String(r.available_minutes / 60),
      notes: r.notes ?? '',
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const booked_minutes = Math.round(Number(form.booked_hours || 0) * 60);
    const available_minutes = Math.round(Number(form.available_hours || 0) * 60);
    const base = {
      chair_name: form.chair_name.trim(), weekday: form.weekday, slot: form.slot,
      booked_minutes, available_minutes, notes: form.notes.trim() || undefined,
    };
    if (editing && form.id) {
      update.mutate({ id: form.id, patch: base }, { onSuccess: () => setForm(EMPTY_FORM) });
    } else {
      create.mutate({ practice_id: selected, ...base }, { onSuccess: () => setForm(EMPTY_FORM) });
    }
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Chair Utilisation</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Manual booked vs available chair time · weekday × slot
          </p>
        </div>
        <select
          value={selected}
          onChange={(e) => setPracticeId(e.target.value)}
          style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
        >
          {practices.length === 0 && <option value="">No practices</option>}
          {practices.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Avg utilisation" value={kpis?.avgUtilPct != null ? `${kpis.avgUtilPct}%` : '—'} sub="UK avg: 72%" subColor="#10B981" />
        <Kpi label="Peak slot" value={peakLabel} sub={kpis?.peakSlot ? `${kpis.peakSlot.pct}% utilised` : ''} subColor="#10B981" />
        <Kpi label="Lowest slot" value={lowestLabel} sub={kpis?.lowestSlot ? `${kpis.lowestSlot.pct}% utilised` : ''} subColor="#EF4444" />
        <Kpi label="Idle chair-hours" value={kpis ? formatNumber(kpis.idleChairHours) : '—'} sub="/week" subColor="#EF4444" />
      </div>

      {/* Heatmap */}
      <div className="card-padded mb-4">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>Heatmap</h2>
        {!grid && <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading…</div>}
        {grid && records.length === 0 && (
          <div className="text-ink-muted" style={{ fontSize: 13 }}>
            No utilisation records yet. Add chairs and hours below to build the heatmap.
          </div>
        )}
        {grid && records.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${WEEKDAYS.length}, 1fr)`, gap: 6, maxWidth: 900 }}>
            <div />
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-ink-muted font-bold" style={{ fontSize: 12 }}>
                {WEEKDAY_LABEL[d]}
              </div>
            ))}
            {SLOT_KEYS.map((slot, slotIdx) => (
              <FragmentRow key={slot} slot={slot} slotIdx={slotIdx} grid={grid.grid} />
            ))}
          </div>
        )}
      </div>

      {/* Records management */}
      <div className="card-padded">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
          {editing ? 'Edit record' : 'Add record'}
        </h2>
        <form onSubmit={submit} className="grid gap-3" style={{ gridTemplateColumns: 'repeat(6, 1fr)', alignItems: 'end', marginBottom: 16 }}>
          <Field label="Chair">
            <input required value={form.chair_name} onChange={(e) => setForm({ ...form, chair_name: e.target.value })}
              placeholder="Surgery 1" style={inputStyle} />
          </Field>
          <Field label="Weekday">
            <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} style={inputStyle}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{WEEKDAY_LABEL[d]}</option>)}
            </select>
          </Field>
          <Field label="Slot">
            <select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value as SlotKey })} style={inputStyle}>
              {SLOT_KEYS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]} ({slotTimeLabel(s)})</option>)}
            </select>
          </Field>
          <Field label="Booked (hrs)">
            <input required type="number" min="0" step="0.25" value={form.booked_hours}
              onChange={(e) => setForm({ ...form, booked_hours: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Available (hrs)">
            <input required type="number" min="0" step="0.25" value={form.available_hours}
              onChange={(e) => setForm({ ...form, available_hours: e.target.value })} style={inputStyle} />
          </Field>
          <div className="flex" style={{ gap: 8 }}>
            <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }} disabled={!selected || create.isPending || update.isPending}>
              {editing ? 'Save' : 'Add'}
            </button>
            {editing && (
              <button type="button" className="btn-ghost" style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #E5E7EB' }} onClick={() => setForm(EMPTY_FORM)}>
                Cancel
              </button>
            )}
          </div>
        </form>

        {records.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px 8px 0' }}>Chair</th>
                <th style={{ padding: '8px 12px' }}>Weekday</th>
                <th style={{ padding: '8px 12px' }}>Slot</th>
                <th style={{ padding: '8px 12px' }}>Booked</th>
                <th style={{ padding: '8px 12px' }}>Available</th>
                <th style={{ padding: '8px 0 8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '10px 12px 10px 0' }}>{r.chair_name}</td>
                  <td style={{ padding: '10px 12px' }}>{WEEKDAY_LABEL[r.weekday]}</td>
                  <td style={{ padding: '10px 12px' }}>{SLOT_LABEL[r.slot]}</td>
                  <td style={{ padding: '10px 12px' }}>{(r.booked_minutes / 60).toFixed(2)}h</td>
                  <td style={{ padding: '10px 12px' }}>{(r.available_minutes / 60).toFixed(2)}h</td>
                  <td style={{ padding: '10px 0 10px 12px', whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn-ghost" style={{ fontSize: 12, marginRight: 8 }} onClick={() => startEdit(r)}>Edit</button>
                    <button type="button" className="btn-ghost" style={{ fontSize: 12, color: '#991B1B' }} onClick={() => del.mutate(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="text-ink-muted font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor: string }) {
  return (
    <div className="card-padded">
      <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>{label}</div>
      <div className="display font-bold" style={{ fontSize: 22, marginTop: 4 }}>{value}</div>
      {sub && <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: subColor }}>{sub}</div>}
    </div>
  );
}

function FragmentRow({ slot, slotIdx, grid }: { slot: SlotKey; slotIdx: number; grid: { pct: number | null }[][] }) {
  return (
    <>
      <div className="text-ink-muted text-right" style={{ fontSize: 11, paddingRight: 8, alignSelf: 'center' }}>
        {SLOT_LABEL[slot]}
      </div>
      {WEEKDAYS.map((_, dayIdx) => {
        const pct = grid[slotIdx]?.[dayIdx]?.pct ?? null;
        return (
          <div key={dayIdx} className="text-center text-white font-bold"
            style={{ background: chairUtilColour(pct), borderRadius: 6, padding: '14px 8px', fontSize: 13 }}>
            {pct == null ? '—' : `${pct}%`}
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck/lint clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/operations/components/ChairScreen.tsx
git commit -m "feat(chair-util): live ChairScreen with selector, heatmap, records CRUD"
```

---

### Task 12: Remove the mock chair data

**Files:**
- Modify: `frontend/features/operations/data.ts` (remove `CHAIR_DAYS`, `CHAIR_SLOTS`, `CHAIR_UTIL`, and `chairUtilColour` if now unused)

- [ ] **Step 1: Confirm nothing else imports the mock chair exports**

Run: `cd frontend && grep -rn "CHAIR_UTIL\|CHAIR_DAYS\|CHAIR_SLOTS" features/ app/ components/`
Expected: no matches (ChairScreen now uses `../chair-util`). If any match remains, update it first.

- [ ] **Step 2: Delete the unused exports from `data.ts`** — remove the `CHAIR_DAYS` / `CHAIR_SLOTS` / `CHAIR_UTIL` declarations. Leave `chairUtilColour` in `data.ts` only if still imported elsewhere; otherwise remove it (the live screen uses the copy in `chair-util.ts`).

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/operations/data.ts
git commit -m "chore(chair-util): drop mock CHAIR_* data"
```

---

## Done-when

- `npm test` (backend) green incl. the two new test files.
- Frontend typecheck + lint + build clean.
- Chair Utilisation page: pick a practice, add a chair record (booked/available hours), see the heatmap cell + KPIs update; edit and delete work; cells with no capacity render `—`.
- `docs/API.md` + `docs/FORMULAS.md` updated.

# Call Reporting v2 — Multi-Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Call Reporting (Google Sheets) feature from one-sheet-per-org with per-row practice mapping to one-sheet-per-practice with self-contained labels, the client's real columns (Yes/No call buckets), and 10 dashboard cards.

**Architecture:** One migration reshapes `sheet_sources` (N per org + `practice_label`), `sheet_leads` (boolean call buckets + `pipeline_name`), and the `sheet_leads_dashboard` RPC (10 counts incl. office-hours bucketing). The sync engine's five mapped columns become Date / Created Time / Called 3m / Called 10m / Pipeline Name, all sync paths become per-source, and the service/routes/frontend follow.

**Tech Stack:** Express (native ESM JS), Supabase Postgres (serviceClient + explicit org filters — rule 3), Zod, vitest; Next.js 14 + React Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-05-call-reporting-v2-multi-sheet-design.md`

## Global Constraints

- Backend is native ESM: `import`/`export`, relative imports carry `.js`. Never `require`/`module.exports`.
- Every repository query carries an explicit `.eq('organisation_id', orgId)` (rule 3).
- Row values (dates, pipeline names) are NEVER logged — counts/status only. Lead Name/Email/Phone/Treatment/Assigned-to columns are never requested from the Sheets API or stored.
- British English in UI copy. No dark mode. No emojis.
- Call Reporting stays gated `growth.view` in nav; routes stay owner (+ practice_manager for reads). Reception never sees it (rule 5).
- Text dates parse as `MM/DD/YYYY` (the sheet's stated format), NOT dd/mm.
- Office hours = Mon–Fri, `>= 09:00` and `< 17:00`, Europe/London.
- Run backend tests from `backend/`: `npx vitest run test/<file>`. Full suite: `npm test`.
- Commit after every task (work directly on `main`, do not push unless asked).

---

### Task 1: Migration `000119` — multi-sheet schema + 10-card RPC

**Files:**
- Create: `supabase/migrations/20260101000119_call_reporting_multi_sheet.sql`

**Interfaces:**
- Produces: table shapes + RPC signature every later task relies on:
  `sheet_sources.practice_label text`, N sources per org (unique
  `(organisation_id, spreadsheet_id)`); `sheet_leads(called_3m bool, called_10m bool, pipeline_name text)`
  without practice columns; RPC `sheet_leads_dashboard(p_org uuid, p_date date, p_source uuid, p_tz text)`
  returning `(total, called_3m, called_10m, in_pipeline, not_called, office_time, outside_office, facebook, google)` bigints.

- [ ] **Step 1: Write the migration**

```sql
-- 20260101000119_call_reporting_multi_sheet.sql
-- Call Reporting v2 — one Google Sheet per practice (self-contained labels).
-- sheet_sources: N per org + practice_label; sheet_leads: Yes/No call buckets
-- + pipeline_name (per-row practice columns dropped); sheet_practice_map and
-- its restamp RPC removed; dashboard RPC now returns the 10-card counts and
-- filters by source (= practice) instead of practice_id.
-- Spec: docs/superpowers/specs/2026-08-05-call-reporting-v2-multi-sheet-design.md
-- Idempotent. After hosted apply run: NOTIFY pgrst, 'reload schema';

-- 1) sheet_sources: many per org, one per practice --------------------------
alter table public.sheet_sources add column if not exists practice_label text;
alter table public.sheet_sources drop constraint if exists sheet_sources_organisation_id_key;
create unique index if not exists sheet_sources_org_spreadsheet_key
  on public.sheet_sources (organisation_id, spreadsheet_id);

-- 2) sheet_leads: v2 shape. v1 rows are wiped (feature shipped yesterday,
--    a re-sync fully repopulates) — the old columns don't map to the new.
delete from public.sheet_leads;
alter table public.sheet_leads add column if not exists called_3m  boolean not null default false;
alter table public.sheet_leads add column if not exists called_10m boolean not null default false;
alter table public.sheet_leads add column if not exists pipeline_name text;
alter table public.sheet_leads drop column if exists first_call_at;
alter table public.sheet_leads drop column if exists lead_source;
alter table public.sheet_leads drop column if exists pipeline_status;
alter table public.sheet_leads drop column if exists practice_value;
alter table public.sheet_leads drop column if exists practice_id;  -- takes its index with it
create index if not exists sheet_leads_org_source_created_idx
  on public.sheet_leads (organisation_id, source_id, created_at);
-- sheet_leads_org_created_idx (organisation_id, created_at) stays from v1.

-- 3) Per-row practice mapping: obsolete -------------------------------------
drop function if exists public.restamp_sheet_lead_practices(uuid);
drop table if exists public.sheet_practice_map;

-- 4) Dashboard RPC v2 — return shape changed => drop first ------------------
drop function if exists public.sheet_leads_dashboard(uuid, date, uuid, text);
create function public.sheet_leads_dashboard(
  p_org uuid,
  p_date date,
  p_source uuid default null,
  p_tz text default 'Europe/London'
)
returns table (
  total bigint,
  called_3m bigint,
  called_10m bigint,
  in_pipeline bigint,
  not_called bigint,
  office_time bigint,
  outside_office bigint,
  facebook bigint,
  google bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where l.called_3m)  as called_3m,
    count(*) filter (where l.called_10m) as called_10m,
    count(*) filter (where nullif(trim(coalesce(l.pipeline_name, '')), '') is not null) as in_pipeline,
    count(*) filter (where not l.called_3m and not l.called_10m) as not_called,
    -- Office hours: Mon-Fri 09:00-16:59 local (p_tz). 17:00 exactly is outside.
    count(*) filter (where extract(isodow from (l.created_at at time zone p_tz)) between 1 and 5
                       and (l.created_at at time zone p_tz)::time >= time '09:00'
                       and (l.created_at at time zone p_tz)::time <  time '17:00') as office_time,
    count(*) filter (where not (extract(isodow from (l.created_at at time zone p_tz)) between 1 and 5
                       and (l.created_at at time zone p_tz)::time >= time '09:00'
                       and (l.created_at at time zone p_tz)::time <  time '17:00')) as outside_office,
    count(*) filter (where l.pipeline_name ~* '(facebook|\mfb\M|meta)')  as facebook,
    count(*) filter (where l.pipeline_name ~* '(google|adwords|\mppc\M)') as google
  from public.sheet_leads l
  where l.organisation_id = p_org
    and (l.created_at at time zone p_tz)::date = p_date
    and (p_source is null or l.source_id = p_source)
$$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Syntax-check the SQL**

If the local Supabase stack is running (`supabase status` from the repo root succeeds), run `supabase db reset` from the repo root and confirm it applies `000119` without error. If the local stack is not running, verify with a parse-only pass: `docker run --rm -i postgres:15 psql --set ON_ERROR_STOP=1 -f - < supabase/migrations/20260101000119_call_reporting_multi_sheet.sql` is NOT possible without a server — instead just re-read the file checking each statement ends with `;` and the `$$` quoting is balanced. (Hosted apply happens in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000119_call_reporting_multi_sheet.sql
git commit -m "feat(call-reporting): migration 000119 — one sheet per practice, Yes/No buckets, 10-card RPC"
```

---

### Task 2: Sync parse helpers — new five columns

**Files:**
- Modify: `backend/src/lib/integrations/google-sheets-sync.js` (pure-helpers section, lines ~30–142)
- Test: `backend/test/google-sheets-parse.test.mjs` (rewrite)

**Interfaces:**
- Produces (exported from `google-sheets-sync.js`, consumed by Tasks 4/5 and tests):
  - `MAPPED_FIELDS = ['date', 'created_time', 'called_3m', 'called_10m', 'pipeline_name']`
  - `parseDateWallMs(v) -> number|null` (ms at wall-clock midnight)
  - `parseTimeOfDayMs(v) -> number` (ms into the day; blank/unparsable = 0)
  - `combineDateTime(dateVal, timeVal, tz) -> string|null` (ISO UTC)
  - `parseYesNo(v) -> boolean`
  - `hashRow(fields) -> string` over `[created_at, called_3m, called_10m, pipeline_name]`
  - `parsePage(columns, startRow, tz) -> { rows, skipped, lastDataRow }` where each row is
    `{ sheet_row_index, created_at, called_3m, called_10m, pipeline_name, row_hash }`
- Removes: `serialToIso`, `parseTextTimestamp`, `parseTimestampValue`, `normalisePracticeValue`, `practiceKey` (no remaining callers after Task 4). `colLetter`, `tzOffsetMs`, `quoteTab` stay.

- [ ] **Step 1: Rewrite the test file with failing tests**

Replace the entire contents of `backend/test/google-sheets-parse.test.mjs` with:

```js
// Google Sheets parse helpers (Call Reporting v2) — date+time combining in the
// sheet's timezone (DST-correct), MM/DD/YYYY text fallback, Yes/No buckets,
// page parsing and content hashing. Serial anchor: 25569 = 1970-01-01.
// Serial for 2026-07-31 (BST) = 46234; 14:00 = 0.5833333333333334.
import './setup.js';
import { describe, it, expect } from 'vitest';
import {
  colLetter, combineDateTime, parseDateWallMs, parseTimeOfDayMs, parseYesNo,
  parsePage, hashRow, MAPPED_FIELDS,
} from '../src/lib/integrations/google-sheets-sync.js';

const TZ = 'Europe/London';

describe('colLetter', () => {
  it('maps 0->A, 25->Z, 26->AA, 27->AB', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
  });
});

describe('combineDateTime', () => {
  it('serial date + serial time, summer (BST = UTC+1)', () => {
    expect(combineDateTime(46234, 0.5833333333333334, TZ)).toBe('2026-07-31T13:00:00.000Z');
  });
  it('serial date + no time = midnight wall time', () => {
    expect(combineDateTime(46234, '', TZ)).toBe('2026-07-30T23:00:00.000Z');
  });
  it('a full datetime serial in the date column floors to midnight (time col re-adds)', () => {
    expect(combineDateTime(46234.9, 0.5, TZ)).toBe('2026-07-31T11:00:00.000Z');
  });
  it('MM/DD/YYYY text + hh:mm text, summer', () => {
    expect(combineDateTime('07/31/2026', '14:05', TZ)).toBe('2026-07-31T13:05:00.000Z');
  });
  it('MM/DD/YYYY text + hh:mm text, winter (GMT = UTC+0)', () => {
    expect(combineDateTime('01/15/2026', '09:00', TZ)).toBe('2026-01-15T09:00:00.000Z');
  });
  it('am/pm times', () => {
    expect(combineDateTime('07/31/2026', '2:05 pm', TZ)).toBe('2026-07-31T13:05:00.000Z');
    expect(combineDateTime('07/31/2026', '12:10 AM', TZ)).toBe('2026-07-30T23:10:00.000Z');
  });
  it('ISO yyyy-mm-dd text dates also accepted', () => {
    expect(combineDateTime('2026-07-31', '10:00', TZ)).toBe('2026-07-31T09:00:00.000Z');
  });
  it('unparsable date -> null (row will be skipped)', () => {
    expect(combineDateTime('soon', '10:00', TZ)).toBeNull();
    expect(combineDateTime('', '10:00', TZ)).toBeNull();
    expect(combineDateTime('31/07/2026', '10:00', TZ)).toBeNull(); // dd/mm is NOT accepted: month 31 invalid
  });
  it('unparsable time falls back to midnight, does not lose the lead', () => {
    expect(combineDateTime('01/15/2026', 'later', TZ)).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('parseDateWallMs / parseTimeOfDayMs', () => {
  it('serial 25569 = 1970-01-01 midnight wall', () => {
    expect(parseDateWallMs(25569)).toBe(0);
  });
  it('time serial 0.5 = 12:00', () => {
    expect(parseTimeOfDayMs(0.5)).toBe(43200000);
  });
  it('time text 09:30:15', () => {
    expect(parseTimeOfDayMs('09:30:15')).toBe(((9 * 60 + 30) * 60 + 15) * 1000);
  });
});

describe('parseYesNo', () => {
  it.each([['Yes'], ['yes'], [' YES '], ['y'], ['TRUE'], ['true'], ['1'], [true]])('%s -> true', (v) => {
    expect(parseYesNo(v)).toBe(true);
  });
  it.each([['No'], ['no'], [''], [null], [undefined], ['maybe'], [false], [0]])('%s -> false', (v) => {
    expect(parseYesNo(v)).toBe(false);
  });
});

describe('parsePage', () => {
  const columns = {
    date:          [46234,   '07/31/2026', 'garbage', ''],
    created_time:  [0.375,   '16:45',      '10:00',   ''],
    called_3m:     ['Yes',   'No',         'Yes',     ''],
    called_10m:    ['No',    'Yes',        'No',      ''],
    pipeline_name: ['Facebook Ads', '',    'Google',  ''],
  };
  it('parses good rows, skips bad dates, ignores fully-empty rows', () => {
    const { rows, skipped, lastDataRow } = parsePage(columns, 2, TZ);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1);          // the 'garbage' date row
    expect(lastDataRow).toBe(4);      // row 4 held data (bad date still counts as data)
    expect(rows[0]).toMatchObject({
      sheet_row_index: 2,
      created_at: '2026-07-31T08:00:00.000Z', // 09:00 BST
      called_3m: true, called_10m: false, pipeline_name: 'Facebook Ads',
    });
    expect(rows[1]).toMatchObject({
      sheet_row_index: 3,
      created_at: '2026-07-31T15:45:00.000Z', // 16:45 BST
      called_3m: false, called_10m: true, pipeline_name: null,
    });
  });
  it('row_hash changes when a bucket flips, stable otherwise', () => {
    const a = parsePage(columns, 2, TZ).rows[0];
    const b = parsePage({ ...columns, called_3m: ['No', 'No', 'Yes', ''] }, 2, TZ).rows[0];
    const again = parsePage(columns, 2, TZ).rows[0];
    expect(a.row_hash).not.toBe(b.row_hash);
    expect(a.row_hash).toBe(again.row_hash);
  });
  it('MAPPED_FIELDS is exactly the five stored columns', () => {
    expect(MAPPED_FIELDS).toEqual(['date', 'created_time', 'called_3m', 'called_10m', 'pipeline_name']);
  });
  it('hashRow covers exactly the four stored values', () => {
    const f = { created_at: '2026-07-31T08:00:00.000Z', called_3m: true, called_10m: false, pipeline_name: 'X' };
    expect(hashRow(f)).toBe(hashRow({ ...f }));
    expect(hashRow(f)).not.toBe(hashRow({ ...f, pipeline_name: 'Y' }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/google-sheets-parse.test.mjs`
Expected: FAIL — `combineDateTime`/`parseYesNo` etc. are not exported.

- [ ] **Step 3: Implement the helpers**

In `backend/src/lib/integrations/google-sheets-sync.js`:

1. Replace the `MAPPED_FIELDS` line (30) with:

```js
export const MAPPED_FIELDS = ['date', 'created_time', 'called_3m', 'called_10m', 'pipeline_name'];
```

2. Delete `serialToIso`, `parseTextTimestamp`, `parseTimestampValue`, `normalisePracticeValue`, `practiceKey` (keep `colLetter`, `quoteTab`, `tzOffsetMs`). In their place add:

```js
// Date cell -> wall-clock ms at midnight. Serial numbers floor to whole days
// (25569 = 1970-01-01); text accepts ISO yyyy-mm-dd, else MM/DD/YYYY — the
// sheet's stated format, deliberately NOT British dd/mm.
export function parseDateWallMs(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
        return (Math.floor(v) - 25569) * 86400000;
    }
    const s = String(v ?? '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const mo = +m[1];
        const d = +m[2];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        return Date.UTC(+m[3], mo - 1, d);
    }
    return null;
}

// Time cell -> ms into the day. Serial values use their fractional part (works
// for bare times and full datetimes alike); text accepts hh:mm[:ss] + am/pm.
// Blank or unparsable -> midnight — a missing time must not lose the lead.
export function parseTimeOfDayMs(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
        return Math.round((v - Math.floor(v)) * 86400000);
    }
    const m = String(v ?? '').trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return 0;
    let h = +m[1];
    if (m[4] === 'pm' && h < 12) h += 12;
    if (m[4] === 'am' && h === 12) h = 0;
    return ((h * 60 + +m[2]) * 60 + +(m[3] ?? 0)) * 1000;
}

// Date + time cells -> ISO UTC (wall time in the sheet's timezone).
export function combineDateTime(dateVal, timeVal, tz = DEFAULT_TZ) {
    const dayMs = parseDateWallMs(dateVal);
    if (dayMs == null) return null;
    const wallMs = dayMs + parseTimeOfDayMs(timeVal);
    return new Date(wallMs - tzOffsetMs(tz, wallMs)).toISOString();
}

// Yes/No call columns. Checkbox TRUE or yes/y/true/1 text (any case) -> true;
// everything else — including blank — false.
export function parseYesNo(v) {
    if (v === true) return true;
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}
```

3. Replace `hashRow` with:

```js
// Deterministic content hash of the four stored values (change detection).
export function hashRow(fields) {
    return crypto.createHash('sha256')
        .update(JSON.stringify([
            fields.created_at ?? null,
            fields.called_3m ?? false,
            fields.called_10m ?? false,
            fields.pipeline_name ?? null,
        ]))
        .digest('hex');
}
```

4. Replace `parsePage`'s row construction (keep the loop/empty-row/lastDataRow structure) with:

```js
        const created = combineDateTime(raw.date, raw.created_time, tz);
        if (!created) { skipped += 1; continue; }
        const fields = {
            created_at: created,
            called_3m: parseYesNo(raw.called_3m),
            called_10m: parseYesNo(raw.called_10m),
            pipeline_name: String(raw.pipeline_name ?? '').trim() || null,
        };
        rows.push({ sheet_row_index: startRow + i, ...fields, row_hash: hashRow(fields) });
```

Also update the file-top comment ("FIVE mapped columns" description) to name the new columns. Note `fullSync`/`topUp`/`stampRows` now reference removed helpers — Task 4 fixes them; for THIS task's test run that's fine because the parse test imports only the helpers (ESM module-level code still parses).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run test/google-sheets-parse.test.mjs`
Expected: PASS (all describe blocks). If `stampRows` references break the module import, apply Task 4's deletion of `stampRows` early (move that single change here).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/google-sheets-sync.js backend/test/google-sheets-parse.test.mjs
git commit -m "feat(call-reporting): parse Date+Created Time, Yes/No call buckets, pipeline name"
```

---

### Task 3: Repository — per-source CRUD, new lead shape, RPC p_source

**Files:**
- Modify: `backend/src/repositories/sheet.repository.js` (full rework)
- Test: `backend/test/sheet.repository.test.mjs` (rewrite)

**Interfaces:**
- Produces (consumed by Tasks 4/5):
  - `listSources(orgId) -> row[]` (ordered by `practice_label`)
  - `getSourceById(orgId, sourceId) -> row|null`
  - `createSource(orgId, {spreadsheet_id, spreadsheet_url, title, sheet_timezone, practice_label}) -> row` (upsert on `organisation_id,spreadsheet_id`, status `pending`)
  - `updateSource(orgId, sourceId, patch)` — NOTE the new middle argument
  - `deleteSource(orgId, sourceId)` / `deleteAllSources(orgId)`
  - `deleteLeadsBySource(orgId, sourceId)` / `deleteAllLeads(orgId)` / `deleteLeadsBeyondRow(orgId, sourceId, lastRow)` (unchanged)
  - `upsertLeads(orgId, sourceId, rows)` — rows carry `{created_at, called_3m, called_10m, pipeline_name, sheet_row_index, row_hash}`
  - `leadHashesBySource(orgId, sourceId)` (unchanged), `listConfiguredSources()` (unchanged)
  - `dashboard(orgId, {date, sourceId = null, tz}) -> row|null` (RPC param `p_source`)
- Removes: `getSource`, all `sheet_practice_map` methods (`listPracticeMap`, `discoverPracticeValues`, `setPracticeMapping`, `deletePracticeMap`, `practiceResolutionMap`, `practiceOptions`), `restampPractices`.

- [ ] **Step 1: Rewrite the test file with failing tests**

Replace the entire contents of `backend/test/sheet.repository.test.mjs` with:

```js
// Sheet repository (Call Reporting v2) — tenant isolation (rule 3: explicit
// organisation_id on EVERY query), per-source scoping, upsert conflict
// targets, and RPC params for the 10-card dashboard.
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';
const SOURCE = '00000000-0000-0000-0000-0000000000aa';

let repo;
beforeEach(async () => {
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcCalls = [];
  supaRec.rpcProvider = null;
  ({ sheetRepository: repo } = await import('../src/repositories/sheet.repository.js'));
});

describe('sheet_sources', () => {
  it('listSources + getSourceById filter by organisation_id (rule 3)', async () => {
    await repo.listSources(ORG);
    expect(supaRec.last.table).toBe('sheet_sources');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    supaRec.resultProvider = () => ({ data: null, error: null });
    await repo.getSourceById(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: SOURCE });
  });
  it('createSource upserts on (organisation_id, spreadsheet_id) with the label', async () => {
    supaRec.resultProvider = () => ({ data: { id: SOURCE }, error: null });
    await repo.createSource(ORG, { spreadsheet_id: 'abc123', title: 'T', practice_label: 'Barnet' });
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,spreadsheet_id');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals.practice_label).toBe('Barnet');
    expect(supaRec.last.upsertVals.status).toBe('pending');
  });
  it('updateSource + deleteSource scope to org AND source id', async () => {
    await repo.updateSource(ORG, SOURCE, { status: 'active' });
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: SOURCE });
    await repo.deleteSource(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: SOURCE });
  });
  it('deleteAllSources deletes ONLY the given org', async () => {
    await repo.deleteAllSources(ORG);
    expect(supaRec.last.table).toBe('sheet_sources');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).not.toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('sheet_leads', () => {
  it('leadHashesBySource scopes to org + source (rule 3)', async () => {
    supaRec.resultProvider = () => ({ data: [{ sheet_row_index: 2, row_hash: 'h' }], error: null });
    const map = await repo.leadHashesBySource(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'source_id', val: SOURCE });
    expect(map.get(2)).toBe('h');
  });
  it('upsertLeads targets (source_id, sheet_row_index) and stores the v2 fields only', async () => {
    await repo.upsertLeads(ORG, SOURCE, [{
      sheet_row_index: 2, row_hash: 'h', created_at: '2026-08-01T08:00:00.000Z',
      called_3m: true, called_10m: false, pipeline_name: 'Facebook Ads',
    }]);
    expect(supaRec.last.upsertOpts.onConflict).toBe('source_id,sheet_row_index');
    const row = supaRec.last.upsertVals[0];
    expect(row.organisation_id).toBe(ORG);
    expect(row.source_id).toBe(SOURCE);
    expect(row.called_3m).toBe(true);
    expect(row.called_10m).toBe(false);
    expect(row.pipeline_name).toBe('Facebook Ads');
    expect(row).not.toHaveProperty('practice_id');
    expect(row).not.toHaveProperty('first_call_at');
    expect(row).not.toHaveProperty('lead_source');
  });
  it('deleteLeadsBySource + deleteAllLeads scope to the org (cross-org isolation)', async () => {
    await repo.deleteLeadsBySource(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'source_id', val: SOURCE });
    await repo.deleteAllLeads(ORG);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).not.toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('aggregates (RPC)', () => {
  it('dashboard calls sheet_leads_dashboard with org/date/source/tz', async () => {
    supaRec.rpcProvider = () => ({ data: [{ total: 6, called_3m: 2, office_time: 3 }], error: null });
    const row = await repo.dashboard(ORG, { date: '2026-07-31', sourceId: SOURCE });
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('sheet_leads_dashboard');
    expect(call.params).toMatchObject({ p_org: ORG, p_date: '2026-07-31', p_source: SOURCE, p_tz: 'Europe/London' });
    expect(row.total).toBe(6);
    expect(row.office_time).toBe(3);
  });
  it('dashboard passes p_source null for the all-practices view', async () => {
    supaRec.rpcProvider = () => ({ data: [{ total: 0 }], error: null });
    await repo.dashboard(ORG, { date: '2026-07-31' });
    expect(supaRec.rpcCalls.at(-1).params.p_source).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/sheet.repository.test.mjs`
Expected: FAIL — `listSources`, `getSourceById` etc. are not functions.

- [ ] **Step 3: Rework the repository**

Rewrite `backend/src/repositories/sheet.repository.js` keeping the file-top comment (update its practice-map sentence) and the `PAGE` pagination pattern:

```js
import * as supabase_1 from "../lib/supabase.js";

const PAGE = 1000; // PostgREST db-max-rows — any larger read MUST paginate

export const sheetRepository = {
    // ---- sheet_sources (one per practice, N per org) -----------------------
    async listSources(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('*')
            .eq('organisation_id', orgId)
            .order('practice_label', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async getSourceById(orgId, sourceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('id', sourceId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ?? null;
    },

    async createSource(orgId, { spreadsheet_id, spreadsheet_url, title, sheet_timezone, practice_label }) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .upsert({
                organisation_id: orgId,
                spreadsheet_id,
                spreadsheet_url: spreadsheet_url ?? null,
                title: title ?? null,
                sheet_timezone: sheet_timezone ?? null,
                practice_label: practice_label ?? null,
                status: 'pending',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,spreadsheet_id' })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async updateSource(orgId, sourceId, patch) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('organisation_id', orgId)
            .eq('id', sourceId);
        if (error) throw new Error(error.message);
    },

    async deleteSource(orgId, sourceId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .delete()
            .eq('organisation_id', orgId)
            .eq('id', sourceId);
        if (error) throw new Error(error.message);
    },

    async deleteAllSources(orgId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .delete()
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    // Worker fan-out: every source with a saved mapping, INCLUDING status
    // 'failed' (a transient failure must not freeze a source out of retries).
    async listConfiguredSources() {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('id, organisation_id, status')
            .not('column_mapping', 'is', null);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // ---- sheet_leads --------------------------------------------------------
    // (leadHashesBySource UNCHANGED from v1 — keep the paginated .range() loop)

    async upsertLeads(orgId, sourceId, rows) {
        if (!rows?.length) return;
        const now = new Date().toISOString();
        const payload = rows.map((r) => ({
            organisation_id: orgId,
            source_id: sourceId,
            created_at: r.created_at,
            called_3m: r.called_3m ?? false,
            called_10m: r.called_10m ?? false,
            pipeline_name: r.pipeline_name ?? null,
            sheet_row_index: r.sheet_row_index,
            row_hash: r.row_hash,
            synced_at: now,
        }));
        const { error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .upsert(payload, { onConflict: 'source_id,sheet_row_index' });
        if (error) throw new Error(error.message);
    },

    // (deleteLeadsBeyondRow UNCHANGED from v1)

    async deleteLeadsBySource(orgId, sourceId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .delete()
            .eq('organisation_id', orgId)
            .eq('source_id', sourceId);
        if (error) throw new Error(error.message);
    },

    // (deleteAllLeads UNCHANGED from v1)

    // ---- aggregates ---------------------------------------------------------
    async dashboard(orgId, { date, sourceId = null, tz = 'Europe/London' }) {
        const { data, error } = await supabase_1.serviceClient.rpc('sheet_leads_dashboard', {
            p_org: orgId,
            p_date: date,
            p_source: sourceId,
            p_tz: tz,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return row ?? null;
    },
};
```

Copy `leadHashesBySource`, `deleteLeadsBeyondRow`, `deleteAllLeads` verbatim from the v1 file where marked UNCHANGED. Delete everything else that isn't listed (all practice-map methods, `getSource`, `restampPractices`).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run test/sheet.repository.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/sheet.repository.js backend/test/sheet.repository.test.mjs
git commit -m "feat(call-reporting): per-source repository, v2 lead shape, p_source dashboard RPC"
```

---

### Task 4: Sync paths — per-source fullSync / topUp / topUpAll / syncAllOrgs

**Files:**
- Modify: `backend/src/lib/integrations/google-sheets-sync.js` (sync-paths section, below the API-reads section)

**Interfaces:**
- Consumes: Task 3 repository (`getSourceById`, `updateSource(orgId, sourceId, patch)`, `listSources`, `upsertLeads`, `leadHashesBySource`, `deleteLeadsBeyondRow`, `listConfiguredSources`).
- Produces (consumed by Task 5 service and the worker):
  - `fullSync(orgId, sourceId) -> {ok|skipped, ...counts}`
  - `topUp(orgId, source) -> {ok|skipped, added?}` — takes the SOURCE ROW (callers already hold it); debounce key `` `${orgId}:${source.id}` ``
  - `topUpAll(orgId) -> {ok: boolean}` — top-up every configured source, never throws
  - `syncAllOrgs() -> results[]` — unchanged name/signature (worker `workers/index.js:336` keeps working untouched)

- [ ] **Step 1: Rework the sync paths**

In `google-sheets-sync.js`:

1. Delete the `stampRows` function entirely (practice stamping is gone).
2. Replace `fullSync` with (same page-loop/diff/delete-beyond structure; changes: source lookup by id, `updateSource` three-arg, no `stampRows` — upsert `page.rows` directly):

```js
export async function fullSync(orgId, sourceId) {
    const source = await sheetRepository.getSourceById(orgId, sourceId);
    if (!source) return { skipped: 'no_source' };
    if (!source.column_mapping || !source.tab_name) return { skipped: 'not_configured' };
    const tz = source.sheet_timezone || DEFAULT_TZ;
    try {
        const meta = await getMeta(orgId, source.spreadsheet_id);
        if (!meta.tabs.some((t) => t.title === source.tab_name)) {
            throw new Error(`Tab "${source.tab_name}" no longer exists in the sheet`);
        }
        const existing = await sheetRepository.leadHashesBySource(orgId, source.id);

        let start = source.header_row + 1;
        let lastDataRow = source.header_row;
        let skipped = 0;
        let upserted = 0;
        let seen = 0;
        for (;;) {
            const end = start + PAGE_ROWS - 1;
            const columns = await fetchMappedPage(orgId, source, start, end);
            const page = parsePage(columns, start, tz);
            skipped += page.skipped;
            if (page.lastDataRow > lastDataRow) lastDataRow = page.lastDataRow;
            seen += page.rows.length;
            const changed = page.rows.filter((r) => existing.get(r.sheet_row_index) !== r.row_hash);
            for (let i = 0; i < changed.length; i += UPSERT_CHUNK) {
                await sheetRepository.upsertLeads(orgId, source.id, changed.slice(i, i + UPSERT_CHUNK));
            }
            upserted += changed.length;
            const pageLen = Math.max(...MAPPED_FIELDS.map((f) => columns[f]?.length ?? 0), 0);
            if (pageLen < PAGE_ROWS) break;   // trailing page — no more data
            start = end + 1;
        }

        const deleted = await sheetRepository.deleteLeadsBeyondRow(orgId, source.id, lastDataRow);
        await sheetRepository.updateSource(orgId, source.id, {
            title: meta.title ?? source.title,
            sheet_timezone: meta.timezone ?? source.sheet_timezone,
            status: 'active',
            last_error: null,
            last_synced_row: lastDataRow,
            row_count: seen,
            skipped_rows: skipped,
            last_synced_at: new Date().toISOString(),
        });
        console.log(`[sheets-sync] org=${orgId} source=${source.id} full sync ok: rows=${seen} changed=${upserted} deleted=${deleted} skipped=${skipped}`);
        return { ok: true, rows: seen, changed: upserted, deleted, skipped };
    } catch (err) {
        await sheetRepository.updateSource(orgId, source.id, {
            status: 'failed',
            last_error: String(err.message ?? err).slice(0, 500),
        }).catch(() => {});
        throw err;
    }
}
```

3. Replace `topUp` with a source-row variant (same body; debounce key includes the source id, `updateSource` three-arg, no `stampRows`):

```js
// In-memory debounce for the on-view top-up (per process, per org+source).
const lastTopUp = new Map();

// Append-only read of rows after last_synced_row for ONE source. Cheap
// regardless of sheet size; failures degrade gracefully (cached data renders).
export async function topUp(orgId, source) {
    if (!source?.column_mapping || !source.tab_name || source.status === 'pending') {
        return { skipped: 'not_configured' };
    }
    const key = `${orgId}:${source.id}`;
    const last = lastTopUp.get(key) ?? 0;
    if (Date.now() - last < 60_000) return { skipped: 'debounced' };
    lastTopUp.set(key, Date.now());
    try {
        const tz = source.sheet_timezone || DEFAULT_TZ;
        const start = Math.max(source.last_synced_row, source.header_row) + 1;
        const columns = await fetchMappedPage(orgId, source, start, start + TOPUP_ROWS - 1);
        const page = parsePage(columns, start, tz);
        if (page.rows.length === 0 && page.skipped === 0) return { ok: true, added: 0 };
        for (let i = 0; i < page.rows.length; i += UPSERT_CHUNK) {
            await sheetRepository.upsertLeads(orgId, source.id, page.rows.slice(i, i + UPSERT_CHUNK));
        }
        const lastDataRow = Math.max(page.lastDataRow, source.last_synced_row);
        await sheetRepository.updateSource(orgId, source.id, {
            last_synced_row: lastDataRow,
            row_count: source.row_count + page.rows.length,
            skipped_rows: source.skipped_rows + page.skipped,
            last_synced_at: new Date().toISOString(),
        });
        return { ok: true, added: page.rows.length };
    } catch (err) {
        // Never block the dashboard on a top-up failure — log count-free.
        console.error(`[sheets-sync] org=${orgId} source=${source.id} top-up failed: ${err.message}`);
        return { ok: false, error: err.message };
    }
}

// Dashboard freshness: top-up every configured source. Never throws.
export async function topUpAll(orgId) {
    const sources = await sheetRepository.listSources(orgId);
    let ok = true;
    for (const s of sources) {
        const r = await topUp(orgId, s);
        if (r?.ok === false) ok = false;
    }
    return { ok };
}
```

4. Update `syncAllOrgs` to fan out per source (keep the per-item error isolation):

```js
export async function syncAllOrgs() {
    const sources = await sheetRepository.listConfiguredSources();
    const results = [];
    for (const s of sources) {
        try {
            const r = await fullSync(s.organisation_id, s.id);
            results.push({ orgId: s.organisation_id, sourceId: s.id, ...r });
        } catch (err) {
            console.error(`[sheets-sync] org=${s.organisation_id} source=${s.id} nightly sync failed: ${err.message}`);
            results.push({ orgId: s.organisation_id, sourceId: s.id, error: err.message });
        }
    }
    return results;
}
```

Also update the file-top comment's three-path description (fullSync/topUp are per-source now). `workers/index.js` needs NO change (it calls `syncAllOrgs()`).

- [ ] **Step 2: Verify the module still parses and parse tests still pass**

Run: `cd backend && node --check src/lib/integrations/google-sheets-sync.js && npx vitest run test/google-sheets-parse.test.mjs`
Expected: PASS. (`sheet.service.test.mjs` will fail until Task 5 — expected.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/integrations/google-sheets-sync.js
git commit -m "feat(call-reporting): per-source sync paths (fullSync/topUp/topUpAll/syncAllOrgs)"
```

---

### Task 5: Model + service — sources list, per-source ops, 10-card dashboard

**Files:**
- Modify: `backend/src/models/sheet.model.js`
- Modify: `backend/src/services/sheet.service.js`
- Test: `backend/test/sheet.service.test.mjs` (rewrite)

**Interfaces:**
- Consumes: Task 3 repository, Task 4 `fullSync(orgId, sourceId)` / `topUpAll(orgId)`, unchanged `getMeta`/`getPreview`/`getAccessToken`/`parseSpreadsheetId`.
- Produces (consumed by Task 6 controller and the frontend):
  - Zod: `sheetSourceCreateSchema` `{url, practice_label}`; `sheetSourceIdSchema` `{id: uuid}`; `sheetMappingSchema` columns `{date, created_time, called_3m, called_10m, pipeline_name}` (distinct refine kept); `callReportingQuerySchema` `{date?, source?}` (uuid, `''`→undefined). `sheetPracticeMapSetSchema` deleted.
  - Service: `status(orgId) -> {connected, connectionStatus, connectionError, sources: SafeSource[]}`; `addSource(orgId, {url, practice_label}) -> {ok, id, title, tabs}`; `preview(orgId, {sourceId, tab})`; `saveMapping(orgId, {sourceId, tab_name, header_row, columns})`; `syncNow(orgId, sourceId)`; `removeSource(orgId, sourceId)`; `disconnect(orgId)`; `dashboard(orgId, {date, sourceId})` returning the 10 cards + `sources[]` + `syncFailed` + `lastSyncedAt` + `topUpOk`. `SafeSource` includes `id`, `practice_label`, `mapped` (plus all v1 safe fields). `pickerConfig` unchanged.

- [ ] **Step 1: Rewrite the service test file with failing tests**

Replace the entire contents of `backend/test/sheet.service.test.mjs` with:

```js
// Sheet service (Call Reporting v2) — 10-card dashboard shaping + efficiency %,
// per-source operations, the not-configured path, disconnect purge order, and
// the no-token-leak guarantee on the status endpoint.
import './setup.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORG = '00000000-0000-0000-0000-000000000001';
const SRC = '00000000-0000-0000-0000-0000000000aa';
const SRC2 = '00000000-0000-0000-0000-0000000000ab';

const repoMock = {
  listSources: vi.fn().mockResolvedValue([]),
  getSourceById: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  deleteAllSources: vi.fn(),
  deleteLeadsBySource: vi.fn(),
  deleteAllLeads: vi.fn(),
  dashboard: vi.fn(),
};
const integrationRepoMock = {
  getByProvider: vi.fn(),
  markRevoked: vi.fn(),
};
const syncMock = {
  getMeta: vi.fn(),
  getPreview: vi.fn(),
  fullSync: vi.fn().mockResolvedValue({ ok: true }),
  topUp: vi.fn().mockResolvedValue({ ok: true, added: 0 }),
  topUpAll: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock('../src/repositories/sheet.repository.js', () => ({ sheetRepository: repoMock }));
vi.mock('../src/repositories/integration.repository.js', () => ({ integrationRepository: integrationRepoMock }));
vi.mock('../src/lib/integrations/google-sheets-sync.js', () => syncMock);

const { sheetService } = await import('../src/services/sheet.service.js');

const CONNECTED = { status: 'active', secrets: 'ENCRYPTED-BLOB', last_error: null };
const SOURCE = {
  id: SRC, practice_label: 'Barnet', spreadsheet_id: 'abc123', title: 'Barnet Leads',
  tab_name: 'Lead_Conversion_Tracking',
  column_mapping: { date: 0, created_time: 4, called_3m: 5, called_10m: 6, pipeline_name: 7 },
  header_row: 1, last_synced_row: 100, row_count: 100, skipped_rows: 0,
  status: 'active', last_error: null, last_synced_at: '2026-08-04T06:00:00.000Z',
  sheet_timezone: 'Europe/London',
};

beforeEach(() => {
  vi.clearAllMocks();
  integrationRepoMock.getByProvider.mockResolvedValue(CONNECTED);
  repoMock.listSources.mockResolvedValue([SOURCE]);
  repoMock.getSourceById.mockResolvedValue(SOURCE);
  syncMock.topUpAll.mockResolvedValue({ ok: true });
  syncMock.fullSync.mockResolvedValue({ ok: true });
});

describe('dashboard', () => {
  it('shapes the ten cards and computes efficiency % (2/6 -> 33.3)', async () => {
    repoMock.dashboard.mockResolvedValue({
      total: 6, called_3m: 2, called_10m: 0, in_pipeline: 6, not_called: 4,
      office_time: 3, outside_office: 3, facebook: 5, google: 1,
    });
    const out = await sheetService.dashboard(ORG, { date: '2026-07-31', sourceId: SRC });
    expect(out).toMatchObject({
      configured: true, date: '2026-07-31', sourceId: SRC,
      totalLeads: 6, calledWithin3m: 2, calledWithin10m: 0, efficiencyPct: 33.3,
      leadsInPipeline: 6, notCalled: 4, officeTimeLeads: 3, outsideOfficeTime: 3,
      facebookLeads: 5, googleLeads: 1, syncFailed: false, topUpOk: true,
    });
    expect(out.sources).toEqual([
      { id: SRC, practice_label: 'Barnet', status: 'active', last_synced_at: SOURCE.last_synced_at, mapped: true },
    ]);
    expect(syncMock.topUpAll).toHaveBeenCalledWith(ORG);
    expect(repoMock.dashboard).toHaveBeenCalledWith(ORG, {
      date: '2026-07-31', sourceId: SRC, tz: 'Europe/London',
    });
  });
  it('efficiency is 0 (not NaN) when there are no leads', async () => {
    repoMock.dashboard.mockResolvedValue({ total: 0, called_3m: 0 });
    const out = await sheetService.dashboard(ORG, {});
    expect(out.efficiencyPct).toBe(0);
    expect(out.totalLeads).toBe(0);
  });
  it('returns configured:false when no source has a mapping (no RPC call)', async () => {
    repoMock.listSources.mockResolvedValue([{ ...SOURCE, column_mapping: null }]);
    const out = await sheetService.dashboard(ORG, {});
    expect(out.configured).toBe(false);
    expect(repoMock.dashboard).not.toHaveBeenCalled();
  });
  it('flags syncFailed when any source failed, still serves data', async () => {
    repoMock.listSources.mockResolvedValue([SOURCE, { ...SOURCE, id: SRC2, practice_label: 'Ashford', status: 'failed' }]);
    repoMock.dashboard.mockResolvedValue({ total: 5, called_3m: 1 });
    const out = await sheetService.dashboard(ORG, {});
    expect(out.syncFailed).toBe(true);
    expect(out.totalLeads).toBe(5);
  });
  it('still serves cached data when the top-up fails', async () => {
    syncMock.topUpAll.mockResolvedValue({ ok: false });
    repoMock.dashboard.mockResolvedValue({ total: 5, called_3m: 1 });
    const out = await sheetService.dashboard(ORG, { date: '2026-07-31' });
    expect(out.totalLeads).toBe(5);
    expect(out.topUpOk).toBe(false);
  });
});

describe('status', () => {
  it('lists sources and never exposes token material', async () => {
    const out = await sheetService.status(ORG);
    expect(out.connected).toBe(true);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ id: SRC, practice_label: 'Barnet', mapped: true });
    const flat = JSON.stringify(out);
    expect(flat).not.toContain('ENCRYPTED-BLOB');
    expect(flat).not.toContain('secrets');
    expect(flat).not.toContain('access_token');
    expect(flat).not.toContain('refresh_token');
  });
});

describe('addSource', () => {
  it('rejects a non-sheet URL with a 400', async () => {
    await expect(sheetService.addSource(ORG, { url: 'https://example.com/x', practice_label: 'Barnet' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(repoMock.createSource).not.toHaveBeenCalled();
  });
  it('validates reachability before persisting, stores id + label, returns tabs', async () => {
    syncMock.getMeta.mockResolvedValue({ title: 'Leads', timezone: 'Europe/London', tabs: [{ title: 'Data' }] });
    repoMock.createSource.mockResolvedValue({ ...SOURCE, id: SRC2 });
    const out = await sheetService.addSource(ORG, {
      url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit', practice_label: 'Ashford',
    });
    expect(repoMock.createSource).toHaveBeenCalledWith(ORG, expect.objectContaining({
      spreadsheet_id: '1AbC_d-EfGhIjK123', practice_label: 'Ashford',
    }));
    expect(out.id).toBe(SRC2);
    expect(out.tabs).toEqual(['Data']);
  });
  it('refuses when Google Sheets is not connected', async () => {
    integrationRepoMock.getByProvider.mockResolvedValue(null);
    await expect(sheetService.addSource(ORG, {
      url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit', practice_label: 'Barnet',
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('saveMapping / syncNow / removeSource', () => {
  it('saves the mapping on THAT source, resets the cursor, starts its full sync', async () => {
    const out = await sheetService.saveMapping(ORG, {
      sourceId: SRC, tab_name: 'Lead_Conversion_Tracking', header_row: 1,
      columns: { date: 0, created_time: 4, called_3m: 5, called_10m: 6, pipeline_name: 7 },
    });
    expect(repoMock.updateSource).toHaveBeenCalledWith(ORG, SRC, expect.objectContaining({
      tab_name: 'Lead_Conversion_Tracking', last_synced_row: 0, status: 'pending',
    }));
    expect(syncMock.fullSync).toHaveBeenCalledWith(ORG, SRC);
    expect(out.syncStarted).toBe(true);
  });
  it('syncNow refuses before that source is mapped', async () => {
    repoMock.getSourceById.mockResolvedValue({ ...SOURCE, column_mapping: null });
    await expect(sheetService.syncNow(ORG, SRC)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('syncNow 404s on an unknown source id', async () => {
    repoMock.getSourceById.mockResolvedValue(null);
    await expect(sheetService.syncNow(ORG, SRC2)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('removeSource purges that source\'s leads then the source', async () => {
    const out = await sheetService.removeSource(ORG, SRC);
    expect(repoMock.deleteLeadsBySource).toHaveBeenCalledWith(ORG, SRC);
    expect(repoMock.deleteSource).toHaveBeenCalledWith(ORG, SRC);
    expect(out.ok).toBe(true);
  });
});

describe('disconnect', () => {
  it('purges all leads + sources then revokes the token', async () => {
    await sheetService.disconnect(ORG);
    expect(repoMock.deleteAllLeads).toHaveBeenCalledWith(ORG);
    expect(repoMock.deleteAllSources).toHaveBeenCalledWith(ORG);
    expect(integrationRepoMock.markRevoked).toHaveBeenCalledWith(ORG, 'google_sheets');
  });
});

describe('pickerConfig', () => {
  it('is disabled (and token-free) until GOOGLE_PICKER_API_KEY is set', async () => {
    delete process.env.GOOGLE_PICKER_API_KEY;
    const out = await sheetService.pickerConfig(ORG);
    expect(out).toEqual({ enabled: false });
  });
  it('returns the browser key + a decrypted short-lived access token when configured', async () => {
    process.env.GOOGLE_PICKER_API_KEY = 'browser-key';
    process.env.GOOGLE_CLOUD_PROJECT_NUMBER = '122855749965';
    try {
      const { encryptSecret } = await import('../src/lib/crypto.js');
      integrationRepoMock.getByProvider.mockResolvedValue({
        status: 'active',
        secrets: encryptSecret(JSON.stringify({ access_token: 'live-token', refresh_token: 'refresh' })),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      const out = await sheetService.pickerConfig(ORG);
      expect(out).toMatchObject({ enabled: true, apiKey: 'browser-key', appId: '122855749965', accessToken: 'live-token' });
      expect(JSON.stringify(out)).not.toContain('refresh');
    } finally {
      delete process.env.GOOGLE_PICKER_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    }
  });
});

describe('sheetMappingSchema', () => {
  it('accepts the v2 keys and rejects duplicate columns', async () => {
    const { sheetMappingSchema } = await import('../src/models/sheet.model.js');
    const good = {
      tab_name: 'Data', header_row: 1,
      columns: { date: 0, created_time: 4, called_3m: 5, called_10m: 6, pipeline_name: 7 },
    };
    expect(() => sheetMappingSchema.parse(good)).not.toThrow();
    const bad = { ...good, columns: { ...good.columns, created_time: 0 } };
    expect(() => sheetMappingSchema.parse(bad)).toThrow();
  });
  it('sheetSourceCreateSchema requires a practice label', async () => {
    const { sheetSourceCreateSchema } = await import('../src/models/sheet.model.js');
    expect(() => sheetSourceCreateSchema.parse({ url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit' })).toThrow();
    expect(() => sheetSourceCreateSchema.parse({
      url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit', practice_label: '  Barnet ',
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/sheet.service.test.mjs`
Expected: FAIL — service still expects `getSource`/`topUp`, mapping keys mismatch.

- [ ] **Step 3: Update the Zod model**

In `backend/src/models/sheet.model.js`: replace `sheetSourceCreateSchema`, `sheetMappingSchema`, `callReportingQuerySchema`; add `sheetSourceIdSchema`; delete `sheetPracticeMapSetSchema`:

```js
// Paste-a-URL source registration (full URL or bare spreadsheet id) + the
// practice this sheet belongs to (free-text label — deliberately NOT linked
// to the practices table; Call Reporting is self-contained).
export const sheetSourceCreateSchema = zod_1.z.object({
    url: zod_1.z.string().trim().min(10).max(500),
    practice_label: zod_1.z.string().trim().min(1).max(100),
});

export const sheetSourceIdSchema = zod_1.z.object({ id: uuid });

// One-time column mapping: 0-based column indexes for the five stored fields.
// Indexes must be distinct — two fields reading one column is a setup mistake.
const colIdx = zod_1.z.number().int().min(0).max(199);
export const sheetMappingSchema = zod_1.z.object({
    tab_name: zod_1.z.string().trim().min(1).max(200),
    header_row: zod_1.z.number().int().min(1).max(1000).default(1),
    columns: zod_1.z.object({
        date: colIdx,
        created_time: colIdx,
        called_3m: colIdx,
        called_10m: colIdx,
        pipeline_name: colIdx,
    }),
}).refine(
    (v) => new Set(Object.values(v.columns)).size === Object.values(v.columns).length,
    { message: 'each field must map to a different column' },
);

// Dashboard query: ?date=YYYY-MM-DD (default today, London) + optional sheet
// (source id = practice).
export const callReportingQuerySchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
    source: zod_1.z.preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        uuid.optional(),
    ),
});
```

- [ ] **Step 4: Rework the service**

In `backend/src/services/sheet.service.js` (imports gain `topUpAll` in place of `topUp`; `fullSync` stays):

1. `safeSource` — add `id`, `practice_label`, `mapped`:

```js
function safeSource(source) {
    if (!source) return null;
    return {
        id: source.id,
        practice_label: source.practice_label,
        spreadsheet_id: source.spreadsheet_id,
        spreadsheet_url: source.spreadsheet_url,
        title: source.title,
        tab_name: source.tab_name,
        sheet_timezone: source.sheet_timezone,
        column_mapping: source.column_mapping,
        header_row: source.header_row,
        row_count: source.row_count,
        skipped_rows: source.skipped_rows,
        status: source.status,
        last_error: source.last_error,
        last_synced_at: source.last_synced_at,
        mapped: !!source.column_mapping,
    };
}
```

2. Replace `status`, `addSource`, `preview`, `saveMapping`, `syncNow`, `disconnect`, `dashboard`; delete `listPracticeMap`/`setPracticeMapping`; add `removeSource`. (`pickerConfig`, `requireConnected`, `todayLondon` unchanged.)

```js
    // Panel state: connection + every connected sheet in one call.
    async status(orgId) {
        const [integration, sources] = await Promise.all([
            integrationRepository.getByProvider(orgId, PROVIDER_ID),
            sheetRepository.listSources(orgId),
        ]);
        const connected = !!integration && integration.status !== 'revoked' && !!integration.secrets;
        return {
            connected,
            connectionStatus: integration?.status ?? null,
            connectionError: integration?.last_error ?? null,
            sources: sources.map(safeSource),
        };
    },

    // Register one practice's sheet. Validates reachability with a metadata
    // read BEFORE persisting and returns the tab list for the mapping step.
    async addSource(orgId, { url, practice_label }) {
        await requireConnected(orgId);
        const spreadsheetId = parseSpreadsheetId(url);
        if (!spreadsheetId) throw new AppError('That does not look like a Google Sheets URL', 400);
        let meta;
        try {
            meta = await getMeta(orgId, spreadsheetId);
        } catch (err) {
            throw new AppError(`Could not open that sheet: ${err.message}`, 400);
        }
        const row = await sheetRepository.createSource(orgId, {
            spreadsheet_id: spreadsheetId,
            spreadsheet_url: url.startsWith('http') ? url : null,
            title: meta.title,
            sheet_timezone: meta.timezone,
            practice_label,
        });
        return { ok: true, id: row.id, title: meta.title, tabs: meta.tabs.map((t) => t.title) };
    },

    // First rows of a tab for the mapping UI. Ephemeral — never stored.
    async preview(orgId, { sourceId, tab }) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSourceById(orgId, sourceId);
        if (!source) throw new AppError('Sheet not found', 404);
        const rows = await getPreview(orgId, source.spreadsheet_id, tab);
        return { tab, rows };
    },

    // Save the one-time column mapping for one sheet, then kick its full sync
    // (fire-and-forget — the panel polls status; last_error lands on the source).
    async saveMapping(orgId, { sourceId, tab_name, header_row, columns }) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSourceById(orgId, sourceId);
        if (!source) throw new AppError('Sheet not found', 404);
        await sheetRepository.updateSource(orgId, sourceId, {
            tab_name,
            header_row,
            column_mapping: columns,
            status: 'pending',
            last_error: null,
            last_synced_row: 0,
        });
        fullSync(orgId, sourceId).catch((err) => {
            console.error(`[sheets] org=${orgId} source=${sourceId} post-mapping sync failed: ${err.message}`);
        });
        return { ok: true, syncStarted: true };
    },

    // Manual "Refresh now" for one sheet — full re-sync, fire-and-forget.
    async syncNow(orgId, sourceId) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSourceById(orgId, sourceId);
        if (!source) throw new AppError('Sheet not found', 404);
        if (!source.column_mapping) throw new AppError('Finish the column mapping first', 409);
        fullSync(orgId, sourceId).catch((err) => {
            console.error(`[sheets] org=${orgId} source=${sourceId} manual sync failed: ${err.message}`);
        });
        return { started: true };
    },

    // Remove ONE practice's sheet: its synced rows, then the source row.
    async removeSource(orgId, sourceId) {
        await sheetRepository.deleteLeadsBySource(orgId, sourceId);
        await sheetRepository.deleteSource(orgId, sourceId);
        return { ok: true };
    },

    // Disconnect = clean exit: purge every synced row and every source, then
    // revoke the integration (markRevoked nulls the secrets).
    async disconnect(orgId) {
        await sheetRepository.deleteAllLeads(orgId);
        await sheetRepository.deleteAllSources(orgId);
        await integrationRepository.markRevoked(orgId, PROVIDER_ID);
        return { ok: true };
    },

    // The ten cards. Runs the cheap append-only top-up on every configured
    // sheet first (debounced; failure degrades to cached data) then ONE
    // aggregate RPC round trip. sourceId null = all practices.
    async dashboard(orgId, { date, sourceId }) {
        const sources = await sheetRepository.listSources(orgId);
        if (!sources.some((s) => s.column_mapping)) {
            return { configured: false };
        }
        const freshness = await topUpAll(orgId);
        const day = date ?? todayLondon();
        const row = await sheetRepository.dashboard(orgId, {
            date: day,
            sourceId: sourceId ?? null,
            tz: LONDON_TZ,
        });
        const total = Number(row?.total ?? 0);
        const called3m = Number(row?.called_3m ?? 0);
        return {
            configured: true,
            date: day,
            sourceId: sourceId ?? null,
            totalLeads: total,
            calledWithin3m: called3m,
            calledWithin10m: Number(row?.called_10m ?? 0),
            efficiencyPct: total > 0 ? Math.round((called3m / total) * 1000) / 10 : 0,
            leadsInPipeline: Number(row?.in_pipeline ?? 0),
            notCalled: Number(row?.not_called ?? 0),
            officeTimeLeads: Number(row?.office_time ?? 0),
            outsideOfficeTime: Number(row?.outside_office ?? 0),
            facebookLeads: Number(row?.facebook ?? 0),
            googleLeads: Number(row?.google ?? 0),
            sources: sources.map((s) => ({
                id: s.id,
                practice_label: s.practice_label,
                status: s.status,
                last_synced_at: s.last_synced_at,
                mapped: !!s.column_mapping,
            })),
            syncFailed: sources.some((s) => s.status === 'failed'),
            lastSyncedAt: sources.map((s) => s.last_synced_at).filter(Boolean).sort().at(-1) ?? null,
            topUpOk: freshness?.ok !== false,
        };
    },
```

Update the import line: `import { getMeta, getPreview, fullSync, topUpAll } from "../lib/integrations/google-sheets-sync.js";`

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && npx vitest run test/sheet.service.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/sheet.model.js backend/src/services/sheet.service.js backend/test/sheet.service.test.mjs
git commit -m "feat(call-reporting): multi-source service — per-sheet ops, 10-card dashboard"
```

---

### Task 6: Controller + routes + API docs

**Files:**
- Modify: `backend/src/controllers/sheets.controller.js`
- Modify: `backend/src/routes/integrations.routes.js:33-41`
- Modify: `docs/API.md:706-720` (the Google Sheets / Call Reporting sections)

**Interfaces:**
- Consumes: Task 5 service + Zod schemas (`sheetSourceIdSchema` validates `req.params`).
- Produces: the HTTP surface the frontend (Task 7) calls:
  - `GET /api/integrations/google-sheets/status` (owner|PM)
  - `GET /api/integrations/google-sheets/picker-config` (owner)
  - `POST /api/integrations/google-sheets/sources` (owner) `{url, practice_label}`
  - `GET /api/integrations/google-sheets/sources/:id/preview?tab=` (owner)
  - `PUT /api/integrations/google-sheets/sources/:id/mapping` (owner)
  - `POST /api/integrations/google-sheets/sources/:id/sync` (owner)
  - `DELETE /api/integrations/google-sheets/sources/:id` (owner)
  - `DELETE /api/integrations/google-sheets` (owner) — full disconnect
  - `GET /api/call-reporting/dashboard?date=&source=` (owner|PM)

- [ ] **Step 1: Update the controller**

Replace `addSource`, `preview`, `saveMapping`, `sync`, `dashboard`; delete `practiceMap`/`setPracticeMap`; add `removeSource`:

```js
    async addSource(req, res) {
        const body = sheet_model_1.sheetSourceCreateSchema.parse(req.body);
        console.log(`[sheets] addSource: orgId=${req.user.organisation_id}`);
        res.json(await sheetService.addSource(req.user.organisation_id, body));
    },

    async preview(req, res) {
        const { id } = sheet_model_1.sheetSourceIdSchema.parse(req.params);
        const query = sheet_model_1.sheetPreviewQuerySchema.parse(req.query);
        res.json(await sheetService.preview(req.user.organisation_id, { sourceId: id, tab: query.tab }));
    },

    async saveMapping(req, res) {
        const { id } = sheet_model_1.sheetSourceIdSchema.parse(req.params);
        const body = sheet_model_1.sheetMappingSchema.parse(req.body);
        console.log(`[sheets] saveMapping: orgId=${req.user.organisation_id}, source=${id}, tab=${body.tab_name}`);
        res.json(await sheetService.saveMapping(req.user.organisation_id, { sourceId: id, ...body }));
    },

    async sync(req, res) {
        const { id } = sheet_model_1.sheetSourceIdSchema.parse(req.params);
        console.log(`[sheets] manual sync: orgId=${req.user.organisation_id}, source=${id}`);
        res.json(await sheetService.syncNow(req.user.organisation_id, id));
    },

    async removeSource(req, res) {
        const { id } = sheet_model_1.sheetSourceIdSchema.parse(req.params);
        console.log(`[sheets] removeSource: orgId=${req.user.organisation_id}, source=${id}`);
        res.json(await sheetService.removeSource(req.user.organisation_id, id));
    },

    async dashboard(req, res) {
        const query = sheet_model_1.callReportingQuerySchema.parse(req.query);
        res.json(await sheetService.dashboard(req.user.organisation_id, {
            date: query.date,
            sourceId: query.source ?? null,
        }));
    },
```

(`status`, `pickerConfig`, `disconnect` bodies unchanged.)

- [ ] **Step 2: Update the routes**

Replace `integrations.routes.js` lines 33–41 with:

```js
router.get('/google-sheets/status', (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(sheetsController.status));
router.get('/google-sheets/picker-config', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.pickerConfig));
router.post('/google-sheets/sources', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.addSource));
router.get('/google-sheets/sources/:id/preview', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.preview));
router.put('/google-sheets/sources/:id/mapping', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.saveMapping));
router.post('/google-sheets/sources/:id/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.sync));
router.delete('/google-sheets/sources/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.removeSource));
router.delete('/google-sheets', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.disconnect));
```

- [ ] **Step 3: Update `docs/API.md`**

Rewrite the Google Sheets bullet list (lines 706–714) to the routes above — key points to state: `status` returns `{connected, connectionStatus, connectionError, sources[]}` (safe fields incl. `id`, `practice_label`, `mapped`); `sources` create body `{url, practice_label}` (one sheet per practice, self-contained label — no practices-table link); mapping body columns `{date, created_time, called_3m, called_10m, pipeline_name}`; per-source sync/delete; practice-map endpoints REMOVED. Update the `GET /api/call-reporting/dashboard` section (~line 716): query `?date=&source=`, response now the 10 cards (`officeTimeLeads`, `outsideOfficeTime` added — office hours Mon–Fri 09:00–17:00 London; `unmapped`/`practiceId` gone, `sourceId`/`sources[]`/`syncFailed` added).

- [ ] **Step 4: Syntax-check + full backend suite**

Run: `cd backend && npm run typecheck && npx vitest run test/sheet.service.test.mjs test/sheet.repository.test.mjs test/google-sheets-parse.test.mjs test/google-sheets-oauth-redirect.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/sheets.controller.js backend/src/routes/integrations.routes.js docs/API.md
git commit -m "feat(call-reporting): per-source routes + controller, API docs"
```

---

### Task 7: Frontend API layer — types, endpoints, hooks

**Files:**
- Modify: `frontend/features/call-reporting/api.ts` (rewrite)
- Modify: `frontend/features/call-reporting/hooks.ts` (rewrite)

**Interfaces:**
- Consumes: Task 6 HTTP surface.
- Produces (consumed by Tasks 8/9): `CallReportingDashboard` (10 cards + `sources` + `syncFailed`), `SheetSourceInfo` (with `id`, `practice_label`, `mapped`), `SheetsStatus` (`sources: SheetSourceInfo[]`), `SheetMappingInput` (v2 column keys), functions `fetchCallReportingDashboard(date, sourceId?)`, `fetchSheetsStatus`, `fetchSheetsPickerConfig`, `addSheetSource({url, practiceLabel})`, `fetchSheetPreview(sourceId, tab)`, `saveSheetMapping(sourceId, mapping)`, `syncSheetSource(sourceId)`, `removeSheetSource(sourceId)`, `disconnectSheets()`; hooks `useCallReportingDashboard(date, sourceId?)`, `useSheetsStatus`, `useSheetPreview(sourceId, tab)`, `useAddSheetSource`, `useSaveSheetMapping`, `useSheetSourceSync`, `useRemoveSheetSource`, `useSheetsDisconnect`.

- [ ] **Step 1: Rewrite `api.ts`**

```ts
import { api } from '@/lib/api';

// ---- Call Reporting dashboard ----------------------------------------------

export interface DashboardSourceInfo {
  id: string;
  practice_label: string | null;
  status: 'pending' | 'active' | 'failed';
  last_synced_at: string | null;
  mapped: boolean;
}

export interface CallReportingDashboard {
  configured: boolean;
  date: string;
  sourceId: string | null;
  totalLeads: number;
  calledWithin3m: number;
  calledWithin10m: number;
  efficiencyPct: number;
  leadsInPipeline: number;
  notCalled: number;
  officeTimeLeads: number;
  outsideOfficeTime: number;
  facebookLeads: number;
  googleLeads: number;
  sources: DashboardSourceInfo[];
  syncFailed: boolean;
  lastSyncedAt: string | null;
  topUpOk: boolean;
}

const EMPTY: CallReportingDashboard = {
  configured: false,
  date: '',
  sourceId: null,
  totalLeads: 0,
  calledWithin3m: 0,
  calledWithin10m: 0,
  efficiencyPct: 0,
  leadsInPipeline: 0,
  notCalled: 0,
  officeTimeLeads: 0,
  outsideOfficeTime: 0,
  facebookLeads: 0,
  googleLeads: 0,
  sources: [],
  syncFailed: false,
  lastSyncedAt: null,
  topUpOk: true,
};

export function fetchCallReportingDashboard(date: string, sourceId?: string): Promise<CallReportingDashboard> {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (sourceId) qs.set('source', sourceId);
  const q = qs.toString();
  return api<CallReportingDashboard>(`/api/call-reporting/dashboard${q ? `?${q}` : ''}`)
    .then((r) => ({ ...EMPTY, ...r }));
}

// ---- Google Sheets connection / setup --------------------------------------

export interface SheetSourceInfo {
  id: string;
  practice_label: string | null;
  spreadsheet_id: string;
  spreadsheet_url: string | null;
  title: string | null;
  tab_name: string | null;
  sheet_timezone: string | null;
  column_mapping: Record<string, number> | null;
  header_row: number;
  row_count: number;
  skipped_rows: number;
  status: 'pending' | 'active' | 'failed';
  last_error: string | null;
  last_synced_at: string | null;
  mapped: boolean;
}

export interface SheetsStatus {
  connected: boolean;
  connectionStatus: string | null;
  connectionError: string | null;
  sources: SheetSourceInfo[];
}

export function fetchSheetsStatus() {
  return api<SheetsStatus>('/api/integrations/google-sheets/status');
}

// Google Picker bootstrap (browse-and-pick instead of paste-URL). `enabled` is
// false until the operator sets GOOGLE_PICKER_API_KEY on the backend. The
// access token is short-lived — fetch fresh right before opening the picker.
export interface SheetsPickerConfig {
  enabled: boolean;
  apiKey?: string;
  appId?: string | null;
  accessToken?: string;
}

export function fetchSheetsPickerConfig() {
  return api<SheetsPickerConfig>('/api/integrations/google-sheets/picker-config');
}

export function addSheetSource({ url, practiceLabel }: { url: string; practiceLabel: string }) {
  return api<{ ok: boolean; id: string; title: string | null; tabs: string[] }>(
    '/api/integrations/google-sheets/sources',
    { method: 'POST', body: JSON.stringify({ url, practice_label: practiceLabel }) },
  );
}

export function fetchSheetPreview(sourceId: string, tab: string) {
  return api<{ tab: string; rows: string[][] }>(
    `/api/integrations/google-sheets/sources/${sourceId}/preview?tab=${encodeURIComponent(tab)}`,
  );
}

export interface SheetMappingInput {
  tab_name: string;
  header_row: number;
  columns: {
    date: number;
    created_time: number;
    called_3m: number;
    called_10m: number;
    pipeline_name: number;
  };
}

export function saveSheetMapping(sourceId: string, mapping: SheetMappingInput) {
  return api<{ ok: boolean; syncStarted: boolean }>(
    `/api/integrations/google-sheets/sources/${sourceId}/mapping`,
    { method: 'PUT', body: JSON.stringify(mapping) },
  );
}

export function syncSheetSource(sourceId: string) {
  return api<{ started: boolean }>(
    `/api/integrations/google-sheets/sources/${sourceId}/sync`,
    { method: 'POST' },
  );
}

export function removeSheetSource(sourceId: string) {
  return api<{ ok: boolean }>(
    `/api/integrations/google-sheets/sources/${sourceId}`,
    { method: 'DELETE' },
  );
}

export function disconnectSheets() {
  return api<{ ok: boolean }>('/api/integrations/google-sheets', { method: 'DELETE' });
}
```

- [ ] **Step 2: Rewrite `hooks.ts`**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addSheetSource,
  disconnectSheets,
  fetchCallReportingDashboard,
  fetchSheetPreview,
  fetchSheetsStatus,
  removeSheetSource,
  saveSheetMapping,
  syncSheetSource,
  type SheetMappingInput,
} from './api';

export function useCallReportingDashboard(date: string, sourceId?: string) {
  return useQuery({
    queryKey: ['call-reporting-dashboard', date || 'today', sourceId ?? 'all'],
    queryFn: () => fetchCallReportingDashboard(date, sourceId),
    staleTime: 30_000,
  });
}

export function useSheetsStatus() {
  return useQuery({
    queryKey: ['sheets-status'],
    queryFn: fetchSheetsStatus,
    staleTime: 15_000,
  });
}

export function useSheetPreview(sourceId: string | null, tab: string | null) {
  return useQuery({
    queryKey: ['sheets-preview', sourceId ?? '', tab ?? ''],
    queryFn: () => fetchSheetPreview(sourceId as string, tab as string),
    enabled: !!sourceId && !!tab,
    staleTime: 60_000,
  });
}

function useInvalidateSheets() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['sheets-status'] });
    qc.invalidateQueries({ queryKey: ['call-reporting-dashboard'] });
  };
}

export function useAddSheetSource() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: addSheetSource, onSuccess: invalidate });
}

export function useSaveSheetMapping() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: ({ sourceId, mapping }: { sourceId: string; mapping: SheetMappingInput }) =>
      saveSheetMapping(sourceId, mapping),
    onSuccess: invalidate,
  });
}

export function useSheetSourceSync() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: syncSheetSource, onSuccess: invalidate });
}

export function useRemoveSheetSource() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: removeSheetSource, onSuccess: invalidate });
}

export function useSheetsDisconnect() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: disconnectSheets, onSuccess: invalidate });
}
```

- [ ] **Step 3: Typecheck (expected: only the two consumer components fail)**

Run: `cd frontend && npm run typecheck`
Expected: errors ONLY in `GoogleSheetsPanel.tsx` and `CallReportingScreen.tsx` (fixed next tasks). Any other error is a real problem in this task — fix it now.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/call-reporting/api.ts frontend/features/call-reporting/hooks.ts
git commit -m "feat(call-reporting): frontend API layer for multi-sheet endpoints"
```

---

### Task 8: `GoogleSheetsPanel` — multi-sheet manager

**Files:**
- Modify: `frontend/features/integrations/components/GoogleSheetsPanel.tsx` (rewrite)

**Interfaces:**
- Consumes: Task 7 hooks/types. Keeps `useStartConnect` from `../hooks`, `Chip` from `@/components/ui`, `CollapsibleCard`, `fetchSheetsPickerConfig`, and the existing `openSheetPicker`/`colLetter` helper functions verbatim.

- [ ] **Step 1: Rewrite the component**

Replace the whole file. Keep `openSheetPicker` and `colLetter` exactly as-is (lines 35–76 of the current file). New `FIELDS`:

```tsx
const FIELDS: { key: 'date' | 'created_time' | 'called_3m' | 'called_10m' | 'pipeline_name'; label: string; hint: string }[] = [
  { key: 'date', label: 'Date', hint: 'the lead’s date column (MM/DD/YYYY)' },
  { key: 'created_time', label: 'Created time', hint: 'time the lead came in (e.g. Created Time (BST))' },
  { key: 'called_3m', label: 'Called within 3 min', hint: 'Yes/No column' },
  { key: 'called_10m', label: 'Called within 10 min', hint: 'Yes/No column' },
  { key: 'pipeline_name', label: 'Pipeline name', hint: 'also identifies Facebook/Google Ads leads' },
];
```

Component structure (full body):

```tsx
export default function GoogleSheetsPanel() {
  const { data: status, isLoading } = useSheetsStatus();
  const startConnect = useStartConnect();
  const addSource = useAddSheetSource();
  const saveMapping = useSaveSheetMapping();
  const syncSource = useSheetSourceSync();
  const removeSource = useRemoveSheetSource();
  const disconnect = useSheetsDisconnect();

  // Add-sheet wizard state. null = wizard closed.
  const [wizard, setWizard] = useState<{
    url: string;
    practiceLabel: string;
    sourceId: string | null;
    tabs: string[];
    tab: string | null;
  } | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<Record<string, number | ''>>({
    date: '', created_time: '', called_3m: '', called_10m: '', pipeline_name: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  const connected = !!status?.connected;
  const sources = status?.sources ?? [];
  const { data: preview } = useSheetPreview(wizard?.sourceId ?? null, wizard?.tab ?? null);

  const headers = useMemo(() => {
    const row = preview?.rows?.[headerRow - 1] ?? [];
    const width = Math.max(row.length, ...(preview?.rows ?? []).map((r) => r.length), 0);
    return Array.from({ length: width }, (_, i) => ({
      idx: i,
      label: `${colLetter(i)}${row[i] ? ` — ${row[i]}` : ''}`,
    }));
  }, [preview, headerRow]);

  if (isLoading || !status) return null;

  function resetWizard() {
    setWizard(null);
    setHeaderRow(1);
    setColumns({ date: '', created_time: '', called_3m: '', called_10m: '', pipeline_name: '' });
  }

  async function handleConnect() {
    setErr(null);
    try {
      const res = await startConnect.mutateAsync({ provider: 'google_sheets' });
      if (res.redirectUrl) window.location.href = res.redirectUrl;
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleAddSource(sourceUrl: string, practiceLabel: string) {
    setErr(null);
    if (!practiceLabel.trim()) { setErr('Give this sheet a practice name first (e.g. Barnet).'); return; }
    try {
      const res = await addSource.mutateAsync({ url: sourceUrl, practiceLabel: practiceLabel.trim() });
      setWizard((w) => ({
        url: sourceUrl,
        practiceLabel: practiceLabel.trim(),
        sourceId: res.id,
        tabs: res.tabs,
        tab: res.tabs.length === 1 ? res.tabs[0] : (w?.tab ?? null),
      }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleBrowse() {
    if (!wizard) return;
    setErr(null);
    setPickerBusy(true);
    try {
      const cfg = await fetchSheetsPickerConfig();
      if (!cfg.enabled || !cfg.apiKey || !cfg.accessToken) {
        setErr('Sheet browsing is not configured on the server yet — paste the sheet URL instead.');
        return;
      }
      const pickedId = await openSheetPicker({
        apiKey: cfg.apiKey,
        appId: cfg.appId ?? null,
        accessToken: cfg.accessToken,
      });
      if (pickedId) await handleAddSource(pickedId, wizard.practiceLabel);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPickerBusy(false);
    }
  }

  async function handleSaveMapping() {
    setErr(null);
    if (!wizard?.sourceId || !wizard.tab) { setErr('Pick the tab that holds your lead rows.'); return; }
    const missing = FIELDS.filter((f) => columns[f.key] === '');
    if (missing.length) { setErr(`Map every column: ${missing.map((f) => f.label).join(', ')} still unset.`); return; }
    const vals = FIELDS.map((f) => columns[f.key]);
    if (new Set(vals).size !== vals.length) { setErr('Each field must use a different column.'); return; }
    try {
      await saveMapping.mutateAsync({
        sourceId: wizard.sourceId,
        mapping: {
          tab_name: wizard.tab,
          header_row: headerRow,
          columns: {
            date: columns.date as number,
            created_time: columns.created_time as number,
            called_3m: columns.called_3m as number,
            called_10m: columns.called_10m as number,
            pipeline_name: columns.pipeline_name as number,
          },
        },
      });
      resetWizard();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Resume setup on a source added earlier but never mapped: re-register the
  // same spreadsheet (idempotent upsert) to fetch its tab list again.
  function resumeSetup(s: SheetSourceInfo) {
    setWizard({
      url: s.spreadsheet_url ?? s.spreadsheet_id,
      practiceLabel: s.practice_label ?? '',
      sourceId: null,
      tabs: [],
      tab: null,
    });
    void handleAddSource(s.spreadsheet_url ?? s.spreadsheet_id, s.practice_label ?? '');
  }

  async function handleRemove(s: SheetSourceInfo) {
    if (!window.confirm(`Remove the ${s.practice_label ?? 'unnamed'} sheet? Its synced lead rows will be deleted from the app.`)) return;
    setErr(null);
    try { await removeSource.mutateAsync(s.id); } catch (e) { setErr((e as Error).message); }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Sheets? Every connected sheet and all synced lead rows will be deleted from the app.')) return;
    setErr(null);
    try { await disconnect.mutateAsync(); } catch (e) { setErr((e as Error).message); }
  }

  const anyFailed = sources.some((s) => s.status === 'failed');
  const badge = !connected
    ? <Chip colour="amber">Not connected</Chip>
    : anyFailed
      ? <Chip colour="rose">Sync failed</Chip>
      : sources.some((s) => s.mapped)
        ? <Chip colour="emerald">Connected</Chip>
        : <Chip colour="amber">Setup incomplete</Chip>;

  return (
    <CollapsibleCard title="Google Sheets — Call Reporting" style={{ marginBottom: 12 }} actions={badge}>
      <div className="space-y-3 text-[13px] text-slate-600">
        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{err}</div>
        )}

        {!connected ? (
          <>
            <p>
              Connect the Google account that can view your lead sheets. Access is read-only —
              the app can never edit or share a sheet — and only the five mapped columns are
              ever synced. Connect one sheet per practice.
            </p>
            <button className="btn-primary" onClick={handleConnect} disabled={startConnect.isPending}>
              {startConnect.isPending ? 'Opening Google…' : 'Connect Google'}
            </button>
          </>
        ) : (
          <>
            {sources.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-[13px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[12px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Practice</th>
                      <th className="px-3 py-2">Sheet</th>
                      <th className="px-3 py-2">Rows</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last synced</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-900">{s.practice_label ?? '—'}</td>
                        <td className="px-3 py-2">
                          {s.title ?? s.spreadsheet_id}
                          {s.tab_name ? <span className="text-slate-400"> · {s.tab_name}</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          {s.row_count.toLocaleString('en-GB')}
                          {s.skipped_rows > 0 && <span className="text-amber-600"> ({s.skipped_rows} skipped)</span>}
                        </td>
                        <td className="px-3 py-2">
                          {!s.mapped
                            ? <Chip colour="amber">Setup incomplete</Chip>
                            : s.status === 'failed'
                              ? <Chip colour="rose">Failed</Chip>
                              : s.status === 'pending'
                                ? <Chip colour="amber">Syncing…</Chip>
                                : <Chip colour="emerald">Active</Chip>}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {s.last_synced_at
                            ? new Date(s.last_synced_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            {!s.mapped ? (
                              <button className="btn-ghost" onClick={() => resumeSetup(s)} disabled={addSource.isPending}>
                                Continue setup
                              </button>
                            ) : (
                              <button className="btn-ghost" onClick={() => syncSource.mutate(s.id)} disabled={syncSource.isPending}>
                                Refresh
                              </button>
                            )}
                            <button className="btn-ghost text-rose-600" onClick={() => handleRemove(s)} disabled={removeSource.isPending}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sources.some((s) => s.status === 'failed' && s.last_error) && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                {sources.filter((s) => s.status === 'failed' && s.last_error)
                  .map((s) => `${s.practice_label ?? s.spreadsheet_id}: ${s.last_error}`)
                  .join(' · ')}
              </div>
            )}

            {!wizard ? (
              <div className="flex gap-2 pt-1">
                <button
                  className="btn-primary"
                  onClick={() => setWizard({ url: '', practiceLabel: '', sourceId: null, tabs: [], tab: null })}
                >
                  Add sheet
                </button>
                <button className="btn-ghost text-rose-600" onClick={handleDisconnect} disabled={disconnect.isPending}>
                  {disconnect.isPending ? 'Removing…' : 'Disconnect Google'}
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Add a practice&apos;s sheet</span>
                  <button className="btn-ghost" onClick={resetWizard}>Cancel</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-slate-500">Practice name</label>
                  <input
                    className="input-base w-44"
                    placeholder="e.g. Barnet"
                    value={wizard.practiceLabel}
                    onChange={(e) => setWizard((w) => (w ? { ...w, practiceLabel: e.target.value } : w))}
                  />
                </div>
                {!wizard.sourceId ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn-primary" onClick={handleBrowse} disabled={pickerBusy || addSource.isPending}>
                        {pickerBusy ? 'Opening…' : 'Browse my sheets'}
                      </button>
                      <span className="text-slate-400">or paste its URL:</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="input-base flex-1"
                        placeholder="https://docs.google.com/spreadsheets/d/…"
                        value={wizard.url}
                        onChange={(e) => setWizard((w) => (w ? { ...w, url: e.target.value } : w))}
                      />
                      <button
                        className="btn-ghost"
                        onClick={() => handleAddSource(wizard.url, wizard.practiceLabel)}
                        disabled={addSource.isPending || wizard.url.trim().length < 10}
                      >
                        {addSource.isPending ? 'Checking…' : 'Add sheet'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-slate-500">Tab</label>
                      <select
                        className="input-base"
                        value={wizard.tab ?? ''}
                        onChange={(e) => setWizard((w) => (w ? { ...w, tab: e.target.value || null } : w))}
                      >
                        <option value="">— pick a tab —</option>
                        {wizard.tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <label className="text-slate-500">Header row</label>
                      <input
                        type="number" min={1} max={1000} className="input-base w-20"
                        value={headerRow}
                        onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </div>
                    {wizard.tab && preview && (
                      <>
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="min-w-full text-[12px]">
                            <tbody>
                              {preview.rows.slice(0, 5).map((row, ri) => (
                                <tr key={ri} className={ri === headerRow - 1 ? 'bg-slate-50 font-medium' : ''}>
                                  {headers.map((h) => (
                                    <td key={h.idx} className="whitespace-nowrap border-b border-slate-100 px-2 py-1">
                                      {row[h.idx] ?? ''}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {FIELDS.map((f) => (
                            <label key={f.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                              <span>
                                <span className="font-medium text-slate-900">{f.label}</span>
                                <span className="block text-[12px] text-slate-400">{f.hint}</span>
                              </span>
                              <select
                                className="input-base"
                                value={columns[f.key]}
                                onChange={(e) => setColumns((c) => ({ ...c, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                              >
                                <option value="">—</option>
                                {headers.map((h) => <option key={h.idx} value={h.idx}>{h.label}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                        <button className="btn-primary" onClick={handleSaveMapping} disabled={saveMapping.isPending}>
                          {saveMapping.isPending ? 'Saving…' : 'Save mapping & sync'}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
```

Imports at the top of the file become:

```tsx
import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui';
import CollapsibleCard from './CollapsibleCard';
import { useStartConnect } from '../hooks';
import { fetchSheetsPickerConfig, type SheetSourceInfo } from '@/features/call-reporting/api';
import {
  useAddSheetSource,
  useRemoveSheetSource,
  useSaveSheetMapping,
  useSheetPreview,
  useSheetSourceSync,
  useSheetsDisconnect,
  useSheetsStatus,
} from '@/features/call-reporting/hooks';
```

Update the file-top comment to describe the multi-sheet states (not connected → connect; connected → sheet list + add-sheet wizard).

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: errors ONLY in `CallReportingScreen.tsx` remain.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/integrations/components/GoogleSheetsPanel.tsx
git commit -m "feat(call-reporting): GoogleSheetsPanel multi-sheet manager (one sheet per practice)"
```

---

### Task 9: `CallReportingScreen` — 10 cards + sheet filter

**Files:**
- Modify: `frontend/features/call-reporting/components/CallReportingScreen.tsx` (rewrite)

**Interfaces:**
- Consumes: Task 7 `useCallReportingDashboard(date, sourceId?)` and the `CallReportingDashboard` shape.

- [ ] **Step 1: Rewrite the screen**

Replace the whole file (drops the `PracticeTabs` import — the filter is now the connected sheets themselves):

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCallReportingDashboard } from '../hooks';

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function CallReportingScreen() {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const { data, isLoading, isError } = useCallReportingDashboard(date, sourceId ?? undefined);

  const fieldCls =
    'text-[13px] border border-slate-200 bg-white text-slate-900 px-3 py-2 rounded-xl shadow-sm cursor-pointer';
  const sources = (data?.sources ?? []).filter((s) => s.mapped);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Call Reporting</h1>
        <p className="text-[13px] text-slate-500">
          Lead response speed by practice, synced from your Google Sheets.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={fieldCls}
          value={sourceId ?? ''}
          onChange={(e) => setSourceId(e.target.value || null)}
        >
          <option value="">All practices</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.practice_label ?? 'Unnamed sheet'}</option>
          ))}
        </select>
        <input
          type="date"
          className={fieldCls}
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value || todayISO())}
        />
        {date !== todayISO() && (
          <button
            className="text-[13px] text-slate-500 underline-offset-2 hover:underline"
            onClick={() => setDate(todayISO())}
          >
            Today
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700">
          Could not load Call Reporting. Try refreshing the page.
        </div>
      ) : !data?.configured ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          <div className="font-medium text-slate-900">Not set up yet</div>
          <p className="mt-1 text-[13px]">
            Connect Google Sheets and add each practice&apos;s lead sheet to power this dashboard.
          </p>
          <Link
            href="/integrations"
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-medium text-white"
          >
            Go to Integrations
          </Link>
        </div>
      ) : (
        <>
          {data.syncFailed && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
              A sheet&apos;s last sync failed — figures below are from the last successful sync.
              Check the Google Sheets panel on the Integrations page.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Total Leads Today" value={String(data.totalLeads)} sub={data.date} />
            <Card label="Called Within 3 Min" value={String(data.calledWithin3m)} />
            <Card label="Called Within 10 Min" value={String(data.calledWithin10m)} />
            <Card label="Efficiency % (Called < 3m)" value={`${data.efficiencyPct}%`} />
            <Card label="Leads in Pipeline" value={String(data.leadsInPipeline)} />
            <Card label="Not Called" value={String(data.notCalled)} />
            <Card label="Office Time Leads" value={String(data.officeTimeLeads)} sub="Mon–Fri 9am–5pm" />
            <Card label="Outside Office Time" value={String(data.outsideOfficeTime)} />
            <Card label="Facebook Ads Leads" value={String(data.facebookLeads)} />
            <Card label="Google Ads Leads" value={String(data.googleLeads)} />
          </div>

          <p className="text-[12px] text-slate-400">
            {data.lastSyncedAt
              ? `Last synced ${new Date(data.lastSyncedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}`
              : 'Not synced yet'}
            {!data.topUpOk ? ' · live refresh unavailable, showing cached data' : ''}
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/call-reporting/components/CallReportingScreen.tsx
git commit -m "feat(call-reporting): 10-card dashboard with per-sheet practice filter"
```

---

### Task 10: Full verification + hosted rollout

**Files:**
- Modify: `CLAUDE.md` (Current state work-log entry)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all green. Fix any straggler (e.g. another test importing a removed export) before proceeding.

- [ ] **Step 2: Backend lint + typecheck, frontend build**

Run: `cd backend && npm run lint && npm run typecheck && cd ../frontend && npm run build`
Expected: clean.

- [ ] **Step 3: Apply migration `000119` on hosted Supabase**

Via the Supabase MCP (`apply_migration`) against project `mkfhpzjbijbachoonytt`, apply the exact contents of `supabase/migrations/20260101000119_call_reporting_multi_sheet.sql`, then run `NOTIFY pgrst, 'reload schema';` (the migration also ends with it). Verify: `select column_name from information_schema.columns where table_name='sheet_leads';` shows `called_3m`, `called_10m`, `pipeline_name` and NOT `first_call_at`; `select count(*) from pg_proc where proname='sheet_leads_dashboard';` = 1. If MCP access is unavailable in this session, STOP and tell the user this step is pending — do not mark the task complete.

- [ ] **Step 4: Update CLAUDE.md work log**

Amend the "Call Reporting" bullet in the Current state section: v2 shipped — one sheet per practice (self-contained `practice_label`, no practices-table link), five mapped columns now Date/Created Time/Called-3m/Called-10m/Pipeline Name (Yes/No buckets, MM/DD/YYYY text fallback), 10 cards (+Office Time / Outside Office, Mon–Fri 9–5 London), practice-map table dropped, migration `000119` applied-on-hosted status (true/false per Step 3 outcome).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "feat(call-reporting): v2 complete — multi-sheet, 10 cards; work-log update"
```

- [ ] **Step 6: Report deploy prerequisites to the user**

Remind: deploy backend + frontend together (breaking API change); owner must re-connect each practice's sheet (v1 source/mapping was org-wide and rows were wiped); Google OAuth test-user + env vars already handled earlier in the session.

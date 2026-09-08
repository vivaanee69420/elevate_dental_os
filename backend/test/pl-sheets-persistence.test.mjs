// ============================================================================
// The scenario sheet says "saved to your organisation (not this browser)".
// That is a promise, and nothing tested it.
//
// The plumbing is real — a pl_sheets table with org-scoped CRUD — but the only
// row in the live database had 3 columns, 5 lines, ZERO filled cells and
// created_at exactly equal to updated_at. So creation was proven and the UPDATE
// path, which is what "Save sheet" actually calls, was proven by nothing at all.
//
// These pin the promise: the cells a user typed come back, and a sheet belonging
// to another organisation can never be read, written or deleted through it.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-sheets';
const OTHER_ORG = 'org-not-yours';
const SHEET_ID = 'sheet-1';

/** The grid a user would have typed: two lines across two months. */
const CELLS = {
    'rev:m1': 4500000,
    'rev:m2': 4800000,
    'staff:m1': 1200000,
    'staff:m2': 1250000,
};

beforeEach(() => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('scenario sheets — "saved to your organisation" is true', () => {
    it('the cells sent to Save are the cells written', async () => {
        // The grid is the whole point of the feature. A save that keeps the
        // column and line headings but drops the numbers would look like it
        // worked and lose the work.
        let written = null;
        supaRec.resultProvider = (q) => {
            if (q.table === 'pl_sheets' && q.updateVals) written = q.updateVals;
            return { data: { id: SHEET_ID, organisation_id: ORG, cells: CELLS }, error: null };
        };
        await svc.updatePlSheet(ORG, SHEET_ID, { cells: CELLS }, 'user-1');
        expect(written).toBeTruthy();
        expect(written.cells).toEqual(CELLS);
    });

    it('an update is scoped to the caller organisation AND the sheet id', async () => {
        // serviceClient bypasses RLS, so these two filters ARE the isolation.
        // Without the org filter, any authenticated user knowing a uuid could
        // rewrite another practice group's planning sheet.
        const eqs = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'pl_sheets') for (const e of q.eqs) eqs.push(e);
            return { data: null, error: null };
        };
        await svc.updatePlSheet(ORG, SHEET_ID, { cells: CELLS }, 'user-1');
        expect(eqs).toContainEqual({ col: 'organisation_id', val: ORG });
        expect(eqs).toContainEqual({ col: 'id', val: SHEET_ID });
    });

    it('another org\'s sheet id updates nothing and returns null, never a silent success', async () => {
        // maybeSingle() over a filtered update returns no row when the org does
        // not own the id. That must surface as null so the controller answers
        // 404 rather than reporting a save that never happened.
        supaRec.resultProvider = () => ({ data: null, error: null });
        const r = await svc.updatePlSheet(OTHER_ORG, SHEET_ID, { cells: CELLS }, 'user-1');
        expect(r).toBeNull();
    });

    it('a delete is org-scoped too', async () => {
        const eqs = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'pl_sheets') for (const e of q.eqs) eqs.push(e);
            return { data: null, error: null };
        };
        await svc.deletePlSheet(ORG, SHEET_ID);
        expect(eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    });

    it('the CSV export renders the saved cells, not a blank grid', async () => {
        // The export is how the work leaves the system. It reads the same saved
        // shape, so a sheet that saved correctly must export non-empty.
        const { csv } = svc.plSheetToCsv({
            name: 'Budget 2027',
            cols: [{ id: 'm1', label: 'Month 1' }, { id: 'm2', label: 'Month 2' }],
            lines: [{ id: 'rev', label: 'Revenue', kind: 'line' }],
            cells: { 'rev:m1': 4500000, 'rev:m2': 4800000 },
        });
        expect(csv).toContain('Revenue');
        expect(csv).toContain('45000.00');
        expect(csv).toContain('48000.00');
    });
});

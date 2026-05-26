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
        expect(out.grid[0][0].pct).toBe(50);
        expect(out.kpis.avgUtilPct).toBe(50);
    });
});

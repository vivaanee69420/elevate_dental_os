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

describe('chairUtilisationService.createChair', () => {
    it('injects organisation_id and explains a duplicate name in words', async () => {
        supaRec.resultProvider = () => ({
            data: null,
            error: { message: 'duplicate key value violates unique constraint "uq_practice_chairs_norm_name"' },
        });
        // The owner needs to know they already have that chair, not to read a
        // Postgres constraint name.
        await expect(svc.createChair(ORG, { practice_id: 'prac-1', name: 'Surgery 1' }))
            .rejects.toMatchObject({
                message: 'A chair with that name already exists at this practice',
                statusCode: 409,
            });
        expect(supaRec.last.insertVals).toMatchObject({
            organisation_id: ORG, practice_id: 'prac-1', name: 'Surgery 1',
        });
    });

    it('surfaces any other insert failure as a 400', async () => {
        supaRec.resultProvider = () => ({ data: null, error: { message: 'null value in column' } });
        await expect(svc.createChair(ORG, { practice_id: 'prac-1', name: 'Surgery 1' }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('chairUtilisationService chair not-found', () => {
    it('updateChair throws 404 when no row matches the org + id', async () => {
        supaRec.resultProvider = () => ({ data: null, error: null });
        await expect(svc.updateChair(ORG, 'missing-id', { name: 'Surgery 2' }))
            .rejects.toMatchObject({ message: 'Chair not found', statusCode: 404 });
    });

    it('removeChair throws 404 when nothing was deleted', async () => {
        supaRec.resultProvider = () => ({ data: null, error: null });
        await expect(svc.removeChair(ORG, 'missing-id'))
            .rejects.toMatchObject({ message: 'Chair not found', statusCode: 404 });
    });
});

describe('chairUtilisationService.saveWeek', () => {
    it('refuses a chair that does not belong to the practice', async () => {
        // chair_id arrives in the request BODY, so without this check a caller
        // could name another tenant's chair and write cells against it.
        supaRec.resultProvider = () => ({ data: [], error: null });
        await expect(svc.saveWeek(ORG, {
            practice_id: 'prac-1',
            chair_id: 'someone-elses-chair',
            cells: [{ weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0 }],
        })).rejects.toMatchObject({ message: 'Chair not found at this practice', statusCode: 404 });
    });
});

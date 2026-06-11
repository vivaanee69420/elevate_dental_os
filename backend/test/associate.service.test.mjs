import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/associate.service.js')).associateService;

const ORG = 'org-aaaaaaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('associateService.list', () => {
    it('filters associates by organisation_id and merges stats', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', pay_pct: 4500, joined_date: '2022-01-01', active: true, practice: { name: 'Ashford' } }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_appointment_stats'
                ? { data: [{ associate_id: 'a1', total: 50, completed: 45, no_shows: 2 }], error: null }
                : { data: null, error: { message: 'unstubbed' } };

        const rows = await svc.list(ORG, { weeks: 52 });
        expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
        expect(rows[0]).toMatchObject({
            id: 'a1', full_name: 'Dr A', practice: 'Ashford', pay_pct: 45,
            treatments: 45, appointments_total: 50, no_shows: 2,
            completion_pct: 90, no_show_pct: 4, status: 'top',
            ttm_production: null, ttm_uda: null, conversion: null,
        });
    });

    it('defaults to a 52-week window and passes the since cutoff to the stats RPC', async () => {
        supaRec.rpcCalls = [];
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', active: true, practice: null }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const before = Date.now() - 52 * 7 * 86400000;
        await svc.list(ORG, {});
        const call = supaRec.rpcCalls.find((c) => c.fn === 'associate_appointment_stats');
        expect(call).toBeTruthy();
        const since = new Date(call.params.p_since).getTime();
        // within a minute of the expected 52-week cutoff (test wall-clock drift)
        expect(Math.abs(since - before)).toBeLessThan(60000);
    });

    it('falls back to a paginated appointment scan when the stats RPC is absent', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', active: true, practice: null }], error: null }
                : q.table === 'appointments'
                    ? { data: [
                        { associate_id: 'a1', status: 'completed' },
                        { associate_id: 'a1', status: 'no_show' },
                        { associate_id: 'a1', status: 'confirmed' },
                    ], error: null }
                    : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'rpc missing' } });
        const rows = await svc.list(ORG, { weeks: 12 });
        expect(rows[0]).toMatchObject({ appointments_total: 3, treatments: 1, no_shows: 1, completion_pct: 33 });
    });

    it('merges production / UDA / conversion from the associate_metrics RPC', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', active: true, practice: null, uda_target: 500 }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_metrics'
                ? { data: [{ associate_id: 'a1', production_pence: 1234500, uda_delivered: 412.4, plans_total: 20, plans_completed: 7 }], error: null }
                : { data: [], error: null };
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows[0]).toMatchObject({
            ttm_production: 1234500,   // real invoiced pence
            ttm_uda: 412,             // rounded completed UDAs
            conversion: 35,           // 7/20
            uda_target: 500,
        });
    });

    it('zero production from the metrics RPC -> null (shows "—")', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', dentally_role: 'Dentist', active: true, practice: null }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_metrics'
                ? { data: [{ associate_id: 'a1', production_pence: 0, uda_delivered: 0, plans_total: 0, plans_completed: 0 }], error: null }
                : { data: [], error: null };
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows[0]).toMatchObject({ ttm_production: null, ttm_uda: null, conversion: null });
    });

    it('collapses per-site practitioner records into one clinician by pms_user_id', async () => {
        // Same person (user 7) at two practices -> two associate rows, one group.
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [
                    { id: 'a1', full_name: 'Amit Coonar', pms_user_id: '7', active: true, practice: { name: 'Ashford' } },
                    { id: 'a2', full_name: 'Amit Coonar', pms_user_id: '7', active: true, practice: { name: 'Rochester' } },
                  ], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_appointment_stats'
                ? { data: [
                    { associate_id: 'a1', total: 100, completed: 90, no_shows: 4 },
                    { associate_id: 'a2', total: 50, completed: 40, no_shows: 1 },
                  ], error: null }
                : fn === 'associate_metrics'
                    ? { data: [
                        { associate_id: 'a1', production_pence: 1000, uda_delivered: 0, plans_total: 10, plans_completed: 5 },
                        { associate_id: 'a2', production_pence: 500, uda_delivered: 0, plans_total: 10, plans_completed: 3 },
                      ], error: null }
                    : { data: [], error: null };
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows).toHaveLength(1);                       // two site-records -> one person
        expect(rows[0]).toMatchObject({
            full_name: 'Amit Coonar',
            appointments_total: 150,                          // 100 + 50
            treatments: 130,                                  // 90 + 40
            no_shows: 5,                                       // 4 + 1
            ttm_production: 1500,                             // 1000 + 500
            conversion: 40,                                   // 8 / 20
            practice_count: 2,
            practices: ['Ashford', 'Rochester'],
        });
    });

    it('clinical associate with no appointments -> zeros and review status (still shown)', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a2', full_name: 'Dr B', dentally_role: 'Dentist', pay_pct: 5000, active: true, practice: null }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows[0]).toMatchObject({ treatments: 0, appointments_total: 0, completion_pct: null, status: 'review' });
    });

    it('drops non-clinical accounts with zero activity (admin/reception noise)', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [
                    { id: 'a1', full_name: 'Abbie Nurse', dentally_role: 'Administrator', active: true, practice: { name: 'Rochester' } },
                    { id: 'a2', full_name: 'Real Dentist', dentally_role: 'Dentist', active: true, practice: { name: 'Ashford' } },
                  ], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null }); // no activity for anyone
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows.map((r) => r.full_name)).toEqual(['Real Dentist']); // admin dropped, dentist kept
    });

    it('merges name variants (titles / (ASH) tags / "do not use") into one person', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [
                    { id: 'g1', full_name: 'mr. Gaurav Mehta', dentally_role: 'Dentist', active: true, practice: { name: 'Ashford' } },
                    { id: 'g2', full_name: 'Gaurav(ASH) Mehta', dentally_role: 'Dentist', active: true, practice: { name: 'Ashford' } },
                    { id: 'g3', full_name: 'Gaurav Mehta do not use', dentally_role: 'Dentist', active: true, practice: { name: 'Ashford' } },
                  ], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_appointment_stats'
                ? { data: [{ associate_id: 'g1', total: 588, completed: 380, no_shows: 12 }], error: null }
                : fn === 'associate_metrics'
                    ? { data: [{ associate_id: 'g2', production_pence: 1214800, uda_delivered: 0, plans_total: 0, plans_completed: 0 }], error: null }
                    : { data: [], error: null };
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows).toHaveLength(1);                       // 3 variants -> one person
        expect(rows[0]).toMatchObject({
            full_name: 'mr. Gaurav Mehta',                  // busiest, non-junk variant wins display
            appointments_total: 588,                          // from g1
            ttm_production: 1214800,                          // from g2 (invoices-only record)
        });
    });

    it('drops a junk placeholder with no activity ("Dr Notes Notes") even when clinical', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [
                    { id: 'j1', full_name: 'Dr Notes Notes', dentally_role: 'Therapist', active: true, practice: { name: 'Ashford' } },
                    { id: 'r1', full_name: 'Real Therapist', dentally_role: 'Therapist', active: true, practice: { name: 'Ashford' } },
                  ], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows.map((r) => r.full_name)).toEqual(['Real Therapist']);
    });

    it('keeps a mis-roled non-clinical account that HAS activity', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Busy Nurse', dentally_role: 'Nurse', active: true, practice: { name: 'Ashford' } }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_appointment_stats'
                ? { data: [{ associate_id: 'a1', total: 200, completed: 180, no_shows: 5 }], error: null }
                : { data: [], error: null };
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ full_name: 'Busy Nurse', appointments_total: 200 });
    });
});

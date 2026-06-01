import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/staff.service.js')).staffService;

const ORG = 'org-ssssssss';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
    vi.useRealTimers();
});

describe('staffService.list', () => {
    it('shapes the roster: prefers pms_role, resolves practice, counts KPIs', async () => {
        // Freeze "now" so the 90-day active window is deterministic.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
        supaRec.resultProvider = (q) =>
            q.table === 'staff'
                ? { data: [
                    { id: 's1', full_name: 'Dr Gaurav Mehta', role: 'other', pms_role: 'Dentist', email: 'g@x.com', phone: '07900', last_login_at: '2026-05-20T10:00:00Z', active: true, source: 'dentally', practice: { name: 'Rochester' } },
                    { id: 's2', full_name: 'Anna Reception', role: 'reception', pms_role: 'Receptionist', email: null, phone: null, last_login_at: '2025-01-01T10:00:00Z', active: true, source: 'dentally', practice: { name: 'Ashford' } },
                  ], error: null }
                : { data: [], error: null };

        const out = await svc.list(ORG, {});
        expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
        // pms_role wins over the coarse enum role.
        expect(out.staff[0]).toMatchObject({ id: 's1', role: 'Dentist', practice: 'Rochester', recently_active: true });
        // last login > 90 days ago -> not recently active.
        expect(out.staff[1]).toMatchObject({ role: 'Receptionist', recently_active: false, email: null });
        expect(out).toMatchObject({ total_staff: 2, distinct_roles: 2, practices_covered: 2, active_count: 1 });
    });

    it('falls back to the enum role when pms_role is absent, null practice -> null', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'staff'
                ? { data: [{ id: 's3', full_name: 'Manual Staff', role: 'nurse', pms_role: null, email: null, phone: null, last_login_at: null, active: true, source: null, practice: null }], error: null }
                : { data: [], error: null };
        const out = await svc.list(ORG, {});
        expect(out.staff[0]).toMatchObject({ role: 'nurse', practice: null, last_login_at: null, recently_active: false });
        expect(out.practices_covered).toBe(0);
    });

    it('nulls Dentally placeholder/import emails, keeps real ones', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'staff'
                ? { data: [
                    { id: 'e1', full_name: 'Import Acct', role: 'other', pms_role: 'Administrator', email: 'import+gmdental-42@dentally.co', phone: null, last_login_at: null, practice: null },
                    { id: 'e2', full_name: 'Needs Email', role: 'other', pms_role: 'Dentist', email: '*needemail*@dentally.co', phone: null, last_login_at: null, practice: null },
                    { id: 'e3', full_name: 'Placeholder Domain', role: 'other', pms_role: 'Dentist', email: 'someone@dentally.co', phone: null, last_login_at: null, practice: null },
                    { id: 'e4', full_name: 'Real Person', role: 'other', pms_role: 'Dentist', email: 'amit@barnetorthodontics.co.uk', phone: null, last_login_at: null, practice: null },
                  ], error: null }
                : { data: [], error: null };
        const out = await svc.list(ORG, {});
        const byId = Object.fromEntries(out.staff.map((s) => [s.id, s.email]));
        // e1 is an import+ system account -> excluded from the roster entirely.
        expect(byId.e1).toBeUndefined();
        expect(out.staff.find((s) => s.id === 'e1')).toBeUndefined();
        // e2/e3 are real people with placeholder emails -> kept, email blanked.
        expect(byId.e2).toBeNull();
        expect(byId.e3).toBeNull();
        expect(byId.e4).toBe('amit@barnetorthodontics.co.uk');
        expect(out.total_staff).toBe(3);
    });

    it('passes a practice filter to the repository query', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        await svc.list(ORG, { practice_id: 'prac-9' });
        expect(supaRec.last.eqs.find((e) => e.col === 'practice_id')).toEqual({ col: 'practice_id', val: 'prac-9' });
    });

    it('empty roster -> zero KPIs', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        const out = await svc.list(ORG, {});
        expect(out).toMatchObject({ staff: [], total_staff: 0, distinct_roles: 0, practices_covered: 0, active_count: 0 });
    });
});

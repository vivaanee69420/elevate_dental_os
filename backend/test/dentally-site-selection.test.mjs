// A Dentally OAuth grant is GROUP-wide. Connecting it inside a sub-account
// therefore hands us a token that can read every practice in the group, and
// the old bootstrap created a practice for each site it found and pulled the
// lot on sight.
//
// Measured live: connecting Dentally in the `gm dental Rochester` sub-account
// put 9,446 contacts, 21,800 appointments, 218 practitioners and 270 staff
// belonging to four other practices into it, with no point at which anyone was
// asked. These tests pin the two halves of the fix — stop and ask when there is
// a choice, then honour the answer on every pull.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { bootstrapOnConnect, syncOneOrg, allowedSites, keepSite } =
    await import('../src/lib/integrations/dentally-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

const page = (body) => ({ ok: true, status: 200, json: async () => body });
const SECRETS = encryptSecret(JSON.stringify({ apiKey: 'k' }));

beforeEach(() => {
    integrationRepository.upsert.mockReset();
    integrationRepository.markFailed.mockReset();
    integrationRepository.mergeConfig.mockReset();
    supaRec.resultProvider = undefined;
});

describe('allowedSites / keepSite', () => {
    it('absent or empty selection means every site, NOT no sites', () => {
        // The distinction is the whole safety property: null must mean "all"
        // (every org connected before the picker existed) while an empty Set
        // would mean "pull nothing" and silently freeze a working tenant.
        expect(allowedSites(undefined)).toBeNull();
        expect(allowedSites({ config: {} })).toBeNull();
        expect(allowedSites({ config: { site_ids: [] } })).toBeNull();
        expect(keepSite(null, 'anything')).toBe(true);
    });

    it('a selection admits only its own sites, comparing as strings', () => {
        const allowed = allowedSites({ config: { site_ids: ['S1', 42] } });
        expect(keepSite(allowed, 'S1')).toBe(true);
        expect(keepSite(allowed, 42)).toBe(true);   // number in, string stored
        expect(keepSite(allowed, '42')).toBe(true);
        expect(keepSite(allowed, 'S2')).toBe(false);
        expect(keepSite(allowed, undefined)).toBe(false);
    });
});

describe('bootstrapOnConnect — asks before it pulls', () => {
    it('stops on a multi-site token: no practice created, nothing pulled', async () => {
        const inserted = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices' && q.op === 'insert') {
                inserted.push(String(q.insertVals.pms_site_id));
                return { data: null, error: null };
            }
            return { data: [], error: null };
        };
        const hit = [];
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            hit.push(u);
            if (u.includes('/patients')) {
                return page({
                    patients: [{ id: 'P1', site_id: 'S1' }, { id: 'P2', site_id: 'S2' }],
                    meta: { total_pages: 1 },
                });
            }
            return page({});
        });

        const res = await bootstrapOnConnect('org-1', { secrets: SECRETS, config: {}, status: 'active' });

        expect(res.awaitingSiteSelection).toBe(true);
        expect(res.sitesDetected).toBe(2);
        expect(inserted).toEqual([]);           // no practice invented for a site nobody chose
        expect(res.patients).toBeUndefined();   // the pull never ran

        // The detected sites are persisted so the picker can render them without
        // paying for a second round of detection.
        const patch = integrationRepository.mergeConfig.mock.calls.at(-1)[2];
        expect(patch.awaiting_site_selection).toBe(true);
        expect(patch.detected_sites.map((s) => s.site_id).sort()).toEqual(['S1', 'S2']);
    });

    it('a single-site token is not a decision — it pulls straight through', async () => {
        const inserted = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices' && q.op === 'insert') {
                inserted.push(String(q.insertVals.pms_site_id));
                return { data: null, error: null };
            }
            if (q.table === 'practices' && q.op === 'select') {
                return { data: inserted.map((s) => ({ id: `prac-${s}`, pms_site_id: s })), error: null };
            }
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            if (u.includes('/patients')) return page({ patients: [{ id: 'P1', site_id: 'S1' }], meta: { total_pages: 1 } });
            return page({});
        });

        const res = await bootstrapOnConnect('org-1', { secrets: SECRETS, config: {}, status: 'active' });
        expect(res.awaitingSiteSelection).toBeUndefined();
        expect(inserted).toEqual(['S1']);
    });

    it('once chosen, it creates a practice ONLY for the chosen site', async () => {
        const inserted = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices' && q.op === 'insert') {
                inserted.push(String(q.insertVals.pms_site_id));
                return { data: null, error: null };
            }
            if (q.table === 'practices' && q.op === 'select') {
                return { data: inserted.map((s) => ({ id: `prac-${s}`, pms_site_id: s })), error: null };
            }
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            if (u.includes('/patients')) {
                return page({
                    patients: [{ id: 'P1', site_id: 'S1' }, { id: 'P2', site_id: 'S2' }],
                    meta: { total_pages: 1 },
                });
            }
            return page({});
        });

        await bootstrapOnConnect('org-1', {
            secrets: SECRETS, status: 'active', config: { site_ids: ['S1'] },
        });
        expect(inserted).toEqual(['S1']); // S2 exists on the token and is left alone
    });
});

describe('syncOneOrg — the selection gates the rows, not just the practice list', () => {
    // This is the half that actually stopped the leak. Appointments, payments
    // and invoices already drop a record whose site maps to no practice, because
    // those tables have a NOT NULL practice_id. Patients, practitioners and
    // staff set practice_id: null and insert regardless — so limiting the
    // practices alone would still have filled the sub-account with the group's
    // patient list.
    function fixture() {
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices' && q.op === 'select') {
                return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
            }
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            if (u.includes('/patients')) {
                return page({
                    patients: [{ id: 'P1', first_name: 'A', site_id: 'S1' },
                               { id: 'P2', first_name: 'B', site_id: 'S2' }],
                    meta: { total_pages: 1 },
                });
            }
            if (u.includes('/practitioners')) {
                return page({
                    practitioners: [{ id: 'PR1', site_id: 'S1' }, { id: 'PR2', site_id: 'S2' }],
                    meta: { total_pages: 1 },
                });
            }
            if (u.includes('/users')) {
                return page({
                    users: [{ id: 'U1', site_id: 'S1' }, { id: 'U2', site_id: 'S2' }],
                    meta: { total_pages: 1 },
                });
            }
            return page({});
        });
    }

    it('keeps only the selected site\'s patients, practitioners and staff', async () => {
        fixture();
        const res = await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1'] }, last_sync_at: null,
        }, () => {});
        expect(res.patients).toBe(1);
        expect(res.practitioners).toBe(1);
        expect(res.staff).toBe(1);
    });

    it('pulls every site when no selection was made (unchanged for existing orgs)', async () => {
        fixture();
        const res = await syncOneOrg('org-1', {
            secrets: SECRETS, config: {}, last_sync_at: null,
        }, () => {});
        expect(res.patients).toBe(2);
        expect(res.practitioners).toBe(2);
        expect(res.staff).toBe(2);
    });
});

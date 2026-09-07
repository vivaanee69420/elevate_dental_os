// A scoped account must not store rows it cannot attribute to a practice it
// selected.
//
// appointments, payments, invoices and contacts were already safe: their
// practice_id is NOT NULL, so a row whose site maps to no practice is dropped.
// treatment_plans, dentally_treatment_items and invoice_items have a NULLABLE
// practice_id and stored the row regardless — correct for an organisation that
// holds the whole group, wrong for one scoped to a single practice, where an
// unresolvable practice means the record belongs to a practice it did not pick.
//
// Measured live in the Rochester sub-account before the fix: 64,165 treatment
// items, 10,792 invoice items and 7,700 treatment plans with a null practice.
// The Treatments Completed card counted them all and read 1,981 for June
// against 775 that were Rochester's, and 341 for a September week against
// Dentally's own report of 96.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { syncOneOrg } = await import('../src/lib/integrations/dentally-sync.js');
const SECRETS = encryptSecret(JSON.stringify({ apiKey: 'k' }));
const page = (body) => ({ ok: true, status: 200, json: async () => body });

// PR-1 belongs to the selected site and resolves a practice; PR-2 does not, so
// anything it worked on is another practice's record.
function fixture() {
    const upserts = { dentally_treatment_items: [], treatment_plans: [], invoice_items: [] };
    supaRec.resultProvider = (q) => {
        if (q.table === 'practices' && q.op === 'select') {
            return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
        }
        if (q.table === 'associates' && q.op === 'select') {
            return { data: [{ id: 'a1', pms_external_id: 'PR-1', primary_practice_id: 'prac-1' }], error: null };
        }
        if (q.op === 'upsert' && upserts[q.table]) {
            for (const r of [].concat(q.upsertVals ?? [])) upserts[q.table].push(r);
            return { data: null, error: null };
        }
        return { data: [], error: null };
    };
    global.fetch = vi.fn(async (url) => {
        const u = url.toString();
        if (u.includes('/practitioners')) {
            return page({ practitioners: [{ id: 'PR-1', site_id: 'S1' }], meta: { total_pages: 1 } });
        }
        if (u.includes('/treatment_plan_items')) {
            return page({
                treatment_plan_items: [
                    { id: 'TI-1', completed: true, practitioner_id: 'PR-1' },
                    { id: 'TI-2', completed: true, practitioner_id: 'PR-2' }, // another practice
                ],
                meta: { total_pages: 1 },
            });
        }
        if (u.includes('/treatment_plans')) {
            return page({
                treatment_plans: [
                    { id: 'TP-1', practitioner_id: 'PR-1' },
                    { id: 'TP-2', practitioner_id: 'PR-2' },
                ],
                meta: { total_pages: 1 },
            });
        }
        return page({});
    });
    return upserts;
}

beforeEach(() => { supaRec.resultProvider = undefined; });

describe('a site-scoped account', () => {
    it('stores no treatment item it cannot attribute to a selected practice', async () => {
        const upserts = fixture();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1'] }, last_sync_at: null,
        }, () => {});
        const items = upserts.dentally_treatment_items;
        expect(items.length).toBeGreaterThan(0);
        for (const r of items) expect(r.practice_id).toBeTruthy();
        expect(items.map((r) => r.pms_external_id)).not.toContain('TI-2');
    });

    it('stores no treatment plan it cannot attribute either', async () => {
        const upserts = fixture();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1'] }, last_sync_at: null,
        }, () => {});
        for (const r of upserts.treatment_plans) expect(r.practice_id).toBeTruthy();
    });
});

describe('an account that pulls the whole group', () => {
    it('KEEPS unattributed rows — they are still its own records', async () => {
        // The counterpart the gate must not break. With no selection, a row we
        // cannot attribute belongs to a practice the org holds anyway, and
        // dropping it would silently delete real history from every existing
        // tenant.
        const upserts = fixture();
        await syncOneOrg('org-1', { secrets: SECRETS, config: {}, last_sync_at: null }, () => {});
        const items = upserts.dentally_treatment_items;
        expect(items.map((r) => r.pms_external_id)).toContain('TI-2');
        expect(items.some((r) => !r.practice_id)).toBe(true);
    });
});

describe('attribution falls back to the patient', () => {
    // The first version of the gate resolved practice from the PRACTITIONER
    // alone and dropped anything unresolved. That deleted the account's own
    // work whenever the practitioner was missing from `associates` — a locum, a
    // leaver, anyone the roster pull had not reached — and Treatments Completed
    // fell from too high to too low. A patient we hold is a patient of a
    // practice we selected, so the patient is the safer second signal.
    function fixtureUnknownPractitioner() {
        const upserts = { dentally_treatment_items: [], treatment_plans: [] };
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices' && q.op === 'select') {
                return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
            }
            if (q.table === 'contacts' && q.op === 'select') {
                // Our patient, stamped with the practice we selected.
                return { data: [{ id: 'c1', pms_external_id: 'PAT-1', practice_id: 'prac-1' }], error: null };
            }
            if (q.op === 'upsert' && upserts[q.table]) {
                for (const r of [].concat(q.upsertVals ?? [])) upserts[q.table].push(r);
                return { data: null, error: null };
            }
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            if (u.includes('/treatment_plan_items')) {
                return page({
                    treatment_plan_items: [
                        // Practitioner nobody knows, but OUR patient.
                        { id: 'TI-9', completed: true, practitioner_id: 'PR-UNKNOWN', patient_id: 'PAT-1' },
                        // Neither known — genuinely another practice's record.
                        { id: 'TI-8', completed: true, practitioner_id: 'PR-UNKNOWN', patient_id: 'PAT-OTHER' },
                    ],
                    meta: { total_pages: 1 },
                });
            }
            return page({});
        });
        return upserts;
    }

    it('keeps a row whose practitioner is unknown but whose patient is ours', async () => {
        const upserts = fixtureUnknownPractitioner();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1'] }, last_sync_at: null,
        }, () => {});
        const ids = upserts.dentally_treatment_items.map((r) => r.pms_external_id);
        expect(ids).toContain('TI-9');
        expect(upserts.dentally_treatment_items.find((r) => r.pms_external_id === 'TI-9').practice_id)
            .toBe('prac-1');
    });

    it('still drops a row where neither practitioner nor patient is ours', async () => {
        const upserts = fixtureUnknownPractitioner();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1'] }, last_sync_at: null,
        }, () => {});
        expect(upserts.dentally_treatment_items.map((r) => r.pms_external_id)).not.toContain('TI-8');
    });
});

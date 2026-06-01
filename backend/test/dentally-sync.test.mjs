// Dentally sync — pure mappers, fetchAllPages (pagination + 429 backoff),
// and syncOneOrg mapping/upsert with practice resolution + unmatched skip.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

// integration.repository.upsert chains .select().single() which the supabase
// fake doesn't model; mock the repo so syncOneOrg's bookkeeping is observable.
vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn() },
}));

const { syncOneOrg, bootstrapOnConnect, __test } = await import('../src/lib/integrations/dentally-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

describe('dentally mappers', () => {
    it('toPence: pounds -> integer pence, no float drift', () => {
        expect(__test.toPence(12.5)).toBe(1250);
        expect(__test.toPence('0.1') + __test.toPence('0.2')).toBe(30);
        expect(__test.toPence('abc')).toBe(0);
    });
    it('mapAppointmentStatus maps Dentally states to our enum', () => {
        expect(__test.mapAppointmentStatus('did_not_attend')).toBe('no_show');
        expect(__test.mapAppointmentStatus('finished')).toBe('completed');
        expect(__test.mapAppointmentStatus('cancelled')).toBe('cancelled');
        expect(__test.mapAppointmentStatus('wibble')).toBe('scheduled');
    });
    it('mapPaymentStatus: paid flag + state', () => {
        expect(__test.mapPaymentStatus({ paid: true })).toBe('settled');
        expect(__test.mapPaymentStatus({ state: 'failed' })).toBe('failed');
        expect(__test.mapPaymentStatus({ state: 'whatever' })).toBe('pending');
    });
    it('mapPaymentMethod allowlists, else null', () => {
        expect(__test.mapPaymentMethod('CARD')).toBe('card');
        expect(__test.mapPaymentMethod('crypto')).toBeNull();
    });
});

describe('authHeader', () => {
    it('round-trips an encrypted apiKey to a Bearer header', () => {
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k-123' }));
        expect(__test.authHeader(secrets)).toBe('Bearer k-123');
    });
    it('returns null on garbage', () => {
        expect(__test.authHeader('not-encrypted')).toBeNull();
    });
});

function page(body) {
    return { ok: true, status: 200, json: async () => body };
}

describe('fetchAllPages', () => {
    it('concatenates pages until meta.total_pages and sends mandatory User-Agent', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(page({ patients: [{ id: 1 }], meta: { total_pages: 2 } }))
            .mockResolvedValueOnce(page({ patients: [{ id: 2 }], meta: { total_pages: 2 } }));
        const out = await __test.fetchAllPages('https://api.dentally.co/v1', '/patients', 'Bearer k', { updated_since: 'x' });
        expect(out.map((p) => p.id)).toEqual([1, 2]);
        const headers = global.fetch.mock.calls[0][1].headers;
        expect(headers['User-Agent']).toMatch(/ElevateOS/);
        expect(headers.Authorization).toBe('Bearer k');
    });

    it('backs off on 429 then succeeds', async () => {
        vi.useFakeTimers();
        const h = { get: (k) => (k === 'retry-after' ? '1' : null) };
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ status: 429, ok: false, headers: h })
            .mockResolvedValueOnce(page({ patients: [{ id: 9 }] }));
        const p = __test.fetchAllPages('https://b', '/patients', 'Bearer k', {});
        await vi.advanceTimersByTimeAsync(1000);
        const out = await p;
        expect(out).toEqual([{ id: 9 }]);
        vi.useRealTimers();
    });

    it('retries a thrown network error (one slow page no longer fails the sync)', async () => {
        vi.useFakeTimers();
        global.fetch = vi.fn()
            .mockRejectedValueOnce(new Error('socket hang up'))
            .mockResolvedValueOnce(page({ patients: [{ id: 7 }] }));
        const p = __test.fetchAllPages('https://b', '/patients', 'Bearer k', {});
        await vi.advanceTimersByTimeAsync(1000); // first backoff
        const out = await p;
        expect(out).toEqual([{ id: 7 }]);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('surfaces an actionable timeout, not the opaque "This operation was aborted"', async () => {
        vi.useFakeTimers();
        const abortErr = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
        global.fetch = vi.fn().mockRejectedValue(abortErr);
        const p = __test.fetchAllPages('https://b', '/patients', 'Bearer k', {}).catch((e) => e);
        await vi.advanceTimersByTimeAsync(1000 + 2000 + 3000); // exhaust the 4 attempts
        const err = await p;
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/timed out after 30s/);
        expect(err.message).not.toMatch(/operation was aborted/);
        expect(global.fetch).toHaveBeenCalledTimes(4);
        vi.useRealTimers();
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
    });

    it('maps + upserts with practice resolution and skips unmatched-practice rows', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => {
            queries.push(q);
            if (q.table === 'practices') return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
            if (q.table === 'contacts' && q.op === 'select') return { data: [{ id: 'cont-1', pms_external_id: 'P1' }], error: null };
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            if (u.includes('/patients')) return page({ patients: [{ id: 'P1', first_name: 'A', site_id: 'S1' }], meta: { total_pages: 1 } });
            if (u.includes('/appointments')) return page({ appointments: [
                { id: 'A1', patient_id: 'P1', site_id: 'S1', start_time: 't1', finish_time: 't2', state: 'completed' },
                { id: 'A2', patient_id: 'P1', site_id: 'UNKNOWN', start_time: 't1', finish_time: 't2' },
            ], meta: { total_pages: 1 } });
            if (u.includes('/payments')) return page({ payments: [
                { id: 'PAY1', patient_id: 'P1', site_id: 'S1', amount: 12.5, payment_method: 'card', paid: true, payment_date: 'd' },
            ], meta: { total_pages: 1 } });
            return page({});
        });

        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        const res = await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' });

        expect(res.appointments).toBe(1);          // A2 skipped (unknown site)
        expect(res.skipped_unmatched_practice).toBe(1);
        expect(res.payments).toBe(1);

        const payUpsert = queries.find((q) => q.table === 'payments' && q.op === 'upsert');
        expect(payUpsert.upsertVals[0]).toMatchObject({
            organisation_id: 'org-1', source: 'dentally', external_id: 'PAY1',
            practice_id: 'prac-1', amount_pence: 1250, status: 'settled', contact_id: 'cont-1',
        });
        expect(payUpsert.upsertOpts.onConflict).toBe('organisation_id,source,external_id');
        expect(integrationRepository.upsert).toHaveBeenCalled();   // last_sync_at advanced
        // contact relink runs after the pulls so cross-run / pre-column nulls get backfilled
        expect((supaRec.rpcCalls ?? []).some((c) => c.fn === 'relink_dentally_appointment_contacts')).toBe(true);
    });

    it('marks the integration failed when the API key is missing', async () => {
        const res = await syncOneOrg('org-1', { secrets: 'garbage', config: {} });
        expect(res.error).toBe('no_auth');
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    it('recent mode: all three resources pull the same ~24-month updated_since window (no open-only `after`)', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const seen = [];
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            seen.push({ path: u.pathname, updated_since: u.searchParams.get('updated_since'), after: u.searchParams.get('after') });
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-05-01T00:00:00Z' }, () => {}, { recent: true });

        const expected24 = Date.now() - 24 * 30 * 86400000; // RECENT_MONTHS
        const patients = seen.filter((s) => s.path.includes('/patients'));
        const payments = seen.filter((s) => s.path.includes('/payments'));
        const appts = seen.filter((s) => s.path.includes('/appointments'));
        expect(patients.length).toBeGreaterThan(0);
        expect(payments.length).toBeGreaterThan(0);
        expect(appts.length).toBeGreaterThan(0);
        // Patients + payments pull the bounded 2-year window via updated_since.
        for (const s of [...patients, ...payments]) {
            expect(s.after).toBeNull();
            expect(Math.abs(new Date(s.updated_since).getTime() - expected24)).toBeLessThan(86400000);
        }
        // Appointments are pulled BOTH ways on bootstrap: the 2-year history via
        // updated_since (for Associates / Treatment Mix / Pay) AND the upcoming
        // book via `after=now` (for the live Appointments diary — a separate
        // query so years of history can't crowd future bookings out under the
        // page cap).
        const apptHistory = appts.filter((s) => s.updated_since != null);
        const apptUpcoming = appts.filter((s) => s.after != null);
        expect(apptHistory.length).toBeGreaterThan(0);
        expect(apptUpcoming.length).toBeGreaterThan(0);
        for (const s of apptHistory) {
            expect(Math.abs(new Date(s.updated_since).getTime() - expected24)).toBeLessThan(86400000);
        }
        for (const s of apptUpcoming) {
            expect(Math.abs(new Date(s.after).getTime() - Date.now())).toBeLessThan(86400000);
        }
    });
});

describe('open-appointment filter (first pull)', () => {
    it('isOpenAppointment: keeps upcoming + active, drops closed states and past dates', () => {
        const future = new Date(Date.now() + 7 * 86400000).toISOString();
        const past = new Date(Date.now() - 7 * 86400000).toISOString();
        expect(__test.isOpenAppointment({ status: 'scheduled', starts_at: future })).toBe(true);
        expect(__test.isOpenAppointment({ status: 'confirmed', starts_at: future })).toBe(true);
        expect(__test.isOpenAppointment({ status: 'completed', starts_at: future })).toBe(false);
        expect(__test.isOpenAppointment({ status: 'cancelled', starts_at: future })).toBe(false);
        expect(__test.isOpenAppointment({ status: 'no_show', starts_at: future })).toBe(false);
        expect(__test.isOpenAppointment({ status: 'scheduled', starts_at: past })).toBe(false);
    });
});

describe('bootstrapOnConnect (first-connect automation)', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
    });

    // The regression: the old first-connect sync ran with an EMPTY siteMap
    // (practices not mapped yet), so every appointment/payment was skipped and
    // the dashboard showed all zeros. bootstrapOnConnect must detect the site,
    // create the practice, and THEN pull — so the appointment resolves a
    // practice instead of being skipped.
    it('creates a practice per detected site BEFORE pulling, so appointments are not skipped', async () => {
        const future = new Date(Date.now() + 7 * 86400000).toISOString();
        const past = new Date(Date.now() - 7 * 86400000).toISOString();
        const created = []; // practices that exist "now" — empty until insert runs
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices' && q.op === 'insert') {
                created.push({ id: `prac-${q.insertVals.pms_site_id}`, pms_site_id: String(q.insertVals.pms_site_id) });
                return { data: null, error: null };
            }
            if (q.table === 'practices' && q.op === 'select') return { data: created.slice(), error: null };
            if (q.table === 'contacts' && q.op === 'select') return { data: [{ id: 'c1', pms_external_id: 'P1' }], error: null };
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            // patients/payments expose site_id; appointments expose practitioner_site_id (real Dentally shapes)
            if (u.includes('/patients')) return page({ patients: [{ id: 'P1', first_name: 'A', site_id: 'S1' }], meta: { total_pages: 1 } });
            if (u.includes('/appointments')) return page({ appointments: [
                // bootstrap now keeps the full 2-year window: BOTH the upcoming
                // booking AND the completed/past visit are stored (the latter
                // feeds Associates / Treatment Mix / Pay).
                { id: 'A1', patient_id: 'P1', practitioner_site_id: 'S1', start_time: future, finish_time: future, state: 'booked' },
                { id: 'A2', patient_id: 'P1', practitioner_site_id: 'S1', start_time: past, finish_time: past, state: 'completed' },
            ], meta: { total_pages: 1 } });
            if (u.includes('/payments')) return page({ payments: [
                { id: 'PAY1', patient_id: 'P1', site_id: 'S1', amount: 10, method: 'card', paid: true, dated_on: 'd' },
            ], meta: { total_pages: 1 } });
            return page({}); // /sites, /practices -> no array key -> []
        });

        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        const res = await bootstrapOnConnect('org-1', { secrets, config: {}, status: 'active' });

        expect(res.practicesCreated).toBe(1);            // S1 detected + auto-created
        expect(res.appointments).toBe(2);                // A1 + A2 both resolved + stored (2-year window)
        expect(res.skipped_unmatched_practice).toBe(0);  // neither was an unmatched practice
        expect(res.skipped_closed_appointments).toBe(0); // open-only filter no longer applied on bootstrap
        expect(res.payments).toBe(1);
    });

    it('no_auth when the key is missing (does not crash the connect path)', async () => {
        const res = await bootstrapOnConnect('org-1', { secrets: 'garbage', config: {} });
        expect(res.error).toBe('no_auth');
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    it('full backfill uses a far-back updated_since (all history), not the 30d/last_sync window', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const seen = [];
        global.fetch = vi.fn(async (url) => {
            seen.push(new URL(url.toString()).searchParams.get('updated_since'));
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-05-01T00:00:00Z' }, () => {}, { full: true });
        // every WINDOWED resource pull asked for everything since ~2005, ignoring
        // last_sync_at. The /users roster pull is deliberately unwindowed (full
        // team every sync), so it carries no updated_since (null) — skip it.
        const windowed = seen.filter(Boolean);
        expect(windowed.length).toBeGreaterThan(0);
        for (const s of windowed) expect(s.startsWith('2005-')).toBe(true);
    });
});

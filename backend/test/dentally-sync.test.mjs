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

const { syncOneOrg, __test } = await import('../src/lib/integrations/dentally-sync.js');
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
    });

    it('marks the integration failed when the API key is missing', async () => {
        const res = await syncOneOrg('org-1', { secrets: 'garbage', config: {} });
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
        // every resource pull asked for everything since ~2005, ignoring last_sync_at
        expect(seen.length).toBeGreaterThan(0);
        for (const s of seen) expect(s.startsWith('2005-')).toBe(true);
    });
});

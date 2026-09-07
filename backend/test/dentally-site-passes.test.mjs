// Pull only the practices the organisation selected — never the whole group.
//
// A Dentally grant covers every practice on the login, and the old pull
// downloaded all of them and discarded what did not belong. Measured on the
// live token: 33,828 appointments read to keep 12,675, 9,553 patients to keep
// 4,108. Correct, but it made a one-practice sub-account pay the group's
// transfer cost on every sync, and it made the progress overlay report figures
// more than twice the account's own totals.
//
// `site_id` narrows every collection (verified live), but it takes ONE value —
// so N selected sites is N filtered passes, expanded at the fetch layer so no
// individual pull has to know.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { sitePasses, siteRequestParams, syncOneOrg } =
    await import('../src/lib/integrations/dentally-sync.js');

const SECRETS = encryptSecret(JSON.stringify({ apiKey: 'k' }));
const page = (body) => ({ ok: true, status: 200, json: async () => body });

describe('sitePasses', () => {
    it('makes one unfiltered pass when nothing was selected', () => {
        // Every organisation connected before the picker existed lands here.
        expect(sitePasses({ updated_after: 'X' })).toEqual([{ updated_after: 'X' }]);
        expect(sitePasses({ updated_after: 'X', __sites: [] })).toEqual([{ updated_after: 'X' }]);
        expect(sitePasses(undefined)).toEqual([{}]);
    });

    it('makes one filtered pass per selected site, keeping the other params', () => {
        expect(sitePasses({ updated_after: 'X', __sites: ['S1', 'S2'] })).toEqual([
            { updated_after: 'X', site_id: 'S1' },
            { updated_after: 'X', site_id: 'S2' },
        ]);
    });

    it('de-duplicates, so a repeated site is not pulled and upserted twice', () => {
        expect(sitePasses({ __sites: ['S1', 'S1'] })).toEqual([{ site_id: 'S1' }]);
    });

    it('never leaves __sites in the params it hands to the URL builder', () => {
        // It is an internal marker. Leaking it would put `__sites=S1,S2` in a
        // real query string, which Dentally would either ignore or reject.
        for (const p of sitePasses({ a: 1, __sites: ['S1', 'S2'] })) {
            expect(p).not.toHaveProperty('__sites');
        }
    });
});

describe('siteRequestParams', () => {
    it('adds nothing when the org pulls every site', () => {
        expect(siteRequestParams(null)).toEqual({});
        expect(siteRequestParams(new Set())).toEqual({});
    });
    it('carries every selected site, not just the first', () => {
        expect(siteRequestParams(new Set(['S1', 'S2']))).toEqual({ __sites: ['S1', 'S2'] });
    });
});

describe('syncOneOrg request URLs', () => {
    function capture() {
        const urls = [];
        supaRec.resultProvider = (q) =>
            q.table === 'practices' && q.op === 'select'
                ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null }
                : { data: [], error: null };
        global.fetch = vi.fn(async (url) => {
            urls.push(url.toString());
            return page({ patients: [], appointments: [], meta: { total_pages: 1 } });
        });
        return urls;
    }

    it('asks Dentally for ONLY the selected practice', async () => {
        const urls = capture();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1'] }, last_sync_at: null,
        }, () => {});

        const collections = urls.filter((u) => /\/(patients|appointments|payments|invoices|practitioners|users)\b/.test(u));
        expect(collections.length).toBeGreaterThan(0);
        for (const u of collections) {
            expect(new URL(u).searchParams.get('site_id')).toBe('S1');
        }
    });

    it('asks once per site when several are selected — never one unfiltered call', async () => {
        const urls = capture();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1', 'S2'] }, last_sync_at: null,
        }, () => {});

        const patients = urls.filter((u) => u.includes('/patients'));
        const sites = new Set(patients.map((u) => new URL(u).searchParams.get('site_id')));
        expect(sites).toEqual(new Set(['S1', 'S2']));
        // The failure this guards against: falling back to one unfiltered pull
        // and filtering locally, which downloads every other practice again.
        expect(patients.some((u) => !new URL(u).searchParams.has('site_id'))).toBe(false);
    });

    it('sends no site filter when the org never chose — existing orgs unchanged', async () => {
        const urls = capture();
        await syncOneOrg('org-1', { secrets: SECRETS, config: {}, last_sync_at: null }, () => {});
        const patients = urls.filter((u) => u.includes('/patients'));
        expect(patients.length).toBeGreaterThan(0);
        for (const u of patients) expect(new URL(u).searchParams.has('site_id')).toBe(false);
    });

    it('never puts the internal __sites marker in a request', async () => {
        const urls = capture();
        await syncOneOrg('org-1', {
            secrets: SECRETS, config: { site_ids: ['S1', 'S2'] }, last_sync_at: null,
        }, () => {});
        for (const u of urls) expect(u).not.toContain('__sites');
    });
});

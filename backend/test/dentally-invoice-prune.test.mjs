// ============================================================================
// Dentally invoice delete-reconciliation.
//
// The sync only ever upserts. Appointments and payments each have a prune that
// re-reads Dentally's authoritative id set and removes what Dentally no longer
// returns; invoices had none, so an invoice deleted in Dentally stayed in our
// database forever and every money card built on `invoices` read high.
//
// Measured on the live project 2026-09-07: 150 invoices worth £182,244.42 that
// Dentally returns 404 for. Rochester, August 2026 alone held 8 of them — our
// card read £144,940.18 / 299 invoices against Dentally's £138,363.88 / 291,
// and subtracting exactly those 8 reconciled all three of Dentally's Invoice
// Timeline columns to the penny (total, outstanding, count).
//
// THE ONE THING THAT MAKES THIS DIFFERENT from the appointment/payment prunes:
// Dentally's /invoices endpoint SILENTLY IGNORES every date filter. Verified
// against the live API — `dated_after`/`dated_before`, `dated_from`/`dated_to`
// and `filter[dated_from]`/`filter[dated_to]` all return the identical full
// 23,712-invoice collection. Only `site_id` narrows it. So this prune cannot be
// windowed the way its two siblings are: it reconciles the WHOLE collection,
// and our side must be read at the same scope or the comparison is a lie.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { reconcileDeletedInvoices, selectStaleInvoiceIds } =
    await import('../src/lib/integrations/dentally-sync.js');

const ORG = 'org-inv-prune';
const BASE = 'https://api.dentally.co/v1';
const AUTH = 'Bearer k';

// --- helpers ---------------------------------------------------------------

// A fake /invoices collection served page by page, recording every URL asked
// for so a test can assert what the pull actually requested.
function fakeRemote(ids, { perPage = 100, status = 200 } = {}) {
    const urls = [];
    const fetchImpl = async (url) => {
        urls.push(String(url));
        if (status !== 200) return { ok: false, status, json: async () => ({}) };
        const page = Number(new URL(url).searchParams.get('page') || 1);
        const slice = ids.slice((page - 1) * perPage, page * perPage);
        return { ok: true, status: 200, json: async () => ({ invoices: slice.map((id) => ({ id })) }) };
    };
    return { urls, fetchImpl };
}

// Our invoices table, served through the keyset cursor the reader uses.
function ourInvoices(rows) {
    return (q) => {
        if (q.table !== 'invoices' || q.op !== 'select') return { data: [], error: null };
        const cursor = (q.gts ?? []).find((g) => g.col === 'external_id')?.val;
        const sorted = [...rows].sort((a, b) => String(a.external_id).localeCompare(String(b.external_id)));
        const page = cursor
            ? sorted.filter((r) => String(r.external_id).localeCompare(String(cursor)) > 0)
            : sorted;
        return { data: page.slice(0, q.limitN ?? 1000), error: null };
    };
}

let deletes;
beforeEach(() => {
    deletes = [];
    const base = ourInvoices([]);
    supaRec.resultProvider = (q) => {
        if (q.op === 'delete') { deletes.push(q); return { data: [], error: null }; }
        return base(q);
    };
});
afterEach(() => { vi.restoreAllMocks(); });

function withDb(rows) {
    const read = ourInvoices(rows);
    supaRec.resultProvider = (q) => {
        if (q.op === 'delete') { deletes.push(q); return { data: [], error: null }; }
        return read(q);
    };
}

// --- the pure guard --------------------------------------------------------

describe('selectStaleInvoiceIds (invoice delete-reconciliation safety)', () => {
    const rows = (ids) => ids.map((x) => ({ id: `inv-${x}`, external_id: String(x) }));

    it('flags only invoices Dentally no longer returns', () => {
        // The live Rochester finding in miniature: two of four are gone upstream.
        const our = rows([63134136, 63485041, 63279797, 63365800]);
        const remote = new Set(['63279797', '63365800']);
        const { ids, externalIds, aborted } = selectStaleInvoiceIds(our, remote);
        expect(aborted).toBeNull();
        expect(ids.sort()).toEqual(['inv-63134136', 'inv-63485041']);
        // The external ids come back too — invoice_items keys on pms_invoice_id,
        // not on our row id, so the cascade needs them.
        expect(externalIds.sort()).toEqual(['63134136', '63485041']);
    });

    it('aborts (deletes nothing) on an empty remote set — a bad or partial pull', () => {
        const { ids, aborted } = selectStaleInvoiceIds(rows([1, 2, 3]), new Set());
        expect(aborted).toBe('empty_remote');
        expect(ids).toEqual([]);
    });

    it('aborts when it would delete more than half the collection', () => {
        const { ids, aborted } = selectStaleInvoiceIds(rows([1, 2, 3, 4]), new Set(['1']));
        expect(aborted).toBe('safety_threshold');
        expect(ids).toEqual([]);
    });

    it('no-ops cleanly on an empty table', () => {
        expect(selectStaleInvoiceIds([], new Set())).toEqual({ ids: [], externalIds: [], aborted: null });
    });
});

// --- the reconciler --------------------------------------------------------

describe('reconcileDeletedInvoices', () => {
    it('removes the invoices Dentally has deleted, and their fee lines with them', async () => {
        const { fetchImpl } = fakeRemote(['1', '2', '4']);
        vi.stubGlobal('fetch', vi.fn(fetchImpl));
        withDb([
            { id: 'inv-1', external_id: '1' },
            { id: 'inv-2', external_id: '2' },
            { id: 'inv-3', external_id: '3' }, // deleted in Dentally
            { id: 'inv-4', external_id: '4' },
        ]);

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH);

        expect(res.aborted).toBeUndefined();
        expect(res.deleted).toBe(1);
        // Fee lines go first: invoice_items keys on the Dentally invoice id, so
        // deleting the invoice first would leave nothing to find them by.
        expect(deletes.map((d) => d.table)).toEqual(['invoice_items', 'invoices']);
        expect(deletes[0].ins).toEqual([{ col: 'pms_invoice_id', vals: ['3'] }]);
        expect(deletes[1].ins).toEqual([{ col: 'id', vals: ['inv-3'] }]);
        // Never reach outside this tenant.
        expect(deletes[0].eqs).toContainEqual({ col: 'organisation_id', val: ORG });
        expect(deletes[1].eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    });

    it('reads the WHOLE collection, unfiltered by date, on both sides', async () => {
        // Dentally ignores date filters on /invoices, so a windowed remote pull
        // would return the full set anyway — and the day Dentally starts
        // honouring them, a windowed remote set compared against an unwindowed
        // local one would delete every invoice outside the window. Pinning both
        // sides to the same (full) scope is what makes the comparison sound.
        const { urls, fetchImpl } = fakeRemote(['1']);
        vi.stubGlobal('fetch', vi.fn(fetchImpl));
        const reads = [];
        withDb([{ id: 'inv-1', external_id: '1' }]);
        const inner = supaRec.resultProvider;
        supaRec.resultProvider = (q) => { if (q.op === 'select') reads.push(q); return inner(q); };

        await reconcileDeletedInvoices(ORG, BASE, AUTH);

        for (const u of urls) {
            const p = new URL(u).searchParams;
            for (const k of ['dated_after', 'dated_before', 'dated_from', 'dated_to', 'filter[dated_from]']) {
                expect(p.get(k)).toBeNull();
            }
        }
        const invRead = reads.find((q) => q.table === 'invoices');
        expect(invRead.gtes ?? []).toEqual([]);
        expect(invRead.ltes ?? []).toEqual([]);
        expect(invRead.lts ?? []).toEqual([]);
    });

    it('deletes nothing when the remote pull errors', async () => {
        const { fetchImpl } = fakeRemote([], { status: 500 });
        vi.stubGlobal('fetch', vi.fn(fetchImpl));
        withDb([{ id: 'inv-1', external_id: '1' }, { id: 'inv-2', external_id: '2' }]);

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH);

        expect(res.aborted).toBe('http_500');
        expect(res.deleted).toBe(0);
        expect(deletes).toEqual([]);
    });

    it('deletes nothing when the collection is larger than the page cap', async () => {
        // A partial remote set makes every unseen invoice look deleted. This is
        // the failure that would wipe real money, so it must abort, not trim.
        const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));
        const { fetchImpl } = fakeRemote(ids);
        vi.stubGlobal('fetch', vi.fn(fetchImpl));
        withDb(ids.map((x) => ({ id: `inv-${x}`, external_id: x })));

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH, { maxPages: 2 });

        expect(res.aborted).toBe('page_cap');
        expect(res.deleted).toBe(0);
        expect(deletes).toEqual([]);
    });

    it('deletes nothing when a fetch throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
        withDb([{ id: 'inv-1', external_id: '1' }]);

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH);

        expect(res.aborted).toBe('fetch_error');
        expect(deletes).toEqual([]);
    });

    it('reuses a caller-supplied remote id set instead of paging the collection twice', async () => {
        // The backfill reconciler already walks all ~240 pages of /invoices. Doing
        // it again here would double a nightly cost that is already the most
        // expensive thing in the sync, for an identical answer.
        const fetchSpy = vi.fn(async () => { throw new Error('should not fetch'); });
        vi.stubGlobal('fetch', fetchSpy);
        withDb([{ id: 'inv-1', external_id: '1' }, { id: 'inv-2', external_id: '2' }]);

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH, { remoteIds: new Set(['1']) });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(res.deleted).toBe(1);
        expect(deletes[1].ins).toEqual([{ col: 'id', vals: ['inv-2'] }]);
    });

    it('pages the collection itself when the caller supplies nothing', async () => {
        // The caller passes null when ITS pull was truncated or errored — a
        // partial set must never be mistaken for an authoritative one, which is
        // the whole reason this function is fail-closed.
        const { fetchImpl } = fakeRemote(['1', '2']);
        const spy = vi.fn(fetchImpl);
        vi.stubGlobal('fetch', spy);
        withDb([{ id: 'inv-1', external_id: '1' }, { id: 'inv-2', external_id: '2' }]);

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH, { remoteIds: null });

        expect(spy).toHaveBeenCalled();
        expect(res.deleted).toBe(0);
    });

    it('pages the whole collection before deciding', async () => {
        // 250 invoices over 3 pages, one of ours missing from all of them.
        const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));
        const { fetchImpl } = fakeRemote(ids);
        vi.stubGlobal('fetch', vi.fn(fetchImpl));
        withDb([...ids, '9999'].map((x) => ({ id: `inv-${x}`, external_id: x })));

        const res = await reconcileDeletedInvoices(ORG, BASE, AUTH);

        expect(res.remote).toBe(250);
        expect(res.deleted).toBe(1);
        expect(deletes[1].ins).toEqual([{ col: 'id', vals: ['inv-9999'] }]);
    });
});

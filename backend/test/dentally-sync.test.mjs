// Dentally sync — pure mappers, fetchAllPages (pagination + 429 backoff),
// and syncOneOrg mapping/upsert with practice resolution + unmatched skip.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

// integration.repository.upsert chains .select().single() which the supabase
// fake doesn't model; mock the repo so syncOneOrg's bookkeeping is observable.
vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { syncOneOrg, syncAllOrgs, bootstrapOnConnect, backfillTreatmentItems, invoiceRow, selectStaleAppointmentIds, __test } = await import('../src/lib/integrations/dentally-sync.js');
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

    it('mapAppointmentStatus handles the live Title-Case, space-separated states', () => {
        // The real /appointments `state` is "Did not attend" / "In surgery" /
        // "Cancelled" / "Completed" — NOT snake_case. Spaces must normalise or
        // DNA falls through to 'scheduled' and no_show never populates.
        expect(__test.mapAppointmentStatus('Did not attend')).toBe('no_show');
        expect(__test.mapAppointmentStatus('Cancelled')).toBe('cancelled');
        expect(__test.mapAppointmentStatus('Completed')).toBe('completed');
        expect(__test.mapAppointmentStatus('Confirmed')).toBe('confirmed');
        expect(__test.mapAppointmentStatus('In surgery')).toBe('in_progress');
    });
    it('mapPaymentStatus: Dentally status strings + legacy paid flag', () => {
        // Live Dentally /payments status vocabulary (verified against the API).
        expect(__test.mapPaymentStatus({ status: 'paid' })).toBe('settled');
        // unexplained / partially_explained = money RECEIVED, not yet allocated to
        // an invoice line. It is cash in (a patient credit / deposit), so it counts
        // as a settled receipt — NOT pending debt. Mapping it to pending double-
        // wronged the dashboard: it dropped real receipts out of RECEIVED and piled
        // them into a fake all-time OUTSTANDING. Verified against the live API:
        // amount is the full sum taken; amount_unexplained is only the unallocated
        // remainder. (see investigation: dentally-payment-status-misclass)
        expect(__test.mapPaymentStatus({ status: 'unexplained' })).toBe('settled');
        expect(__test.mapPaymentStatus({ status: 'partially_explained' })).toBe('settled');
        // Back-compat with the old fake/webhook shapes.
        expect(__test.mapPaymentStatus({ paid: true })).toBe('settled');
        expect(__test.mapPaymentStatus({ state: 'failed' })).toBe('failed');
        expect(__test.mapPaymentStatus({ state: 'whatever' })).toBe('pending');
    });
    it('mapPaymentMethod normalises Dentally Title-Case methods, slugs unknowns', () => {
        // Dentally sends Title-Case strings ("Credit Card") — the old lowercase
        // snake whitelist null'd ~94% of real rows. Normalise to our canonical set.
        expect(__test.mapPaymentMethod('Credit Card')).toBe('card');
        expect(__test.mapPaymentMethod('Debit Card')).toBe('card');
        expect(__test.mapPaymentMethod('Cash')).toBe('cash');
        expect(__test.mapPaymentMethod('BACS')).toBe('bank_transfer');
        expect(__test.mapPaymentMethod('Direct Debit')).toBe('direct_debit');
        expect(__test.mapPaymentMethod('CARD')).toBe('card');
        // Unknown but real method: preserve as a slug, never silently null.
        expect(__test.mapPaymentMethod('Crypto Wallet')).toBe('crypto_wallet');
        // Only genuinely empty values map to null.
        expect(__test.mapPaymentMethod('')).toBeNull();
        expect(__test.mapPaymentMethod(null)).toBeNull();
    });
    it('paymentRow: skips Dentally-deleted payments', () => {
        const siteMap = new Map([['s1', 'prac-1']]);
        const contactMap = new Map([['pat-1', 'contact-1']]);
        const base = { id: 'p1', site_id: 's1', patient_id: 'pat-1', amount: '40.0', method: 'Credit Card', status: 'paid', dated_on: '2026-05-10' };
        expect(__test.paymentRow('org-1', base, siteMap, contactMap)).toMatchObject({ method: 'card', status: 'settled', amount_pence: 4000 });
        expect(__test.paymentRow('org-1', { ...base, deleted: true }, siteMap, contactMap)).toBeNull();
    });
});

describe('invoiceRow', () => {
  const siteMap = new Map([['site-1', 'prac-1']]);
  const contactMap = new Map([['pat-1', 'contact-1']]);

  it('maps a Dentally invoice to an invoices row', () => {
    const row = invoiceRow('org-1', {
      id: 'inv-1', site_id: 'site-1', patient_id: 'pat-1',
      amount: 100, amount_outstanding: 40, dated_on: '2026-01-01',
      due_on: '2026-01-31', paid: false,
      invoice_items: [{ treatment: 'Implant' }], patient_name: 'R Sutton',
    }, siteMap, contactMap);
    expect(row).toMatchObject({
      organisation_id: 'org-1', source: 'dentally', external_id: 'inv-1',
      practice_id: 'prac-1', contact_id: 'contact-1',
      amount_pence: 10000, amount_outstanding_pence: 4000,
      dated_on: '2026-01-01', due_on: '2026-01-31', paid: false,
      treatment: 'Implant', patient_name: 'R Sutton',
    });
  });

  it('returns null when the site maps to no practice (practice_id is NOT NULL)', () => {
    expect(invoiceRow('org-1', { id: 'x', site_id: 'unknown' }, siteMap, contactMap)).toBeNull();
  });

  it('summarises multiple invoice items as "Multiple items"', () => {
    const row = invoiceRow('org-1', {
      id: 'inv-2', site_id: 'site-1', invoice_items: [{ treatment: 'A' }, { treatment: 'B' }],
    }, siteMap, contactMap);
    expect(row.treatment).toBe('Multiple items');
    expect(row.amount_pence).toBe(0);
    expect(row.amount_outstanding_pence).toBe(0);
  });

  it('leaves contact_id null for an unknown patient', () => {
    const row = invoiceRow('org-1', { id: 'inv-3', site_id: 'site-1', patient_id: 'ghost' }, siteMap, contactMap);
    expect(row.contact_id).toBeNull();
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

describe('selectStaleAppointmentIds (delete-reconciliation safety)', () => {
    const rows = (ids) => ids.map((x) => ({ id: `row-${x}`, pms_external_id: String(x) }));
    it('flags only rows whose pms id Dentally no longer returns', () => {
        const our = rows([1, 2, 3, 4]);
        const remote = new Set(['1', '2', '4']); // 3 deleted in Dentally
        const { ids, aborted } = selectStaleAppointmentIds(our, remote);
        expect(aborted).toBeNull();
        expect(ids).toEqual(['row-3']);
    });
    it('aborts (deletes nothing) when the remote set is empty — a bad/partial pull', () => {
        const { ids, aborted } = selectStaleAppointmentIds(rows([1, 2, 3]), new Set());
        expect(aborted).toBe('empty_remote');
        expect(ids).toEqual([]);
    });
    it('aborts when it would delete more than half the window (silent shape change)', () => {
        const our = rows([1, 2, 3, 4]);
        const remote = new Set(['1']); // would delete 3 of 4 -> implausible
        const { ids, aborted } = selectStaleAppointmentIds(our, remote);
        expect(aborted).toBe('safety_threshold');
        expect(ids).toEqual([]);
    });
    it('no-ops cleanly on an empty window', () => {
        expect(selectStaleAppointmentIds([], new Set())).toEqual({ ids: [], aborted: null });
    });
    it('keeps rows present in Dentally even at the boundary (no false delete)', () => {
        const our = rows([10, 11]);
        const remote = new Set(['10', '11']);
        expect(selectStaleAppointmentIds(our, remote).ids).toEqual([]);
    });
});

describe('selectStalePaymentIds (payment delete-reconciliation safety)', () => {
    const { selectStalePaymentIds } = __test;
    // Payments key on external_id (not pms_external_id).
    const rows = (ids) => ids.map((x) => ({ id: `pay-${x}`, external_id: String(x) }));
    it('flags only payments Dentally voided/removed (id no longer in the feed)', () => {
        // Mirrors the live finding: a voided duplicate (32459) + a voided payment
        // (32485) linger in our DB and inflate Takings.
        const our = rows([32450, 32459, 32485, 32500]);
        const remote = new Set(['32450', '32500']); // 32459 + 32485 voided in Dentally
        const { ids, aborted } = selectStalePaymentIds(our, remote);
        expect(aborted).toBeNull();
        expect(ids.sort()).toEqual(['pay-32459', 'pay-32485']);
    });
    it('aborts (deletes nothing) on an empty remote set — a bad/partial pull', () => {
        const { ids, aborted } = selectStalePaymentIds(rows([1, 2, 3]), new Set());
        expect(aborted).toBe('empty_remote');
        expect(ids).toEqual([]);
    });
    it('aborts when it would delete more than half the window (silent shape change)', () => {
        const our = rows([1, 2, 3, 4]);
        const { ids, aborted } = selectStalePaymentIds(our, new Set(['1']));
        expect(aborted).toBe('safety_threshold');
        expect(ids).toEqual([]);
    });
    it('no-ops cleanly on an empty window', () => {
        expect(selectStalePaymentIds([], new Set())).toEqual({ ids: [], aborted: null });
    });
});

describe('invoiceItemRow', () => {
    const ORG = 'org-1';
    const invoiceMap = new Map([
        ['9001', { practice_id: 'prac-A', contact_id: 'contact-7', dated_on: '2026-05-10', paid: true }],
    ]);
    const practitionerMap = new Map([['p55', 'assoc-9']]);

    it('maps name + string prices to pence and resolves practice/date from the invoice', () => {
        const row = __test.invoiceItemRow(ORG, {
            id: 'ii-1', name: 'Single Implant', item_price: '2050.0', total_price: '2050.0',
            quantity: 1, nhs_charge: false, invoice_id: 9001, practitioner_id: 'p55',
            treatment_plan_id: 'tp-3',
        }, invoiceMap, practitionerMap);
        expect(row).toMatchObject({
            organisation_id: ORG, source: 'dentally', pms_external_id: 'ii-1',
            pms_invoice_id: '9001', treatment_name: 'Single Implant',
            unit_price_pence: 205000, fee_pence: 205000, quantity: 1, nhs_charge: false,
            practice_id: 'prac-A', contact_id: 'contact-7', associate_id: 'assoc-9',
            treatment_plan_id: 'tp-3', invoiced_on: '2026-05-10', invoice_paid: true,
        });
    });

    it('total_price drives the qty-inclusive fee; quantity defaults to 1', () => {
        const row = __test.invoiceItemRow(ORG, {
            id: 'ii-2', name: 'Crown', item_price: '200', total_price: '600', quantity: 3, invoice_id: 9001,
        }, invoiceMap);
        expect(row.unit_price_pence).toBe(20000);
        expect(row.fee_pence).toBe(60000);
        expect(row.quantity).toBe(3);
        const noQty = __test.invoiceItemRow(ORG, { id: 'ii-3', name: 'X', item_price: '10', invoice_id: 9001 }, invoiceMap);
        expect(noQty.quantity).toBe(1);
        expect(noQty.fee_pence).toBe(1000); // falls back to item_price when total_price absent
    });

    it('unknown invoice -> null practice/date, never throws', () => {
        const row = __test.invoiceItemRow(ORG, { id: 'ii-4', name: 'Y', item_price: '5', invoice_id: 9999 }, invoiceMap);
        expect(row.practice_id).toBeNull();
        expect(row.contact_id).toBeNull();
        expect(row.invoiced_on).toBeNull();
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
        const out = await __test.fetchAllPages('https://api.dentally.co/v1', '/patients', 'Bearer k', { updated_after: 'x' });
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

describe('streamPages (bounded-memory pagination)', () => {
    it('hands each page to onBatch and never buffers the whole resource', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(page({ appointments: [{ id: 1 }, { id: 2 }], meta: { total_pages: 3 } }))
            .mockResolvedValueOnce(page({ appointments: [{ id: 3 }, { id: 4 }], meta: { total_pages: 3 } }))
            .mockResolvedValueOnce(page({ appointments: [{ id: 5 }], meta: { total_pages: 3 } }));
        const batches = [];
        const total = await __test.streamPages('https://b', '/appointments', 'Bearer k', { updated_after: 'x' },
            (items, p) => { batches.push({ p, n: items.length, ids: items.map((i) => i.id) }); });
        // One batch per page — the caller upserts+discards each, so peak memory is
        // a single page, not all 5 rows at once.
        expect(batches.map((b) => b.n)).toEqual([2, 2, 1]);
        expect(batches.flatMap((b) => b.ids)).toEqual([1, 2, 3, 4, 5]);
        expect(total).toBe(5); // returns the running count, not an accumulated array
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
        integrationRepository.mergeConfig.mockReset();
    });

    it('streams appointment upserts one per page (no single buffered upsert of the whole resource)', async () => {
        const base = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const apptUpsertSizes = [];
        supaRec.resultProvider = (q) => {
            if (q.op === 'upsert' && q.table === 'appointments') apptUpsertSizes.push(q.upsertVals.length);
            return base(q);
        };
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            if (u.pathname.endsWith('/appointments') && u.searchParams.get('after') == null) {
                const p = Number(u.searchParams.get('page'));
                return page({ appointments: [
                    { id: `A${p}a`, patient_id: 'P1', site_id: 'S1', start_time: 't', finish_time: 't', state: 'completed' },
                    { id: `A${p}b`, patient_id: 'P1', site_id: 'S1', start_time: 't', finish_time: 't', state: 'completed' },
                ], meta: { total_pages: 3 } });
            }
            const seg = u.pathname.split('/').pop();
            return page({ [seg]: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        const res = await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' });
        // 3 pages => 3 separate upserts of 2 rows each. The old code buffered all
        // pages then issued ONE upsert of 6 (the unbounded array that OOM-killed
        // a large backfill).
        expect(apptUpsertSizes).toEqual([2, 2, 2]);
        expect(res.appointments).toBe(6);
    });

    it('full pull records a per-phase checkpoint and clears it on completion', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        global.fetch = vi.fn(async (url) => {
            const seg = new URL(url.toString()).pathname.split('/').pop();
            return page({ [seg]: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' }, () => {}, { full: true });
        const cursorCalls = integrationRepository.mergeConfig.mock.calls.filter((c) => 'dentally_sync_cursor' in (c[2] ?? {}));
        // A checkpoint is written per completed heavy phase, then cleared at the end.
        expect(cursorCalls.length).toBeGreaterThan(1);
        expect(cursorCalls.at(-1)[2].dentally_sync_cursor).toBeNull();
    });

    it('resume: a checkpointed phase for the same window is not re-pulled', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T00:00:00Z'));
        const windowKey = new Date(Date.now() - 6 * 30 * 86400000).toISOString().slice(0, 10);
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const pageOneHits = {};
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            const seg = u.pathname.split('/').pop();
            if (u.searchParams.get('page') === '1') pageOneHits[seg] = (pageOneHits[seg] ?? 0) + 1;
            return page({ [seg]: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', {
            secrets,
            config: { dentally_sync_cursor: { window: windowKey, done: ['patients'] } },
            last_sync_at: '2026-01-01T00:00:00Z',
        }, () => {}, { full: true });
        // patients: up-front page-count probe fires (1 hit) but the pull is skipped
        // by the checkpoint — so exactly 1 page-1 hit, not 2.
        expect(pageOneHits['patients']).toBe(1);
        // appointments: not checkpointed -> probe + real pull (2) + the delete-
        // reconciliation's own windowed id pull (1) = 3 page-1 hits.
        expect(pageOneHits['appointments']).toBe(3);
        vi.useRealTimers();
    });

    it('selective resources pulls ONLY the named collections, skipping the rest', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const pageOneHits = {};
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            const seg = u.pathname.split('/').pop();
            if (u.searchParams.get('page') === '1') pageOneHits[seg] = (pageOneHits[seg] ?? 0) + 1;
            return page({ [seg]: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' }, () => {}, {
            full: true,
            resources: ['patients'],
        });
        // patients selected -> up-front probe (1) + real pull (1) = 2 page-1 hits.
        expect(pageOneHits['patients']).toBe(2);
        // Every unselected heavy collection is neither probed nor pulled: the
        // whole point — a patients-only run never touches payments/invoices.
        expect(pageOneHits['payments'] ?? 0).toBe(0);
        expect(pageOneHits['appointments'] ?? 0).toBe(0);
        expect(pageOneHits['invoices'] ?? 0).toBe(0);
        expect(pageOneHits['invoice_items'] ?? 0).toBe(0);
        expect(pageOneHits['treatment_plans'] ?? 0).toBe(0);
        // practitioners feed appointment/treatment resolution only -> skipped too.
        expect(pageOneHits['practitioners'] ?? 0).toBe(0);
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
            if (u.includes('/invoices')) return page({ invoices: [
                { id: 'INV1', patient_id: 'P1', site_id: 'S1', amount: 200, amount_outstanding: 50, dated_on: 'd1', due_on: 'd2', paid: false, invoice_items: [{ treatment: 'Crown' }] },
            ], meta: { total_pages: 1 } });
            return page({});
        });

        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        const res = await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' });

        expect(res.appointments).toBe(1);          // A2 skipped (unknown site)
        expect(res.skipped_unmatched_practice).toBe(1);
        expect(res.payments).toBe(1);
        expect(res.invoices).toBe(1);
        const invUpsert = queries.find((q) => q.table === 'invoices' && q.op === 'upsert');
        expect(invUpsert.upsertVals[0]).toMatchObject({
            organisation_id: 'org-1', source: 'dentally', external_id: 'INV1',
            practice_id: 'prac-1', amount_pence: 20000, amount_outstanding_pence: 5000, contact_id: 'cont-1',
        });
        expect(invUpsert.upsertOpts.onConflict).toBe('organisation_id,source,external_id');

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

    it('reports progress for every heavy pull + a final linking phase (no silent stretch, no frozen 99%)', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        // Every collection returns one page of one row so each phase reports.
        global.fetch = vi.fn(async (url) => {
            const u = url.toString();
            const key = u.includes('/patients') ? 'patients'
                : u.includes('/appointments') ? 'appointments'
                : u.includes('/payments') ? 'payments'
                : u.includes('/treatment_plans') ? 'treatment_plans'
                : u.includes('/invoice_items') ? 'invoice_items'
                : u.includes('/invoices') ? 'invoices'
                : u.includes('/practitioners') ? 'practitioners'
                : u.includes('/users') ? 'users'
                : null;
            if (!key) return page({});
            return page({ [key]: [{ id: `${key}-1`, site_id: 'S1', patient_id: 'P1', invoice_id: 'invoices-1', name: 'X', item_price: '1' }], meta: { total_pages: 1 } });
        });
        const phases = [];
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' }, (p) => phases.push(p.phase));

        // The previously-silent heavy pulls now each emit progress.
        for (const ph of ['patients', 'appointments', 'payments', 'treatment_plans', 'invoices', 'invoice_items']) {
            expect(phases).toContain(ph);
        }
        // The 99% tail (relink RPCs) is announced, not silent.
        expect(phases).toContain('linking');
        // linking is emitted after the data pulls (it precedes the relink RPCs).
        expect(phases.lastIndexOf('linking')).toBeGreaterThan(phases.lastIndexOf('invoice_items'));
    });

    it('pulls /invoices once (the invoice map is built from the same fetch, not a second pull)', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        let invoiceListPulls = 0;
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            // Count only the paginating collection pulls of /invoices (page param
            // present), not the up-front page-count probe — both hit the path, but
            // the duplicate we removed was a second *full* pull.
            if (u.pathname.endsWith('/invoices') && u.searchParams.get('page') === '1') invoiceListPulls++;
            const seg = u.pathname.split('/').pop();
            return page({ [seg]: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-01-01T00:00:00Z' });
        // probe (fetchPageCount) + one real pull = 2 page-1 hits; the old code did
        // 3 (probe + buildInvoiceMap + pullInvoices).
        expect(invoiceListPulls).toBe(2);
    });

    it('recent mode: all three resources pull the same ~12-month updated_after window (no open-only `after`)', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const seen = [];
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            seen.push({ path: u.pathname, updated_after: u.searchParams.get('updated_after'), dated_after: u.searchParams.get('dated_after'), after: u.searchParams.get('after') });
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-05-01T00:00:00Z' }, () => {}, { recent: true });

        const expected12 = Date.now() - 12 * 30 * 86400000; // RECENT_MONTHS
        const patients = seen.filter((s) => s.path.includes('/patients'));
        const payments = seen.filter((s) => s.path.includes('/payments'));
        const appts = seen.filter((s) => s.path.includes('/appointments'));
        expect(patients.length).toBeGreaterThan(0);
        expect(payments.length).toBeGreaterThan(0);
        expect(appts.length).toBeGreaterThan(0);
        // Patients pull the bounded 1-year window via updated_after.
        for (const s of patients) {
            expect(s.after).toBeNull();
            expect(Math.abs(new Date(s.updated_after).getTime() - expected12)).toBeLessThan(86400000);
        }
        // Payments have NO updated_after on Dentally — bounded by dated_after
        // (date-only) on the same ~12-month window instead.
        for (const s of payments) {
            expect(s.after).toBeNull();
            expect(s.updated_after).toBeNull();
            expect(Math.abs(new Date(s.dated_after).getTime() - expected12)).toBeLessThan(2 * 86400000);
        }
        // Appointments are pulled BOTH ways on bootstrap: the 1-year history via
        // updated_after (for Associates / Treatment Mix / Pay) AND the upcoming
        // book via `after=now` (for the live Appointments diary — a separate
        // query so years of history can't crowd future bookings out under the
        // page cap).
        const apptHistory = appts.filter((s) => s.updated_after != null);
        const apptUpcoming = appts.filter((s) => s.after != null);
        expect(apptHistory.length).toBeGreaterThan(0);
        expect(apptUpcoming.length).toBeGreaterThan(0);
        for (const s of apptHistory) {
            expect(Math.abs(new Date(s.updated_after).getTime() - expected12)).toBeLessThan(86400000);
        }
        for (const s of apptUpcoming) {
            expect(Math.abs(new Date(s.after).getTime() - Date.now())).toBeLessThan(86400000);
        }
    });

    it('always requests cancelled + DNA appointments (cancelled=true on every /appointments pull)', async () => {
        // Dentally's GET /appointments defaults cancelled=false, silently dropping
        // BOTH cancelled and did_not_attend rows. Without cancelled=true we store
        // zero no_show rows (no-show rate shows "—") and undercount Dentally's
        // "found" total by the cancelled volume. Probe + history + upcoming pulls
        // must all carry the flag, or the gap reopens. (regression: see
        // dentally appointment cancelled/DNA sync gap)
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const apptCalls = [];
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            if (u.pathname.includes('/appointments')) apptCalls.push(u.searchParams.get('cancelled'));
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-05-01T00:00:00Z' }, () => {}, { recent: true });

        expect(apptCalls.length).toBeGreaterThan(0);
        for (const c of apptCalls) expect(c).toBe('true');
    });
});

describe('syncAllOrgs (nightly cron) — one-time overnight backfill', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
        integrationRepository.mergeConfig.mockReset();
    });

    it('first run full-backfills the 6-month window then flags the org', async () => {
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        supaRec.resultProvider = (q) => {
            if (q.table === 'integrations' && q.op === 'select')
                return { data: [{ organisation_id: 'org-1', provider: 'dentally', status: 'active', secrets, config: {}, last_sync_at: '2026-05-01T00:00:00Z' }], error: null };
            if (q.table === 'practices') return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
            return { data: [], error: null };
        };
        const seen = [];
        global.fetch = vi.fn(async (url) => {
            seen.push(new URL(url.toString()).searchParams.get('updated_after'));
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const res = await syncAllOrgs();
        expect(res[0].backfill).toBe(true);
        // full backfill is now a rolling 6-month window (was 2 years / a 2005 anchor).
        const expected6mo = Date.now() - 6 * 30 * 86400000;
        const windowed = seen.filter(Boolean);
        expect(windowed.some((s) => Math.abs(new Date(s).getTime() - expected6mo) < 86400000)).toBe(true);
        expect(windowed.some((s) => s.startsWith('2005-'))).toBe(false);
        // The full pull already seeds treatment_plan_items, so both one-time flags
        // are set together — no separate item backfill needed for a fresh org.
        expect(integrationRepository.mergeConfig).toHaveBeenCalledWith('org-1', 'dentally', { history_backfilled: true, treatment_items_backfilled: true });
    });

    it('once flagged, later runs ride the incremental cursor (no re-backfill)', async () => {
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        supaRec.resultProvider = (q) => {
            if (q.table === 'integrations' && q.op === 'select')
                return { data: [{ organisation_id: 'org-2', provider: 'dentally', status: 'active', secrets, config: { history_backfilled: true, treatment_items_backfilled: true }, last_sync_at: '2026-05-01T00:00:00Z' }], error: null };
            if (q.table === 'practices') return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
            return { data: [], error: null };
        };
        const seen = [];
        global.fetch = vi.fn(async (url) => {
            seen.push(new URL(url.toString()).searchParams.get('updated_after'));
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const res = await syncAllOrgs();
        expect(res[0].backfill).toBe(false);
        const windowed = seen.filter(Boolean);
        expect(windowed.length).toBeGreaterThan(0);
        expect(windowed.every((s) => s.startsWith('2026-05'))).toBe(true); // incremental from last_sync_at
        expect(integrationRepository.mergeConfig).not.toHaveBeenCalled();
    });

    it('legacy org (history backfilled, no item flag) runs a one-time treatment_items backfill', async () => {
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        supaRec.resultProvider = (q) => {
            if (q.table === 'integrations' && q.op === 'select')
                return { data: [{ organisation_id: 'org-3', provider: 'dentally', status: 'active', secrets, config: { history_backfilled: true }, last_sync_at: '2026-05-01T00:00:00Z' }], error: null };
            if (q.table === 'practices') return { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null };
            return { data: [], error: null };
        };
        // Record which resource + window each call hit.
        const items = [];
        global.fetch = vi.fn(async (url) => {
            const u = new URL(url.toString());
            items.push({ path: u.pathname, since: u.searchParams.get('updated_after') });
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const res = await syncAllOrgs();
        expect(res[0].backfill).toBe(false); // main sync stays incremental
        // The one-time item backfill pulled /treatment_plan_items over the full
        // 6-month window (not the 2026-05 incremental cursor) ...
        const expected6mo = Date.now() - 6 * 30 * 86400000;
        const itemPulls = items.filter((c) => c.path.endsWith('/treatment_plan_items'));
        expect(itemPulls.length).toBeGreaterThan(0);
        expect(itemPulls.some((c) => c.since && Math.abs(new Date(c.since).getTime() - expected6mo) < 86400000)).toBe(true);
        // ... and, on reaching the end of the collection, flipped the one-time flag
        // (and cleared the resume cursor) so it never repeats.
        expect(integrationRepository.mergeConfig).toHaveBeenCalledWith('org-3', 'dentally', { treatment_items_backfilled: true, treatment_items_backfill_page: null });
    });
});

describe('isRateLimited — Dentally signals rate limits as 403, not just 429', () => {
    const mk = (status, body) => ({ status, clone: () => ({ text: async () => body }) });
    it('treats a 403 "Rate limit exceeded" body as a rate-limit', async () => {
        expect(await __test.isRateLimited(mk(403, JSON.stringify({ error: { type: 'invalid_access_error', message: 'Rate limit exceeded' } })))).toBe(true);
    });
    it('treats a standard 429 as a rate-limit (no body read needed)', async () => {
        expect(await __test.isRateLimited({ status: 429 })).toBe(true);
    });
    it('does NOT treat a genuine 403 (auth/permission) as a rate-limit', async () => {
        expect(await __test.isRateLimited(mk(403, JSON.stringify({ error: { message: 'Forbidden' } })))).toBe(false);
    });
    it('passes through a normal 200', async () => {
        expect(await __test.isRateLimited({ status: 200 })).toBe(false);
    });
});

describe('backfillTreatmentItems — resumable page cursor', () => {
    beforeEach(() => {
        integrationRepository.mergeConfig.mockReset();
        supaRec.resultProvider = (q) => {
            if (q.table === 'associates') return { data: [{ id: 'a1', pms_external_id: 'P1', primary_practice_id: 'prac-1' }], error: null };
            if (q.table === 'contacts') return { data: [], error: null };
            return { data: [], error: null };
        };
    });

    it('resumes from the saved page cursor instead of page 1', async () => {
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        const pagesSeen = [];
        global.fetch = vi.fn(async (url) => {
            pagesSeen.push(new URL(url.toString()).searchParams.get('page'));
            return page({ treatment_plan_items: [], meta: {} }); // empty short page -> finished
        });
        const integ = { config: { history_backfilled: true, treatment_items_backfill_page: 7 }, secrets };
        const res = await backfillTreatmentItems('org-9', integ);
        expect(pagesSeen[0]).toBe('7'); // started at the cursor, not 1
        expect(res.finished).toBe(true);
        // reaching the end flips the flag AND clears the cursor
        expect(integrationRepository.mergeConfig).toHaveBeenCalledWith('org-9', 'dentally', { treatment_items_backfilled: true, treatment_items_backfill_page: null });
    });

    it('no-ops once the org is already flagged (never re-pulls)', async () => {
        global.fetch = vi.fn();
        const integ = { config: { treatment_items_backfilled: true }, secrets: encryptSecret(JSON.stringify({ apiKey: 'k' })) };
        const res = await backfillTreatmentItems('org-9', integ);
        expect(res).toEqual({ skipped: true });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(integrationRepository.mergeConfig).not.toHaveBeenCalled();
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

    it('full backfill uses a 6-month updated_after window, not the 30d/last_sync window', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'practices' ? { data: [{ id: 'prac-1', pms_site_id: 'S1' }], error: null } : { data: [], error: null };
        const seen = [];
        global.fetch = vi.fn(async (url) => {
            seen.push(new URL(url.toString()).searchParams.get('updated_after'));
            return page({ patients: [], meta: { total_pages: 1 } });
        });
        const secrets = encryptSecret(JSON.stringify({ apiKey: 'k' }));
        await syncOneOrg('org-1', { secrets, config: {}, last_sync_at: '2026-05-01T00:00:00Z' }, () => {}, { full: true });
        // every WINDOWED resource pull asked for the most-recent 6 months, ignoring
        // last_sync_at. The /users roster pull is deliberately unwindowed (full
        // team every sync), so it carries no updated_after (null) — skip it.
        const windowed = seen.filter(Boolean);
        expect(windowed.length).toBeGreaterThan(0);
        const expected6mo = Date.now() - 6 * 30 * 86400000;
        for (const s of windowed) expect(Math.abs(new Date(s).getTime() - expected6mo) < 86400000).toBe(true);
    });
});

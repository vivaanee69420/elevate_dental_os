// Row counts for the Integrations panel.
//
// The panel's only signal was integrations.last_sync_at, which is stamped once,
// on completion. A pull 4,060 contacts in read "Synced never" — identical to
// one that had never started, and to one that died at 90%. These counts are
// what distinguishes those three states.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ list: [] }));

// A chainable fake: every count query records what it was asked for and
// answers from FIXTURE. `head: true` means no row bodies come back, which is
// the property that keeps patient data out of this endpoint.
const FIXTURE = vi.hoisted(() => ({
    contacts: 4060, appointments: 14463, payments: 0, invoices: 0,
    treatment_plans: 0, associates: 75, staff: 99, practices: 1,
}));

vi.mock('../src/lib/supabase.js', () => {
    const makeQuery = (table) => {
        const q = {
            _table: table, _filters: {},
            select(_cols, opts) { this._opts = opts; return this; },
            eq(col, val) { this._filters[col] = val; return this; },
            not() { return this; },
            order(col, opts) { this._order = { col, ...opts }; return this; },
            limit() { return this; },
            maybeSingle() {
                calls.list.push({ table: this._table, filters: this._filters, order: this._order });
                return Promise.resolve({
                    data: { starts_at: this._order?.ascending ? '2024-01-04' : '2026-11-20' },
                    error: null,
                });
            },
            then(resolve) {
                calls.list.push({ table: this._table, filters: this._filters, opts: this._opts });
                return Promise.resolve(resolve({ count: FIXTURE[this._table] ?? 0, error: null }));
            },
        };
        return q;
    };
    return { serviceClient: { from: (t) => makeQuery(t) } };
});

const { importSummaryRepository } = await import('../src/repositories/import-summary.repository.js');

const ORG = 'org-1';
beforeEach(() => { calls.list = []; });

describe('importSummaryRepository.summary', () => {
    it('counts every resource the PMS writes', async () => {
        const res = await importSummaryRepository.summary(ORG, 'dentally');
        const by = Object.fromEntries(res.rows.map((r) => [r.key, r.count]));
        expect(by).toMatchObject({
            contacts: 4060, appointments: 14463, associates: 75, staff: 99, practices: 1,
        });
        expect(res.span.from).toBe('2024-01-04');
        expect(res.span.to).toBe('2026-11-20');
    });

    it('scopes every count to the organisation', async () => {
        await importSummaryRepository.summary(ORG, 'dentally');
        // There is no RLS on the serviceClient path, so a missing filter here
        // would count another tenant's rows into this tenant's panel.
        expect(calls.list.length).toBeGreaterThan(0);
        for (const c of calls.list) expect(c.filters.organisation_id).toBe(ORG);
    });

    it('filters the imported tables by source, and does NOT filter the provisioned ones', async () => {
        await importSummaryRepository.summary(ORG, 'dentally');
        const byTable = Object.fromEntries(calls.list.map((c) => [c.table, c.filters]));
        // An org with both Dentally and GoHighLevel contacts must see the
        // Dentally figure on the Dentally tile, not a combined total.
        expect(byTable.contacts.source).toBe('dentally');
        expect(byTable.appointments.source).toBe('dentally');
        // These are provisioned from the PMS rather than imported and carry no
        // `source` column — filtering on one would return zero for everything.
        expect(byTable.associates.source).toBeUndefined();
        expect(byTable.practices.source).toBeUndefined();
    });

    it('reads counts only — never row bodies', async () => {
        await importSummaryRepository.summary(ORG, 'dentally');
        const counted = calls.list.filter((c) => c.opts);
        expect(counted.length).toBeGreaterThan(0);
        for (const c of counted) {
            expect(c.opts.head).toBe(true);       // no rows come back at all
            expect(c.opts.count).toBe('exact');
        }
    });
});

describe('a count that cannot be read', () => {
    it('reports null, not zero — "unknown" and "none" are different answers', async () => {
        const broken = { ...importSummaryRepository, _client: () => ({
            from: () => ({
                select() { return this; },
                eq() { return this; },
                then(resolve) { return Promise.resolve(resolve({ count: null, error: { message: 'boom' } })); },
            }),
        }) };
        expect(await broken._count(ORG, { table: 'contacts', source: 'dentally' })).toBeNull();
    });
});

describe('the provider registry', () => {
    it('covers every provider with a tile, and tells same-table rows apart', async () => {
        const { PROVIDER_RESOURCES } = await import('../src/repositories/import-summary.repository.js');
        // Dentally and GoHighLevel both write `contacts`; QuickBooks and Xero
        // both write `monthly_financials`. Without a discriminator each tile
        // would show a combined total that matches neither.
        const shared = ['contacts', 'monthly_financials', 'ad_metrics', 'ad_accounts'];
        for (const [provider, resources] of Object.entries(PROVIDER_RESOURCES)) {
            for (const r of resources) {
                if (shared.includes(r.table)) {
                    expect(
                        Boolean(r.source || r.provider),
                        `${provider}.${r.table} shares a table and needs a source/provider filter`,
                    ).toBe(true);
                }
            }
            // A tile with no resources would render an empty panel.
            expect(resources.length, `${provider} has no resources`).toBeGreaterThan(0);
        }
    });

    it('never lists the same table twice for one provider', async () => {
        const { PROVIDER_RESOURCES } = await import('../src/repositories/import-summary.repository.js');
        for (const [provider, resources] of Object.entries(PROVIDER_RESOURCES)) {
            const keys = resources.map((r) => r.table);
            expect(new Set(keys).size, `${provider} lists a table twice`).toBe(keys.length);
        }
    });
});

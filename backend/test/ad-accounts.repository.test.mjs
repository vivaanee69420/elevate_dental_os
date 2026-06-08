// ad_accounts dimension + selection — the dynamic, org-isolated ad-account
// filter that powers the marketing views. Verifies upsert row shaping, the
// "default to selected / null when no rows" read semantics, and that selection
// updates are scoped per provider and split into select/deselect statements.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { integrationRepository } = await import('../src/repositories/integration.repository.js');

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('upsertAdAccounts', () => {
    it('shapes rows and drops entries without a customer_id', async () => {
        let captured;
        // .upsert(...).select(...) flips q.op to 'select' before settle, so key
        // off the recorded upsertVals rather than q.op.
        supaRec.resultProvider = (q) => {
            if (q.upsertVals !== undefined) captured = q;
            return { data: [], error: null };
        };
        await integrationRepository.upsertAdAccounts('org-1', 'meta_ads', [
            { customer_id: '123', name: 'Smile Co', currency: 'GBP', status: 'active' },
            { name: 'no id' }, // dropped
        ]);
        expect(captured.table).toBe('ad_accounts');
        expect(captured.upsertVals).toEqual([
            { organisation_id: 'org-1', provider: 'meta_ads', customer_id: '123', name: 'Smile Co', currency: 'GBP', status: 'active' },
        ]);
        // is_selected is NOT written on upsert (column default / preserved).
        expect(captured.upsertVals[0]).not.toHaveProperty('is_selected');
    });

    it('no-ops on an empty list', async () => {
        const out = await integrationRepository.upsertAdAccounts('org-1', 'meta_ads', []);
        expect(out).toEqual([]);
    });
});

describe('selectedAdAccountIds', () => {
    it('returns null when the org has no ad_accounts rows (no filter / back-compat)', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        expect(await integrationRepository.selectedAdAccountIds('org-1', null)).toBeNull();
    });

    it('returns only the selected customer_ids', async () => {
        supaRec.resultProvider = () => ({
            data: [
                { customer_id: 'a', is_selected: true },
                { customer_id: 'b', is_selected: false },
                { customer_id: 'c', is_selected: true },
            ],
            error: null,
        });
        expect(await integrationRepository.selectedAdAccountIds('org-1', 'google_ads')).toEqual(['a', 'c']);
    });
});

describe('setAdAccountSelection', () => {
    it('marks the chosen ids selected and the rest deselected, scoped to the provider', async () => {
        const updates = [];
        supaRec.resultProvider = (q) => {
            if (q.op === 'select') {
                return { data: [
                    { provider: 'meta_ads', customer_id: 'a', is_selected: false },
                    { provider: 'meta_ads', customer_id: 'b', is_selected: true },
                    { provider: 'meta_ads', customer_id: 'c', is_selected: true },
                ], error: null };
            }
            if (q.op === 'update') updates.push(q);
            return { data: [], error: null };
        };
        await integrationRepository.setAdAccountSelection('org-1', 'meta_ads', ['a']);
        const sel = updates.find((u) => u.updateVals.is_selected === true);
        const desel = updates.find((u) => u.updateVals.is_selected === false);
        expect(sel.ins).toEqual([{ col: 'customer_id', vals: ['a'] }]);
        expect(desel.ins).toEqual([{ col: 'customer_id', vals: ['b', 'c'] }]);
        // Every update is org + provider scoped.
        for (const u of updates) {
            expect(u.eqs).toEqual(expect.arrayContaining([
                { col: 'organisation_id', val: 'org-1' }, { col: 'provider', val: 'meta_ads' },
            ]));
        }
    });
});

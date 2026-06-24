// markSynced — the success-path status write must NOT resurrect a 'revoked'
// integration. If the user disconnects (markRevoked → status:'revoked',
// secrets:null) while a sync is mid-flight, the finishing sync's status write
// must skip the revoked row rather than flip it back to 'active' (which would
// show a credential-less integration as healthy). It is a scoped UPDATE with a
// `status != 'revoked'` guard, not a blind upsert.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { integrationRepository } = await import('../src/repositories/integration.repository.js');

describe('integrationRepository.markSynced', () => {
    beforeEach(() => { supaRec.resultProvider = () => ({ data: [], error: null }); });

    it('updates the integration row to active/cleared, scoped to org+provider, excluding revoked', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };

        await integrationRepository.markSynced('org-1', 'meta_ads');

        const q = queries.find((x) => x.table === 'integrations' && x.op === 'update');
        expect(q, 'expected an UPDATE on integrations').toBeTruthy();
        expect(q.updateVals).toMatchObject({ status: 'active', last_error: null });
        expect(q.updateVals.last_sync_at).toBeTruthy();
        expect(q.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' },
            { col: 'provider', val: 'meta_ads' },
        ]));
        // The guard: never touch a row the user has revoked mid-sync.
        expect(q.neqs).toEqual(expect.arrayContaining([{ col: 'status', val: 'revoked' }]));
    });
});

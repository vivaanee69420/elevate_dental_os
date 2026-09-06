// ============================================================================
// openDayRepository — org scoping on every read and write.
//
// Open days are the one mapping in this codebase a TENANT can edit rather than
// only an agency admin, so the org filter here is doing more work than usual:
// it is the only thing standing between a tenant's own request and another
// tenant's events. The composite foreign key (organisation_id, open_day_id)
// backs it up in the database, but a query that forgets the filter would still
// read or delete rows it should never see.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { openDayRepository } = await import('../src/repositories/open-day.repository.js');

const ORG = 'org-aaaaaaaa';
const OTHER = 'org-bbbbbbbb';

let seen;
beforeEach(() => {
    seen = [];
    supaRec.last = undefined;
    supaRec.resultProvider = (q) => {
        seen.push(q);
        return { data: [], error: null };
    };
});

const orgFilterOf = (q) => (q.eqs ?? []).find((e) => e.col === 'organisation_id')?.val;

describe('openDayRepository org scoping', () => {
    it('lists only the caller org\'s events', async () => {
        await openDayRepository.list(ORG);
        expect(seen).not.toHaveLength(0);
        for (const q of seen) expect(orgFilterOf(q)).toBe(ORG);
    });

    it('lists only the caller org\'s campaign mappings', async () => {
        await openDayRepository.mappings(ORG, 'meta_ads');
        const q = seen.find((x) => x.table === 'ad_open_day_campaigns');
        expect(orgFilterOf(q)).toBe(ORG);
        expect(q.eqs).toEqual(expect.arrayContaining([{ col: 'provider', val: 'meta_ads' }]));
    });

    it('stamps the caller org on a created event rather than trusting a body', async () => {
        await openDayRepository.create(ORG, { name: 'July 26', eventDate: '2026-07-15' });
        // Matched on the insert PAYLOAD, not on q.op: the chain ends
        // .insert(...).select().single(), and the harness records the last
        // verb, so op reads 'select' by the time the query settles.
        const q = seen.find((x) => x.table === 'ad_open_days' && x.insertVals);
        expect(q.insertVals).toMatchObject({ organisation_id: ORG, name: 'July 26', event_date: '2026-07-15' });
    });

    it('scopes a rename to the caller org, so an id from elsewhere matches nothing', async () => {
        await openDayRepository.update(OTHER, 'e-1', { name: 'Renamed' });
        const q = seen.find((x) => x.op === 'update');
        expect(orgFilterOf(q)).toBe(OTHER);
        expect(q.eqs).toEqual(expect.arrayContaining([{ col: 'id', val: 'e-1' }]));
        // organisation_id must never be writable from a patch body.
        expect(q.updateVals).not.toHaveProperty('organisation_id');
    });

    it('scopes a delete to the caller org', async () => {
        await openDayRepository.remove(ORG, 'e-1');
        const q = seen.find((x) => x.op === 'delete');
        expect(orgFilterOf(q)).toBe(ORG);
        expect(q.eqs).toEqual(expect.arrayContaining([{ col: 'id', val: 'e-1' }]));
    });

    it('replaces an event\'s campaigns: clears only that event\'s own rows, then inserts', async () => {
        await openDayRepository.setCampaigns(ORG, 'e-1', 'meta_ads', [
            { campaign_id: 'c1', customer_id: 'act_1' },
            { campaign_id: 'c2', customer_id: 'act_2' },
        ]);
        const del = seen.find((x) => x.op === 'delete');
        expect(orgFilterOf(del)).toBe(ORG);
        expect(del.eqs).toEqual(expect.arrayContaining([{ col: 'open_day_id', val: 'e-1' }]));

        const ins = seen.find((x) => x.op === 'upsert' || x.op === 'insert');
        const rows = ins.upsertVals ?? ins.insertVals;
        expect(rows).toHaveLength(2);
        for (const r of rows) {
            expect(r.organisation_id).toBe(ORG);
            expect(r.open_day_id).toBe('e-1');
            expect(r.provider).toBe('meta_ads');
        }
    });

    it('clearing an event\'s campaigns writes nothing, rather than inserting an empty list', async () => {
        await openDayRepository.setCampaigns(ORG, 'e-1', 'meta_ads', []);
        expect(seen.some((x) => x.op === 'delete')).toBe(true);
        expect(seen.some((x) => x.op === 'insert' || x.op === 'upsert')).toBe(false);
    });

    it('upserts a single campaign mapping keyed on provider AND campaign', async () => {
        await openDayRepository.setCampaign(ORG, {
            campaignId: 'c9', customerId: 'act_9', openDayId: 'e-1',
        });
        const q = seen.find((x) => x.upsertVals);
        expect(q.table).toBe('ad_open_day_campaigns');
        expect(q.upsertVals).toMatchObject({
            organisation_id: ORG, provider: 'meta_ads',
            campaign_id: 'c9', customer_id: 'act_9', open_day_id: 'e-1',
        });
        expect(q.upsertOpts.onConflict).toBe('organisation_id,provider,campaign_id');
    });

    it('clearing a single campaign mapping deletes its row rather than writing a null event', async () => {
        await openDayRepository.setCampaign(ORG, {
            campaignId: 'c9', customerId: 'act_9', openDayId: null,
        });
        const q = seen.find((x) => x.op === 'delete');
        expect(q.table).toBe('ad_open_day_campaigns');
        expect(orgFilterOf(q)).toBe(ORG);
        expect(q.eqs).toEqual(expect.arrayContaining([
            { col: 'provider', val: 'meta_ads' },
            { col: 'campaign_id', val: 'c9' },
        ]));
        expect(seen.some((x) => x.upsertVals)).toBe(false);
    });

    it('lists only the caller org\'s pipeline mappings', async () => {
        await openDayRepository.pipelineMappings(ORG);
        const q = seen.find((x) => x.table === 'ad_open_day_pipelines');
        expect(orgFilterOf(q)).toBe(ORG);
    });

    it('upserts a pipeline mapping keyed on the account AND the pipeline', async () => {
        await openDayRepository.setPipeline(ORG, {
            integrationAccountId: 'acct-1', ghlPipelineId: 'pipe-1', openDayId: 'e-1',
        });
        const q = seen.find((x) => x.upsertVals);
        expect(q.table).toBe('ad_open_day_pipelines');
        expect(q.upsertVals).toMatchObject({
            organisation_id: ORG, integration_account_id: 'acct-1',
            ghl_pipeline_id: 'pipe-1', open_day_id: 'e-1',
        });
        // GHL pipeline ids are unique only within a Location, so the conflict
        // target must carry the account or two subaccounts collide.
        expect(q.upsertOpts.onConflict)
            .toBe('organisation_id,integration_account_id,ghl_pipeline_id');
    });

    it('clearing a pipeline deletes its row rather than writing a null event', async () => {
        await openDayRepository.setPipeline(ORG, {
            integrationAccountId: 'acct-1', ghlPipelineId: 'pipe-1', openDayId: null,
        });
        const q = seen.find((x) => x.op === 'delete');
        expect(q.table).toBe('ad_open_day_pipelines');
        expect(orgFilterOf(q)).toBe(ORG);
        expect(q.eqs).toEqual(expect.arrayContaining([
            { col: 'integration_account_id', val: 'acct-1' },
            { col: 'ghl_pipeline_id', val: 'pipe-1' },
        ]));
        expect(seen.some((x) => x.upsertVals)).toBe(false);
    });
});

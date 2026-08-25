import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { dataRoomRepository } from '../src/repositories/data-room.repository.js';
import { getDataset } from '../src/lib/data-room/registry.js';
import { dataRoomQuerySchema } from '../src/models/data-room.model.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PRACTICE = '22222222-2222-4222-8222-222222222222';
const NONE = { practiceId: null, practiceKeys: null, since: null, until: null };

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null, count: 0 });
});

describe('dataRoomQuerySchema', () => {
  it('defaults scope=all, limit=100, pii=false', () => {
    expect(dataRoomQuerySchema.parse({})).toEqual({ scope: 'all', limit: 100, pii: false });
  });
  it('accepts a uuid scope and pii=1', () => {
    const q = dataRoomQuerySchema.parse({ scope: PRACTICE, pii: '1', limit: '50' });
    expect(q).toMatchObject({ scope: PRACTICE, pii: true, limit: 50 });
  });
  it('rejects a non-uuid scope, limit > 500, unparsable dates', () => {
    expect(() => dataRoomQuerySchema.parse({ scope: 'ashford' })).toThrow();
    expect(() => dataRoomQuerySchema.parse({ limit: '501' })).toThrow();
    expect(() => dataRoomQuerySchema.parse({ since: 'yesterday' })).toThrow();
  });
});

describe('page()', () => {
  it('always scopes by organisation_id and applies the static where', async () => {
    const ds = getDataset('dentally', 'appointments');
    await dataRoomRepository.page(ORG, ds, NONE, { after: null, limit: 100 });
    const q = supaRec.last;
    expect(q.table).toBe('appointments');
    expect(q.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(q.eqs).toContainEqual({ col: 'source', val: 'dentally' });
    expect(q.select).toBe('id,practice_id,contact_id,associate_id,pms_external_id,pms_patient_id,pms_practitioner_id,starts_at,ends_at,status,appointment_type');
    expect(q.limitN).toBe(100);
  });

  it('selects only the requested columns when `columns` is passed', async () => {
    const ds = getDataset('dentally', 'patients');
    await dataRoomRepository.page(ORG, ds, NONE, { after: null, limit: 10, columns: ['id', 'practice_id'] });
    expect(supaRec.last.select).toBe('id,practice_id');
  });

  it('applies practice + timestamptz window + keyset order for an event dataset', async () => {
    const ds = getDataset('dentally', 'appointments');
    await dataRoomRepository.page(ORG, ds,
      { practiceId: PRACTICE, practiceKeys: null, since: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z' },
      { after: null, limit: 100 });
    const q = supaRec.last;
    expect(q.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE });
    expect(q.gtes).toContainEqual({ col: 'starts_at', val: '2026-08-01T00:00:00.000Z' });
    expect(q.lts).toContainEqual({ col: 'starts_at', val: '2026-09-01T00:00:00.000Z' });
    expect(q.orders).toEqual([{ col: 'starts_at', opts: { ascending: true } }, { col: 'id', opts: { ascending: true } }]);
  });

  it('formats date-typed windows as London YYYY-MM-DD', async () => {
    const ds = getDataset('dentally', 'invoices');
    await dataRoomRepository.page(ORG, ds,
      { practiceId: null, practiceKeys: null, since: '2026-07-31T23:00:00.000Z', until: '2026-08-31T23:00:00.000Z' },
      { after: null, limit: 100 });
    const q = supaRec.last;
    expect(q.gtes).toContainEqual({ col: 'dated_on', val: '2026-08-01' });
    expect(q.lts).toContainEqual({ col: 'dated_on', val: '2026-09-01' });
  });

  it('keyset cursor becomes an .or() over (date > d) OR (date = d AND id > id)', async () => {
    const ds = getDataset('dentally', 'appointments');
    await dataRoomRepository.page(ORG, ds, NONE, { after: { d: '2026-08-05T10:00:00.000Z', id: 'abc' }, limit: 100 });
    expect(supaRec.last.ors).toEqual(['starts_at.gt."2026-08-05T10:00:00.000Z",and(starts_at.eq."2026-08-05T10:00:00.000Z",id.gt."abc")']);
  });

  it('roster datasets order by id only and page with id > cursor', async () => {
    const ds = getDataset('dentally', 'practitioners');
    await dataRoomRepository.page(ORG, ds, NONE, { after: { d: null, id: 'abc' }, limit: 50 });
    const q = supaRec.last;
    expect(q.orders).toEqual([{ col: 'id', opts: { ascending: true } }]);
    expect(q.gts).toContainEqual({ col: 'id', val: 'abc' });
    expect(q.nots).toContainEqual({ col: 'pms_external_id', op: 'is', val: null });
    expect(q.gtes).toBeUndefined();
  });

  it('via datasets filter col IN practiceKeys and use a jsonb text predicate when configured', async () => {
    const ds = getDataset('gohighlevel', 'conversations');
    await dataRoomRepository.page(ORG, ds, { practiceId: PRACTICE, practiceKeys: ['acc-1', 'acc-2'], since: null, until: null }, { after: null, limit: 100 });
    const q = supaRec.last;
    expect(q.eqs).toContainEqual({ col: 'metadata->>provider', val: 'gohighlevel' });
    expect(q.ins).toContainEqual({ col: 'integration_account_id', vals: ['acc-1', 'acc-2'] });
    expect(q.eqs.find((e) => e.col === 'practice_id')).toBeUndefined();
  });

  it('throws when Supabase returns an error', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    const ds = getDataset('dentally', 'appointments');
    await expect(dataRoomRepository.page(ORG, ds, NONE, { after: null, limit: 10 })).rejects.toThrow('boom');
  });
});

describe('count()', () => {
  it('issues a head count with identical filters and returns the number', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null, count: 42 });
    const ds = getDataset('dentally', 'payments');
    const n = await dataRoomRepository.count(ORG, ds, { practiceId: PRACTICE, practiceKeys: null, since: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z' });
    expect(n).toBe(42);
    const q = supaRec.last;
    expect(q.selectArgs[1]).toEqual({ count: 'exact', head: true });
    expect(q.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(q.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE });
  });
});

describe('viaKeys()', () => {
  it('reads key values from the via table scoped to org + practice (+ via.where)', async () => {
    supaRec.resultProvider = () => ({ data: [{ customer_id: '123' }, { customer_id: '456' }], error: null });
    const via = getDataset('google-ads', 'campaign_daily').practice.via;
    const keys = await dataRoomRepository.viaKeys(ORG, via, PRACTICE);
    expect(keys).toEqual(['123', '456']);
    const q = supaRec.last;
    expect(q.table).toBe('ad_accounts');
    expect(q.select).toBe('customer_id');
    expect(q.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(q.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE });
    expect(q.eqs).toContainEqual({ col: 'provider', val: 'google_ads' });
  });
});

describe('pipelineRows()', () => {
  it('flattens config.pipelines[].stages[] into one row per stage, org-scoped', async () => {
    supaRec.resultProvider = () => ({
      data: [{ id: 'acc-1', practice_id: PRACTICE, config: { pipelines: [
        { id: 'p1', name: 'Implants', stages: [{ id: 's1', name: 'New' }, { id: 's2', name: 'Booked' }] },
        { id: 'p2', name: 'Ortho', stages: [] },
      ] } }],
      error: null,
    });
    const rows = await dataRoomRepository.pipelineRows(ORG, null);
    expect(rows).toEqual([
      { integration_account_id: 'acc-1', practice_id: PRACTICE, pipeline_id: 'p1', pipeline_name: 'Implants', stage_id: 's1', stage_name: 'New' },
      { integration_account_id: 'acc-1', practice_id: PRACTICE, pipeline_id: 'p1', pipeline_name: 'Implants', stage_id: 's2', stage_name: 'Booked' },
      { integration_account_id: 'acc-1', practice_id: PRACTICE, pipeline_id: 'p2', pipeline_name: 'Ortho', stage_id: null, stage_name: null },
    ]);
    const q = supaRec.last;
    expect(q.table).toBe('integration_accounts');
    expect(q.select).toBe('id,practice_id,config');
    expect(q.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(q.eqs).toContainEqual({ col: 'provider', val: 'gohighlevel' });
  });
  it('filters by practice when given', async () => {
    await dataRoomRepository.pipelineRows(ORG, PRACTICE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE });
  });
});

describe('logExport()', () => {
  it('inserts an audit_log row with action=export and the diff', async () => {
    await dataRoomRepository.logExport(ORG, 'user-1', { source: 'dentally', dataset: 'appointments', rows: 3 }, { ip: '1.2.3.4', userAgent: 'vitest' });
    const q = supaRec.last;
    expect(q.table).toBe('audit_log');
    expect(q.op).toBe('insert');
    expect(q.insertVals).toMatchObject({
      organisation_id: ORG, user_id: 'user-1', action: 'export', entity_type: 'data_room',
      diff: { source: 'dentally', dataset: 'appointments', rows: 3 }, ip_address: '1.2.3.4', user_agent: 'vitest',
    });
  });
});

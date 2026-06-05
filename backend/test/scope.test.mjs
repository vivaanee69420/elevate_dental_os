// ============================================================================
// Scope engine — resolveScope() branches, the kind='practice' read-path audit
// (T2, critical), and scopeQuerySchema validation.
//
// resolveScope is the single source that turns a scope param into a concrete
// entity filter (CQ2). The kind filter on practicesList/practicesFull/
// entitiesByKind is what stops Academy/Lab corrupting clinical rollups — these
// are regression tests for that guarantee. DB access runs the REAL repository
// against the fake Supabase client from test/setup.js, recording every .eq().
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const repo = (await import('../src/repositories/analytics.repository.js')).analyticsRepository;
const { scopeQuerySchema } = await import('../src/models/analytics.model.js');

const ORG = 'org-aaaaaaaa';
const UUID = '11111111-2222-3333-4444-555555555555';
const eq = (col) => supaRec.last?.eqs.find((e) => e.col === col);

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('resolveScope', () => {
  it('all → no id filter, all three kinds, aggregate, no DB call', async () => {
    const r = await svc.resolveScope(ORG, 'all');
    expect(r).toMatchObject({ mode: 'all', practiceIds: null, isAggregate: true });
    expect(r.kinds).toEqual(['practice', 'academy', 'lab']);
    expect(supaRec.last).toBeUndefined(); // pure, no query
  });

  it('practices → no id filter, practice kind only', async () => {
    const r = await svc.resolveScope(ORG, 'practices');
    expect(r).toMatchObject({ mode: 'practices', practiceIds: null });
    expect(r.kinds).toEqual(['practice']);
    expect(supaRec.last).toBeUndefined();
  });

  it('a UUID → that single entity, no DB call', async () => {
    const r = await svc.resolveScope(ORG, UUID);
    expect(r).toMatchObject({ mode: 'entity', practiceIds: [UUID] });
    expect(r.kinds).toEqual(['practice']);
    expect(supaRec.last).toBeUndefined();
  });

  it('academy → one query filtered by kind=academy + org; ids mapped', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: 'acad-1', name: 'Academy', kind: 'academy' }], error: null });
    const r = await svc.resolveScope(ORG, 'academy');
    expect(r.mode).toBe('academy');
    expect(r.practiceIds).toEqual(['acad-1']);
    expect(supaRec.last.table).toBe('practices');
    expect(eq('kind')).toEqual({ col: 'kind', val: 'academy' });
    expect(eq('organisation_id')).toEqual({ col: 'organisation_id', val: ORG });
  });

  it('lab → kind=lab filter', async () => {
    await svc.resolveScope(ORG, 'lab');
    expect(eq('kind')).toEqual({ col: 'kind', val: 'lab' });
  });
});

describe('read-path audit (T2): clinical practice queries exclude academy/lab', () => {
  it('practicesList filters kind=practice AND org', async () => {
    await repo.practicesList(ORG);
    expect(supaRec.last.table).toBe('practices');
    expect(eq('kind')).toEqual({ col: 'kind', val: 'practice' });
    expect(eq('organisation_id')).toEqual({ col: 'organisation_id', val: ORG });
  });

  it('practicesFull filters kind=practice AND org', async () => {
    await repo.practicesFull(ORG);
    expect(eq('kind')).toEqual({ col: 'kind', val: 'practice' });
    expect(eq('organisation_id')).toEqual({ col: 'organisation_id', val: ORG });
  });
});

describe('scopeQuerySchema', () => {
  it('defaults scope=all, period=month', () => {
    expect(scopeQuerySchema.parse({})).toMatchObject({ scope: 'all', period: 'month' });
  });
  it('accepts literals, a UUID, and period=day', () => {
    expect(scopeQuerySchema.parse({ scope: 'academy', period: 'day' }).scope).toBe('academy');
    expect(scopeQuerySchema.parse({ scope: UUID }).scope).toBe(UUID);
  });
  it('rejects a bogus scope', () => {
    expect(() => scopeQuerySchema.parse({ scope: 'drop-table' })).toThrow();
  });
  it('rejects a malformed period key', () => {
    expect(() => scopeQuerySchema.parse({ pk: '2026/05' })).toThrow();
  });
});

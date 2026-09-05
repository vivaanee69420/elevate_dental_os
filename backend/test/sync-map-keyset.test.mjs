// ============================================================================
// The sync map loaders page the whole of an org's contacts on purpose — the
// nightly pull genuinely needs every row. What it must NOT do is page with
// OFFSET: PostgREST's .range() makes the server re-walk every skipped row, so
// building one map is quadratic in contact count. Measured on the live project,
// page 28 of a 28k-contact org cost 16,819 shared buffers / 29.4ms with OFFSET
// against 576 buffers / 5.2ms for the same page fetched by key.
//
// These tests pin the two properties that make that safe: no .range(), and no
// row lost or repeated across the page boundary.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { loadContactMap } = await import('../src/lib/integrations/dentally-sync.js');

const ORG = 'org-aaaaaaaa';

// A keyset-honouring fake: serves the rows after the caller's cursor, in key
// order, capped at the caller's limit — the way PostgREST would.
function keysetSource(rows, keyCol, reads) {
  return (q) => {
    reads.push(q);
    const after = (q.gts ?? []).find((g) => g.col === keyCol)?.val;
    const page = rows
      .filter((r) => after == null || String(r[keyCol]) > String(after))
      .sort((a, b) => (String(a[keyCol]) < String(b[keyCol]) ? -1 : 1))
      .slice(0, q.limitN ?? 1000);
    return { data: page, error: null };
  };
}

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('loadContactMap — keyset paging', () => {
  // 2,500 rows = three pages at the 1000-row PostgREST cap, so the assertions
  // below actually cross two page boundaries.
  const contacts = Array.from({ length: 2500 }, (_, i) => ({
    id: `c${i}`,
    pms_external_id: String(100000 + i),
  }));

  it('returns every row exactly once across page boundaries', async () => {
    supaRec.resultProvider = keysetSource(contacts, 'pms_external_id', []);
    const map = await loadContactMap(ORG);
    expect(map.size).toBe(2500);
    // First, last, and both rows either side of a page boundary.
    expect(map.get('100000')).toBe('c0');
    expect(map.get('100999')).toBe('c999');
    expect(map.get('101000')).toBe('c1000');
    expect(map.get('102499')).toBe('c2499');
  });

  it('advances by key, never by OFFSET, and stops on a short page', async () => {
    const reads = [];
    supaRec.resultProvider = keysetSource(contacts, 'pms_external_id', reads);
    await loadContactMap(ORG);

    expect(reads).toHaveLength(3);              // 1000 + 1000 + 500, then stop
    expect(reads.every((r) => r.range === undefined)).toBe(true);
    // Ordered by the cursor column, so "after the last row I saw" is well defined.
    expect(reads[0].order).toMatchObject({ col: 'pms_external_id' });
    // First page has no cursor; each later page resumes from the previous last row.
    expect(reads[0].gts ?? []).toEqual([]);
    expect(reads[1].gts).toEqual([{ col: 'pms_external_id', val: '100999' }]);
    expect(reads[2].gts).toEqual([{ col: 'pms_external_id', val: '101999' }]);
  });

  it('stays scoped to the org and source that the covering index expects', async () => {
    const reads = [];
    supaRec.resultProvider = keysetSource(contacts, 'pms_external_id', reads);
    await loadContactMap(ORG);
    expect(reads[0].eqs).toEqual(expect.arrayContaining([
      { col: 'organisation_id', val: ORG },
      { col: 'source', val: 'dentally' },
    ]));
  });

  it('handles an org with no contacts in a single read', async () => {
    const reads = [];
    supaRec.resultProvider = keysetSource([], 'pms_external_id', reads);
    const map = await loadContactMap(ORG);
    expect(map.size).toBe(0);
    expect(reads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The GoHighLevel sync has the same whole-org map build, three times per run.
// Two of its three callers use only `byGhl`, so they were pulling email, phone
// and attribution for every contact in the org to answer a question that
// idx_contacts_ghl_id (organisation_id, ghl_contact_id) answers directly —
// 1,010 buffers/page against 7,912 for a deep OFFSET page of the wide select.
// ---------------------------------------------------------------------------
const { loadGhlContactMap, loadContactDedupMaps } =
  await import('../src/lib/integrations/gohighlevel-sync.js');

describe('loadGhlContactMap — ghl_contact_id -> our id, for callers that need only that', () => {
  const contacts = Array.from({ length: 1500 }, (_, i) => ({
    id: `c${i}`,
    ghl_contact_id: `g${String(i).padStart(5, '0')}`,
  }));

  it('returns every linked contact exactly once across the page boundary', async () => {
    supaRec.resultProvider = keysetSource(contacts, 'ghl_contact_id', []);
    const map = await loadGhlContactMap(ORG);
    expect(map.size).toBe(1500);
    expect(map.get('g00999')).toBe('c999');
    expect(map.get('g01000')).toBe('c1000');
  });

  it('advances by key on the ghl index, never by OFFSET', async () => {
    const reads = [];
    supaRec.resultProvider = keysetSource(contacts, 'ghl_contact_id', reads);
    await loadGhlContactMap(ORG);
    expect(reads).toHaveLength(2);
    expect(reads.every((r) => r.range === undefined)).toBe(true);
    expect(reads[0].order).toMatchObject({ col: 'ghl_contact_id' });
    expect(reads[1].gts).toEqual([{ col: 'ghl_contact_id', val: 'g00999' }]);
    expect(reads[0].eqs).toEqual([{ col: 'organisation_id', val: ORG }]);
    // Only the two columns the map needs — not the whole dedup row.
    expect(reads[0].select).toBe('id, ghl_contact_id');
  });
});

describe('loadContactDedupMaps — keyset paging over the org contact book', () => {
  const contacts = Array.from({ length: 1500 }, (_, i) => ({
    id: `c${String(i).padStart(5, '0')}`,
    ghl_contact_id: i % 2 === 0 ? `g${i}` : null,
    email: `p${i}@example.com`,
    phone: `0770000${String(i).padStart(4, '0')}`,
    attribution_captured_at: i % 4 === 0 ? '2026-01-01' : null,
  }));

  it('builds every map across the page boundary', async () => {
    supaRec.resultProvider = keysetSource(contacts, 'id', []);
    const { byGhl, byEmail, byPhone, needsAttribution } = await loadContactDedupMaps(ORG);
    expect(byGhl.size).toBe(750);
    expect(byGhl.get('g1000')).toBe('c01000');
    expect(byEmail.size).toBe(1500);
    expect(byEmail.get('p1000@example.com')).toMatchObject({ id: 'c01000' });
    expect(byPhone.size).toBe(1500);
    // ghl-linked, attribution never captured: i even AND i % 4 !== 0.
    expect(needsAttribution.has('g1002')).toBe(true);
    expect(needsAttribution.has('g1000')).toBe(false);
  });

  it('advances by id, never by OFFSET', async () => {
    const reads = [];
    supaRec.resultProvider = keysetSource(contacts, 'id', reads);
    await loadContactDedupMaps(ORG);
    expect(reads).toHaveLength(2);
    expect(reads.every((r) => r.range === undefined)).toBe(true);
    expect(reads[0].order).toMatchObject({ col: 'id' });
    expect(reads[1].gts).toEqual([{ col: 'id', val: 'c00999' }]);
  });
});

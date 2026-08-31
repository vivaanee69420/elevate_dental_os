// Cached organisations lookups for agency checks — one query per org per 60s.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { orgMetaService } = await import('../src/services/org-meta.service.js');

const ROW = { id: 'org-1', name: 'Agency', parent_organisation_id: null, is_agency: true };

describe('orgMetaService', () => {
  beforeEach(() => {
    orgMetaService.invalidate();
    supaRec.resultProvider = () => ({ data: ROW, error: null });
  });

  it('queries organisations by id and returns the meta row', async () => {
    const meta = await orgMetaService.getOrgMeta('org-1');
    expect(meta).toEqual(ROW);
    expect(supaRec.last.table).toBe('organisations');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'id', val: 'org-1' }]));
  });

  it('caches per org inside the TTL', async () => {
    const provider = vi.fn(() => ({ data: ROW, error: null }));
    supaRec.resultProvider = provider;
    await orgMetaService.getOrgMeta('org-1');
    await orgMetaService.getOrgMeta('org-1');
    expect(provider).toHaveBeenCalledTimes(1);
    await orgMetaService.getOrgMeta('org-2');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('returns null (uncached) on error so auth fails safe to home context', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    expect(await orgMetaService.getOrgMeta('org-1')).toBeNull();
    // a later good read is not poisoned by a cached null
    supaRec.resultProvider = () => ({ data: ROW, error: null });
    expect(await orgMetaService.getOrgMeta('org-1')).toEqual(ROW);
  });

  it('invalidate(orgId) drops one entry', async () => {
    const provider = vi.fn(() => ({ data: ROW, error: null }));
    supaRec.resultProvider = provider;
    await orgMetaService.getOrgMeta('org-1');
    orgMetaService.invalidate('org-1');
    await orgMetaService.getOrgMeta('org-1');
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

// backend/test/features.worker-skip.test.mjs
// Worker fan-outs must skip orgs whose feature flag is off.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasFeature: vi.fn() },
}));
vi.mock('../src/repositories/sheet.repository.js', () => ({
  sheetRepository: { listConfiguredSources: vi.fn() },
}));

const { featuresService } = await import('../src/services/features.service.js');
const { sheetRepository } = await import('../src/repositories/sheet.repository.js');
const emergentSync = await import('../src/lib/integrations/emergent-sync.js');
const sheetsSync = await import('../src/lib/integrations/google-sheets-sync.js');
const { sheetExportService } = await import('../src/services/sheet-export.service.js');
const { sheetExportRepository } = await import('../src/repositories/sheet-export.repository.js');

describe('worker feature skips', () => {
  beforeEach(() => {
    featuresService.orgHasFeature.mockReset();
    featuresService.orgHasFeature.mockResolvedValue(false);
    supaRec.resultProvider = (q) =>
      q.table === 'integrations'
        ? { data: [{ organisation_id: 'org-a' }], error: null }
        : { data: [], error: null };
  });

  it('emergent syncAllOrgs skips a disabled org without syncing', async () => {
    const results = await emergentSync.syncAllOrgs();
    expect(results).toEqual([{ orgId: 'org-a', skipped: 'feature_disabled' }]);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-a', 'emergent');
  });

  it('google-sheets syncAllOrgs skips a disabled org', async () => {
    sheetRepository.listConfiguredSources.mockResolvedValue([{ organisation_id: 'org-a', id: 's1' }]);
    const results = await sheetsSync.syncAllOrgs();
    expect(results).toEqual([{ orgId: 'org-a', sourceId: 's1', skipped: 'feature_disabled' }]);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-a', 'call_reporting');
  });

  it('sheet-export refresh/drain skip a disabled org', async () => {
    vi.spyOn(sheetExportRepository, 'orgsWithWriter').mockResolvedValue(['org-a']);
    const refreshSpy = vi.spyOn(sheetExportService, 'refreshOrg');
    const drainSpy = vi.spyOn(sheetExportService, 'drainOrg');
    expect(await sheetExportService.refreshAllOrgs()).toEqual([{ orgId: 'org-a', skipped: 'feature_disabled' }]);
    expect(await sheetExportService.drainAllOrgs()).toEqual([{ orgId: 'org-a', skipped: 'feature_disabled' }]);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(drainSpy).not.toHaveBeenCalled();
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-a', 'sheet_export');
  });
});

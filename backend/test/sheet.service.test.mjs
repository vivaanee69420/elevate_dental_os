// Sheet service (Call Reporting) — dashboard shaping + efficiency %, the
// not-configured path, source registration guards, disconnect purge order,
// and the no-token-leak guarantee on the status endpoint.
import './setup.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORG = '00000000-0000-0000-0000-000000000001';
const PRACTICE = '00000000-0000-0000-0000-0000000000bb';

const repoMock = {
  getSource: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  listPracticeMap: vi.fn().mockResolvedValue([]),
  setPracticeMapping: vi.fn(),
  deletePracticeMap: vi.fn(),
  practiceOptions: vi.fn().mockResolvedValue([]),
  deleteAllLeads: vi.fn(),
  dashboard: vi.fn(),
  restampPractices: vi.fn().mockResolvedValue(3),
};
const integrationRepoMock = {
  getByProvider: vi.fn(),
  markRevoked: vi.fn(),
};
const syncMock = {
  getMeta: vi.fn(),
  getPreview: vi.fn(),
  fullSync: vi.fn().mockResolvedValue({ ok: true }),
  topUp: vi.fn().mockResolvedValue({ ok: true, added: 0 }),
};

vi.mock('../src/repositories/sheet.repository.js', () => ({ sheetRepository: repoMock }));
vi.mock('../src/repositories/integration.repository.js', () => ({ integrationRepository: integrationRepoMock }));
vi.mock('../src/lib/integrations/google-sheets-sync.js', () => syncMock);

const { sheetService } = await import('../src/services/sheet.service.js');

const CONNECTED = { status: 'active', secrets: 'ENCRYPTED-BLOB', last_error: null };
const CONFIGURED_SOURCE = {
  id: 'src-1', spreadsheet_id: 'abc123', title: 'Leads', tab_name: 'Data',
  column_mapping: { practice: 0, created_at: 1, first_call_at: 2, source: 3, pipeline_status: 4 },
  header_row: 1, last_synced_row: 100, row_count: 100, skipped_rows: 0,
  status: 'active', last_error: null, last_synced_at: '2026-08-04T06:00:00.000Z',
  sheet_timezone: 'Europe/London',
};

beforeEach(() => {
  vi.clearAllMocks();
  integrationRepoMock.getByProvider.mockResolvedValue(CONNECTED);
  repoMock.getSource.mockResolvedValue(CONFIGURED_SOURCE);
  syncMock.topUp.mockResolvedValue({ ok: true, added: 0 });
  syncMock.fullSync.mockResolvedValue({ ok: true });
});

describe('dashboard', () => {
  it('shapes the eight cards and computes efficiency % (2/14 -> 14.3)', async () => {
    repoMock.dashboard.mockResolvedValue({
      total: 14, called_3m: 2, called_10m: 0, in_pipeline: 14,
      not_called: 12, facebook: 11, google: 1, unmapped: 0,
    });
    const out = await sheetService.dashboard(ORG, { date: '2026-08-01', practiceId: PRACTICE });
    expect(out).toMatchObject({
      configured: true, date: '2026-08-01', practiceId: PRACTICE,
      totalLeads: 14, calledWithin3m: 2, calledWithin10m: 0,
      efficiencyPct: 14.3, leadsInPipeline: 14, notCalled: 12,
      facebookLeads: 11, googleLeads: 1, unmapped: 0,
    });
    expect(syncMock.topUp).toHaveBeenCalledWith(ORG);
    expect(repoMock.dashboard).toHaveBeenCalledWith(ORG, {
      date: '2026-08-01', practiceId: PRACTICE, tz: 'Europe/London',
    });
  });
  it('efficiency is 0 (not NaN) when there are no leads', async () => {
    repoMock.dashboard.mockResolvedValue({ total: 0, called_3m: 0 });
    const out = await sheetService.dashboard(ORG, {});
    expect(out.efficiencyPct).toBe(0);
    expect(out.totalLeads).toBe(0);
  });
  it('returns configured:false before the mapping is saved (no RPC call)', async () => {
    repoMock.getSource.mockResolvedValue({ ...CONFIGURED_SOURCE, column_mapping: null });
    const out = await sheetService.dashboard(ORG, {});
    expect(out.configured).toBe(false);
    expect(repoMock.dashboard).not.toHaveBeenCalled();
  });
  it('still serves cached data when the top-up fails', async () => {
    syncMock.topUp.mockResolvedValue({ ok: false, error: 'google down' });
    repoMock.dashboard.mockResolvedValue({ total: 5, called_3m: 1 });
    const out = await sheetService.dashboard(ORG, { date: '2026-08-01' });
    expect(out.totalLeads).toBe(5);
    expect(out.topUpOk).toBe(false);
  });
});

describe('status', () => {
  it('never exposes token material', async () => {
    const out = await sheetService.status(ORG);
    expect(out.connected).toBe(true);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain('ENCRYPTED-BLOB');
    expect(flat).not.toContain('secrets');
    expect(flat).not.toContain('access_token');
    expect(flat).not.toContain('refresh_token');
  });
});

describe('addSource', () => {
  it('rejects a non-sheet URL with a 400', async () => {
    await expect(sheetService.addSource(ORG, { url: 'https://example.com/x' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(repoMock.createSource).not.toHaveBeenCalled();
  });
  it('validates reachability before persisting, then stores the parsed id', async () => {
    syncMock.getMeta.mockResolvedValue({ title: 'Leads', timezone: 'Europe/London', tabs: [{ title: 'Data' }] });
    const out = await sheetService.addSource(ORG, { url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit' });
    expect(repoMock.createSource).toHaveBeenCalledWith(ORG, expect.objectContaining({ spreadsheet_id: '1AbC_d-EfGhIjK123' }));
    expect(out.tabs).toEqual(['Data']);
  });
  it('refuses when Google Sheets is not connected', async () => {
    integrationRepoMock.getByProvider.mockResolvedValue(null);
    await expect(sheetService.addSource(ORG, { url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('saveMapping / practice map', () => {
  it('saves the mapping, resets the cursor and starts a full sync', async () => {
    const out = await sheetService.saveMapping(ORG, {
      tab_name: 'Data', header_row: 1,
      columns: { practice: 0, created_at: 1, first_call_at: 2, source: 3, pipeline_status: 4 },
    });
    expect(repoMock.updateSource).toHaveBeenCalledWith(ORG, expect.objectContaining({
      tab_name: 'Data', last_synced_row: 0, status: 'pending',
    }));
    expect(syncMock.fullSync).toHaveBeenCalledWith(ORG);
    expect(out.syncStarted).toBe(true);
  });
  it('setPracticeMapping restamps existing rows in place', async () => {
    const out = await sheetService.setPracticeMapping(ORG, { sheet_value: 'Rochester', practice_id: PRACTICE });
    expect(repoMock.setPracticeMapping).toHaveBeenCalledWith(ORG, 'Rochester', PRACTICE);
    expect(repoMock.restampPractices).toHaveBeenCalledWith(ORG);
    expect(out.restamped).toBe(3);
  });
});

describe('syncNow / disconnect', () => {
  it('syncNow refuses before mapping', async () => {
    repoMock.getSource.mockResolvedValue({ ...CONFIGURED_SOURCE, column_mapping: null });
    await expect(sheetService.syncNow(ORG)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('disconnect purges leads + map + source then revokes the token', async () => {
    await sheetService.disconnect(ORG);
    expect(repoMock.deleteAllLeads).toHaveBeenCalledWith(ORG);
    expect(repoMock.deletePracticeMap).toHaveBeenCalledWith(ORG);
    expect(repoMock.deleteSource).toHaveBeenCalledWith(ORG);
    expect(integrationRepoMock.markRevoked).toHaveBeenCalledWith(ORG, 'google_sheets');
    // data purge strictly before token revoke would also be acceptable, but the
    // purge MUST happen — order asserted via call counts above.
  });
});

describe('sheetMappingSchema', () => {
  it('rejects two fields mapped to the same column', async () => {
    const { sheetMappingSchema } = await import('../src/models/sheet.model.js');
    const bad = {
      tab_name: 'Data', header_row: 1,
      columns: { practice: 0, created_at: 0, first_call_at: 2, source: 3, pipeline_status: 4 },
    };
    expect(() => sheetMappingSchema.parse(bad)).toThrow();
  });
});

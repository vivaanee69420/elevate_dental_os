// Sheet service (Call Reporting v2) — 10-card dashboard shaping + efficiency %,
// per-source operations, the not-configured path, disconnect purge order, and
// the no-token-leak guarantee on the status endpoint.
import './setup.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORG = '00000000-0000-0000-0000-000000000001';
const SRC = '00000000-0000-0000-0000-0000000000aa';
const SRC2 = '00000000-0000-0000-0000-0000000000ab';

const repoMock = {
  listSources: vi.fn().mockResolvedValue([]),
  getSourceById: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  deleteAllSources: vi.fn(),
  deleteLeadsBySource: vi.fn(),
  deleteAllLeads: vi.fn(),
  dashboard: vi.fn(),
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
  topUpAll: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock('../src/repositories/sheet.repository.js', () => ({ sheetRepository: repoMock }));
vi.mock('../src/repositories/integration.repository.js', () => ({ integrationRepository: integrationRepoMock }));
vi.mock('../src/lib/integrations/google-sheets-sync.js', () => syncMock);

const { sheetService } = await import('../src/services/sheet.service.js');

const CONNECTED = { status: 'active', secrets: 'ENCRYPTED-BLOB', last_error: null };
const SOURCE = {
  id: SRC, practice_label: 'Barnet', spreadsheet_id: 'abc123', title: 'Barnet Leads',
  tab_name: 'Lead_Conversion_Tracking',
  column_mapping: { date: 0, created_time: 4, called_3m: 5, called_10m: 6, pipeline_name: 7 },
  header_row: 1, last_synced_row: 100, row_count: 100, skipped_rows: 0,
  status: 'active', last_error: null, last_synced_at: '2026-08-04T06:00:00.000Z',
  sheet_timezone: 'Europe/London',
};

beforeEach(() => {
  vi.clearAllMocks();
  integrationRepoMock.getByProvider.mockResolvedValue(CONNECTED);
  repoMock.listSources.mockResolvedValue([SOURCE]);
  repoMock.getSourceById.mockResolvedValue(SOURCE);
  syncMock.topUpAll.mockResolvedValue({ ok: true });
  syncMock.fullSync.mockResolvedValue({ ok: true });
});

describe('dashboard', () => {
  it('shapes the ten cards and computes efficiency % (2/6 -> 33.3)', async () => {
    repoMock.dashboard.mockResolvedValue({
      total: 6, called_3m: 2, called_10m: 0, in_pipeline: 6, not_called: 4,
      office_time: 3, outside_office: 3, facebook: 5, google: 1,
    });
    const out = await sheetService.dashboard(ORG, { date: '2026-07-31', sourceId: SRC });
    expect(out).toMatchObject({
      configured: true, date: '2026-07-31', sourceId: SRC,
      totalLeads: 6, calledWithin3m: 2, calledWithin10m: 0, efficiencyPct: 33.3,
      leadsInPipeline: 6, notCalled: 4, officeTimeLeads: 3, outsideOfficeTime: 3,
      facebookLeads: 5, googleLeads: 1, syncFailed: false, topUpOk: true,
    });
    expect(out.sources).toEqual([
      { id: SRC, practice_label: 'Barnet', status: 'active', last_synced_at: SOURCE.last_synced_at, mapped: true },
    ]);
    expect(syncMock.topUpAll).toHaveBeenCalledWith(ORG);
    expect(repoMock.dashboard).toHaveBeenCalledWith(ORG, {
      date: '2026-07-31', sourceId: SRC, tz: 'Europe/London',
    });
  });
  it('efficiency is 0 (not NaN) when there are no leads', async () => {
    repoMock.dashboard.mockResolvedValue({ total: 0, called_3m: 0 });
    const out = await sheetService.dashboard(ORG, {});
    expect(out.efficiencyPct).toBe(0);
    expect(out.totalLeads).toBe(0);
  });
  it('returns configured:false when no source has a mapping (no RPC call)', async () => {
    repoMock.listSources.mockResolvedValue([{ ...SOURCE, column_mapping: null }]);
    const out = await sheetService.dashboard(ORG, {});
    expect(out.configured).toBe(false);
    expect(repoMock.dashboard).not.toHaveBeenCalled();
  });
  it('flags syncFailed when any source failed, still serves data', async () => {
    repoMock.listSources.mockResolvedValue([SOURCE, { ...SOURCE, id: SRC2, practice_label: 'Ashford', status: 'failed' }]);
    repoMock.dashboard.mockResolvedValue({ total: 5, called_3m: 1 });
    const out = await sheetService.dashboard(ORG, {});
    expect(out.syncFailed).toBe(true);
    expect(out.totalLeads).toBe(5);
  });
  it('still serves cached data when the top-up fails', async () => {
    syncMock.topUpAll.mockResolvedValue({ ok: false });
    repoMock.dashboard.mockResolvedValue({ total: 5, called_3m: 1 });
    const out = await sheetService.dashboard(ORG, { date: '2026-07-31' });
    expect(out.totalLeads).toBe(5);
    expect(out.topUpOk).toBe(false);
  });
});

describe('status', () => {
  it('lists sources and never exposes token material', async () => {
    const out = await sheetService.status(ORG);
    expect(out.connected).toBe(true);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ id: SRC, practice_label: 'Barnet', mapped: true });
    const flat = JSON.stringify(out);
    expect(flat).not.toContain('ENCRYPTED-BLOB');
    expect(flat).not.toContain('secrets');
    expect(flat).not.toContain('access_token');
    expect(flat).not.toContain('refresh_token');
  });
});

describe('addSource', () => {
  it('rejects a non-sheet URL with a 400', async () => {
    await expect(sheetService.addSource(ORG, { url: 'https://example.com/x', practice_label: 'Barnet' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(repoMock.createSource).not.toHaveBeenCalled();
  });
  it('validates reachability before persisting, stores id + label, returns tabs', async () => {
    syncMock.getMeta.mockResolvedValue({ title: 'Leads', timezone: 'Europe/London', tabs: [{ title: 'Data' }] });
    repoMock.createSource.mockResolvedValue({ ...SOURCE, id: SRC2 });
    const out = await sheetService.addSource(ORG, {
      url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit', practice_label: 'Ashford',
    });
    expect(repoMock.createSource).toHaveBeenCalledWith(ORG, expect.objectContaining({
      spreadsheet_id: '1AbC_d-EfGhIjK123', practice_label: 'Ashford',
    }));
    expect(out.id).toBe(SRC2);
    expect(out.tabs).toEqual(['Data']);
  });
  it('refuses when Google Sheets is not connected', async () => {
    integrationRepoMock.getByProvider.mockResolvedValue(null);
    await expect(sheetService.addSource(ORG, {
      url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit', practice_label: 'Barnet',
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('saveMapping / syncNow / removeSource', () => {
  it('saves the mapping on THAT source, resets the cursor, starts its full sync', async () => {
    const out = await sheetService.saveMapping(ORG, {
      sourceId: SRC, tab_name: 'Lead_Conversion_Tracking', header_row: 1,
      columns: { date: 0, created_time: 4, called_3m: 5, called_10m: 6, pipeline_name: 7 },
    });
    expect(repoMock.updateSource).toHaveBeenCalledWith(ORG, SRC, expect.objectContaining({
      tab_name: 'Lead_Conversion_Tracking', last_synced_row: 0, status: 'pending',
    }));
    expect(syncMock.fullSync).toHaveBeenCalledWith(ORG, SRC);
    expect(out.syncStarted).toBe(true);
  });
  it('syncNow refuses before that source is mapped', async () => {
    repoMock.getSourceById.mockResolvedValue({ ...SOURCE, column_mapping: null });
    await expect(sheetService.syncNow(ORG, SRC)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('syncNow 404s on an unknown source id', async () => {
    repoMock.getSourceById.mockResolvedValue(null);
    await expect(sheetService.syncNow(ORG, SRC2)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('removeSource purges that source\'s leads then the source', async () => {
    const out = await sheetService.removeSource(ORG, SRC);
    expect(repoMock.deleteLeadsBySource).toHaveBeenCalledWith(ORG, SRC);
    expect(repoMock.deleteSource).toHaveBeenCalledWith(ORG, SRC);
    expect(out.ok).toBe(true);
  });
});

describe('disconnect', () => {
  it('purges all leads + sources then revokes the token', async () => {
    await sheetService.disconnect(ORG);
    expect(repoMock.deleteAllLeads).toHaveBeenCalledWith(ORG);
    expect(repoMock.deleteAllSources).toHaveBeenCalledWith(ORG);
    expect(integrationRepoMock.markRevoked).toHaveBeenCalledWith(ORG, 'google_sheets');
  });
});

describe('pickerConfig', () => {
  it('is disabled (and token-free) until GOOGLE_PICKER_API_KEY is set', async () => {
    delete process.env.GOOGLE_PICKER_API_KEY;
    const out = await sheetService.pickerConfig(ORG);
    expect(out).toEqual({ enabled: false });
  });
  it('returns the browser key + a decrypted short-lived access token when configured', async () => {
    process.env.GOOGLE_PICKER_API_KEY = 'browser-key';
    process.env.GOOGLE_CLOUD_PROJECT_NUMBER = '122855749965';
    try {
      const { encryptSecret } = await import('../src/lib/crypto.js');
      integrationRepoMock.getByProvider.mockResolvedValue({
        status: 'active',
        secrets: encryptSecret(JSON.stringify({ access_token: 'live-token', refresh_token: 'refresh' })),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      const out = await sheetService.pickerConfig(ORG);
      expect(out).toMatchObject({ enabled: true, apiKey: 'browser-key', appId: '122855749965', accessToken: 'live-token' });
      expect(JSON.stringify(out)).not.toContain('refresh');
    } finally {
      delete process.env.GOOGLE_PICKER_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    }
  });
});

describe('sheetMappingSchema', () => {
  it('accepts the v2 keys and rejects duplicate columns', async () => {
    const { sheetMappingSchema } = await import('../src/models/sheet.model.js');
    const good = {
      tab_name: 'Data', header_row: 1,
      columns: { date: 0, created_time: 4, called_3m: 5, called_10m: 6, pipeline_name: 7 },
    };
    expect(() => sheetMappingSchema.parse(good)).not.toThrow();
    const bad = { ...good, columns: { ...good.columns, created_time: 0 } };
    expect(() => sheetMappingSchema.parse(bad)).toThrow();
  });
  it('sheetSourceCreateSchema requires a practice label', async () => {
    const { sheetSourceCreateSchema } = await import('../src/models/sheet.model.js');
    expect(() => sheetSourceCreateSchema.parse({ url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit' })).toThrow();
    expect(() => sheetSourceCreateSchema.parse({
      url: 'https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit', practice_label: '  Barnet ',
    })).not.toThrow();
  });
});

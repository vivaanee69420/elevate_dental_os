// Tab management + idempotent append for the conversion export sheet writer.
// Tab identity is the practice UUID stamped as spreadsheet-level developer
// metadata (key `practice:<uuid>`) — NOT the display title — so renaming a
// practice in the app never forks a new tab. writerFetch is mocked; these
// tests assert the exact Sheets API calls the writer issues.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const writerFetch = vi.fn();

vi.mock('../src/lib/integrations/google-sheets-writer-provider.js', () => ({
  writerFetch: (...args) => writerFetch(...args),
}));

describe('google-sheets-writer', () => {
  beforeEach(() => {
    writerFetch.mockReset();
  });

  describe('formatLondonDate', () => {
    it('formats a UTC ISO timestamp as dd/mm/yyyy in Europe/London', async () => {
      const { formatLondonDate } = await import('../src/lib/integrations/google-sheets-writer.js');
      expect(formatLondonDate('2026-08-12T18:30:00Z')).toBe('12/08/2026');
    });

    it('is DST-correct at the BST boundary (23:30 UTC rolls to the next London day)', async () => {
      const { formatLondonDate } = await import('../src/lib/integrations/google-sheets-writer.js');
      expect(formatLondonDate('2026-06-30T23:30:00Z')).toBe('01/07/2026');
    });

    it('returns empty string for null/undefined', async () => {
      const { formatLondonDate } = await import('../src/lib/integrations/google-sheets-writer.js');
      expect(formatLondonDate(null)).toBe('');
      expect(formatLondonDate(undefined)).toBe('');
    });
  });

  describe('ensurePracticeTab', () => {
    it('returns the CURRENT title of the mapped sheetId when metadata already maps the practice, performing no batchUpdate', async () => {
      const { ensurePracticeTab, HEADER } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch
        .mockResolvedValueOnce({
          sheets: [
            { properties: { sheetId: 111, title: 'Old Name' } },
            { properties: { sheetId: 222, title: 'Bexleyheath' } },
          ],
          developerMetadata: [
            { metadataKey: 'practice:practice-uuid-1', metadataValue: '222' },
          ],
        })
        // 2. header check — header intact, no repair needed
        .mockResolvedValueOnce({ values: [HEADER] });

      const title = await ensurePracticeTab('org-1', 'sheet-1', 'practice-uuid-1', 'Bexleyheath Renamed');

      expect(title).toBe('Bexleyheath');
      expect(writerFetch).toHaveBeenCalledTimes(2);
      const batchUpdateCalls = writerFetch.mock.calls.filter(([path]) => path.includes(':batchUpdate'));
      expect(batchUpdateCalls).toHaveLength(0);
    });

    it('self-heals a mapped tab whose contents were cleared: re-inserts the header row and re-hides the Export ID column', async () => {
      const { ensurePracticeTab, HEADER } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch
        .mockResolvedValueOnce({
          sheets: [{ properties: { sheetId: 222, title: 'Rochester' } }],
          developerMetadata: [{ metadataKey: 'practice:practice-uuid-1', metadataValue: '222' }],
        })
        // 2. header check — row 1 holds DATA, not the header (tab was cleared then re-appended)
        .mockResolvedValueOnce({ values: [['04/11/2024', 'Anthony Rose']] })
        // 3. batchUpdate insertDimension + hide column H
        .mockResolvedValueOnce({})
        // 4. values.update header into the new row 1
        .mockResolvedValueOnce({});

      const title = await ensurePracticeTab('org-1', 'sheet-1', 'practice-uuid-1', 'Rochester');

      expect(title).toBe('Rochester');
      const [, repairPath, repairOpts] = writerFetch.mock.calls[2];
      expect(repairPath).toBe('/v4/spreadsheets/sheet-1:batchUpdate');
      expect(repairOpts.body.requests[0].insertDimension.range).toEqual(
        { sheetId: 222, dimension: 'ROWS', startIndex: 0, endIndex: 1 });
      expect(repairOpts.body.requests[1].updateDimensionProperties.range).toEqual(
        { sheetId: 222, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 });

      const [, writePath, writeOpts] = writerFetch.mock.calls[3];
      expect(writePath).toBe(`/v4/spreadsheets/sheet-1/values/${encodeURIComponent("'Rochester'!A1")}`);
      expect(writeOpts.method).toBe('PUT');
      expect(writeOpts.body.values).toEqual([HEADER]);
    });

    it('creates a tab + stamps metadata + appends HEADER when absent', async () => {
      const { ensurePracticeTab, HEADER } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch
        // 1. spreadsheet metadata fetch — no existing mapping
        .mockResolvedValueOnce({ sheets: [], developerMetadata: [] })
        // 2. batchUpdate addSheet
        .mockResolvedValueOnce({ replies: [{ addSheet: { properties: { sheetId: 999, title: 'Ashford' } } }] })
        // 3. batchUpdate createDeveloperMetadata
        .mockResolvedValueOnce({})
        // 4. appendRows HEADER
        .mockResolvedValueOnce({});

      const title = await ensurePracticeTab('org-1', 'sheet-1', 'practice-uuid-2', 'Ashford');

      expect(title).toBe('Ashford');
      expect(writerFetch).toHaveBeenCalledTimes(4);

      const [, addSheetPath, addSheetOpts] = writerFetch.mock.calls[1];
      expect(addSheetPath).toBe('/v4/spreadsheets/sheet-1:batchUpdate');
      expect(addSheetOpts.method).toBe('POST');
      expect(addSheetOpts.body.requests[0].addSheet.properties.title).toBe('Ashford');

      const [, metaPath, metaOpts] = writerFetch.mock.calls[2];
      expect(metaPath).toBe('/v4/spreadsheets/sheet-1:batchUpdate');
      const metaReq = metaOpts.body.requests[0].createDeveloperMetadata.developerMetadata;
      expect(metaReq.metadataKey).toBe('practice:practice-uuid-2');
      expect(metaReq.metadataValue).toBe('999');
      // Export ID (column H) hidden on creation — bookkeeping, not report content.
      const hideReq = metaOpts.body.requests.find((r) => r.updateDimensionProperties);
      expect(hideReq.updateDimensionProperties.range).toEqual(
        { sheetId: 999, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 });
      expect(hideReq.updateDimensionProperties.properties.hiddenByUser).toBe(true);

      const [, appendPath, appendOpts] = writerFetch.mock.calls[3];
      expect(appendPath).toContain(`/values/${encodeURIComponent("'Ashford'!A1")}:append`);
      expect(appendOpts.body.values).toEqual([HEADER]);
    });

    it('HEADER puts Lead Incoming Date first and Export ID last (hidden column K)', async () => {
      const { HEADER } = await import('../src/lib/integrations/google-sheets-writer.js');
      expect(HEADER).toEqual(['Lead Incoming Date', 'Name', 'Email', 'Phone',
        'Source (Pipeline)', 'Appointment Date', 'Treatment',
        'Status', 'Invoiced', 'Collected', 'Export ID']);
    });

    it('metadata points at a deleted sheetId + a second valid entry -> uses the valid one, no batchUpdate', async () => {
      const { ensurePracticeTab } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch
        .mockResolvedValueOnce({
          sheets: [
            { properties: { sheetId: 222, title: 'Bexleyheath' } },
          ],
          developerMetadata: [
            // Stale — pointed at a sheetId that no longer exists.
            { metadataKey: 'practice:practice-uuid-1', metadataValue: '111' },
            // Valid — still resolves.
            { metadataKey: 'practice:practice-uuid-1', metadataValue: '222' },
          ],
        })
        // 2. header check — intact
        .mockResolvedValueOnce({ values: [['Lead Incoming Date']] });

      const title = await ensurePracticeTab('org-1', 'sheet-1', 'practice-uuid-1', 'Bexleyheath');

      expect(title).toBe('Bexleyheath');
      expect(writerFetch).toHaveBeenCalledTimes(2);
      const batchUpdateCalls = writerFetch.mock.calls.filter(([path]) => path.includes(':batchUpdate'));
      expect(batchUpdateCalls).toHaveLength(0);
    });

    it('metadata points ONLY at a deleted sheetId -> creates a tab, deletes stale metadata, stamps fresh metadata', async () => {
      const { ensurePracticeTab } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch
        // 1. spreadsheet metadata fetch — only a stale mapping (sheetId 111 no longer in sheets)
        .mockResolvedValueOnce({
          sheets: [{ properties: { sheetId: 222, title: 'Other Tab' } }],
          developerMetadata: [{ metadataKey: 'practice:practice-uuid-1', metadataValue: '111' }],
        })
        // 2. batchUpdate addSheet
        .mockResolvedValueOnce({ replies: [{ addSheet: { properties: { sheetId: 333, title: 'Bexleyheath' } } }] })
        // 3. batchUpdate delete-stale + createDeveloperMetadata
        .mockResolvedValueOnce({})
        // 4. appendRows HEADER
        .mockResolvedValueOnce({});

      const title = await ensurePracticeTab('org-1', 'sheet-1', 'practice-uuid-1', 'Bexleyheath');

      expect(title).toBe('Bexleyheath');
      expect(writerFetch).toHaveBeenCalledTimes(4);

      const [, metaPath, metaOpts] = writerFetch.mock.calls[2];
      expect(metaPath).toBe('/v4/spreadsheets/sheet-1:batchUpdate');
      const requests = metaOpts.body.requests;
      expect(requests[0].deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataKey)
        .toBe('practice:practice-uuid-1');
      expect(requests[1].createDeveloperMetadata.developerMetadata.metadataKey).toBe('practice:practice-uuid-1');
      expect(requests[1].createDeveloperMetadata.developerMetadata.metadataValue).toBe('333');
    });

    it('retries once with a " (2)" suffix when addSheet 400s on a duplicate title', async () => {
      const { ensurePracticeTab } = await import('../src/lib/integrations/google-sheets-writer.js');
      const dupError = new Error('A sheet with the name "Ashford" already exists.');
      dupError.status = 400;

      writerFetch
        // 1. spreadsheet metadata fetch — no existing mapping
        .mockResolvedValueOnce({ sheets: [], developerMetadata: [] })
        // 2. batchUpdate addSheet — 400 duplicate title
        .mockRejectedValueOnce(dupError)
        // 3. batchUpdate addSheet retry with suffix — succeeds
        .mockResolvedValueOnce({ replies: [{ addSheet: { properties: { sheetId: 998, title: 'Ashford (2)' } } }] })
        // 4. batchUpdate createDeveloperMetadata
        .mockResolvedValueOnce({})
        // 5. appendRows HEADER
        .mockResolvedValueOnce({});

      const title = await ensurePracticeTab('org-1', 'sheet-1', 'practice-uuid-3', 'Ashford');

      expect(title).toBe('Ashford (2)');
      const retryCall = writerFetch.mock.calls[2];
      expect(retryCall[2].body.requests[0].addSheet.properties.title).toBe('Ashford (2)');
    });
  });

  describe('appendRows', () => {
    it('POSTs to values/<tab>!A1:append with RAW input + INSERT_ROWS and the rows in body.values', async () => {
      const { appendRows } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch.mockResolvedValueOnce({});

      const rows = [['Jane Doe', 'jane@example.com', '07700900000', 'Facebook', '12/08/2026', '10/08/2026', 'export-id-1']];
      const result = await appendRows('org-1', 'sheet-1', 'Bexleyheath', rows);

      expect(result).toEqual({ appended: 1 });
      expect(writerFetch).toHaveBeenCalledTimes(1);
      const [, path, opts] = writerFetch.mock.calls[0];
      expect(path).toBe(`/v4/spreadsheets/sheet-1/values/${encodeURIComponent("'Bexleyheath'!A1")}:append`);
      expect(opts.method).toBe('POST');
      expect(opts.params).toEqual({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
      expect(opts.body.values).toEqual(rows);
    });

    it('no-ops on an empty rows array without calling writerFetch', async () => {
      const { appendRows } = await import('../src/lib/integrations/google-sheets-writer.js');
      const result = await appendRows('org-1', 'sheet-1', 'Bexleyheath', []);
      expect(result).toEqual({ appended: 0 });
      expect(writerFetch).not.toHaveBeenCalled();
    });

    it('quotes a tab title, doubling internal apostrophes ("St Mary\'s")', async () => {
      const { appendRows } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch.mockResolvedValueOnce({});

      await appendRows('org-1', 'sheet-1', "St Mary's", [['Jane Doe']]);

      const [, path] = writerFetch.mock.calls[0];
      expect(path).toBe(`/v4/spreadsheets/sheet-1/values/${encodeURIComponent("'St Mary''s'!A1")}:append`);
    });
  });

  describe('readExportIds', () => {
    it('unions columns G and H into a Set (H = current tabs, G = pre-Treatment tabs), skipping the header via the range', async () => {
      const { readExportIds } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch.mockResolvedValueOnce({
        // Current tab shape: [treatment, export id]; old tab rows carry the id in G.
        values: [['Cosmetic Consultation', 'export-id-1'], ['', 'export-id-2'], ['old-tab-id'], ['', '']],
      });

      const ids = await readExportIds('org-1', 'sheet-1', 'Bexleyheath');

      expect(ids).toBeInstanceOf(Set);
      expect(ids.has('export-id-1')).toBe(true);
      expect(ids.has('export-id-2')).toBe(true);
      expect(ids.has('old-tab-id')).toBe(true);
      expect(ids.has('')).toBe(false);
      const [, path] = writerFetch.mock.calls[0];
      expect(path).toBe(`/v4/spreadsheets/sheet-1/values/${encodeURIComponent("'Bexleyheath'!G2:L")}`);
    });

    it('quotes a tab title with an apostrophe for the G2:L range', async () => {
      const { readExportIds } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch.mockResolvedValueOnce({ values: [] });

      await readExportIds('org-1', 'sheet-1', "St Mary's");

      const [, path] = writerFetch.mock.calls[0];
      expect(path).toBe(`/v4/spreadsheets/sheet-1/values/${encodeURIComponent("'St Mary''s'!G2:L")}`);
    });

    it('returns an empty Set when the range has no values', async () => {
      const { readExportIds } = await import('../src/lib/integrations/google-sheets-writer.js');
      writerFetch.mockResolvedValueOnce({});
      const ids = await readExportIds('org-1', 'sheet-1', 'Bexleyheath');
      expect(ids).toEqual(new Set());
    });
  });
});

// Drainer service — outbox: enqueue -> claim -> match -> append -> mark.
// All collaborators mocked at module level (vi.mock). No real network/DB.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/repositories/sheet-export.repository.js', () => ({
  sheetExportRepository: {
    enqueue: vi.fn(),
    claim: vi.fn(),
    markExported: vi.fn(),
    markNoMatch: vi.fn(),
    markSkipped: vi.fn(),
    markRetry: vi.fn(),
    counts: vi.fn(),
    getContact: vi.fn(),
    appointmentType: vi.fn(),
    appointmentStatus: vi.fn(),
    revenue: vi.fn(),
    exportedRows: vi.fn(),
    practices: vi.fn(),
    recordMatch: vi.fn(),
    pipelineLeads: vi.fn(),
    orgsWithWriter: vi.fn(),
  },
}));

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: {
    getByProvider: vi.fn(),
    mergeConfig: vi.fn(),
    markRevoked: vi.fn(),
    markFailed: vi.fn(),
    setSyncTime: vi.fn(),
  },
}));

vi.mock('../src/services/sheet-export-match.service.js', () => ({
  findMatch: vi.fn(),
  pipelineNameMap: vi.fn(async () => new Map([['pipe-1', 'New Patient'], ['pipe-2', 'Google PPC']])),
  journeyFromLeads: vi.fn((leads, names) => {
    const seen = new Set(); const out = [];
    for (const l of [...leads].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
      const n = names.get(String(l.ghl_pipeline_id));
      if (n && !seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out.length ? out.join(' → ') : 'Unknown pipeline';
  }),
}));

vi.mock('../src/lib/integrations/google-sheets-writer-provider.js', () => ({
  WRITER_PROVIDER_ID: 'google_sheets_writer',
  writerFetch: vi.fn(),
}));

vi.mock('../src/lib/integrations/google-sheets-provider.js', () => ({
  parseSpreadsheetId: vi.fn(),
}));

vi.mock('../src/lib/integrations/google-sheets-writer.js', () => ({
  ensurePracticeTab: vi.fn(),
  ensureOpenDayTab: vi.fn(),
  appendRows: vi.fn(),
  listMappedTabs: vi.fn(),
  readTabGrid: vi.fn(),
  batchUpdateCells: vi.fn(),
  rangeFor: vi.fn((t, r, a, b) => `'${t}'!${String.fromCharCode(64 + a)}${r}:${String.fromCharCode(64 + b)}${r}`),
  readExportIds: vi.fn(),
  formatLondonDate: vi.fn((iso) => (iso ? `formatted:${iso}` : '')),
  londonDateSerial: vi.fn((iso) => (iso ? `serial:${iso}` : '')),
  sortMappedTabsByLeadDate: vi.fn(async () => ({ sorted: 0 })),
}));

import { sheetExportRepository } from '../src/repositories/sheet-export.repository.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { findMatch } from '../src/services/sheet-export-match.service.js';
import { writerFetch } from '../src/lib/integrations/google-sheets-writer-provider.js';
import { parseSpreadsheetId } from '../src/lib/integrations/google-sheets-provider.js';
import { ensurePracticeTab, ensureOpenDayTab, appendRows, readExportIds, londonDateSerial, listMappedTabs, readTabGrid, batchUpdateCells, sortMappedTabsByLeadDate }
  from '../src/lib/integrations/google-sheets-writer.js';
import { sheetExportService } from '../src/services/sheet-export.service.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';

function integ(overrides = {}) {
  return {
    status: 'active',
    secrets: 'encrypted-blob',
    config: { spreadsheet_id: 'sheet-1', export_since: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

function contact(overrides = {}) {
  return {
    id: 'contact-1',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@x.com',
    phone: '+447123456789',
    ...overrides,
  };
}

function queueRow(overrides = {}) {
  return {
    id: 'row-1',
    contact_id: 'contact-1',
    practice_id: 'practice-1',
    appointment_id: 'appt-1',
    appointment_starts_at: '2026-02-01T10:00:00.000Z',
    ...overrides,
  };
}

function matchResult(overrides = {}) {
  return {
    matchedContact: { id: 'ghl-1', email: 'ghl-jane@x.com', phone: '+447000000000' },
    lead: { id: 'lead-1' },
    pipelineName: 'New Patient',
    leadCreatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sheetExportRepository.enqueue.mockResolvedValue(0);
  sheetExportRepository.claim.mockResolvedValue([]);
  sheetExportRepository.practices.mockResolvedValue([{ id: 'practice-1', name: 'Bexleyheath' }]);
  sheetExportRepository.markRetry.mockResolvedValue(undefined);
  sheetExportRepository.markNoMatch.mockResolvedValue(undefined);
  sheetExportRepository.appointmentType.mockResolvedValue('Cosmetic Consultation');
  sheetExportRepository.appointmentStatus.mockResolvedValue('scheduled');
  sheetExportRepository.revenue.mockResolvedValue({ invoicedPence: 12500, collectedPence: 5000 });
  sheetExportRepository.exportedRows.mockResolvedValue([]);
  sheetExportRepository.pipelineLeads.mockResolvedValue([]);
  listMappedTabs.mockResolvedValue([]);
  readTabGrid.mockResolvedValue([]);
  batchUpdateCells.mockResolvedValue({ updated: 0 });
  integrationRepository.setSyncTime.mockResolvedValue(undefined);
  integrationRepository.markFailed.mockResolvedValue(undefined);
  ensurePracticeTab.mockResolvedValue('Bexleyheath');
  ensureOpenDayTab.mockResolvedValue('Open Days');
  sheetExportRepository.markSkipped.mockResolvedValue(undefined);
  readExportIds.mockResolvedValue(new Set());
  appendRows.mockResolvedValue({ appended: 0 });
});

describe('drainOrg', () => {
  it('1. not connected / revoked / no spreadsheet_id -> skipped, no RPC calls', async () => {
    integrationRepository.getByProvider.mockResolvedValue(null);
    let result = await sheetExportService.drainOrg(ORG);
    expect(result).toEqual({ skipped: 'not_connected' });

    integrationRepository.getByProvider.mockResolvedValue(integ({ status: 'revoked' }));
    result = await sheetExportService.drainOrg(ORG);
    expect(result).toEqual({ skipped: 'not_connected' });

    integrationRepository.getByProvider.mockResolvedValue(integ({ secrets: null }));
    result = await sheetExportService.drainOrg(ORG);
    expect(result).toEqual({ skipped: 'not_connected' });

    integrationRepository.getByProvider.mockResolvedValue(integ({ config: {} }));
    result = await sheetExportService.drainOrg(ORG);
    expect(result).toEqual({ skipped: 'no_destination' });

    expect(sheetExportRepository.enqueue).not.toHaveBeenCalled();
    expect(sheetExportRepository.claim).not.toHaveBeenCalled();
  });

  it("1b. integration status 'failed' -> skipped: 'integration_failed', no enqueue/claim (outage pause, no lost rows)", async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ({ status: 'failed' }));

    const result = await sheetExportService.drainOrg(ORG);

    expect(result).toEqual({ skipped: 'integration_failed' });
    expect(sheetExportRepository.enqueue).not.toHaveBeenCalled();
    expect(sheetExportRepository.claim).not.toHaveBeenCalled();
  });

  it('2. happy path: enqueue with export_since, claim, match, ensurePracticeTab + appendRows with 6 display fields + uuid, markExported, formatLondonDate used', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());

    const result = await sheetExportService.drainOrg(ORG);

    expect(sheetExportRepository.enqueue).toHaveBeenCalledWith(ORG, '2026-01-01T00:00:00.000Z');
    expect(sheetExportRepository.recordMatch).toHaveBeenCalledWith(ORG, row.id, 'ghl-1', 'lead-1');
    expect(ensurePracticeTab).toHaveBeenCalledWith(ORG, 'sheet-1', 'practice-1', 'Bexleyheath');
    expect(appendRows).toHaveBeenCalledTimes(1);
    const [, , , rows] = appendRows.mock.calls[0];
    // Lead Incoming Date leads the row; Treatment precedes the hidden Export ID.
    expect(sheetExportRepository.appointmentType).toHaveBeenCalledWith(ORG, 'appt-1');
    expect(rows).toEqual([
      ['serial:2026-01-15T00:00:00.000Z', 'Jane Doe', 'jane@x.com',
        '+447123456789', 'New Patient', 'serial:2026-02-01T10:00:00.000Z',
        'Cosmetic Consultation', 'Booked', 125, 50, row.id],
    ]);
    expect(londonDateSerial).toHaveBeenCalledWith('2026-02-01T10:00:00.000Z');
    expect(londonDateSerial).toHaveBeenCalledWith('2026-01-15T00:00:00.000Z');
    expect(sortMappedTabsByLeadDate).toHaveBeenCalledWith(ORG, 'sheet-1');
    expect(sheetExportRepository.markExported).toHaveBeenCalledWith(ORG, [row.id]);
    expect(result).toEqual({ exported: 1, noMatch: 0, retried: 0, excluded: 0, skippedDuplicates: 0 });
  });

  it('2b. blank Dentally email/phone fall back to the matched GHL contact details', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact({ email: null, phone: '' }));
    findMatch.mockResolvedValue(matchResult());

    await sheetExportService.drainOrg(ORG);

    const [, , , rows] = appendRows.mock.calls[0];
    expect(rows[0][2]).toBe('ghl-jane@x.com');
    expect(rows[0][3]).toBe('+447000000000');
  });

  it('2c. telephone consultation -> markSkipped (excluded), nothing appended, terminal', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());
    // Live Dentally value carries a trailing space — matching must be trimmed
    // + case-insensitive.
    sheetExportRepository.appointmentType.mockResolvedValue('Telephone consultation ');

    const result = await sheetExportService.drainOrg(ORG);

    expect(sheetExportRepository.markSkipped).toHaveBeenCalledWith(ORG, row.id, 'excluded: telephone consultation');
    expect(appendRows).not.toHaveBeenCalled();
    expect(sheetExportRepository.markExported).not.toHaveBeenCalled();
    expect(result).toEqual({ exported: 0, noMatch: 0, retried: 0, excluded: 1, skippedDuplicates: 0 });
  });

  it('2d. open-day pipeline -> routed to the Open Days tab with a Practice column, not the practice tab', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult({ pipelineName: '3. Cosmetic Dental Open Day (8th July 2026)' }));

    const result = await sheetExportService.drainOrg(ORG);

    expect(ensureOpenDayTab).toHaveBeenCalledWith(ORG, 'sheet-1');
    expect(ensurePracticeTab).not.toHaveBeenCalled();
    const [, , tab, rows] = appendRows.mock.calls[0];
    expect(tab).toBe('Open Days');
    // Practice column precedes Status/Invoiced/Collected + hidden Export ID.
    expect(rows[0][7]).toBe('Bexleyheath');
    expect(rows[0][8]).toBe('Booked');
    expect(rows[0][11]).toBe(row.id);
    expect(result).toEqual({ exported: 1, noMatch: 0, retried: 0, excluded: 0, skippedDuplicates: 0 });
  });

  it('3. matcher returns null -> markNoMatch, nothing appended', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(null);

    const result = await sheetExportService.drainOrg(ORG);

    expect(sheetExportRepository.markNoMatch).toHaveBeenCalledWith(ORG, row.id, 'no GHL pipeline lead matched');
    expect(appendRows).not.toHaveBeenCalled();
    expect(sheetExportRepository.markExported).not.toHaveBeenCalled();
    expect(result).toEqual({ exported: 0, noMatch: 1, retried: 0, excluded: 0, skippedDuplicates: 0 });
  });

  it('4. appendRows throws -> markRetry with error message, no markExported, error does not propagate', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());
    appendRows.mockRejectedValue(new Error('sheets append boom'));

    const result = await expect(sheetExportService.drainOrg(ORG)).resolves.toEqual({
      exported: 0, noMatch: 0, retried: 1, excluded: 0, skippedDuplicates: 0,
    });

    expect(sheetExportRepository.markRetry).toHaveBeenCalledWith(ORG, row.id, 'sheets append boom');
    expect(sheetExportRepository.markExported).not.toHaveBeenCalled();
  });

  it('5. row uuid already in readExportIds -> skipped from append but still markExported (crash recovery)', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());
    readExportIds.mockResolvedValue(new Set([row.id]));

    const result = await sheetExportService.drainOrg(ORG);

    expect(appendRows).toHaveBeenCalledWith(ORG, 'sheet-1', 'Bexleyheath', []);
    expect(sheetExportRepository.markExported).toHaveBeenCalledWith(ORG, [row.id]);
    // The row was already in the sheet (dedup via Export ID column) — it
    // still gets markExported (crash recovery), but it does NOT count as a
    // fresh export; it's reported as a skipped duplicate instead.
    expect(result).toEqual({ exported: 0, noMatch: 0, retried: 0, excluded: 0, skippedDuplicates: 1 });
  });

  it('6. two claimed rows, same practice -> ONE appendRows call with two value rows', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const rowA = queueRow({ id: 'row-a', contact_id: 'contact-a' });
    const rowB = queueRow({ id: 'row-b', contact_id: 'contact-b' });
    sheetExportRepository.claim.mockResolvedValue([rowA, rowB]);
    sheetExportRepository.getContact.mockImplementation(async (org, contactId) => contact({ id: contactId }));
    findMatch.mockResolvedValue(matchResult());

    const result = await sheetExportService.drainOrg(ORG);

    expect(appendRows).toHaveBeenCalledTimes(1);
    const [, , , rows] = appendRows.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(sheetExportRepository.markExported).toHaveBeenCalledWith(ORG, [rowA.id, rowB.id]);
    expect(result.exported).toBe(2);
  });

  it('7. kickDrain twice within debounce window -> drainOrg runs once', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(sheetExportService, 'drainOrg').mockResolvedValue({ exported: 0, noMatch: 0, retried: 0 });

    sheetExportService.kickDrain(ORG);
    sheetExportService.kickDrain(ORG);
    await vi.runAllTimersAsync();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('8. cross-org isolation: drainOrg(org-a) never passes org-b to any collaborator', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());

    await sheetExportService.drainOrg(ORG);

    const allMockFns = [
      integrationRepository.getByProvider, integrationRepository.setSyncTime,
      integrationRepository.markFailed,
      sheetExportRepository.enqueue, sheetExportRepository.claim, sheetExportRepository.practices,
      sheetExportRepository.getContact, sheetExportRepository.recordMatch,
      sheetExportRepository.markExported, sheetExportRepository.markNoMatch, sheetExportRepository.markRetry,
    ];
    for (const fn of allMockFns) {
      for (const call of fn.mock.calls) {
        expect(call[0]).not.toBe(OTHER_ORG);
      }
    }
    expect(findMatch.mock.calls.every((call) => call[0] !== OTHER_ORG)).toBe(true);
  });

  it('9. no token material in any thrown/logged string: markRetry message comes from err.message only', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());
    const err = new Error('sheets append boom');
    err.secrets = 'super-secret-token-should-never-leak';
    appendRows.mockRejectedValue(err);

    await sheetExportService.drainOrg(ORG);

    const call = sheetExportRepository.markRetry.mock.calls.find((c) => c[1] === row.id);
    expect(call[2]).toBe('sheets append boom');
    expect(call[2]).not.toContain('super-secret-token-should-never-leak');
  });

  it('11. recovery-write failure (markRetry rejects) never escapes drainOrg — remaining rows/batches still process', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const rowA = queueRow({ id: 'row-a', contact_id: 'contact-a', practice_id: 'practice-1' });
    const rowB = queueRow({ id: 'row-b', contact_id: 'contact-b', practice_id: 'practice-2' });
    sheetExportRepository.claim.mockResolvedValue([rowA, rowB]);
    sheetExportRepository.practices.mockResolvedValue([
      { id: 'practice-1', name: 'Bexleyheath' },
      { id: 'practice-2', name: 'Barnet' },
    ]);
    // rowA's match throws (goes through the catch -> markRetry recovery path);
    // markRetry ITSELF rejects (e.g. a transient Supabase blip during recovery).
    sheetExportRepository.getContact.mockImplementation(async (org, contactId) => {
      if (contactId === 'contact-a') throw new Error('lookup boom');
      return contact({ id: contactId });
    });
    sheetExportRepository.markRetry.mockRejectedValue(new Error('supabase write boom'));
    findMatch.mockResolvedValue(matchResult());
    ensurePracticeTab.mockImplementation(async (org, sheetId, practiceId, name) => name);

    const result = await sheetExportService.drainOrg(ORG);

    // Did not throw, and rowB (the remaining row) still got matched + appended
    // + exported — the failed recovery write for rowA did not abort the loop.
    expect(result.retried).toBe(1);
    expect(appendRows).toHaveBeenCalledWith(ORG, 'sheet-1', 'Barnet', [expect.any(Array)]);
    expect(sheetExportRepository.markExported).toHaveBeenCalledWith(ORG, [rowB.id]);
  });

  it('10. appendRows throws 404 -> integrationRepository.markFailed called + rows get markRetry (stay pending)', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    const row = queueRow();
    sheetExportRepository.claim.mockResolvedValue([row]);
    sheetExportRepository.getContact.mockResolvedValue(contact());
    findMatch.mockResolvedValue(matchResult());
    const err = new Error('Sheets API HTTP 404');
    err.status = 404;
    appendRows.mockRejectedValue(err);

    const result = await sheetExportService.drainOrg(ORG);

    expect(integrationRepository.markFailed).toHaveBeenCalledWith(
      ORG, 'google_sheets_writer', 'destination sheet not accessible',
    );
    expect(sheetExportRepository.markRetry).toHaveBeenCalledWith(ORG, row.id, 'Sheets API HTTP 404');
    expect(result.retried).toBe(1);
  });
});

describe('refreshOrg', () => {
  it('updates Status/Invoiced/Collected in place for changed rows only, found via Export ID', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    sheetExportRepository.exportedRows.mockResolvedValue([
      { id: 'row-1', contact_id: 'contact-1', matched_contact_id: 'ghl-1', appointment_id: 'appt-1',
        appointment_starts_at: '2026-02-01T10:00:00.000Z', episode: 1, episode_lead_at: null },
    ]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([
      { id: 'l1', contact_id: 'ghl-1', ghl_pipeline_id: 'pipe-1', created_at: '2026-01-15T00:00:00.000Z' },
      // Moved/added in GHL after export — journey must gain Google PPC.
      { id: 'l2', contact_id: 'ghl-1', ghl_pipeline_id: 'pipe-2', created_at: '2026-01-20T00:00:00.000Z' },
    ]);
    listMappedTabs.mockResolvedValue([{ key: 'practice:practice-1', title: 'Bexleyheath' }]);
    readTabGrid.mockResolvedValue([
      ['Lead Incoming Date', 'Name', 'Email', 'Phone', 'Source (Pipeline)',
        'Appointment Date', 'Treatment', 'Status', 'Invoiced', 'Collected', 'Export ID'],
      // Stale row: was Booked/125/50 — appointment now completed with more revenue.
      ['15/01/2026', 'Jane Doe', 'jane@x.com', '+447123456789', 'New Patient',
        '01/02/2026', 'Cosmetic Consultation', 'Booked', 125, 50, 'row-1'],
      // A row whose Export ID we do not know — must be left alone.
      ['16/01/2026', 'Someone Else', '', '', 'Other', '02/02/2026', 'Implant',
        'Booked', 0, 0, 'unknown-id'],
    ]);
    sheetExportRepository.appointmentStatus.mockResolvedValue('completed');
    sheetExportRepository.revenue.mockResolvedValue({ invoicedPence: 250000, collectedPence: 100000 });

    const result = await sheetExportService.refreshOrg(ORG);

    expect(batchUpdateCells).toHaveBeenCalledTimes(1);
    const [, , data] = batchUpdateCells.mock.calls[0];
    expect(data).toEqual([
      { range: "'Bexleyheath'!H2:J2", values: [['Completed', 2500, 1000]] },
      // Source recomputed from the matched contact's CURRENT leads.
      { range: "'Bexleyheath'!E2:E2", values: [['New Patient → Google PPC']] },
    ]);
    expect(result).toEqual({ refreshed: 2 });
  });

  it('unchanged rows produce no updates; pre-Status tabs are skipped', async () => {
    integrationRepository.getByProvider.mockResolvedValue(integ());
    sheetExportRepository.exportedRows.mockResolvedValue([
      { id: 'row-1', contact_id: 'contact-1', matched_contact_id: 'ghl-1', appointment_id: 'appt-1',
        appointment_starts_at: '2026-02-01T10:00:00.000Z', episode: 1, episode_lead_at: null },
    ]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([
      { id: 'l1', contact_id: 'ghl-1', ghl_pipeline_id: 'pipe-1', created_at: '2026-01-15T00:00:00.000Z' },
    ]);
    listMappedTabs.mockResolvedValue([
      { key: 'practice:practice-1', title: 'Bexleyheath' },
      { key: 'practice:practice-2', title: 'OldLayout' },
    ]);
    readTabGrid
      .mockResolvedValueOnce([
        ['Lead Incoming Date', 'Name', 'Email', 'Phone', 'Source (Pipeline)',
          'Appointment Date', 'Treatment', 'Status', 'Invoiced', 'Collected', 'Export ID'],
        ['15/01/2026', 'Jane Doe', 'jane@x.com', '+447123456789', 'New Patient',
          '01/02/2026', 'Cosmetic Consultation', 'Booked', 125, 50, 'row-1'],
      ])
      // Old layout without a Status column — skipped entirely.
      .mockResolvedValueOnce([
        ['Lead Incoming Date', 'Name', 'Email', 'Phone', 'Source (Pipeline)',
          'Appointment Date', 'Treatment', 'Export ID'],
      ]);
    sheetExportRepository.appointmentStatus.mockResolvedValue('scheduled');
    sheetExportRepository.revenue.mockResolvedValue({ invoicedPence: 12500, collectedPence: 5000 });

    const result = await sheetExportService.refreshOrg(ORG);

    // Nothing changed -> one batchUpdateCells call with an empty payload for
    // the current-layout tab, none for the old-layout tab.
    const payloads = batchUpdateCells.mock.calls.map((c) => c[2]);
    expect(payloads.every((p) => p.length === 0)).toBe(true);
    expect(result).toEqual({ refreshed: 0 });
  });
});

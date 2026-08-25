import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/data-room.repository.js', () => ({
  dataRoomRepository: {
    page: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    viaKeys: vi.fn(async () => []),
    pipelineRows: vi.fn(async () => []),
    logExport: vi.fn(async () => {}),
  },
}));

const { dataRoomService } = await import('../src/services/data-room.service.js');
const { dataRoomRepository: repo } = await import('../src/repositories/data-room.repository.js');
const { encodeCursor, decodeCursor } = await import('../src/lib/data-room/cursor.js');
const { AppError } = await import('../src/middleware/errors.js');

const ORG = '11111111-1111-4111-8111-111111111111';
const PRACTICE = '22222222-2222-4222-8222-222222222222';
const owner = { id: 'u-owner', organisation_id: ORG, role: 'owner' };
const analyst = { id: 'u-analyst', organisation_id: ORG, role: 'analyst' };
const WIN = { scope: 'all', since: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z', limit: 100, pii: false };

beforeEach(() => {
  repo.page.mockReset().mockResolvedValue([]);
  repo.count.mockReset().mockResolvedValue(0);
  repo.viaKeys.mockReset().mockResolvedValue([]);
  repo.pipelineRows.mockReset().mockResolvedValue([]);
  repo.logExport.mockReset().mockResolvedValue(undefined);
});

describe('datasets()', () => {
  it('returns the client registry', () => {
    expect(dataRoomService.datasets().sources.map((s) => s.key)).toContain('dentally');
  });
});

describe('page() — validation', () => {
  it('404s on unknown source/dataset', async () => {
    await expect(dataRoomService.page(owner, 'nope', 'appointments', WIN)).rejects.toMatchObject({ statusCode: 404 });
    await expect(dataRoomService.page(owner, 'dentally', 'nope', WIN)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('400s when an event dataset has no window or since >= until', async () => {
    await expect(dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, since: undefined, until: undefined }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, since: WIN.until, until: WIN.since }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  it('roster datasets ignore the window entirely', async () => {
    await dataRoomService.page(owner, 'dentally', 'practitioners', { ...WIN, since: undefined, until: undefined });
    expect(repo.page).toHaveBeenCalledOnce();
    expect(repo.page.mock.calls[0][2]).toEqual({ practiceId: null, practiceKeys: null, since: null, until: null });
  });
  it('403s when a non-owner asks for PII', async () => {
    await expect(dataRoomService.page(analyst, 'dentally', 'patients', { ...WIN, pii: true }))
      .rejects.toMatchObject({ statusCode: 403, message: 'PII export is owner-only' });
    expect(repo.page).not.toHaveBeenCalled();
  });
});

describe('page() — projection + pagination', () => {
  it('strips PII columns for an analyst and requests only non-PII columns', async () => {
    repo.page.mockResolvedValue([{ id: 'a', practice_id: PRACTICE, pms_external_id: '9', first_name: 'X', email: 'x@y' }]);
    repo.count.mockResolvedValue(1);
    const out = await dataRoomService.page(analyst, 'dentally', 'patients', WIN);
    expect(out.rows).toEqual([{ id: 'a', practice_id: PRACTICE, pms_external_id: '9' }]);
    const cols = repo.page.mock.calls[0][3].columns;
    expect(cols).not.toContain('first_name');
    expect(cols).toContain('pms_external_id');
  });
  it('owner with pii=true gets PII columns', async () => {
    repo.page.mockResolvedValue([{ id: 'a', first_name: 'X' }]);
    const out = await dataRoomService.page(owner, 'dentally', 'patients', { ...WIN, pii: true });
    expect(out.rows[0].first_name).toBe('X');
    expect(repo.page.mock.calls[0][3].columns).toContain('first_name');
  });
  it('emits next_cursor from the last row when the page is full, null otherwise', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => ({ id: `id-${i}`, starts_at: `2026-08-0${i + 1}T09:00:00.000Z` }));
    repo.page.mockResolvedValue(rows);
    repo.count.mockResolvedValue(5);
    const full = await dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, limit: 2 });
    expect(decodeCursor(full.next_cursor)).toEqual({ d: '2026-08-02T09:00:00.000Z', id: 'id-1' });
    expect(full.total).toBe(5);
    repo.page.mockResolvedValue(rows.slice(0, 1));
    const last = await dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, limit: 2 });
    expect(last.next_cursor).toBeNull();
  });
  it('decodes an incoming cursor and hands it to the repository', async () => {
    const cursor = encodeCursor({ d: '2026-08-02T09:00:00.000Z', id: 'id-1' });
    await dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, cursor });
    expect(repo.page.mock.calls[0][3].after).toEqual({ d: '2026-08-02T09:00:00.000Z', id: 'id-1' });
  });
  it('scope=practice on a direct-column dataset passes practiceId', async () => {
    await dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, scope: PRACTICE });
    expect(repo.page.mock.calls[0][2]).toMatchObject({ practiceId: PRACTICE, practiceKeys: null });
  });
  it('scope=practice on a via dataset resolves keys, and short-circuits to zero rows on none', async () => {
    repo.viaKeys.mockResolvedValue(['123']);
    await dataRoomService.page(owner, 'google-ads', 'campaign_daily', { ...WIN, scope: PRACTICE });
    expect(repo.viaKeys).toHaveBeenCalledWith(ORG, expect.objectContaining({ table: 'ad_accounts' }), PRACTICE);
    expect(repo.page.mock.calls[0][2]).toMatchObject({ practiceId: null, practiceKeys: ['123'] });

    repo.page.mockClear(); repo.count.mockClear();
    repo.viaKeys.mockResolvedValue([]);
    const out = await dataRoomService.page(owner, 'google-ads', 'campaign_daily', { ...WIN, scope: PRACTICE });
    expect(out).toEqual({ rows: [], next_cursor: null, total: 0 });
    expect(repo.page).not.toHaveBeenCalled();
    expect(repo.count).not.toHaveBeenCalled();
  });
  it('the derived pipelines dataset pages in memory by offset', async () => {
    repo.pipelineRows.mockResolvedValue([
      { integration_account_id: 'a', practice_id: null, pipeline_id: 'p1', pipeline_name: 'Implants', stage_id: 's1', stage_name: 'New' },
      { integration_account_id: 'a', practice_id: null, pipeline_id: 'p1', pipeline_name: 'Implants', stage_id: 's2', stage_name: 'Booked' },
      { integration_account_id: 'a', practice_id: null, pipeline_id: 'p2', pipeline_name: 'Ortho', stage_id: null, stage_name: null },
    ]);
    const p1 = await dataRoomService.page(owner, 'gohighlevel', 'pipelines', { ...WIN, limit: 2 });
    expect(p1.rows).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(decodeCursor(p1.next_cursor)).toEqual({ d: null, id: 2 });
    const p2 = await dataRoomService.page(owner, 'gohighlevel', 'pipelines', { ...WIN, limit: 2, cursor: p1.next_cursor });
    expect(p2.rows.map((r) => r.pipeline_id)).toEqual(['p2']);
    expect(p2.next_cursor).toBeNull();
    expect(repo.page).not.toHaveBeenCalled();
  });
  it('every repository call is bound to the caller organisation (cross-org isolation)', async () => {
    const other = { id: 'u2', organisation_id: '33333333-3333-4333-8333-333333333333', role: 'owner' };
    await dataRoomService.page(other, 'dentally', 'appointments', WIN);
    expect(repo.page.mock.calls[0][0]).toBe(other.organisation_id);
    expect(repo.count.mock.calls[0][0]).toBe(other.organisation_id);
  });
});

describe('streamCsv()', () => {
  function sink() {
    const chunks = [];
    return { chunks, write: (c) => chunks.push(c), end: vi.fn(), text: () => chunks.join('') };
  }
  const meta = { ip: '1.2.3.4', userAgent: 'vitest', isAborted: () => false };

  it('writes BOM, header, every batch, ends, and audits the row count', async () => {
    repo.page
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, starts_at: '2026-08-01T00:00:00.000Z', status: 'completed' })))
      .mockResolvedValueOnce([{ id: 'last', starts_at: '2026-08-02T00:00:00.000Z', status: 'cancelled' }]);
    const s = sink();
    const out = await dataRoomService.streamCsv(analyst, 'dentally', 'appointments', WIN, s, meta);
    expect(out.rows).toBe(1001);
    const text = s.text();
    expect(text.startsWith('﻿id,practice_id,contact_id,associate_id,pms_external_id,pms_patient_id,pms_practitioner_id,starts_at,ends_at,status,appointment_type\r\n')).toBe(true);
    expect(text.split('\r\n').length).toBe(1003); // header + 1001 rows + trailing ''
    expect(s.end).toHaveBeenCalledOnce();
    expect(repo.page).toHaveBeenCalledTimes(2);
    expect(repo.page.mock.calls[1][3].after).toEqual({ d: '2026-08-01T00:00:00.000Z', id: 'id-999' });
    expect(repo.page.mock.calls[0][3].limit).toBe(1000);
    expect(repo.logExport).toHaveBeenCalledWith(ORG, 'u-analyst',
      { source: 'dentally', dataset: 'appointments', scope: 'all', since: WIN.since, until: WIN.until, pii: false, rows: 1001 },
      { ip: '1.2.3.4', userAgent: 'vitest' });
  });

  it('omits PII columns from the header and rows for a non-owner', async () => {
    repo.page.mockResolvedValueOnce([{ id: 'a', pms_external_id: '9' }]);
    const s = sink();
    await dataRoomService.streamCsv(analyst, 'dentally', 'patients', WIN, s, meta);
    expect(s.text()).not.toMatch(/first_name|email/);
  });

  it('stops when the client disconnects and audits aborted=true', async () => {
    repo.page.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, starts_at: '2026-08-01T00:00:00.000Z' })));
    let calls = 0;
    const s = sink();
    await dataRoomService.streamCsv(owner, 'dentally', 'appointments', WIN, s, { ...meta, isAborted: () => ++calls > 1 });
    expect(repo.page).toHaveBeenCalledTimes(1);
    expect(repo.logExport.mock.calls[0][2]).toMatchObject({ rows: 1000, aborted: true });
  });

  it('audits aborted=true and rethrows when a batch fails mid-stream', async () => {
    repo.page.mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, starts_at: '2026-08-01T00:00:00.000Z' })))
      .mockRejectedValueOnce(new Error('db down'));
    const s = sink();
    await expect(dataRoomService.streamCsv(owner, 'dentally', 'appointments', WIN, s, meta)).rejects.toThrow('db down');
    expect(repo.logExport.mock.calls[0][2]).toMatchObject({ rows: 1000, aborted: true });
  });

  it('403s a non-owner PII request before writing anything', async () => {
    const s = sink();
    await expect(dataRoomService.streamCsv(analyst, 'dentally', 'patients', { ...WIN, pii: true }, s, meta)).rejects.toBeInstanceOf(AppError);
    expect(s.chunks).toEqual([]);
  });

  it('400s (not 500) when an event dataset export has no window, before writing anything', async () => {
    const s = sink();
    await expect(dataRoomService.streamCsv(owner, 'dentally', 'appointments', { ...WIN, since: undefined, until: undefined }, s, meta))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(s.chunks).toEqual([]);
    expect(repo.logExport).not.toHaveBeenCalled();
  });
});

describe('exportFilename()', () => {
  it('event: <source>-<dataset>_<since>_<until>.csv using London dates', () => {
    // WIN's bounds are UTC midnight; the last INCLUDED London day of a UTC-midnight
    // `until` (2026-08-31T23:59:59.999Z = 00:59 BST on 1 Sep) would be 2026-09-01.
    // Production callers always send London-local windows, so this fixture uses
    // London-local bounds instead of WIN's UTC ones.
    const WIN_LONDON = { ...WIN, since: '2026-08-01T00:00:00.000+01:00', until: '2026-09-01T00:00:00.000+01:00' };
    const { getDataset } = { getDataset: (s, k) => ({ source: s, key: k, dateCol: 'starts_at' }) };
    expect(dataRoomService.exportFilename(getDataset('dentally', 'appointments'), WIN_LONDON))
      .toBe('dentally-appointments_2026-08-01_2026-08-31.csv');
  });
  it('roster: <source>-<dataset>_<today>.csv', () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    expect(dataRoomService.exportFilename({ source: 'dentally', key: 'staff', dateCol: null }, WIN)).toBe(`dentally-staff_${today}.csv`);
  });
});

describe('page() — numbered pages (offset mode)', () => {
  const PIPES = [
    { integration_account_id: 'a', practice_id: null, pipeline_id: 'p1', pipeline_name: 'Implants', stage_id: 's1', stage_name: 'New' },
    { integration_account_id: 'a', practice_id: null, pipeline_id: 'p1', pipeline_name: 'Implants', stage_id: 's2', stage_name: 'Booked' },
    { integration_account_id: 'a', practice_id: null, pipeline_id: 'p2', pipeline_name: 'Ortho', stage_id: null, stage_name: null },
  ];
  it('page=N hands offset=(N-1)*limit to the repository and no cursor', async () => {
    await dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, page: 3, limit: 50 });
    expect(repo.page.mock.calls[0][3]).toMatchObject({ offset: 100, limit: 50, after: null });
  });
  it('page=1 is offset 0 and still reports the exact total', async () => {
    repo.page.mockResolvedValue([{ id: 'a', starts_at: '2026-08-01T09:00:00.000Z' }]);
    repo.count.mockResolvedValue(7);
    const out = await dataRoomService.page(owner, 'dentally', 'appointments', { ...WIN, page: 1, limit: 50 });
    expect(repo.page.mock.calls[0][3].offset).toBe(0);
    expect(out.total).toBe(7);
    expect(out.rows).toEqual([{ id: 'a', starts_at: '2026-08-01T09:00:00.000Z' }]);
  });
  it('without page the keyset path is unchanged (no offset passed)', async () => {
    await dataRoomService.page(owner, 'dentally', 'appointments', WIN);
    expect(repo.page.mock.calls[0][3].offset).toBeUndefined();
  });
  it('the derived pipelines dataset pages by page number too, and a page past the end is empty', async () => {
    repo.pipelineRows.mockResolvedValue(PIPES);
    const p2 = await dataRoomService.page(owner, 'gohighlevel', 'pipelines', { ...WIN, limit: 2, page: 2 });
    expect(p2.rows.map((r) => r.pipeline_id)).toEqual(['p2']);
    expect(p2.total).toBe(3);
    const p9 = await dataRoomService.page(owner, 'gohighlevel', 'pipelines', { ...WIN, limit: 2, page: 9 });
    expect(p9).toEqual({ rows: [], next_cursor: null, total: 3 });
    expect(repo.page).not.toHaveBeenCalled();
  });
  it('patients is a dated dataset: the window applies (created_at) and is required', async () => {
    await dataRoomService.page(owner, 'dentally', 'patients', WIN);
    expect(repo.page.mock.calls[0][2]).toMatchObject({ since: WIN.since, until: WIN.until });
    await expect(dataRoomService.page(owner, 'dentally', 'patients', { ...WIN, since: undefined, until: undefined }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

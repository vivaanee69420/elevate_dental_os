import './setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCashups, fetchMonthlyPl, monthWindows, yearWindows, fetchAllCashups, fetchAllMonthlyPl } = await import('../src/lib/integrations/emergent-sync.js');

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('emergent pull endpoints', () => {
  it('fetchCashups calls /api/public/daily-cashups with the window and returns sheets[]', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ count: 1, sheets: [{ business_id: 'b', date: '2026-08-20' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchCashups('https://api.test/', 'key123', '2026-08-01', '2026-08-31');
    expect(rows).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/api/public/daily-cashups');
    expect(url).toContain('start_date=2026-08-01');
    expect(url).toContain('end_date=2026-08-31');
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('key123');
  });
  it('fetchMonthlyPl calls /api/public/monthly-pl and returns months[]', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ count: 1, months: [{ business_id: 'b', date: '2026-08-01' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchMonthlyPl('https://api.test/', 'key123', '2026-06-01', '2026-08-01');
    expect(rows).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/public/monthly-pl');
    expect(fetchMock.mock.calls[0][0]).toContain('start_month=2026-06-01');
  });
  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' })));
    await expect(fetchCashups('https://api.test/', 'k', '2026-08-01', '2026-08-31')).rejects.toThrow(/401/);
  });
});

describe('emergent windowed backfill (pagination — no 1000-row truncation)', () => {
  it('monthWindows splits a range into calendar-month windows clamped to bounds', () => {
    expect(monthWindows('2026-06-10', '2026-08-05')).toEqual([
      ['2026-06-10', '2026-06-30'],
      ['2026-07-01', '2026-07-31'],
      ['2026-08-01', '2026-08-05'],
    ]);
  });
  it('monthWindows handles a single-month range', () => {
    expect(monthWindows('2026-08-01', '2026-08-20')).toEqual([['2026-08-01', '2026-08-20']]);
  });
  it('monthWindows uses the correct last day (Feb non-leap)', () => {
    expect(monthWindows('2025-02-01', '2025-02-28')).toEqual([['2025-02-01', '2025-02-28']]);
  });
  it('yearWindows splits by calendar year clamped to bounds', () => {
    expect(yearWindows('2025-06-01', '2026-03-01')).toEqual([
      ['2025-06-01', '2025-12-01'],
      ['2026-01-01', '2026-03-01'],
    ]);
  });
  it('fetchAllCashups pages each month window and concatenates', async () => {
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => ({ count: 1, sheets: [{ business_id: 'b', date: url.match(/start_date=([0-9-]+)/)[1] }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchAllCashups('https://api.test/', 'k', '2026-06-10', '2026-08-05');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(3);
  });
  it('fetchAllMonthlyPl pages each year window and concatenates', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ count: 1, months: [{ business_id: 'b' }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchAllMonthlyPl('https://api.test/', 'k', '2025-06-01', '2026-03-01');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });
});

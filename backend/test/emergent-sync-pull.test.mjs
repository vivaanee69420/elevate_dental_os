import './setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCashups, fetchMonthlyPl } = await import('../src/lib/integrations/emergent-sync.js');

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

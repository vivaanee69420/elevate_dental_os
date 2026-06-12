import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

const { ghlDashboardService } = await import('../src/services/ghl-dashboard.service.js');
const { integrationController } = await import('../src/controllers/integration.controller.js');

function mockRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

beforeEach(() => vi.restoreAllMocks());

describe('ghlDashboard controller', () => {
  it('passes org + parsed query to the service and returns its result', async () => {
    const spy = vi.spyOn(ghlDashboardService, 'getDashboard').mockResolvedValue({ totals: {}, perAccount: [] });
    const req = {
      user: { organisation_id: 'org-1' },
      query: { since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z', accountId: '11111111-1111-1111-1111-111111111111' },
    };
    const res = mockRes();
    await integrationController.ghlDashboard(req, res);
    expect(spy).toHaveBeenCalledWith('org-1', expect.objectContaining({
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      accountId: '11111111-1111-1111-1111-111111111111',
    }));
    expect(res.body).toEqual({ totals: {}, perAccount: [] });
  });

  it('defaults to a 30-day window when since/until are omitted', async () => {
    const spy = vi.spyOn(ghlDashboardService, 'getDashboard').mockResolvedValue({ totals: {}, perAccount: [] });
    const req = { user: { organisation_id: 'org-1' }, query: {} };
    await integrationController.ghlDashboard(req, mockRes());
    const arg = spy.mock.calls[0][1];
    expect(typeof arg.since).toBe('string');
    expect(typeof arg.until).toBe('string');
    expect(new Date(arg.until) > new Date(arg.since)).toBe(true);
  });
});

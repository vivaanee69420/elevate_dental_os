import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dailyReportController, _resetSendLimiter } from '../src/controllers/daily-report.controller.js';

const ORG = 'org-aaaa';

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (body = {}) => ({ user: { id: 'u1', organisation_id: ORG }, body });

beforeEach(() => { _resetSendLimiter(); });

describe('saveSettings', () => {
  it('rejects a non-https webhook url', async () => {
    const r = res();
    await dailyReportController.saveSettings(req({ webhookUrl: 'http://a.test/h', enabled: true }), r);
    expect(r.statusCode).toBe(400);
  });

  it('rejects a value that is not a url at all', async () => {
    const r = res();
    await dailyReportController.saveSettings(req({ webhookUrl: 'paste-here', enabled: true }), r);
    expect(r.statusCode).toBe(400);
  });
});

describe('send rate limit', () => {
  it('blocks manual sends beyond the hourly allowance', async () => {
    const deps = { send: vi.fn().mockResolvedValue({ sent: true, status: 'ok' }) };
    let last;
    for (let i = 0; i < 7; i++) {
      last = res();
      await dailyReportController.send(req(), last, deps);
    }
    expect(last.statusCode).toBe(429);
    expect(deps.send).toHaveBeenCalledTimes(6);
  });
});

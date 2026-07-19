import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { dailyReportController, _resetSendLimiter } from '../src/controllers/daily-report.controller.js';
import { dailyReportService } from '../src/services/daily-report.service.js';

const ORG = 'org-aaaa';
const RAW_URL = 'https://services.leadconnectorhq.com/hooks/super-secret-path';

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (body = {}) => ({ user: { id: 'u1', organisation_id: ORG }, body });

beforeEach(() => {
  _resetSendLimiter();
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: null, error: null });
});

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

describe('getSettings', () => {
  it('never leaks the raw webhook url and returns the masked shape', async () => {
    supaRec.resultProvider = () => ({
      data: {
        organisation_id: ORG,
        webhook_url: encryptSecret(RAW_URL),
        enabled: true,
        last_sent_at: '2026-07-21T17:00:00.000Z',
        last_status: 'ok',
        last_error: null,
      },
      error: null,
    });

    const r = res();
    await dailyReportController.getSettings(req(), r);

    expect(r.statusCode).toBe(200);
    expect(r.body.settings.webhookUrlMasked).toBeTruthy();
    expect(r.body.settings.configured).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(RAW_URL);
    expect(JSON.stringify(r.body)).not.toContain('super-secret-path');
  });

  it('returns { settings: null } when no row exists', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });

    const r = res();
    await dailyReportController.getSettings(req(), r);

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ settings: null });
  });
});

describe('saveSettings happy path', () => {
  it('accepts a valid https url, returns 200 with masked settings, never leaks the raw url', async () => {
    supaRec.resultProvider = () => ({
      data: {
        organisation_id: ORG,
        webhook_url: encryptSecret(RAW_URL),
        enabled: true,
        last_sent_at: null,
        last_status: null,
        last_error: null,
      },
      error: null,
    });

    const r = res();
    await dailyReportController.saveSettings(req({ webhookUrl: RAW_URL, enabled: true }), r);

    expect(r.statusCode).toBe(200);
    expect(r.body.settings.webhookUrlMasked).toBeTruthy();
    expect(r.body.settings.configured).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(RAW_URL);
    expect(JSON.stringify(r.body)).not.toContain('super-secret-path');
  });
});

describe('preview', () => {
  it('returns 503 with a clear message when buildPayload fails, instead of throwing', async () => {
    const spy = vi.spyOn(dailyReportService, 'buildPayload').mockRejectedValue(new Error('ad attribution unreachable'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = res();
    await dailyReportController.preview(req(), r);

    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBeTruthy();
    expect(r.body.error).not.toContain('ad attribution unreachable');

    spy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('send', () => {
  // The handler MUST be invoked the way Express invokes it: (req, res, next).
  // These tests previously passed a fake service as the third argument, which
  // exercised a code path production never takes — at runtime the third
  // argument is always Express's `next`. The service is stubbed by spying on
  // the module, the same way the `preview` test above does it.
  const next = () => vi.fn();

  it('sends via the real service module when called with Express\'s (req, res, next)', async () => {
    const spy = vi.spyOn(dailyReportService, 'send').mockResolvedValue({ sent: true, status: 'ok' });

    const r = res();
    await dailyReportController.send(req(), r, next());

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ sent: true, status: 'ok' });
    expect(spy).toHaveBeenCalledWith(ORG, { trigger: 'manual' });

    spy.mockRestore();
  });

  it('blocks manual sends beyond the hourly allowance', async () => {
    const spy = vi.spyOn(dailyReportService, 'send').mockResolvedValue({ sent: true, status: 'ok' });

    let last;
    for (let i = 0; i < 7; i++) {
      last = res();
      await dailyReportController.send(req(), last, next());
    }
    expect(last.statusCode).toBe(429);
    expect(spy).toHaveBeenCalledTimes(6);

    spy.mockRestore();
  });
});

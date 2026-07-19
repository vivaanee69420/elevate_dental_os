import { describe, it, expect, vi } from 'vitest';
import { postToInboundWebhook } from '../src/lib/integrations/ghl-webhook.js';

const URL = 'https://services.leadconnectorhq.com/hooks/abc';
const PAYLOAD = { report_line: 'Daily 21 Jul | Leads 24' };

describe('postToInboundWebhook', () => {
  it('posts json and reports success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl });

    expect(res).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });

  it('retries on a server error then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and returns the failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toContain('boom');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry a 4xx, which will not fix itself', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never throws when the network fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('ECONNRESET');
  });
});

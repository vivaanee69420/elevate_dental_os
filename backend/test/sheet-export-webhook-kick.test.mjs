// ============================================================================
// Dentally webhook -> sheet-export drain kick. A new/relinked appointment or
// patient may complete a first-appointment condition, so the dentally webhook
// handler fires the (mocked, debounced, fire-and-forget) sheet-export drain.
// Never awaited: this must not slow the webhook response path.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { supaRec } from './setup.js';

const kickDrain = vi.fn();
vi.mock('../src/services/sheet-export.service.js', () => ({
  sheetExportService: { kickDrain },
}));

const { signWebhookToken } = await import('../src/lib/webhook-token.js');
const { webhookService } = await import('../src/services/webhook.service.js');

const ORG = 'org-aaaaaaaa';
const SECRET = 'topsecret-key';
const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

beforeEach(() => {
  kickDrain.mockClear();
  supaRec.last = undefined;
  supaRec.resultProvider = (q) => {
    if (q.table === 'integrations')
      return { data: { status: 'active', config: { webhook_secret: SECRET } }, error: null };
    if (q.table === 'practices')
      return { data: [{ id: 'p1', pms_site_id: '5' }], error: null };
    return { data: [], error: null };
  };
});

const fire = (bodyObj) => {
  const token = signWebhookToken(ORG);
  const raw = Buffer.from(JSON.stringify(bodyObj));
  return webhookService.dentally(token, raw, sign(raw));
};

describe('webhookService.dentally — sheet-export drain kick', () => {
  it('kicks the drain for the org on a valid appointment event', async () => {
    const r = await fire({ event: 'appointment.created', data: { id: 1, site_id: 5, patient_id: 7, start_time: 't' } });
    expect(r).toMatchObject({ received: true, resourceType: 'appointment' });
    expect(kickDrain).toHaveBeenCalledTimes(1);
    expect(kickDrain).toHaveBeenCalledWith(ORG);
  });

  it('kicks the drain for the org on a valid patient event', async () => {
    const r = await fire({ event: 'patient.created', data: { id: 7, site_id: 5, first_name: 'A' } });
    expect(r).toMatchObject({ received: true, resourceType: 'patient' });
    expect(kickDrain).toHaveBeenCalledTimes(1);
    expect(kickDrain).toHaveBeenCalledWith(ORG);
  });

  it('does NOT kick the drain for a payment event', async () => {
    const raw = Buffer.from(JSON.stringify({ topic: 'payment.created', data: { id: 9, site_id: 5, amount: 12.5, patient_id: 7 } }));
    const token = signWebhookToken(ORG);
    const r = await webhookService.dentally(token, raw, sign(raw));
    expect(r).toMatchObject({ received: true, resourceType: 'payment' });
    expect(kickDrain).not.toHaveBeenCalled();
  });

  it('resolves even when the mocked drain path would hang (kick is sync fire-and-forget)', async () => {
    // kickDrain itself is a fire-and-forget void call from the handler's POV —
    // simulate a slow/hanging drain by having the mock never resolve anything
    // it returns, and assert the handler still resolves promptly.
    kickDrain.mockImplementation(() => new Promise(() => {})); // never resolves
    const r = await fire({ event: 'appointment.created', data: { id: 1, site_id: 5, patient_id: 7, start_time: 't' } });
    expect(r).toMatchObject({ received: true, resourceType: 'appointment' });
  });
});

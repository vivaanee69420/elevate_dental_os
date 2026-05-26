// ============================================================================
// Dentally real-time webhook — org token signing, single-record apply (shared
// row builders), and the service-layer HMAC signature gate.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { supaRec } from './setup.js';

const { signWebhookToken, verifyWebhookToken } = await import('../src/lib/webhook-token.js');
const { applyWebhookEvent, appointmentRow, patientRow } =
  await import('../src/lib/integrations/dentally-sync.js');
const { webhookService } = await import('../src/services/webhook.service.js');
const { integrationService } = await import('../src/services/integration.service.js');

const ORG = 'org-aaaaaaaa';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('webhook-token — stable signed org token', () => {
  it('round-trips orgId', () => {
    expect(verifyWebhookToken(signWebhookToken(ORG))).toBe(ORG);
  });
  it('rejects a tampered token', () => {
    const t = signWebhookToken(ORG);
    expect(() => verifyWebhookToken(t.slice(0, -2) + 'xy')).toThrow();
    expect(() => verifyWebhookToken('garbage')).toThrow();
  });
});

describe('integrationService.webhookInfo — config-error handling', () => {
  it('throws a clear 501 (not an opaque 500) when OAUTH_STATE_SECRET is unset', async () => {
    const saved = process.env.OAUTH_STATE_SECRET;
    delete process.env.OAUTH_STATE_SECRET;
    try {
      await expect(integrationService.webhookInfo(ORG, 'dentally'))
        .rejects.toMatchObject({ statusCode: 501 });
    } finally {
      process.env.OAUTH_STATE_SECRET = saved;
    }
  });

  it('rejects a provider that does not support webhooks (400)', async () => {
    await expect(integrationService.webhookInfo(ORG, 'xero'))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('row builders — shared by poll + webhook', () => {
  it('appointmentRow returns null when site_id maps to no practice (NOT NULL guard)', () => {
    const siteMap = new Map(); // no mapping
    expect(appointmentRow(ORG, { id: 1, site_id: 99 }, siteMap, new Map())).toBeNull();
  });
  it('appointmentRow persists pms_patient_id (and null for patient-less diary blocks)', () => {
    const siteMap = new Map([['5', 'p1']]);
    const withPatient = appointmentRow(ORG, { id: 1, practitioner_site_id: 5, patient_id: 7, start_time: 't' }, siteMap, new Map());
    expect(withPatient.pms_patient_id).toBe('7');
    const block = appointmentRow(ORG, { id: 2, practitioner_site_id: 5, start_time: 't' }, siteMap, new Map());
    expect(block.pms_patient_id).toBeNull();
  });

  it('patientRow maps regardless of practice mapping', () => {
    const row = patientRow(ORG, { id: 7, first_name: 'A', site_id: 5 }, new Map());
    expect(row).toMatchObject({ source: 'dentally', pms_external_id: '7', practice_id: null });
  });
});

describe('applyWebhookEvent — single record upsert', () => {
  it('patient → contacts upsert', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices'
        ? { data: [{ id: 'p1', pms_site_id: '5' }], error: null }
        : { data: [], error: null };
    const r = await applyWebhookEvent(ORG, 'patient', { id: 7, site_id: 5, first_name: 'A' });
    expect(r).toEqual({ table: 'contacts', applied: 1 });
  });

  it('appointment with unmapped practice is skipped', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null }); // empty siteMap
    const r = await applyWebhookEvent(ORG, 'appointment', { id: 1, site_id: 99, patient_id: 7 });
    expect(r).toEqual({ skipped: 'unmatched_practice' });
  });

  it('ignores a record with no id', async () => {
    expect(await applyWebhookEvent(ORG, 'patient', {})).toEqual({ ignored: 'no_record_id' });
  });
});

describe('webhookService.dentally — token + HMAC gate', () => {
  const SECRET = 'topsecret-key';
  const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  // integration row carries the verifying secret; other tables resolve sync.
  const provider = (siteMapped = true) => (q) => {
    if (q.table === 'integrations')
      return { data: { status: 'active', config: { webhook_secret: SECRET } }, error: null };
    if (q.table === 'practices')
      return { data: siteMapped ? [{ id: 'p1', pms_site_id: '5' }] : [], error: null };
    return { data: [], error: null };
  };

  it('rejects an invalid org token (401)', async () => {
    await expect(webhookService.dentally('bad.token', Buffer.from('{}'), 'x'))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a bad signature (401)', async () => {
    supaRec.resultProvider = provider();
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify({ event: 'patient.created', data: { id: 7, site_id: 5 } }));
    await expect(webhookService.dentally(token, raw, 'deadbeef'))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('401 when no secret configured', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'integrations'
        ? { data: { status: 'active', config: {} }, error: null }
        : { data: [], error: null };
    const token = signWebhookToken(ORG);
    const raw = Buffer.from('{}');
    await expect(webhookService.dentally(token, raw, sign(raw)))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('accepts a valid signature and applies the event', async () => {
    supaRec.resultProvider = provider();
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify({ event: 'patient.created', data: { id: 7, site_id: 5, first_name: 'A' } }));
    const r = await webhookService.dentally(token, raw, sign(raw));
    expect(r).toMatchObject({ received: true, resourceType: 'patient', count: 1 });
  });

  it('accepts the sha256= prefixed signature form', async () => {
    supaRec.resultProvider = provider();
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify({ topic: 'payment.created', data: { id: 9, site_id: 5, amount: 12.5, patient_id: 7 } }));
    const r = await webhookService.dentally(token, raw, `sha256=${sign(raw)}`);
    expect(r).toMatchObject({ received: true, resourceType: 'payment' });
  });

  it('ignores an unrecognised event type', async () => {
    supaRec.resultProvider = provider();
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify({ event: 'note.created', data: { id: 1 } }));
    const r = await webhookService.dentally(token, raw, sign(raw));
    expect(r).toEqual({ received: true, ignored: true });
  });
});

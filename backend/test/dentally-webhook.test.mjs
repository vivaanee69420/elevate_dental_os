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

  it('patient webhook scopes relink to its OWN orphan appointments (no full-table relink)', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'practices') return { data: [{ id: 'p1', pms_site_id: '5' }], error: null };
      if (q.table === 'contacts' && q.op === 'select') return { data: { id: 'c1' }, error: null };
      return { data: [], error: null };
    };
    const r = await applyWebhookEvent(ORG, 'patient', { id: 7, site_id: 5, first_name: 'A' });
    expect(r).toEqual({ table: 'contacts', applied: 1 });
    // Last DB op is a scoped UPDATE on appointments — keyed to this patient,
    // guarded to orphan rows only. No RPC, no full-table relink.
    expect(supaRec.last).toMatchObject({ table: 'appointments', op: 'update', updateVals: { contact_id: 'c1' } });
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'pms_patient_id', val: '7' }]));
    expect(supaRec.last.iss).toEqual([{ col: 'contact_id', val: null }]);
  });

  it('patient webhook with no orphan contact resolved does not UPDATE appointments', async () => {
    // contacts select returns nothing -> early return, last op stays the upsert.
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', pms_site_id: '5' }], error: null } : { data: [], error: null };
    await applyWebhookEvent(ORG, 'patient', { id: 7, site_id: 5, first_name: 'A' });
    expect(supaRec.last).not.toMatchObject({ table: 'appointments', op: 'update' });
  });

  it('appointment with unmapped practice is skipped', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null }); // empty siteMap
    const r = await applyWebhookEvent(ORG, 'appointment', { id: 1, site_id: 99, patient_id: 7 });
    expect(r).toEqual({ skipped: 'unmatched_practice' });
  });

  it('ignores a record with no id', async () => {
    expect(await applyWebhookEvent(ORG, 'patient', {})).toEqual({ ignored: 'no_record_id' });
  });

  it('invoice → invoices upsert AND persists embedded line items', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices'
        ? { data: [{ id: 'p1', pms_site_id: '5' }], error: null }
        : { data: [], error: null };
    const r = await applyWebhookEvent(ORG, 'invoice', {
      id: 100, site_id: 5, patient_id: 7, dated_on: '2026-01-01', paid: true,
      invoice_items: [{ id: 201, name: 'Crown', item_price: '500.00', total_price: '500.00', quantity: 1 }],
    });
    expect(r).toMatchObject({ table: 'invoices', applied: 1, invoice_items: 1 });
  });

  it('standalone invoice_item resolves parent context from the invoices table', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'invoices'
        ? { data: [{ external_id: '100', practice_id: 'p1', contact_id: 'c1', dated_on: '2026-01-01', paid: true }], error: null }
        : { data: [], error: null };
    const r = await applyWebhookEvent(ORG, 'invoice_item', {
      id: 201, invoice_id: 100, name: 'Crown', item_price: '500.00', total_price: '500.00', quantity: 1,
    });
    expect(r).toEqual({ table: 'invoice_items', applied: 1 });
  });

  it('treatment_plan → treatment_plans upsert (associate production)', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    const r = await applyWebhookEvent(ORG, 'treatment_plan', {
      id: 301, practitioner_id: 11, patient_id: 7, private_treatment_value: '1200.00', completed: true,
    });
    expect(r).toEqual({ table: 'treatment_plans', applied: 1 });
  });
});

describe('parseDentallyEvent — resource classification (via webhookService)', () => {
  const SECRET = 'topsecret-key';
  const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  beforeEach(() => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'integrations')
        return { data: { status: 'active', config: { webhook_secret: SECRET } }, error: null };
      if (q.table === 'practices')
        return { data: [{ id: 'p1', pms_site_id: '5' }], error: null };
      return { data: [], error: null };
    };
  });
  const fire = async (event, data) => {
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify({ event, data }));
    return webhookService.dentally(token, raw, sign(raw));
  };

  it('classifies invoice_item BEFORE invoice (substring trap)', async () => {
    const r = await fire('invoice_item.created', { id: 201, invoice_id: 100 });
    expect(r).toMatchObject({ resourceType: 'invoice_item' });
  });
  it('classifies a plain invoice event', async () => {
    const r = await fire('invoice.updated', { id: 100, site_id: 5 });
    expect(r).toMatchObject({ resourceType: 'invoice' });
  });
  it('classifies treatment_plan (not eaten by payment/patient)', async () => {
    const r = await fire('treatment_plan.completed', { id: 301, practitioner_id: 11 });
    expect(r).toMatchObject({ resourceType: 'treatment_plan' });
  });

  // --- payload-shape tolerance: Dentally's exact envelope is not contractually
  //     fixed, so the receiver must still create records whether the resource is
  //     under `data`, under its singular key, or the body IS the resource. -----
  const fireRaw = async (bodyObj) => {
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify(bodyObj));
    return webhookService.dentally(token, raw, sign(raw));
  };

  it('creates a record when the resource is nested under its singular key (no data wrapper)', async () => {
    const r = await fireRaw({ event: 'appointment.created', appointment: { id: 1, site_id: 5, patient_id: 7, start_time: 't' } });
    expect(r).toMatchObject({ resourceType: 'appointment', count: 1 });
    expect(r.results[0]).toMatchObject({ table: 'appointments', applied: 1 });
  });

  it('infers the resource type from the body when there is no event string', async () => {
    const r = await fireRaw({ patient: { id: 7, site_id: 5, first_name: 'A' } });
    expect(r).toMatchObject({ resourceType: 'patient', count: 1 });
  });
});

describe('applyWebhookEvent — delete events remove rows (no resurrection)', () => {
  it('appointment.deleted deletes the row instead of upserting it', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    const r = await applyWebhookEvent(ORG, 'appointment', { id: 1 }, 'delete');
    expect(r).toEqual({ table: 'appointments', deleted: 1 });
    expect(supaRec.last).toMatchObject({ table: 'appointments', op: 'delete' });
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([
      { col: 'source', val: 'dentally' },
      { col: 'pms_external_id', val: '1' },
    ]));
  });

  it('payment.deleted keys on external_id', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    const r = await applyWebhookEvent(ORG, 'payment', { id: 9 }, 'delete');
    expect(r).toEqual({ table: 'payments', deleted: 1 });
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'external_id', val: '9' }]));
  });
});

describe('webhookService.dentally — resilient processing (never 5xx a live delivery)', () => {
  // Dentally auto-disables a webhook after sustained failed deliveries, so a
  // single unstorable record or a transient DB blip must NOT 5xx the batch —
  // it is logged + skipped and the nightly poll reconciles. Auth/signature
  // failures (tested below) stay hard 401s; only POST-verification processing
  // is made fault-tolerant.
  const SECRET = 'topsecret-key';
  const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const fire = (bodyObj) => {
    const token = signWebhookToken(ORG);
    const raw = Buffer.from(JSON.stringify(bodyObj));
    return webhookService.dentally(token, raw, sign(raw));
  };

  it('a record whose apply throws (transient DB error on delete) is skipped, not a 5xx', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'integrations')
        return { data: { status: 'active', config: { webhook_secret: SECRET } }, error: null };
      if (q.table === 'appointments' && q.op === 'delete')
        return { data: null, error: { message: 'connection reset by peer' } };
      return { data: [], error: null };
    };
    const r = await fire({ event: 'appointment.deleted', data: { id: 1 } });
    expect(r).toMatchObject({ received: true, resourceType: 'appointment', action: 'delete', count: 1 });
    expect(r.results[0]).toMatchObject({ error: true, recordId: 1 });
  });

  it('one bad record does not block sibling records in the same delivery', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'integrations')
        return { data: { status: 'active', config: { webhook_secret: SECRET } }, error: null };
      // Fail only the delete keyed to id '1'; id '2' deletes cleanly.
      if (q.table === 'appointments' && q.op === 'delete'
          && q.eqs.some((e) => e.col === 'pms_external_id' && e.val === '1'))
        return { data: null, error: { message: 'deadlock detected' } };
      return { data: [], error: null };
    };
    const r = await fire({ event: 'appointment.deleted', data: [{ id: 1 }, { id: 2 }] });
    expect(r.count).toBe(2);
    expect(r.results[0]).toMatchObject({ error: true, recordId: 1 });
    expect(r.results[1]).toMatchObject({ table: 'appointments', deleted: 1 });
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

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { whatsappReportRepository } from '../src/repositories/whatsapp-report.repository.js';

const ORG = 'org-aaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('get', () => {
  it('decrypts the webhook url and scopes to the organisation', async () => {
    supaRec.resultProvider = () => ({
      data: {
        organisation_id: ORG,
        webhook_url: encryptSecret('https://services.leadconnectorhq.com/hooks/abc'),
        enabled: true,
        last_sent_at: '2026-07-21T17:00:00.000Z',
        last_status: 'ok',
        last_error: null,
      },
      error: null,
    });

    const row = await whatsappReportRepository.get(ORG);

    expect(row.webhookUrl).toBe('https://services.leadconnectorhq.com/hooks/abc');
    expect(row.enabled).toBe(true);
    expect(row.lastStatus).toBe('ok');
    expect(orgFilter(supaRec.last).val).toBe(ORG);
  });

  it('returns null when no row exists', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    expect(await whatsappReportRepository.get(ORG)).toBeNull();
  });
});

describe('upsert', () => {
  it('encrypts the webhook url before writing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });

    await whatsappReportRepository.upsert(ORG, {
      webhookUrl: 'https://services.leadconnectorhq.com/hooks/abc',
      enabled: true,
    });

    const written = supaRec.last.upsertVals;
    expect(written.organisation_id).toBe(ORG);
    expect(written.enabled).toBe(true);
    expect(written.webhook_url).not.toContain('leadconnectorhq');
  });
});

describe('listEnabled', () => {
  it('returns only enabled rows with decrypted urls', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { organisation_id: ORG, webhook_url: encryptSecret('https://a.test/hook'), enabled: true, last_sent_at: null },
      ],
      error: null,
    });

    const rows = await whatsappReportRepository.listEnabled();

    expect(rows).toHaveLength(1);
    expect(rows[0].webhookUrl).toBe('https://a.test/hook');
    expect(supaRec.last.eqs.find((e) => e.col === 'enabled').val).toBe(true);
  });

  it('skips an undecryptable row and still returns the good ones', async () => {
    const ORG2 = 'org-bbbb';
    supaRec.resultProvider = () => ({
      data: [
        { organisation_id: ORG, webhook_url: 'not-valid-ciphertext', enabled: true, last_sent_at: null },
        { organisation_id: ORG2, webhook_url: encryptSecret('https://b.test/hook'), enabled: true, last_sent_at: null },
      ],
      error: null,
    });

    const rows = await whatsappReportRepository.listEnabled();

    expect(rows).toHaveLength(1);
    expect(rows[0].organisationId).toBe(ORG2);
    expect(rows[0].webhookUrl).toBe('https://b.test/hook');
  });
});

describe('markSent', () => {
  it('writes the expected columns scoped to the organisation', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });

    await whatsappReportRepository.markSent(ORG, {
      status: 'failed',
      error: 'timeout',
      payload: { foo: 'bar' },
      sentAt: '2026-07-21T17:00:00.000Z',
    });

    const written = supaRec.last.updateVals;
    expect(written.last_sent_at).toBe('2026-07-21T17:00:00.000Z');
    expect(written.last_status).toBe('failed');
    expect(written.last_error).toBe('timeout');
    expect(written.last_payload).toEqual({ foo: 'bar' });
    expect(orgFilter(supaRec.last).val).toBe(ORG);
  });
});

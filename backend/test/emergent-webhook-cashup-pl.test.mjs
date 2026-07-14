// backend/test/emergent-webhook-cashup-pl.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const taUpsert = vi.fn(async (row) => row);
const cashupUpsert = vi.fn(async (row) => row);
const plUpsert = vi.fn(async (row) => row);
const discover = vi.fn(async () => {});
const getByProvider = vi.fn();
const setSyncTime = vi.fn(async () => {});
const recordWebhookResult = vi.fn(async () => {});
const loadResolution = vi.fn(async () => ({ explicit: new Map(), fuzzy: new Map() }));

vi.mock('../src/repositories/treatment-accepted.repository.js', () => ({
  treatmentAcceptedRepository: { upsert: taUpsert, deleteByExternalId: vi.fn() },
}));
vi.mock('../src/repositories/emergent-daily-cashup.repository.js', () => ({
  emergentDailyCashupRepository: { upsert: cashupUpsert },
}));
vi.mock('../src/repositories/emergent-monthly-pl.repository.js', () => ({
  emergentMonthlyPlRepository: { upsert: plUpsert },
}));
vi.mock('../src/repositories/emergent-practice-map.repository.js', () => ({
  emergentPracticeMapRepository: { discover, resolutionMap: vi.fn(async () => new Map()) },
}));
vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { getByProvider, setSyncTime, recordWebhookResult },
}));
vi.mock('../src/lib/integrations/emergent-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadResolution };
});

const SECRET = 'whsec_test_123';
const ORG = '00000000-0000-0000-0000-000000000001';
const sign = (buf) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');

let token, webhookService;
beforeEach(async () => {
  vi.clearAllMocks();
  process.env.OAUTH_STATE_SECRET ||= 'test-oauth-state-secret';
  const { signWebhookToken } = await import('../src/lib/webhook-token.js');
  token = signWebhookToken(ORG);
  getByProvider.mockResolvedValue({ status: 'active', config: { webhook_secret: SECRET } });
  ({ webhookService } = await import('../src/services/webhook.service.js'));
});

const CASHUP = {
  business_id: 'biz1', business_name: 'Ashford', date: '2026-08-20',
  cash_up_money_taken: 1850.0, source_google: 3,
  patients: [{ patient_name: 'Sarah Wong', treatment_accepted: 'Invisalign', amount: 4500, source: 'Google' }],
};
const PL = {
  business_id: 'biz1', business_name: 'Ashford', date: '2026-08-01',
  revenue: 95000, net_profit: 21220.0,
};

it('daily_cashup.saved upserts the cash-up row + each patient into treatment_accepted', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'daily_cashup.saved', data: CASHUP }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'daily_cashup.saved');
  expect(res.received).toBe(true);
  expect(cashupUpsert).toHaveBeenCalledTimes(1);
  expect(cashupUpsert.mock.calls[0][0].organisation_id).toBe(ORG);
  expect(cashupUpsert.mock.calls[0][0].cash_up_money_taken_pence).toBe(185000);
  expect(taUpsert).toHaveBeenCalledTimes(1);
  expect(taUpsert.mock.calls[0][0].value_pence).toBe(450000);
});

it('monthly_pl.saved upserts the P&L row', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'monthly_pl.saved', data: PL }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'monthly_pl.saved');
  expect(res.received).toBe(true);
  expect(plUpsert).toHaveBeenCalledTimes(1);
  expect(plUpsert.mock.calls[0][0].revenue_pence).toBe(9500000);
  expect(plUpsert.mock.calls[0][0].organisation_id).toBe(ORG);
});

it('a bad signature rejects (401) and writes nothing', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'daily_cashup.saved', data: CASHUP }));
  await expect(webhookService.emergent(token, raw, 'sha256=deadbeef', 'daily_cashup.saved'))
    .rejects.toMatchObject({ statusCode: 401 });
  expect(cashupUpsert).not.toHaveBeenCalled();
});

it('acks (200, not 5xx) when the cash-up upsert throws', async () => {
  cashupUpsert.mockRejectedValueOnce(new Error('deadlock'));
  const raw = Buffer.from(JSON.stringify({ event: 'daily_cashup.saved', data: CASHUP }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'daily_cashup.saved');
  expect(res).toMatchObject({ received: true, error: true });
});

it('scopes to the token org even if the body smuggles another organisation_id', async () => {
  const raw = Buffer.from(JSON.stringify({
    event: 'monthly_pl.saved', data: { ...PL, organisation_id: 'attacker-org' },
  }));
  await webhookService.emergent(token, raw, sign(raw), 'monthly_pl.saved');
  expect(plUpsert.mock.calls[0][0].organisation_id).toBe(ORG);
});

// backend/test/emergent-webhook.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mock the data layer so the test is pure (no DB). We assert the service's
// control flow: signature gate, event routing, org isolation via the token.
const upsert = vi.fn(async (row) => row);
const deleteByExternalId = vi.fn(async () => 1);
const discover = vi.fn(async () => {});
const resolutionMap = vi.fn(async () => new Map());
const getByProvider = vi.fn();
const setSyncTime = vi.fn(async () => {});

vi.mock('../src/repositories/treatment-accepted.repository.js', () => ({
  treatmentAcceptedRepository: { upsert, deleteByExternalId },
}));
vi.mock('../src/repositories/emergent-practice-map.repository.js', () => ({
  emergentPracticeMapRepository: { discover, resolutionMap },
}));
vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { getByProvider, setSyncTime },
}));

const SECRET = 'whsec_test_123';
const ORG = '00000000-0000-0000-0000-000000000001';

function sign(rawBuf) {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBuf).digest('hex');
}

let token;
let webhookService;
beforeEach(async () => {
  vi.clearAllMocks();
  process.env.OAUTH_STATE_SECRET ||= 'test-oauth-state-secret';
  const { signWebhookToken } = await import('../src/lib/webhook-token.js');
  token = signWebhookToken(ORG);
  getByProvider.mockResolvedValue({ status: 'active', config: { webhook_secret: SECRET } });
  ({ webhookService } = await import('../src/services/webhook.service.js'));
});

const DATA = {
  business_id: 'biz-1', business_name: 'Ashford', date: '2026-06-15',
  patient_name: 'Emma Wilson', treatment_accepted: 'Dental Implant', amount: 15108.0,
  dentist: 'Dr. Sarah Johnson', source: 'google', campaign: 'Implant', comments: '',
};

it('accepts a valid treatment.accepted and upserts', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(res.received).toBe(true);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect(upsert.mock.calls[0][0].organisation_id).toBe(ORG);
  expect(upsert.mock.calls[0][0].value_pence).toBe(1510800);
});

it('routes treatment.deleted to a delete', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.deleted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.deleted');
  expect(deleteByExternalId).toHaveBeenCalledTimes(1);
  expect(res.deleted).toBe(1);
});

it('rejects a bad signature with 401', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, 'sha256=deadbeef', 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
  expect(upsert).not.toHaveBeenCalled();
});

it('rejects when no webhook secret is configured (401)', async () => {
  getByProvider.mockResolvedValue({ status: 'active', config: {} });
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, sign(raw), 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
});

it('rejects a tampered token with 401', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent('not.a.valid.token', raw, sign(raw), 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
});

it('ignores an unknown event', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.something', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.something');
  expect(res.ignored).toBe(true);
  expect(upsert).not.toHaveBeenCalled();
  expect(deleteByExternalId).not.toHaveBeenCalled();
});

it('discovers the business and stamps last_sync_at on a valid event', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(discover).toHaveBeenCalledWith(ORG, [{ business_id: 'biz-1', business_name: 'Ashford' }]);
  expect(setSyncTime).toHaveBeenCalledWith(ORG, 'emergent');
});

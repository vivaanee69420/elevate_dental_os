// backend/test/emergent-webhook.test.mjs
import './setup.js'; // dummy Supabase env + @supabase/supabase-js stub (this file
                     // mocks the repos but webhook.service still loads lib/supabase
                     // transitively via dentally-sync; without this it only passed
                     // when another suite's setup import leaked env into the run).
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
const recordWebhookResult = vi.fn(async () => {});
// loadResolution touches serviceClient (practices query) inside emergent-sync,
// so mock it here to keep the test hermetic while keeping the REAL mapRecord /
// externalId. Returns empty maps (no practice match) by default.
const loadResolution = vi.fn(async () => ({ explicit: new Map(), fuzzy: new Map() }));

vi.mock('../src/repositories/treatment-accepted.repository.js', () => ({
  treatmentAcceptedRepository: { upsert, deleteByExternalId },
}));
vi.mock('../src/repositories/emergent-practice-map.repository.js', () => ({
  emergentPracticeMapRepository: { discover, resolutionMap },
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

// An org is paused by flipping its integrations to 'revoked'. Pushed events must
// be refused too, not just the nightly pull — otherwise a paused org keeps
// writing tenant data in real time.
it('rejects a correctly-signed event once the integration is revoked', async () => {
  getByProvider.mockResolvedValue({ status: 'revoked', config: { webhook_secret: SECRET } });
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, sign(raw), 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 404 });
  expect(upsert).not.toHaveBeenCalled();
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

// Webhook health: the owner UI must show a truthful, time-stamped status for
// Emergent just like Dentally. Record the outcome of every delivery.
it('records a verified webhook health result on a valid event', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(recordWebhookResult).toHaveBeenCalledWith(ORG, 'emergent', expect.objectContaining({ outcome: 'verified' }));
});

it('records bad_signature on a rejected signature', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, 'sha256=deadbeef', 'treatment.accepted')).rejects.toMatchObject({ statusCode: 401 });
  expect(recordWebhookResult).toHaveBeenCalledWith(ORG, 'emergent', expect.objectContaining({ outcome: 'bad_signature' }));
});

it('records no_secret when no webhook secret is configured', async () => {
  getByProvider.mockResolvedValue({ status: 'active', config: {} });
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, sign(raw), 'treatment.accepted')).rejects.toMatchObject({ statusCode: 401 });
  expect(recordWebhookResult).toHaveBeenCalledWith(ORG, 'emergent', expect.objectContaining({ outcome: 'no_secret' }));
});

it('discovers the business and stamps last_sync_at on a valid event', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(discover).toHaveBeenCalledWith(ORG, [{ business_id: 'biz-1', business_name: 'Ashford' }]);
  expect(setSyncTime).toHaveBeenCalledWith(ORG, 'emergent');
});

// --- resilience: a transient DB error must NOT 5xx the delivery. The provider
//     disables a webhook after sustained failures, and the nightly sync is the
//     reconciliation backstop, so processing faults are logged + acked (200). --
it('acks (200, not 5xx) when the upsert throws — nightly sync reconciles', async () => {
  upsert.mockRejectedValueOnce(new Error('connection reset by peer'));
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(res).toMatchObject({ received: true, error: true });
});

it('acks (200, not 5xx) when the delete throws', async () => {
  deleteByExternalId.mockRejectedValueOnce(new Error('deadlock detected'));
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.deleted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.deleted');
  expect(res).toMatchObject({ received: true, error: true });
});

it('a failing business-discover does not 5xx the delivery', async () => {
  discover.mockRejectedValueOnce(new Error('pg timeout'));
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(res).toMatchObject({ received: true, error: true });
});

it('a bad signature still hard-rejects (resilience does not swallow auth failures)', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, 'sha256=deadbeef', 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
});

it('uses ONLY the org from the signed token (body cannot cross tenants)', async () => {
  // Token is for ORG. Even though the body smuggles a different organisation_id,
  // every downstream write must be scoped to ORG (the token-resolved tenant).
  const raw = Buffer.from(JSON.stringify({
    event: 'treatment.accepted',
    data: { ...DATA, organisation_id: 'attacker-org', business_id: 'biz-1' },
  }));
  await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(loadResolution).toHaveBeenCalledWith(ORG);
  expect(discover).toHaveBeenCalledWith(ORG, [{ business_id: 'biz-1', business_name: 'Ashford' }]);
  expect(setSyncTime).toHaveBeenCalledWith(ORG, 'emergent');
  expect(upsert.mock.calls[0][0].organisation_id).toBe(ORG);
});

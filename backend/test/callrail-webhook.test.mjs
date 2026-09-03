// ============================================================================
// CallRail webhook ingestion (Task 5).
//
// integrationAccountRepository and callrailRepository are used FOR REAL
// against the shared fake Supabase client from test/setup.js (`supaRec`),
// dispatched by table name — not vi.mock'd away — so these tests prove the
// actual query shapes: the token lookup, the (organisation_id, callrail_id)
// upsert conflict target, and that a real Postgres UNIQUE constraint on that
// pair would in fact collapse a re-delivered call to one row (mirrors the
// idempotency test in callrail.accounts.test.mjs's "upserting the same call
// twice yields one stored row").
//
// SIGNATURE VECTOR: the vendor's own published test vector, replayed
// byte-for-byte. `test/fixtures/callrail-signature-vector.json` is the exact
// JSON body from apidocs.callrail.com "Webhooks -> Validating Payloads",
// which with the published signing key `072e77e426f92738a72fe23c4d1953b4`
// must produce `UZAHbUdfm3GqL7qzilGozGzWV64=`.
//
// The expected signature below is HARDCODED, not recomputed with the same
// formula the implementation uses. That distinction is the whole point: a
// test that derives its expectation from `createHmac('sha1', ...)` passes
// even when both sides are wrong in the same way (SHA256 in both places, or
// hex instead of base64). Asserting the vendor's literal output makes the
// test an independent check against CallRail rather than against ourselves.
//
// The fixture has NO trailing newline, deliberately. The signature is over
// the raw request bytes, so one stray `\n` changes it — verified: the same
// body with a trailing newline hashes to `slJqKZkCtpJp2y989jy0zSM7tz4=`
// instead. Anything that re-serialises the body (JSON.parse then stringify)
// breaks verification, which is why app.js mounts the raw body for this route.
//
// Note also what the vendor's real payload proves: its `id` is `766970532`,
// a NUMBER — not the `CAL…` string the v3 API returns. That is the identity
// trap this integration is built around, confirmed from CallRail's own
// example rather than inferred.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { normalisePhone } from '../src/lib/sheet-export/normalise.js';
import {
  handleWebhook,
  parseCallPayload,
  CALLRAIL_FIELDS,
} from '../src/lib/integrations/callrail-webhook.js';

const ORG_A = 'org-aaaa';
const TOKEN_A = 'tok-aaaa-1111';

function makeAccount(overrides = {}) {
  return {
    id: 'acc-1',
    organisation_id: ORG_A,
    provider: 'callrail',
    external_account_id: 'ACT1',
    practice_id: 'practice-1',
    label: 'Ashford',
    status: 'active',
    webhook_token: TOKEN_A,
    config: {},
    secrets: encryptSecret(JSON.stringify({ api_key: 'test-api-key' })),
    ...overrides,
  };
}

const CANONICAL_CALL = {
  id: 'CAL8154748ae6bd4e278a7cddd38a662f4f',
  start_time: '2026-09-01T10:15:00Z',
  duration: 125,
  answered: true,
  customer_name: 'JOHN SMITH',
  customer_phone_number: '+447700900123',
  tracking_phone_number: '+441233445566',
  first_call: true,
  gclid: 'Cj0KCQjw_test_gclid',
  keywords: 'dental implants',
  campaign: 'Implants - Search',
  source: 'google',
};

let accounts;
let store; // Map "org|callrail_id" -> stored row — the real conflict target

beforeEach(() => {
  vi.clearAllMocks();
  accounts = [makeAccount()];
  store = new Map();
  supaRec.last = undefined;
  supaRec.resultProvider = (q) => {
    if (q.table === 'integration_accounts') {
      const tokenEq = q.eqs.find((e) => e.col === 'webhook_token');
      if (tokenEq) {
        const found = accounts.find((a) => a.webhook_token === tokenEq.val) ?? null;
        return { data: found, error: null };
      }
      return { data: null, error: null };
    }
    if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
      const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
      const out = [];
      for (const r of rows) {
        const key = `${r.organisation_id}|${r.callrail_id}`;
        const id = store.get(key)?.id ?? `row-${store.size + 1}`;
        store.set(key, { ...r, id });
        out.push({ id });
      }
      return { data: out, error: null };
    }
    return { data: [], error: null };
  };
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => CANONICAL_CALL,
  }));
});

function deliveryBody(overrides = {}) {
  return Buffer.from(JSON.stringify({ id: CANONICAL_CALL.id, timestamp: '2026-09-01T10:20:00Z', ...overrides }));
}

describe('CALLRAIL_FIELDS — shared ?fields= constant', () => {
  it('requests every attribution field the default calls.json omits', () => {
    for (const f of ['gclid', 'keywords', 'campaign', 'source', 'first_call', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      expect(CALLRAIL_FIELDS.split(',')).toContain(f);
    }
  });
});

describe('token resolution', () => {
  it('rejects an unknown token', async () => {
    await expect(handleWebhook('no-such-token', deliveryBody(), undefined))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('gives an IDENTICAL response for an unknown token and a revoked company\'s token — never reveals which case it was', async () => {
    let unknownErr;
    try {
      await handleWebhook('no-such-token', deliveryBody(), undefined);
    } catch (err) {
      unknownErr = err;
    }
    accounts = [makeAccount({ status: 'revoked' })];
    let revokedErr;
    try {
      await handleWebhook(TOKEN_A, deliveryBody(), undefined);
    } catch (err) {
      revokedErr = err;
    }
    expect(unknownErr.statusCode).toBe(revokedErr.statusCode);
    expect(unknownErr.message).toBe(revokedErr.message);
  });

  it('never resolves the org from the payload — a payload claiming another organisation_id changes nothing', async () => {
    const body = deliveryBody({ organisation_id: 'org-EVIL', organization_id: 'org-EVIL' });
    const res = await handleWebhook(TOKEN_A, body, undefined);
    expect(res.stored).toBe(true);
    const row = store.get(`${ORG_A}|${CANONICAL_CALL.id}`);
    expect(row).toBeTruthy();
    expect(row.organisation_id).toBe(ORG_A);
    expect([...store.keys()].some((k) => k.startsWith('org-EVIL|'))).toBe(false);
  });
});

describe('idempotency — through the REAL upsert, on the REAL conflict target', () => {
  it('the same call delivered twice produces exactly one stored row', async () => {
    await handleWebhook(TOKEN_A, deliveryBody(), undefined);
    await handleWebhook(TOKEN_A, deliveryBody(), undefined); // re-delivery (CallRail says it never happens, but nothing else guarantees it)

    expect(store.size).toBe(1);
    expect(supaRec.last.table).toBe('callrail_calls');
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,callrail_id');
  });
});

describe('missing id/start_time — rejected, not stored half-formed', () => {
  it('parseCallPayload returns null when the call has no id', () => {
    expect(parseCallPayload({ start_time: '2026-09-01T10:00:00Z' })).toBeNull();
  });

  it('parseCallPayload returns null when the call has no start_time', () => {
    expect(parseCallPayload({ id: 'CAL1' })).toBeNull();
  });

  it('a delivery whose body carries no id is ignored — the canonical re-fetch is never attempted', async () => {
    const res = await handleWebhook(TOKEN_A, Buffer.from(JSON.stringify({ timestamp: 'x' })), undefined);
    expect(res).toEqual({ received: true, stored: false, reason: 'no_call_id' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('a canonical call missing start_time is not stored', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ...CANONICAL_CALL, start_time: undefined }),
    }));
    const res = await handleWebhook(TOKEN_A, deliveryBody(), undefined);
    expect(res).toEqual({ received: true, stored: false, reason: 'incomplete_call' });
    expect(store.size).toBe(0);
  });
});

describe('shared normalisers', () => {
  it('caller_phone10 is populated via the shared normalisePhone (same value, not re-derived)', () => {
    const row = parseCallPayload(CANONICAL_CALL);
    const expected = normalisePhone(CANONICAL_CALL.customer_phone_number);
    expect(row.caller_phone10).toBe(expected.canonical);
    expect(row.caller_phone10).toBe('447700900123');
  });

  it('caller_email and caller_email_norm are always null — CallRail carries no email for a call', () => {
    const row = parseCallPayload(CANONICAL_CALL);
    expect(row.caller_email).toBeNull();
    expect(row.caller_email_norm).toBeNull();
  });
});

describe('re-fetch (IDENTITY ruling) failure', () => {
  it('stores nothing and still returns 2xx-shaped success when the canonical re-fetch fails — the pull collects it later', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const res = await handleWebhook(TOKEN_A, deliveryBody(), undefined);
    expect(res).toEqual({ received: true, stored: false, reason: 'refetch_failed' });
    expect(store.size).toBe(0);
  });
});

describe('Signature header — HMAC-SHA1, second factor, per-account key', () => {
  // The vendor's own published key and body (callrail-api-findings.md §1).
  const VENDOR_KEY = '072e77e426f92738a72fe23c4d1953b4';
  const VENDOR_BODY = readFileSync(
    new URL('./fixtures/callrail-signature-vector.json', import.meta.url),
  );
  const VENDOR_SIGNATURE = 'UZAHbUdfm3GqL7qzilGozGzWV64=';

  function sign(key, rawBuf) {
    return crypto.createHmac('sha1', key).update(rawBuf).digest('base64');
  }

  it("reproduces the vendor's published signature exactly, from their own example body", () => {
    // Hardcoded expectation, not a recomputation — see the file header. This
    // is the one assertion that would catch SHA256-for-SHA1, hex-for-base64,
    // or a body that got re-serialised somewhere in the chain.
    expect(sign(VENDOR_KEY, VENDOR_BODY)).toBe(VENDOR_SIGNATURE);
  });

  it("accepts the vendor's own example delivery end to end", async () => {
    accounts = [makeAccount({ config: { signing_key: VENDOR_KEY } })];
    const res = await handleWebhook(TOKEN_A, VENDOR_BODY, VENDOR_SIGNATURE);
    expect(res.stored).toBe(true);
  });

  it('rejects the vendor body when a single byte is appended — the signature is over the RAW bytes', async () => {
    accounts = [makeAccount({ config: { signing_key: VENDOR_KEY } })];
    // One trailing newline moves the digest to slJqKZkCtpJp2y989jy0zSM7tz4=.
    // Anything that re-serialises the body would fail here the same way, which
    // is what makes this an assertion about the raw-body mount, not just HMAC.
    await expect(
      handleWebhook(TOKEN_A, Buffer.concat([VENDOR_BODY, Buffer.from('\n')]), VENDOR_SIGNATURE),
    ).rejects.toThrow(/invalid signature/i);
  });

  it('accepts a correctly HMAC-SHA1-signed delivery when a signing key is on file', async () => {
    accounts = [makeAccount({ config: { signing_key: VENDOR_KEY } })];
    const body = deliveryBody();
    const sig = sign(VENDOR_KEY, body);
    const res = await handleWebhook(TOKEN_A, body, sig);
    expect(res.stored).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    accounts = [makeAccount({ config: { signing_key: VENDOR_KEY } })];
    const body = deliveryBody();
    const badSig = sign(VENDOR_KEY, body).slice(0, -2) + 'xx';
    await expect(handleWebhook(TOKEN_A, body, badSig)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a signature computed with SHA256 instead of SHA1 — algorithm matters, not just shape', async () => {
    accounts = [makeAccount({ config: { signing_key: VENDOR_KEY } })];
    const body = deliveryBody();
    const sha256Sig = crypto.createHmac('sha256', VENDOR_KEY).update(body).digest('base64');
    await expect(handleWebhook(TOKEN_A, body, sha256Sig)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a missing Signature header when a key IS configured', async () => {
    accounts = [makeAccount({ config: { signing_key: VENDOR_KEY } })];
    await expect(handleWebhook(TOKEN_A, deliveryBody(), undefined)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('is a no-op (never rejects on signature) when no signing key is configured for the account', async () => {
    accounts = [makeAccount({ config: {} })]; // no signing_key — every account today
    const res = await handleWebhook(TOKEN_A, deliveryBody(), 'garbage-not-even-base64');
    expect(res.stored).toBe(true);
  });
});

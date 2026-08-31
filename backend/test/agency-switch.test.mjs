// backend/test/agency-switch.test.mjs
// Signed agency-switch token: HMAC over base64url JSON {u, o, exp}.
// Secret: AGENCY_SWITCH_SECRET, falling back to OAUTH_STATE_SECRET (already
// required at runtime) — same idiom as webhook-token.js.
import { describe, it, expect } from 'vitest';

process.env.OAUTH_STATE_SECRET ||= 'test-secret';

const { signSwitchToken, verifySwitchToken, SWITCH_TTL_MS } = await import('../src/lib/agency-switch.js');

const U = '11111111-1111-1111-1111-111111111111';
const O = '22222222-2222-2222-2222-222222222222';

describe('agency switch token', () => {
  it('round-trips user + org', () => {
    const t = signSwitchToken(U, O);
    expect(verifySwitchToken(t)).toEqual({ userId: U, orgId: O });
  });

  it('defaults to a ~12h expiry', () => {
    expect(SWITCH_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('rejects a tampered payload', () => {
    const t = signSwitchToken(U, O);
    const [, sig] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: U, o: '33333333-3333-3333-3333-333333333333', exp: Date.now() + 60000 }),
    ).toString('base64url');
    expect(() => verifySwitchToken(`${forged}.${sig}`)).toThrow(/invalid_switch_token/);
  });

  it('rejects an expired token', () => {
    const t = signSwitchToken(U, O, -1000);
    expect(() => verifySwitchToken(t)).toThrow(/switch_token_expired/);
  });

  it('rejects garbage', () => {
    expect(() => verifySwitchToken('not-a-token')).toThrow(/invalid_switch_token/);
    expect(() => verifySwitchToken('')).toThrow(/invalid_switch_token/);
  });
});

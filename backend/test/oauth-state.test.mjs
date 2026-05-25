// OAuth state signing — the security boundary that lets the PUBLIC callback
// trust an org id with no JWT. Forge-resistance is the whole point, so the
// tamper/expiry/mismatch paths are non-negotiable.
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { signState, verifyState } from '../src/lib/oauth-state.js';

beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = 'test-state-secret';
});

describe('oauth-state', () => {
    it('round-trips orgId + provider', () => {
        const s = signState({ orgId: 'org-1', provider: 'gohighlevel' });
        expect(verifyState(s, 'gohighlevel')).toEqual({ orgId: 'org-1', provider: 'gohighlevel' });
    });

    it('rejects a tampered payload (signature mismatch)', () => {
        const s = signState({ orgId: 'org-1', provider: 'gohighlevel' });
        const [, sig] = s.split('.');
        const forgedPayload = Buffer.from(JSON.stringify({
            orgId: 'attacker-org', provider: 'gohighlevel', ts: Date.now(), nonce: 'x',
        })).toString('base64url');
        expect(() => verifyState(`${forgedPayload}.${sig}`)).toThrow(/signature/);
    });

    it('rejects a different signing key', () => {
        const s = signState({ orgId: 'org-1', provider: 'gohighlevel' });
        process.env.OAUTH_STATE_SECRET = 'different-secret';
        expect(() => verifyState(s)).toThrow(/signature/);
    });

    it('rejects an expired state (older than TTL)', () => {
        const old = Buffer.from(JSON.stringify({
            orgId: 'org-1', provider: 'gohighlevel', ts: Date.now() - 11 * 60 * 1000, nonce: 'x',
        })).toString('base64url');
        // Sign the stale payload with the real key so only TTL can reject it.
        const key = crypto.createHash('sha256').update(process.env.OAUTH_STATE_SECRET).digest();
        const sig = crypto.createHmac('sha256', key).update(old).digest('base64url');
        expect(() => verifyState(`${old}.${sig}`)).toThrow(/expired/);
    });

    it('rejects a provider mismatch', () => {
        const s = signState({ orgId: 'org-1', provider: 'xero' });
        expect(() => verifyState(s, 'gohighlevel')).toThrow(/mismatch/);
    });

    it('rejects malformed input', () => {
        expect(() => verifyState('not-a-state')).toThrow(/invalid_state/);
        expect(() => verifyState('')).toThrow(/invalid_state/);
    });

    it('throws when OAUTH_STATE_SECRET is missing', () => {
        delete process.env.OAUTH_STATE_SECRET;
        expect(() => signState({ orgId: 'o', provider: 'p' })).toThrow(/OAUTH_STATE_SECRET/);
    });
});

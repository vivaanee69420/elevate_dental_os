// OAuth `state` signing — lets the public OAuth callback derive the org/provider
// from an unforgeable token instead of req.user (the callback is an
// unauthenticated browser redirect, so there is no Bearer/session to read).
//
// Token layout:  base64url(JSON{orgId,provider,ts,nonce}) "." base64url(HMAC-SHA256)
// verify() rejects a bad signature, an expired token (TTL), or a provider
// mismatch. HMAC key from OAUTH_STATE_SECRET.

import crypto from 'node:crypto';

const TTL_MS = 10 * 60 * 1000; // 10 minutes from issue to callback

function getKey() {
    const secret = process.env.OAUTH_STATE_SECRET;
    if (!secret) throw new Error('OAUTH_STATE_SECRET missing');
    return crypto.createHash('sha256').update(secret).digest();
}

function sign_(payloadB64) {
    return crypto.createHmac('sha256', getKey()).update(payloadB64).digest('base64url');
}

export function signState({ orgId, provider }) {
    if (!orgId || !provider) throw new Error('signState requires orgId and provider');
    const payload = { orgId, provider, ts: Date.now(), nonce: crypto.randomBytes(8).toString('hex') };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${payloadB64}.${sign_(payloadB64)}`;
}

// Returns { orgId, provider } on success. Throws on any tamper/expiry/mismatch.
export function verifyState(state, expectedProvider) {
    if (!state || typeof state !== 'string' || !state.includes('.')) {
        throw new Error('invalid_state');
    }
    const [payloadB64, sig] = state.split('.');
    const expected = sign_(payloadB64);
    // Constant-time compare; lengths must match first or timingSafeEqual throws.
    const sigBuf = Buffer.from(sig ?? '', 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('invalid_state_signature');
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        throw new Error('invalid_state_payload');
    }
    if (typeof payload.ts !== 'number' || Date.now() - payload.ts > TTL_MS) {
        throw new Error('expired_state');
    }
    if (expectedProvider && payload.provider !== expectedProvider) {
        throw new Error('provider_mismatch');
    }
    if (!payload.orgId || !payload.provider) {
        throw new Error('invalid_state_payload');
    }
    return { orgId: payload.orgId, provider: payload.provider };
}

// Stable per-org webhook token. Unlike oauth-state (TTL'd, single-use), a
// webhook URL must stay valid indefinitely — the provider keeps POSTing to it.
// Layout: base64url(orgId) "." base64url(HMAC-SHA256(orgId)). No expiry.
// HMAC key from OAUTH_STATE_SECRET (already required at runtime).

import crypto from 'node:crypto';

function getKey() {
    const secret = process.env.OAUTH_STATE_SECRET;
    if (!secret) throw new Error('OAUTH_STATE_SECRET missing');
    return crypto.createHash('sha256').update(secret).digest();
}

function sign_(payloadB64) {
    return crypto.createHmac('sha256', getKey()).update(payloadB64).digest('base64url');
}

export function signWebhookToken(orgId) {
    if (!orgId) throw new Error('signWebhookToken requires orgId');
    const payloadB64 = Buffer.from(String(orgId)).toString('base64url');
    return `${payloadB64}.${sign_(payloadB64)}`;
}

// Returns orgId on success; throws on tamper. No expiry check (stable URL).
export function verifyWebhookToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        throw new Error('invalid_webhook_token');
    }
    const [payloadB64, sig] = token.split('.');
    const expected = sign_(payloadB64);
    const sigBuf = Buffer.from(sig ?? '', 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('invalid_webhook_token_signature');
    }
    return Buffer.from(payloadB64, 'base64url').toString('utf8');
}

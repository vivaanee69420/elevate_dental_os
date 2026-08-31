// Agency → sub-account switch token. Layout: base64url(JSON {u,o,exp}) "."
// base64url(HMAC-SHA256(payload)). Unlike webhook-token (stable, no expiry)
// this token expires (~12h) and binds the ACTING USER, so a leaked cookie
// can't be replayed by another account. Secret: AGENCY_SWITCH_SECRET, falling
// back to OAUTH_STATE_SECRET so no new env var is required to boot.
import crypto from 'node:crypto';

export const SWITCH_TTL_MS = 12 * 60 * 60 * 1000;

function getKey() {
    const secret = process.env.AGENCY_SWITCH_SECRET || process.env.OAUTH_STATE_SECRET;
    if (!secret) throw new Error('AGENCY_SWITCH_SECRET/OAUTH_STATE_SECRET missing');
    return crypto.createHash('sha256').update(secret).digest();
}

function sign_(payloadB64) {
    return crypto.createHmac('sha256', getKey()).update(payloadB64).digest('base64url');
}

export function signSwitchToken(userId, orgId, ttlMs = SWITCH_TTL_MS) {
    if (!userId || !orgId) throw new Error('signSwitchToken requires userId and orgId');
    const payloadB64 = Buffer.from(
        JSON.stringify({ u: String(userId), o: String(orgId), exp: Date.now() + ttlMs }),
    ).toString('base64url');
    return `${payloadB64}.${sign_(payloadB64)}`;
}

// Returns { userId, orgId }; throws on tamper or expiry.
export function verifySwitchToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        throw new Error('invalid_switch_token');
    }
    const [payloadB64, sig] = token.split('.');
    const expected = sign_(payloadB64);
    const sigBuf = Buffer.from(sig ?? '', 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('invalid_switch_token');
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        throw new Error('invalid_switch_token');
    }
    if (!payload?.u || !payload?.o || typeof payload.exp !== 'number') {
        throw new Error('invalid_switch_token');
    }
    if (Date.now() > payload.exp) throw new Error('switch_token_expired');
    return { userId: payload.u, orgId: payload.o };
}

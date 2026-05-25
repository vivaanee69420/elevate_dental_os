// Symmetric encryption for integration secrets at rest (AES-256-GCM).
//
// Returns/accepts a BASE64 STRING (not a Node Buffer). Buffers cannot round-trip
// through supabase-js: passing a Buffer to .upsert() JSON-serializes it to
// {"type":"Buffer","data":[...]}, so the stored bytes are that JSON, not the
// ciphertext, and decryption later fails ("undecryptable"). A base64 string
// stores and reads back verbatim in a TEXT column. decryptSecret is tolerant of
// legacy inputs (Buffer, or a Postgres bytea "\x.." hex string) for safety.
//
// Key from INTEGRATIONS_SECRET_KEY env var (sha256-derived). Layout per blob:
// [12B iv | 16B tag | ciphertext], base64-encoded.

import crypto from 'node:crypto';

const KEY = process.env.INTEGRATIONS_SECRET_KEY;
if (!KEY && process.env.NODE_ENV === 'production') {
    console.warn('[crypto] INTEGRATIONS_SECRET_KEY not set — integrations will fail to encrypt');
}

function getKey() {
    if (!KEY) throw new Error('INTEGRATIONS_SECRET_KEY missing');
    return crypto.createHash('sha256').update(KEY).digest();
}

export function encryptSecret(plaintext) {
    if (plaintext == null) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
}

// Coerce whatever the DB/driver hands back into the raw [iv|tag|ct] Buffer.
function toBuffer(value) {
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return value;            // legacy / direct Buffer
    if (typeof value === 'string') {
        // Postgres bytea text form: "\x<hex>"
        if (value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex');
        return Buffer.from(value, 'base64');             // current format
    }
    // Last resort: a {type:'Buffer',data:[...]} shape (legacy corrupt rows).
    if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
    return null;
}

export function decryptSecret(value) {
    const buf = toBuffer(value);
    if (!buf) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

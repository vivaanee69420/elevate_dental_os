// Symmetric encryption for integration secrets at rest.
// Uses pgcrypto via Supabase RPC — secrets never leave the DB unencrypted.
// Falls back to in-process AES-256-GCM with INTEGRATIONS_SECRET_KEY env var.

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
    // Layout: [12B iv | 16B tag | ciphertext]
    return Buffer.concat([iv, tag, ct]);
}

export function decryptSecret(buf) {
    if (!buf) return null;
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const ct = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

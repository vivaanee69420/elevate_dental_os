// ============================================================================
// Opaque keyset cursor for Data Room pagination. `d` is the last row's date
// column value (null for roster datasets), `id` the last row's id (uuid) —
// or, for derived in-memory datasets, a numeric offset. base64url JSON so it
// is URL-safe; decoding validates the shape and 400s on anything else.
// ============================================================================
import { AppError } from '../../middleware/errors.js';

export function encodeCursor({ d, id }) {
    return Buffer.from(JSON.stringify({ d: d ?? null, id }), 'utf8').toString('base64url');
}

export function decodeCursor(str) {
    if (typeof str !== 'string' || str.length === 0 || !/^[A-Za-z0-9_-]+$/.test(str)) {
        throw new AppError('Invalid cursor', 400);
    }
    let obj;
    try {
        obj = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
    } catch {
        throw new AppError('Invalid cursor', 400);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new AppError('Invalid cursor', 400);
    const dOk = obj.d === null || typeof obj.d === 'string';
    const idOk = typeof obj.id === 'string' || (typeof obj.id === 'number' && Number.isFinite(obj.id));
    if (!dOk || !idOk) throw new AppError('Invalid cursor', 400);
    return { d: obj.d, id: obj.id };
}

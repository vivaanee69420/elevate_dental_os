// Contact-identity normalisers for the GHL→Dentally sheet export matcher.
// Exact equality after normalisation ONLY — no fuzzy matching by design.

export function normaliseEmail(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s || !s.includes('@')) return null;
    return s;
}

// UK-centric canonicalisation: 07… / +447… / 447… all collapse to 44-prefixed
// digits. <10 digits is too ambiguous to trust for identity — discard.
export function normalisePhone(raw) {
    let digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.startsWith('0044')) digits = `44${digits.slice(4)}`;
    else if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
    if (digits.length < 10) return null;
    return { canonical: digits, suffix9: digits.slice(-9) };
}

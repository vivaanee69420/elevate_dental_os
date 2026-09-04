// ============================================================================
// Currency guard for ad spend.
//
// microsToPence (Google) and spendToPence (Meta) both divide the platform's
// figure and call the result pence, with NO currency conversion. That is
// correct only while every account bills in GBP. One USD Google account is
// connected — deselected today, so nothing is wrong now, but selecting it
// would silently inflate every group total.
//
// The choice here is to REFUSE rather than convert. A visible gap is
// recoverable; a wrong total that looks right is not. Building FX conversion
// is a much larger piece of work and is not needed until a non-GBP account is
// actually in use.
// ============================================================================

export const SUPPORTED_CURRENCY = 'GBP';

// A null/absent currency is treated as supported. Three connected Google
// accounts have no currency recorded, and dropping their live spend would be a
// worse error than assuming the GBP that they almost certainly are. They are
// listed in the reconciliation panel so the gap is visible and correctable.
export function isSupportedCurrency(currency) {
    if (currency == null || currency === '') return true;
    return String(currency).toUpperCase() === SUPPORTED_CURRENCY;
}

export function partitionAccountsByCurrency(accounts) {
    const supported = [];
    const unsupported = [];
    for (const a of Array.isArray(accounts) ? accounts : []) {
        if (isSupportedCurrency(a?.currency)) supported.push(String(a.customer_id));
        else unsupported.push({ customer_id: String(a.customer_id), currency: a.currency });
    }
    return { supported, unsupported };
}

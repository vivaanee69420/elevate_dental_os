// Currency guard. microsToPence and spendToPence both assume the account is
// billed in GBP — they divide and call the result pence with no conversion.
// A USD account is connected (deselected today), and selecting it would make
// every group total silently larger. Refuse rather than convert.
import { describe, it, expect } from 'vitest';

const { isSupportedCurrency, partitionAccountsByCurrency, SUPPORTED_CURRENCY } =
    await import('../src/lib/integrations/ad-currency.js');

describe('isSupportedCurrency', () => {
    it('accepts GBP in any case', () => {
        expect(isSupportedCurrency('GBP')).toBe(true);
        expect(isSupportedCurrency('gbp')).toBe(true);
    });

    it('rejects any other currency', () => {
        expect(isSupportedCurrency('USD')).toBe(false);
        expect(isSupportedCurrency('EUR')).toBe(false);
    });

    // Three connected Google accounts have a null currency. Treating them as
    // unsupported would drop live spend that is almost certainly GBP; they are
    // surfaced in the reconciliation panel instead.
    it('treats an unknown currency as supported, to be flagged not dropped', () => {
        expect(isSupportedCurrency(null)).toBe(true);
        expect(isSupportedCurrency(undefined)).toBe(true);
        expect(isSupportedCurrency('')).toBe(true);
    });

    it('names GBP as the supported currency', () => {
        expect(SUPPORTED_CURRENCY).toBe('GBP');
    });
});

describe('partitionAccountsByCurrency', () => {
    it('splits ids to sync from accounts to flag', () => {
        const { supported, unsupported } = partitionAccountsByCurrency([
            { customer_id: 'A', currency: 'GBP' },
            { customer_id: 'B', currency: 'USD' },
            { customer_id: 'C', currency: null },
        ]);
        expect(supported).toEqual(['A', 'C']);
        expect(unsupported).toEqual([{ customer_id: 'B', currency: 'USD' }]);
    });

    it('handles an empty list', () => {
        expect(partitionAccountsByCurrency([])).toEqual({ supported: [], unsupported: [] });
        expect(partitionAccountsByCurrency(undefined)).toEqual({ supported: [], unsupported: [] });
    });
});

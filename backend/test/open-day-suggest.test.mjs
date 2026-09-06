import { describe, it, expect } from 'vitest';
const { suggestOpenDay } = await import('../src/lib/marketing/open-day-suggest.js');

const EVENTS = [
    { id: 'e-jul', name: 'July 26', eventDate: '2026-07-15' },
    { id: 'e-oct', name: 'October 26', eventDate: '2026-10-12' },
];

describe('suggestOpenDay', () => {
    it('suggests nothing for a name that does not mention an open day', () => {
        expect(suggestOpenDay('Mint: Retargeting LF - £10/day', EVENTS)).toBeNull();
    });

    it('matches an event whose month and year appear in the name', () => {
        expect(suggestOpenDay('Mint: Implants Open Day LF July 26', EVENTS)).toBe('e-jul');
        expect(suggestOpenDay('3. Dental Implants Open Day (12 Oct 2026)', EVENTS)).toBe('e-oct');
    });

    it('tolerates the naming this org actually uses', () => {
        expect(suggestOpenDay('Mint: Cosmetic Open Day LF 07/26', EVENTS)).toBe('e-jul');
        expect(suggestOpenDay('Mint: GM Dental: Dental Implants Open Day July 2026', EVENTS)).toBe('e-jul');
    });

    it('suggests nothing when it recognises an open day but no event matches', () => {
        // A tenant whose naming this does not understand gets NO suggestion,
        // never a wrong one. The cost is a missing shortcut, not a bad mapping.
        expect(suggestOpenDay('Open Day Spring Special', EVENTS)).toBeNull();
    });

    it('suggests nothing when the org has no events yet', () => {
        expect(suggestOpenDay('Mint: Implants Open Day LF July 26', [])).toBeNull();
    });
});

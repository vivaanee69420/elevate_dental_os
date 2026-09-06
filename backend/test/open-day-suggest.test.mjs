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

    it('does not treat a month name as a prefix match inside a longer word', () => {
        // "Mayfair" is a London district, "Junction Road" a plausible
        // campaign or practice name — neither is the word "May"/"June", so
        // neither may borrow that month. A false positive here pre-ticks the
        // WRONG event, which this design treats as worse than no suggestion.
        expect(suggestOpenDay('Mint: Implants Mayfair Open Day', EVENTS)).toBeNull();
        expect(suggestOpenDay('Mint: Junction Road Open Day', EVENTS)).toBeNull();
    });

    it('still recognises real month abbreviations, short or long', () => {
        const sepEvent = [{ id: 'e-sep', name: 'September 26', eventDate: '2026-09-20' }];
        expect(suggestOpenDay('Mint: GM Dental Open Day September 26', sepEvent)).toBe('e-sep');
        expect(suggestOpenDay('Mint: Cosmetic Open Day Sept 26', sepEvent)).toBe('e-sep');
    });

    it('suggests nothing when two events both match the same month and year', () => {
        // This org genuinely runs more than one open day in a month — e.g.
        // July 2026 events on the 7th, 8th, 9th+11th and 14th. An ambiguous
        // name is precisely when a guess is most likely to be wrong.
        const julyEvents = [
            { id: 'e-jul-7', name: 'July 26 (7th)', eventDate: '2026-07-07' },
            { id: 'e-jul-14', name: 'July 26 (14th)', eventDate: '2026-07-14' },
        ];
        expect(suggestOpenDay('Mint: Implants Open Day LF July 26', julyEvents)).toBeNull();
    });

    it('tolerates any run of whitespace or a hyphen between "open" and "day"', () => {
        // Live data: three September open-day campaigns, one per practice.
        // The double-space name was silently missed before this fix — a
        // miss the owner has to notice a running campaign is absent, not
        // merely a lost shortcut.
        const sepEvent = [{ id: 'e-sep', name: 'September 26', eventDate: '2026-09-20' }];
        expect(suggestOpenDay('Dental Implant Open Day Sept 26', sepEvent)).toBe('e-sep');
        expect(suggestOpenDay('Dental Implants Open  Day Sept 26', sepEvent)).toBe('e-sep');
        expect(suggestOpenDay('Dental Implant Open-Day Sept 26', sepEvent)).toBe('e-sep');
    });

    it('does not loosen the phrase into matching "day" on its own', () => {
        expect(suggestOpenDay('Mint: Retargeting LF - GBP10/day', EVENTS)).toBeNull();
    });
});

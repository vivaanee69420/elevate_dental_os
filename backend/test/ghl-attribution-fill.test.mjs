// Opportunistic attribution fill. The nightly walk already holds every
// contact; a contact outside the incremental window whose attribution has
// never been captured is written anyway. A contact that ALREADY has
// attribution is still skipped — otherwise the incremental sync degenerates
// into a full rewrite every night.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn(), markSynced: vi.fn(), markFailed: vi.fn() },
}));

const { __test } = await import('../src/lib/integrations/gohighlevel-sync.js');

describe('selectContactsToWrite', () => {
    const older = '2020-01-01T00:00:00.000Z';
    const newer = '2030-01-01T00:00:00.000Z';
    const since = '2025-01-01T00:00:00.000Z';

    it('includes contacts changed since the last sync', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'a', dateUpdated: newer }], since, new Set());
        expect(out.map((c) => c.id)).toEqual(['a']);
    });

    it('includes an UNCHANGED contact whose attribution was never captured', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'b', dateUpdated: older }], since, new Set(['b']));
        expect(out.map((c) => c.id)).toEqual(['b']);
    });

    it('skips an unchanged contact that already has attribution', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'c', dateUpdated: older }], since, new Set());
        expect(out).toEqual([]);
    });

    it('keeps a contact with no update timestamp rather than silently dropping it', () => {
        const out = __test.selectContactsToWrite([{ id: 'd' }], since, new Set());
        expect(out.map((c) => c.id)).toEqual(['d']);
    });

    it('a full run (no since) takes everything', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'e', dateUpdated: older }], null, new Set());
        expect(out.map((c) => c.id)).toEqual(['e']);
    });
});

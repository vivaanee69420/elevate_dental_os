import { describe, it, expect } from 'vitest';
import { associateStatus } from '../src/lib/associate-status.js';

describe('associateStatus', () => {
    it('no recent activity -> review', () => {
        expect(associateStatus({ completionPct: null, total: 0 })).toBe('review');
    });
    it('high completion + high volume -> top', () => {
        expect(associateStatus({ completionPct: 90, total: 60 })).toBe('top');
    });
    it('low completion or low volume -> review', () => {
        expect(associateStatus({ completionPct: 60, total: 50 })).toBe('review');
        expect(associateStatus({ completionPct: 95, total: 10 })).toBe('review');
    });
    it('middle -> good', () => {
        expect(associateStatus({ completionPct: 80, total: 30 })).toBe('good');
    });
});

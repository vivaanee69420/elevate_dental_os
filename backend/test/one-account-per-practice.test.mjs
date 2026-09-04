// One account per practice, per provider (migration 000161).
//
// The unique indexes are the real guarantee. This file covers the half that
// decides whether an owner can ACT on them: a duplicate mapping must come back
// as a 409 saying what happened, not as an opaque 500.
//
// Why that distinction earns a test. Repositories throw a bare Error on any
// Postgres failure, and errorHandler renders every bare Error as "Internal
// server error". A tenant mapping a second CallRail company to a practice
// would see a crash, retry, and see the identical crash — with the truthful
// answer ("that practice already has one") never reaching them.
import { describe, it, expect } from 'vitest';
import { AppError, assertNotDuplicatePracticeMapping } from '../src/middleware/errors.js';

const dupe = (constraint) => ({
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
});

describe('assertNotDuplicatePracticeMapping', () => {
    it('turns a practice-uniqueness violation into an actionable 409', () => {
        try {
            assertNotDuplicatePracticeMapping(dupe('ad_accounts_one_per_practice'), 'ad account');
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect(err.statusCode).toBe(409);
            expect(err.message).toContain('ad account');
            // Says what to do, not merely what went wrong.
            expect(err.message).toMatch(/unmap the existing one/i);
        }
    });

    it('covers every index the rule is enforced by', () => {
        for (const c of [
            'integration_accounts_one_per_practice',
            'ad_accounts_one_per_practice',
            'practices_one_pms_site',
            'emergent_practice_map_one_per_practice',
            // The GoHighLevel-only index that predates the rule and still exists.
            'idx_integration_accounts_practice',
        ]) {
            expect(() => assertNotDuplicatePracticeMapping(dupe(c))).toThrow(AppError);
        }
    });

    it('does NOT claim a practice conflict for an unrelated unique violation', () => {
        // Each of these tables carries other unique constraints — an external
        // account id, a business id, a webhook token. Reporting "already mapped
        // to that practice" for a duplicate ACCOUNT id would be a confident,
        // wrong diagnosis that sends the owner to the wrong screen.
        for (const c of [
            'integration_accounts_organisation_id_provider_external_acco_key',
            'emergent_practice_map_organisation_id_business_id_key',
            'ad_accounts_organisation_id_provider_customer_id_key',
            'idx_integration_accounts_webhook_token',
        ]) {
            expect(() => assertNotDuplicatePracticeMapping(dupe(c))).not.toThrow();
        }
    });

    it('ignores a null error and any non-unique failure', () => {
        expect(() => assertNotDuplicatePracticeMapping(null)).not.toThrow();
        expect(() => assertNotDuplicatePracticeMapping(undefined)).not.toThrow();
        // A dead connection must stay a 500 — it is not the owner's mistake.
        expect(() => assertNotDuplicatePracticeMapping({ code: '08006', message: 'connection failure' })).not.toThrow();
    });
});

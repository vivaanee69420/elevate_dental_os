// Regression: upsertSecrets MUST preserve existing config keys (notably
// webhook_secret/webhook_id) rather than replacing the whole config blob.
//
// Root cause it guards: every OAuth token refresh persists tokens via
// upsertSecrets({ config: { token_type, scope } }). A full replace dropped the
// per-org webhook_secret on the first refresh after pairing, so every real-time
// Dentally/Emergent webhook delivery 401'd ("webhook secret not configured")
// and the provider auto-disabled the hook after ~50 failures. Merge fixes it.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { integrationRepository } = await import('../src/repositories/integration.repository.js');

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('integrationRepository.upsertSecrets config merge', () => {
    it('preserves webhook_secret/webhook_id when an OAuth refresh writes only token_type/scope', async () => {
        let upserted;
        supaRec.resultProvider = (q) => {
            // The getByProvider read (select -> maybeSingle) returns the existing
            // row: a paired webhook secret + base_url already on file.
            if (q.op === 'select') {
                return {
                    data: { config: { webhook_secret: 'paired-secret', webhook_id: 82890, base_url: 'https://api.dentally.co' } },
                    error: null,
                };
            }
            if (q.op === 'upsert') {
                upserted = q.upsertVals;
                return { data: null, error: null };
            }
            return { data: [], error: null };
        };

        // Simulate the OAuth token-refresh persistence: config carries only the
        // token payload markers, NOT the webhook secret.
        await integrationRepository.upsertSecrets('org-1', 'dentally', {
            config: { token_type: 'Bearer', scope: 'patient:read' },
            secrets: 'enc',
            status: 'active',
            verified_at: '2026-06-17T00:00:00.000Z',
            scopes: ['patient:read'],
            expires_at: '2026-06-30T00:00:00.000Z',
        });

        expect(upserted.config).toEqual({
            // preserved across the refresh
            webhook_secret: 'paired-secret',
            webhook_id: 82890,
            base_url: 'https://api.dentally.co',
            // new token markers merged in
            token_type: 'Bearer',
            scope: 'patient:read',
        });
    });

    it('new config values win over stale ones on conflict', async () => {
        let upserted;
        supaRec.resultProvider = (q) => {
            if (q.op === 'select') return { data: { config: { scope: 'old', base_url: 'https://old' } }, error: null };
            if (q.op === 'upsert') { upserted = q.upsertVals; return { data: null, error: null }; }
            return { data: [], error: null };
        };
        await integrationRepository.upsertSecrets('org-1', 'dentally', {
            config: { scope: 'new' }, secrets: 'enc', status: 'active',
        });
        expect(upserted.config.scope).toBe('new');
        expect(upserted.config.base_url).toBe('https://old');
    });

    it('handles a first-time connect with no existing row', async () => {
        let upserted;
        supaRec.resultProvider = (q) => {
            if (q.op === 'select') return { data: null, error: null }; // no existing row
            if (q.op === 'upsert') { upserted = q.upsertVals; return { data: null, error: null }; }
            return { data: [], error: null };
        };
        await integrationRepository.upsertSecrets('org-1', 'dentally', {
            config: { token_type: 'Bearer' }, secrets: 'enc', status: 'active',
        });
        expect(upserted.config).toEqual({ token_type: 'Bearer' });
    });
});

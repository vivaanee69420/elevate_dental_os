// ============================================================================
// Integration repository — Supabase data access for integrations domain.
// Phase 3: token persistence + status lifecycle. Secrets are pre-encrypted
// before reaching here. Read methods NEVER return secrets via API.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const integrationRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('integrations')
            .select('id, provider, status, last_sync_at, last_error, config, verified_at, scopes, expires_at, created_at, updated_at')
            .eq('organisation_id', orgId)
            .order('updated_at', { ascending: false });
        return data ?? [];
    },
    async getByProvider(orgId, provider) {
        const { data } = await supabase_1.serviceClient
            .from('integrations')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .maybeSingle();
        return data;
    },
    async upsert(orgId, provider, fields) {
        const row = { organisation_id: orgId, provider, ...fields };
        const { data, error } = await supabase_1.serviceClient
            .from('integrations')
            .upsert(row, { onConflict: 'organisation_id,provider' })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    async upsertSecrets(orgId, provider, { config, secrets, status, verified_at, scopes, expires_at }) {
        const row = {
            organisation_id: orgId,
            provider,
            config: config ?? {},
            secrets,
            status: status ?? 'active',
            verified_at,
            scopes: scopes ?? null,
            expires_at: expires_at ?? null,
            last_error: null,
        };
        const { error } = await supabase_1.serviceClient
            .from('integrations')
            .upsert(row, { onConflict: 'organisation_id,provider' });
        if (error) throw new Error(error.message);
    },
    async markFailed(orgId, provider, last_error) {
        const { error } = await supabase_1.serviceClient
            .from('integrations')
            .update({ status: 'failed', last_error })
            .eq('organisation_id', orgId)
            .eq('provider', provider);
        if (error) throw new Error(error.message);
    },
    async markRevoked(orgId, provider) {
        const { error } = await supabase_1.serviceClient
            .from('integrations')
            .update({ status: 'revoked', secrets: null })
            .eq('organisation_id', orgId)
            .eq('provider', provider);
        if (error) throw new Error(error.message);
    },
    // Optimistic refresh guard. Atomically claims the row by stamping
    // refresh_in_progress_at=now() ONLY if it's unset or older than staleMs
    // (a previous refresh that crashed without clearing). The UPDATE...WHERE is
    // atomic in Postgres, so a concurrent second caller matches 0 rows and backs
    // off — preventing two refreshes from racing on GHL's single-use token.
    // Returns true if THIS caller claimed the refresh.
    async claimRefresh(orgId, provider, staleMs = 120000) {
        const cutoff = new Date(Date.now() - staleMs).toISOString();
        const { data, error } = await supabase_1.serviceClient
            .from('integrations')
            .update({ refresh_in_progress_at: new Date().toISOString() })
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .or(`refresh_in_progress_at.is.null,refresh_in_progress_at.lt.${cutoff}`)
            .select('id');
        if (error) throw new Error(error.message);
        return (data?.length ?? 0) > 0;
    },
    async clearRefresh(orgId, provider) {
        await supabase_1.serviceClient
            .from('integrations')
            .update({ refresh_in_progress_at: null })
            .eq('organisation_id', orgId)
            .eq('provider', provider);
    },
    async setSyncTime(orgId, provider) {
        await supabase_1.serviceClient
            .from('integrations')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('organisation_id', orgId)
            .eq('provider', provider);
    },
    async remove(orgId, id) {
        await supabase_1.serviceClient
            .from('integrations')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
};

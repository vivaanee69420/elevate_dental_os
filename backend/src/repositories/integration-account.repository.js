// ============================================================================
// Integration-account repository — per-subaccount credential store. Today only
// GoHighLevel uses it (one row per GHL Location, mapped 1:1 to a practice).
// Secrets are pre-encrypted before reaching here; read methods that face the API
// NEVER select the secrets column. Every query carries organisation_id (no RLS
// on the serviceClient path).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Columns safe to return to the API (no secrets).
const SAFE_COLS = 'id, provider, external_account_id, practice_id, label, status, last_sync_at, last_error, config, webhook_token, created_at, updated_at';

export const integrationAccountRepository = {
    // Indirection so tests can stub the client.
    _client() { return supabase_1.serviceClient; },

    async list(orgId, provider) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .order('created_at', { ascending: true });
        return data ?? [];
    },

    // Full row INCLUDING secrets — for sync only, never returned by a controller.
    async getByIdWithSecrets(orgId, id) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
        return data;
    },

    async getById(orgId, id) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
        return data;
    },

    async getByLocation(orgId, provider, locationId) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .eq('external_account_id', String(locationId))
            .maybeSingle();
        return data;
    },

    // Upsert a per-company account row keyed by its external id (QB realmId).
    // Updates secrets/config/status if the company is already connected, else
    // inserts. Returns the account id. Used by the QuickBooks OAuth callback.
    async upsertByExternalId(orgId, provider, externalId, fields) {
        const existing = await this.getByLocation(orgId, provider, externalId);
        if (existing) {
            await this.update(orgId, existing.id, fields);
            return existing.id;
        }
        const row = await this.insert(orgId, { provider, external_account_id: String(externalId), ...fields });
        return row.id;
    },

    // Per-account rotating-refresh-token claim (optimistic, JSONB-flag based).
    // Only the caller that flips config.refreshing from falsey -> true proceeds;
    // mirrors integration.repository.claimRefresh for the single-row path.
    async claimRefresh(orgId, id) {
        const row = await this.getByIdWithSecrets(orgId, id);
        if (!row || row.config?.refreshing) return false;
        await this.mergeConfig(orgId, id, { refreshing: true });
        return true;
    },
    async clearRefresh(orgId, id) {
        await this.mergeConfig(orgId, id, { refreshing: false });
    },

    // Webhook routing — resolves an account from its random token (no org filter:
    // the token IS the credential). Returns the full row including practice_id.
    async getByWebhookToken(token) {
        if (!token) return null;
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('webhook_token', token)
            .maybeSingle();
        return data;
    },

    async insert(orgId, fields) {
        const row = { organisation_id: orgId, ...fields };
        const { data, error } = await this._client()
            .from('integration_accounts')
            .insert(row)
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async update(orgId, id, patch) {
        const { data, error } = await this._client()
            .from('integration_accounts')
            .update(patch)
            .eq('organisation_id', orgId)
            .eq('id', id)
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    // Shallow-merge a JSONB config patch (preserve other keys, e.g. stage_mappings).
    async mergeConfig(orgId, id, patch) {
        const { data: existing } = await this._client()
            .from('integration_accounts')
            .select('config')
            .eq('organisation_id', orgId).eq('id', id).maybeSingle();
        const config = { ...(existing?.config ?? {}), ...patch };
        const { error } = await this._client()
            .from('integration_accounts')
            .update({ config })
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
        return config;
    },

    async markSynced(orgId, id) {
        const { error } = await this._client()
            .from('integration_accounts')
            .update({ last_sync_at: new Date().toISOString(), last_error: null, status: 'active' })
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
    },

    async markFailed(orgId, id, lastError) {
        const { error } = await this._client()
            .from('integration_accounts')
            .update({ status: 'failed', last_error: String(lastError).slice(0, 500) })
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
    },

    async markRevoked(orgId, id) {
        const { error } = await this._client()
            .from('integration_accounts')
            .update({ status: 'revoked', secrets: null })
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
    },

    // All active GHL accounts across every org — for the worker.
    async listAllActive(provider) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('provider', provider)
            .eq('status', 'active');
        return data ?? [];
    },
};

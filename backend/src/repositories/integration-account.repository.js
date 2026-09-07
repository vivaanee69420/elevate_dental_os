// ============================================================================
// Integration-account repository — per-subaccount credential store. Today only
// GoHighLevel uses it (one row per GHL Location, mapped 1:1 to a practice).
// Secrets are pre-encrypted before reaching here; read methods that face the API
// NEVER select the secrets column. Every query carries organisation_id (no RLS
// on the serviceClient path).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { AppError, assertNotDuplicatePracticeMapping } from "../middleware/errors.js";

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
        if (error) {
            // 23505 = unique_violation. Callers are expected to pre-check for
            // a live duplicate (getByLocation) before ever reaching here, but
            // a race between that check and this insert is still possible —
            // and a bare Error on a duplicate is masked by errorHandler as an
            // opaque "Internal server error", which is exactly what happened
            // before addAccount had a pre-check at all (CallRail's
            // "disconnect and reconnect" flow hit this). Surface it as
            // something the owner can act on instead.
            if (error.code === '23505') {
                throw new AppError('That account is already connected', 409);
            }
            throw new Error(error.message);
        }
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
        assertNotDuplicatePracticeMapping(error, 'GoHighLevel or CallRail account');
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

    /**
     * Newest per-account sync time, keyed by provider.
     *
     * GoHighLevel, QuickBooks and CallRail keep their credentials per account,
     * and their syncers stamp the ACCOUNT row — never the `integrations`
     * marker row the Integrations cards read. The parent's `last_sync_at` only
     * moves when someone runs a provider-level sync, so a nightly poll that
     * ran two hours ago was being reported as "synced 86d ago" while data
     * arrived normally underneath.
     *
     * Revoked accounts are excluded deliberately: they are paused on purpose,
     * so how long ago one last ran says nothing about whether the connection
     * is healthy. A 'failed' account IS counted — its last successful run is
     * still the honest answer to "when did this last sync", and the failure
     * surfaces through status/last_error rather than by freezing the clock.
     */
    async newestSyncByProvider(orgId) {
        const { data, error } = await this._client()
            .from('integration_accounts')
            .select('provider, last_sync_at')
            .eq('organisation_id', orgId)
            .neq('status', 'revoked')
            .not('last_sync_at', 'is', null);
        if (error) throw new Error(error.message);
        const newest = new Map();
        for (const row of data ?? []) {
            const at = Date.parse(row.last_sync_at);
            if (Number.isNaN(at)) continue;
            const cur = newest.get(row.provider);
            // Compare as instants, not strings: the two can carry different
            // UTC offsets and would then sort by text rather than by time.
            if (!cur || at > Date.parse(cur)) newest.set(row.provider, row.last_sync_at);
        }
        return newest;
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

    // Permanently remove the row. ORG-SCOPED, always — a bare delete by id is
    // one typo away from another tenant's account. Callers must go through
    // integration-account-delete.service, which checks what the row owns first:
    // seven of the eleven foreign keys onto this table are ON DELETE CASCADE.
    async deleteById(orgId, id) {
        const { error } = await this._client()
            .from('integration_accounts')
            .delete()
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
        return true;
    },

    // What a delete of this account would take with it, counted per table.
    //
    // `cascade` is the rows the database would DESTROY (ON DELETE CASCADE);
    // `detach` is the rows that survive and merely lose their account
    // attribution (ON DELETE SET NULL). The split is the whole point: one is a
    // decision the owner has to make in front of the numbers, the other is
    // information. Tables are listed here rather than read from the catalogue
    // so that adding a new cascading FK without thinking about this code shows
    // up as a missing count in review, not as silent data loss in production.
    //
    // Counted with head:true + count:'exact' — the count comes back in the
    // Content-Range header, so no rows cross the wire and PostgREST's 1000-row
    // ceiling cannot truncate the answer.
    async ownedRowCounts(orgId, id) {
        const CASCADE_TABLES = [
            'invoices', 'payments', 'monthly_financials', 'ghl_appointments',
            'bank_accounts', 'bank_balance_snapshots', 'ad_channel_pipelines',
        ];
        const DETACH_TABLES = ['contacts', 'leads', 'communications', 'callrail_calls'];
        const countIn = async (table) => {
            const { count, error } = await this._client()
                .from(table)
                .select('id', { count: 'exact', head: true })
                .eq('organisation_id', orgId)
                .eq('integration_account_id', id);
            if (error) throw new Error(error.message);
            return Number(count || 0);
        };
        const tally = async (tables) => {
            const out = {};
            for (const t of tables) {
                const n = await countIn(t);
                // Only non-zero entries: a refusal listing eleven zeroes tells
                // the owner nothing about what is actually in the way.
                if (n > 0) out[t] = n;
            }
            return out;
        };
        return { cascade: await tally(CASCADE_TABLES), detach: await tally(DETACH_TABLES) };
    },

    async markRevoked(orgId, id) {
        const { error } = await this._client()
            .from('integration_accounts')
            .update({ status: 'revoked', secrets: null })
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
    },

    // Every account the worker should attempt across all orgs. Includes
    // 'failed' on purpose: markFailed flips the row on ANY sync error, and when
    // this filtered to 'active' only, one transient upstream blip removed a
    // subaccount from every future nightly run — it sat on a red "failed" badge
    // indefinitely (July 2026 incident, 5 of 7 GHL subaccounts frozen for over
    // a week). markSynced flips it back to 'active', so a failed account now
    // self-heals on the next successful run. Mirrors the google_ads/meta_ads
    // workers, which already select ['active','failed']. 'revoked' stays out —
    // the user disconnected it and its secrets are gone.
    async listAllSyncable(provider) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('provider', provider)
            .in('status', ['active', 'failed']);
        return data ?? [];
    },
};

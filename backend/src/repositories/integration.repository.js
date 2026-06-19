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
            .select('id, provider, status, last_sync_at, last_error, config, webhook_last_result, verified_at, scopes, expires_at, created_at, updated_at')
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
        // Shallow-merge into the existing config instead of replacing it. A full
        // replace silently wiped per-org config keys the incoming token payload
        // doesn't carry — critically `webhook_secret`/`webhook_id`. Every OAuth
        // token refresh runs through here, so the secret vanished on the first
        // refresh after pairing, every real-time webhook delivery then 401'd
        // ("webhook secret not configured"), and the provider auto-disabled the
        // hook after ~50 failures. Merge keeps secrets/base_url/cursors paired
        // across refresh and reconnect. New keys in `config` still win.
        const existing = await this.getByProvider(orgId, provider);
        const row = {
            organisation_id: orgId,
            provider,
            config: { ...(existing?.config ?? {}), ...(config ?? {}) },
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
    // Shallow-merge a patch into the JSONB config without clobbering other keys
    // (e.g. set webhook_secret while preserving base_url).
    async mergeConfig(orgId, provider, patch) {
        const existing = await this.getByProvider(orgId, provider);
        if (!existing) throw new Error(`${provider} not connected`);
        const config = { ...(existing.config ?? {}), ...patch };
        const { error } = await supabase_1.serviceClient
            .from('integrations')
            .update({ config })
            .eq('organisation_id', orgId)
            .eq('provider', provider);
        if (error) throw new Error(error.message);
        return config;
    },
    // Record the outcome of the most recent inbound real-time webhook delivery.
    // Single atomic UPDATE on a dedicated column — deliberately NOT a config
    // merge, so it can never clobber webhook_secret/cursors (the exact failure
    // mode this whole diagnostic exists to surface). Best-effort: callers wrap
    // it so a recording blip never fails the delivery itself.
    async recordWebhookResult(orgId, provider, result) {
        await supabase_1.serviceClient
            .from('integrations')
            .update({ webhook_last_result: result })
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

    // ---- Ad accounts (Google Ads / Meta Ads) dimension + selection ----------
    // The connectors discover every accessible account and upsert it here; the
    // marketing read paths filter ad_metrics to the SELECTED accounts. All
    // queries carry organisation_id (tenant isolation on the serviceClient path).

    // Upsert discovered accounts. `accounts` = [{ customer_id, name, currency,
    // status }]. is_selected is preserved on conflict (don't re-select an account
    // the owner has deselected); new accounts default to selected via the column
    // default. customer_id+provider+org is the unique key.
    async upsertAdAccounts(orgId, provider, accounts) {
        const rows = (accounts ?? [])
            .filter((a) => a && a.customer_id)
            .map((a) => ({
                organisation_id: orgId,
                provider,
                customer_id: String(a.customer_id),
                name: a.name ?? null,
                currency: a.currency ?? null,
                status: a.status ?? null,
            }));
        if (rows.length === 0) return [];
        const { data, error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .upsert(rows, { onConflict: 'organisation_id,provider,customer_id', ignoreDuplicates: false })
            .select('customer_id, name, currency, status, is_selected');
        if (error) throw new Error(`ad_accounts upsert: ${error.message}`);
        return data ?? [];
    },

    // All accounts for an org (optionally one provider), for the selector UI.
    async listAdAccounts(orgId, provider = null) {
        let q = supabase_1.serviceClient
            .from('ad_accounts')
            .select('provider, customer_id, name, currency, status, is_selected, practice_id, period_reach, period_frequency, period_impressions, period_window_start, period_window_end, period_synced_at')
            .eq('organisation_id', orgId)
            .order('provider', { ascending: true })
            .order('name', { ascending: true });
        if (provider) q = q.eq('provider', provider);
        const { data } = await q;
        return data ?? [];
    },

    // Persist the selection: mark the given customer_ids selected, the rest not.
    // Scoped to one provider so selecting Meta accounts never touches Google.
    async setAdAccountSelection(orgId, provider, selectedIds) {
        const selected = new Set((selectedIds ?? []).map(String));
        const existing = await this.listAdAccounts(orgId, provider);
        // One UPDATE per desired state (two statements, not N) keeps it cheap.
        const toSelect = existing.filter((a) => selected.has(a.customer_id)).map((a) => a.customer_id);
        const toDeselect = existing.filter((a) => !selected.has(a.customer_id)).map((a) => a.customer_id);
        if (toSelect.length) {
            const { error } = await supabase_1.serviceClient
                .from('ad_accounts').update({ is_selected: true })
                .eq('organisation_id', orgId).eq('provider', provider)
                .in('customer_id', toSelect);
            if (error) throw new Error(`ad_accounts select: ${error.message}`);
        }
        if (toDeselect.length) {
            const { error } = await supabase_1.serviceClient
                .from('ad_accounts').update({ is_selected: false })
                .eq('organisation_id', orgId).eq('provider', provider)
                .in('customer_id', toDeselect);
            if (error) throw new Error(`ad_accounts deselect: ${error.message}`);
        }
        return this.listAdAccounts(orgId, provider);
    },

    // Selected customer_ids for the read filter. provider = null spans both ad
    // providers (the cross-channel marketing views). Returns null when the org
    // has NO ad_accounts rows yet (pre-migration / never synced) so callers can
    // fall back to "no account filter" rather than filtering to an empty set.
    async selectedAdAccountIds(orgId, provider = null) {
        let q = supabase_1.serviceClient
            .from('ad_accounts')
            .select('customer_id, is_selected')
            .eq('organisation_id', orgId);
        if (provider) q = q.eq('provider', provider);
        const { data } = await q;
        if (!data || data.length === 0) return null;
        return data.filter((a) => a.is_selected).map((a) => a.customer_id);
    },
};

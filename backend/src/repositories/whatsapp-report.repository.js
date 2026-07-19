import * as supabase_1 from "../lib/supabase.js";
import * as crypto_1 from "../lib/crypto.js";

const TABLE = 'whatsapp_report_settings';
const COLS = 'organisation_id, webhook_url, enabled, last_sent_at, last_status, last_error';

function toDomain(row) {
    if (!row) return null;
    return {
        organisationId: row.organisation_id,
        webhookUrl: crypto_1.decryptSecret(row.webhook_url),
        enabled: row.enabled === true,
        lastSentAt: row.last_sent_at ?? null,
        lastStatus: row.last_status ?? null,
        lastError: row.last_error ?? null,
    };
}

export const whatsappReportRepository = {
    // Indirection so tests can stub the client.
    _client() { return supabase_1.serviceClient; },

    async get(orgId) {
        const { data } = await this._client()
            .from(TABLE)
            .select(COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        return toDomain(data);
    },

    async upsert(orgId, { webhookUrl, enabled }) {
        const { data } = await this._client()
            .from(TABLE)
            .upsert({
                organisation_id: orgId,
                webhook_url: crypto_1.encryptSecret(webhookUrl),
                enabled: enabled === true,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id' })
            .select(COLS)
            .maybeSingle();
        return toDomain(data);
    },

    // Cron use: every org with the report switched on, across all tenants.
    async listEnabled() {
        const { data } = await this._client()
            .from(TABLE)
            .select(COLS)
            .eq('enabled', true);
        return (data ?? []).map(toDomain);
    },

    async markSent(orgId, { status, error = null, payload = null, sentAt }) {
        await this._client()
            .from(TABLE)
            .update({
                last_sent_at: sentAt,
                last_status: status,
                last_error: error,
                last_payload: payload,
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId);
    },
};

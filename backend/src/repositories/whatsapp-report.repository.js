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

    // Partial update for a row that already exists: flips `enabled` only,
    // leaving the stored (encrypted) webhook_url untouched. Deliberately a
    // separate path from `upsert` above — `upsert` always writes webhook_url,
    // and encryptSecret(undefined) returns null, which the NOT NULL column
    // would reject (or silently wipe the secret if it didn't). Never call
    // this for a row that doesn't exist yet: there would be nothing to send
    // to, and the caller is expected to have checked via `get` first.
    async updateEnabled(orgId, enabled) {
        const { data } = await this._client()
            .from(TABLE)
            .update({
                enabled: enabled === true,
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId)
            .select(COLS)
            .maybeSingle();
        return toDomain(data);
    },

    // Cron use: every org with the report switched on, across all tenants.
    // One organisation's undecryptable row (key rotation, manual DB edit)
    // must not abort every other organisation's daily report.
    async listEnabled() {
        const { data } = await this._client()
            .from(TABLE)
            .select(COLS)
            .eq('enabled', true);
        const rows = [];
        for (const row of data ?? []) {
            try {
                rows.push(toDomain(row));
            } catch (err) {
                console.error(
                    `[whatsapp-report] failed to decrypt webhook_url for organisation ${row?.organisation_id}, skipping`,
                    err,
                );
            }
        }
        return rows;
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

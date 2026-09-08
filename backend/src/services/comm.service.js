// ============================================================================
// Comm service — business logic for the communications domain.
// Orchestrates the repository + outbound providers; throws AppError for
// client-visible failures.
// ============================================================================
import * as comm_repository_1 from "../repositories/comm.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as messaging_1 from "../lib/messaging.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { sendMessage as ghlSendMessage } from "../lib/integrations/gohighlevel-conversations.js";
import { sendAuthForContact } from "../lib/integrations/gohighlevel-sync.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { decryptSecret } from "../lib/crypto.js";
import * as supabase_1 from "../lib/supabase.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
// A thread key is 'c:<uuid>' (contact), 'l:<uuid>' (lead) or
// 'a:<channel>:<address>' (neither — an address-only conversation). Mirrors
// groupIntoThreads() in InboxScreen.tsx, which is what produced the key.
export function parseThreadKey(key) {
    if (typeof key !== 'string' || key.length < 3) return null;
    if (key.startsWith('c:')) return { contactId: key.slice(2) };
    if (key.startsWith('l:')) return { leadId: key.slice(2) };
    if (key.startsWith('a:')) {
        // channel may not contain ':', the address may — split once only.
        const rest = key.slice(2);
        const i = rest.indexOf(':');
        if (i < 0) return null;
        return { channel: rest.slice(0, i) || null, counterparty: rest.slice(i + 1) || null };
    }
    return null;
}

export const commService = {
    list(orgId, q, viewer) {
        return comm_repository_1.commRepository.list(orgId, q, viewer);
    },
    // Inbox page: one page of threads plus the organisation-wide totals.
    //
    // `total` is the count of threads MATCHING the current filters (returned by
    // the window function inside the RPC), while `summary` counts the whole
    // inbox. They answer different questions and the screen shows both — "12 of
    // 340 matching" beside a 5,753 unread badge — so neither is inferred from
    // the length of the page, which is what made the old figures wrong.
    async inbox(orgId, viewer, q = {}) {
        const [rows, summary] = await Promise.all([
            comm_repository_1.commRepository.inboxThreads(orgId, viewer, q),
            comm_repository_1.commRepository.inboxSummary(orgId, viewer, q.integration_account_id ?? null),
        ]);
        const total = rows.length > 0 ? Number(rows[0].total_threads) : 0;
        return {
            threads: rows.map((r) => ({
                thread_key: r.thread_key,
                contact_id: r.contact_id,
                lead_id: r.lead_id,
                channel: r.channel,
                counterparty: r.counterparty,
                contact_first_name: r.contact_first_name,
                contact_last_name: r.contact_last_name,
                last_at: r.last_at,
                last_subject: r.last_subject,
                last_body: r.last_body,
                message_count: Number(r.message_count) || 0,
                unread_count: Number(r.unread_count) || 0,
            })),
            total,
            limit: q.limit ?? 50,
            offset: q.offset ?? 0,
            summary: {
                total_messages: Number(summary?.total_messages) || 0,
                total_threads: Number(summary?.total_threads) || 0,
                unread_messages: Number(summary?.unread_messages) || 0,
                unread_threads: Number(summary?.unread_threads) || 0,
            },
        };
    },
    // Every message in one conversation, for the reading pane.
    async thread(orgId, viewer, key) {
        const parsed = parseThreadKey(key);
        if (!parsed) throw new errors_1.AppError('Unknown conversation', 400);
        const rows = await comm_repository_1.commRepository.threadMessages(orgId, parsed);
        // The repository already filters on organisation_id, so these rows are
        // ours. Visibility is the second gate, applied exactly as list() does —
        // an owner sees everything, anyone else sees org-wide rows, rows aimed
        // at their role or themselves, and anything assigned to them.
        if (!viewer || viewer.role === 'owner') return { messages: rows };
        const allowed = new Set(['org', `role:${viewer.role}`, `user:${viewer.id}`]);
        return {
            messages: rows.filter((r) => allowed.has(r.visibility ?? 'org')
                || r.assigned_user_id === viewer.id),
        };
    },
    async send(orgId, input, log) {
        // The Inbox embeds `contact:contacts(...)` on read, so storing a
        // foreign contact_id would disclose that patient's name and email.
        // Validate before any send work happens.
        await assertOrgOwns(orgId, 'contacts', input.contact_id, 'Contact');
        await assertOrgOwns(orgId, 'leads', input.lead_id, 'Lead');
        let externalId;
        let provider = 'native';
        let conversationId = null;
        // Prefer GoHighLevel when the target contact is GHL-linked and we can
        // resolve the credential for ITS subaccount — the reply then goes out
        // through that Location's own number/email and threads where the
        // conversation already lives (and back into our Inbox via
        // syncConversations). Otherwise fall back to the native Twilio/Postmark
        // providers: a patient still gets the message.
        let ghlContactId = null;
        let ghlToken = null;
        if (input.contact_id) {
            // Two credential stores, and most orgs have only one of them: the
            // per-Location `integration_accounts` rows the sync actually uses,
            // and the legacy single `integrations` row. Ask both before
            // touching contacts, so an org with no GoHighLevel at all still
            // costs the same two cheap reads it always did.
            const [marker, accounts] = await Promise.all([
                integrationRepository.getByProvider(orgId, 'gohighlevel'),
                integrationAccountRepository.list(orgId, 'gohighlevel'),
            ]);
            const markerUsable = marker?.status === 'active' && !!marker.secrets;
            const anyAccount = accounts.some((a) => a.status !== 'revoked');
            if (markerUsable || anyAccount) {
                const { data } = await supabase_1.serviceClient.from('contacts')
                    .select('ghl_contact_id, integration_account_id')
                    .eq('organisation_id', orgId).eq('id', input.contact_id).maybeSingle();
                ghlContactId = data?.ghl_contact_id ?? null;
                if (ghlContactId) {
                    // The contact's OWN subaccount first — a GHL contact belongs
                    // to one Location, so this is the only credential that can
                    // thread the reply where the conversation already lives.
                    // Refreshed on the way out if it is an OAuth account.
                    ghlToken = await sendAuthForContact(orgId, data);
                    // Legacy single-connection orgs, unchanged: one row, one
                    // Location, and no account rows to disambiguate.
                    if (!ghlToken && markerUsable) {
                        ghlToken = JSON.parse(decryptSecret(marker.secrets)).access_token ?? null;
                    }
                }
            }
        }
        try {
            if (ghlContactId && ghlToken) {
                const r = await ghlSendMessage(orgId, ghlToken, {
                    contactId: ghlContactId, channel: input.channel, body: input.body, subject: input.subject,
                });
                externalId = r.messageId;
                conversationId = r.conversationId;
                provider = 'gohighlevel';
            }
            else if (input.channel === 'email') {
                const r = await messaging_1.sendEmail({ orgId, to: input.to, subject: input.subject || '', body: input.body });
                externalId = r.external_id;
            }
            else if (input.channel === 'sms') {
                const r = await messaging_1.sendSMS({ orgId, to: input.to, body: input.body });
                externalId = r.external_id;
            }
            else {
                throw new errors_1.AppError(`Channel ${input.channel} needs a connected GoHighLevel contact`, 400);
            }
        }
        catch (err) {
            log?.error?.({ err }, 'Send failed');
            throw err instanceof errors_1.AppError ? err : new errors_1.AppError(err.message || 'Send failed', 500);
        }
        const { data, error } = await comm_repository_1.commRepository.create({
            organisation_id: orgId,
            contact_id: input.contact_id,
            lead_id: input.lead_id,
            channel: input.channel,
            direction: 'outbound',
            subject: input.subject,
            body: input.body,
            to_address: input.to,
            external_id: externalId,
            delivery_status: 'sent',
            metadata: provider === 'gohighlevel' ? { provider, conversationId } : {},
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};

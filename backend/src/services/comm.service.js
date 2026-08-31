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
import * as supabase_1 from "../lib/supabase.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
export const commService = {
    list(orgId, q, viewer) {
        return comm_repository_1.commRepository.list(orgId, q, viewer);
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
        // Prefer GoHighLevel when the target contact is GHL-linked and GHL is
        // connected — the reply goes out through GHL's number/email and threads
        // in GHL (and back into our Inbox via syncConversations). Otherwise fall
        // back to the native Twilio/Postmark providers.
        let ghlContactId = null;
        let ghlIntegration = null;
        if (input.contact_id) {
            ghlIntegration = await integrationRepository.getByProvider(orgId, 'gohighlevel');
            if (ghlIntegration?.status === 'active' && ghlIntegration?.secrets) {
                const { data } = await supabase_1.serviceClient.from('contacts')
                    .select('ghl_contact_id').eq('organisation_id', orgId).eq('id', input.contact_id).maybeSingle();
                ghlContactId = data?.ghl_contact_id ?? null;
            }
        }
        try {
            if (ghlContactId) {
                const r = await ghlSendMessage(orgId, ghlIntegration, {
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

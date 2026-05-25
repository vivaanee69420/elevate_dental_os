// ============================================================================
// Comm service — business logic for the communications domain.
// Orchestrates the repository + outbound providers; throws AppError for
// client-visible failures.
// ============================================================================
import * as comm_repository_1 from "../repositories/comm.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as messaging_1 from "../lib/messaging.js";
export const commService = {
    list(orgId, q, viewer) {
        return comm_repository_1.commRepository.list(orgId, q, viewer);
    },
    async send(orgId, input, log) {
        let externalId;
        try {
            if (input.channel === 'email') {
                const r = await messaging_1.sendEmail({ orgId, to: input.to, subject: input.subject || '', body: input.body });
                externalId = r.external_id;
            }
            else if (input.channel === 'sms') {
                const r = await messaging_1.sendSMS({ orgId, to: input.to, body: input.body });
                externalId = r.external_id;
            }
        }
        catch (err) {
            log?.error?.({ err }, 'Send failed');
            throw new errors_1.AppError('Send failed', 500);
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
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};

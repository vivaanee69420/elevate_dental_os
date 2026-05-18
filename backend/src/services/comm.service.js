"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commService = void 0;
// ============================================================================
// Comm service — business logic for the communications domain.
// Orchestrates the repository + outbound providers; throws AppError for
// client-visible failures.
// ============================================================================
const comm_repository_1 = require("../repositories/comm.repository");
const errors_1 = require("../middleware/errors");
const postmark_1 = require("../lib/postmark");
const twilio_1 = require("../lib/twilio");
exports.commService = {
    list(orgId, q) {
        return comm_repository_1.commRepository.list(orgId, q);
    },
    async send(orgId, input, log) {
        let externalId;
        try {
            if (input.channel === 'email') {
                externalId = await (0, postmark_1.sendEmail)({ to: input.to, subject: input.subject || '', body: input.body });
            }
            else if (input.channel === 'sms') {
                externalId = await (0, twilio_1.sendSMS)({ to: input.to, body: input.body });
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

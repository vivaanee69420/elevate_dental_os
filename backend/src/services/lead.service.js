// ============================================================================
// Lead service — business logic for the leads domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as lead_repository_1 from "../repositories/lead.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as lead_model_1 from "../models/lead.model.js";
export const leadService = {
    list(orgId, q) {
        return lead_repository_1.leadRepository.list(orgId, q);
    },
    async getById(orgId, id) {
        const { data, error } = await lead_repository_1.leadRepository.getById(orgId, id);
        if (error || !data)
            throw new errors_1.AppError('Not found', 404);
        return data;
    },
    async create(orgId, input) {
        let contactId = input.contact_id;
        if (!contactId && input.contact) {
            const { data: contact, error: contactErr } = await lead_repository_1.leadRepository.createContact(orgId, input.practice_id, input.contact);
            if (contactErr)
                throw new errors_1.AppError(contactErr.message, 400);
            contactId = contact.id;
        }
        if (!contactId) {
            throw new errors_1.AppError('Must provide contact_id or contact data', 400);
        }
        const { data, error } = await lead_repository_1.leadRepository.create({
            organisation_id: orgId,
            contact_id: contactId,
            practice_id: input.practice_id,
            treatment: input.treatment,
            estimated_value_pence: input.estimated_value_pence,
            source: input.source,
            utm_source: input.utm_source,
            utm_medium: input.utm_medium,
            utm_campaign: input.utm_campaign,
            status: 'new',
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        // TODO: enqueue workflow_run for 'lead_created' triggers
        return data;
    },
    async update(orgId, id, patch) {
        const { data, error } = await lead_repository_1.leadRepository.update(orgId, id, patch);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async softDelete(orgId, id) {
        const { error } = await lead_repository_1.leadRepository.softDelete(orgId, id);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return { success: true };
    },
    async funnel(orgId) {
        const rows = await lead_repository_1.leadRepository.funnelRows(orgId);
        const funnel = {};
        for (const status of lead_model_1.LEAD_STATUSES)
            funnel[status] = { count: 0, value: 0 };
        for (const lead of rows || []) {
            funnel[lead.status].count++;
            funnel[lead.status].value += lead.estimated_value_pence;
        }
        return { funnel };
    },
};

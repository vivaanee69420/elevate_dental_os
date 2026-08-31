// ============================================================================
// Lead service — business logic for the leads domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as lead_repository_1 from "../repositories/lead.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as lead_model_1 from "../models/lead.model.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
export const leadService = {
    list(orgId, q) {
        return lead_repository_1.leadRepository.list(orgId, q);
    },
    // GoHighLevel pipeline definitions (id/name + ordered stages), cached on each
    // subaccount's config by the sync. Drives the dynamic Pipeline-screen columns.
    // CRM-accessible (reception/staff use the Pipeline screen), so it lives here
    // rather than the owner-only integrations routes.
    //
    // Pipeline ids are per GHL Location, so these MUST be scoped to the selected
    // subaccount: an org with several Locations connected has a disjoint pipeline
    // set per Location, and a lead only ever carries its own Location's pipeline
    // id. With no subaccount selected ("All subaccounts") we union them, deduped
    // by id. The legacy org-level `integrations` config — a single Location's
    // pipelines — is only the fallback for orgs with no accounts row.
    async pipelines(orgId, q = {}) {
        const accountId = q.integration_account_id ?? null;
        const accounts = await integrationAccountRepository.list(orgId, 'gohighlevel');
        let defs;
        if (accounts.length) {
            const scoped = accountId ? accounts.filter((a) => a.id === accountId) : accounts;
            const byId = new Map();
            for (const account of scoped) {
                for (const pipeline of account.config?.pipelines ?? []) {
                    if (pipeline?.id && !byId.has(pipeline.id))
                        byId.set(pipeline.id, pipeline);
                }
            }
            defs = [...byId.values()];
        }
        else if (accountId) {
            return { pipelines: [] };
        }
        else {
            const integration = await integrationRepository.getByProvider(orgId, 'gohighlevel');
            defs = integration?.config?.pipelines ?? [];
        }
        if (!defs.length)
            return { pipelines: [] };
        // Busiest first: a Location can carry 60+ pipelines, most of them empty or
        // archived, and GHL's own order routinely puts a 1-lead pipeline first —
        // which reads as "the board is broken". Sort is stable, so pipelines with
        // equal counts keep GHL's order.
        const counts = await lead_repository_1.leadRepository.pipelineCounts(orgId, accountId);
        const byPipeline = new Map(counts.map((c) => [String(c.ghl_pipeline_id), c]));
        return {
            pipelines: defs
                .map((p) => ({
                ...p,
                lead_count: Number(byPipeline.get(String(p.id))?.lead_count ?? 0),
                value_pence: Number(byPipeline.get(String(p.id))?.value_pence ?? 0),
            }))
                .sort((a, b) => b.lead_count - a.lead_count),
        };
    },
    async getById(orgId, id) {
        const { data, error } = await lead_repository_1.leadRepository.getById(orgId, id);
        if (error || !data)
            throw new errors_1.AppError('Not found', 404);
        return data;
    },
    async create(orgId, input) {
        // Leads embed contact + practice on read, so both ids must be ours.
        await assertOrgOwns(orgId, 'contacts', input.contact_id, 'Contact');
        await assertOrgOwns(orgId, 'practices', input.practice_id, 'Practice');
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

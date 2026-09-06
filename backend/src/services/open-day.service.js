// ============================================================================
// Open days — create the event, choose the campaigns that promoted it.
//
// Deliberately thin. The REPORTING side of open days lives in
// facebook-report.service.js, which reads the same two tables and buckets the
// campaign rows it already has; this file only manages the mapping itself.
// Keeping them apart means the report cannot accidentally depend on write-path
// state, and this file needs to know nothing about spend or leads.
//
// ACCESS, and why it differs from every other mapping here. Ad-account ->
// practice, Emergent -> practice and the GHL practice field are all
// requireAgencyActor-gated: they decide how an agency's client data is
// attributed, so the agency owns them. An open day is the TENANT'S OWN EVENT —
// they know when they ran it and which campaigns promoted it, and having to
// ask their agency to record it would make the feature useless. So writes here
// are requireRole('owner') instead. That is a considered exception, not an
// oversight; see docs/ISOLATION_AUDIT.md for the rule it departs from.
// ============================================================================
import { openDayRepository } from "../repositories/open-day.repository.js";
import { marketingRepository } from "../repositories/marketing.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { AppError } from "../middleware/errors.js";
import { suggestOpenDay } from "../lib/marketing/open-day-suggest.js";

const PROVIDER = 'meta_ads';

export const openDayService = {
    // The management screen's whole payload: the events, which campaigns each
    // one owns, and the catalogue to pick from.
    //
    // The catalogue is EVERY campaign the org has ever had metrics for, not
    // just the current window's. An owner recording last November's open day
    // is reaching for campaigns that stopped running months ago; offering only
    // the selected period would hide exactly the ones they came to map.
    async list(orgId) {
        const [events, mappings, campaigns, pipelineMappings] = await Promise.all([
            openDayRepository.list(orgId),
            openDayRepository.mappings(orgId, PROVIDER),
            marketingRepository.campaignCatalogue(orgId, PROVIDER),
            openDayRepository.pipelineMappings(orgId),
        ]);
        const byEvent = new Map();
        for (const m of mappings) {
            if (!byEvent.has(m.openDayId)) byEvent.set(m.openDayId, []);
            byEvent.get(m.openDayId).push(m.campaignId);
        }
        // Which event each campaign already belongs to, so the picker can show
        // "already mapped to April 26" instead of letting an owner silently
        // move a campaign and wonder why another event's numbers dropped.
        const assignedTo = Object.fromEntries(
            mappings.map((m) => [m.campaignId, m.openDayId]),
        );
        // Keyed accountId|pipelineId because a bare pipeline id collides
        // across subaccounts.
        const pipelineAssignedTo = Object.fromEntries(
            pipelineMappings.map((m) => [
                `${m.integrationAccountId}|${m.ghlPipelineId}`, m.openDayId,
            ]),
        );
        // A SUGGESTION, never a mapping — nothing is written here. Only
        // unmapped campaigns get one; an already-assigned campaign has
        // nothing left to propose. Reads only this org's own events/names, so
        // a tenant's naming convention never leaks into another tenant's
        // suggestions.
        const suggestions = {};
        for (const c of campaigns) {
            if (assignedTo[c.campaignId]) continue;
            const id = suggestOpenDay(c.campaignName, events);
            if (id) suggestions[c.campaignId] = id;
        }
        return {
            openDays: events.map((e) => ({ ...e, campaignIds: byEvent.get(e.id) ?? [] })),
            campaigns,
            assignedTo,
            pipelineAssignedTo,
            suggestions,
        };
    },

    async create(orgId, { name, eventDate = null }) {
        return openDayRepository.create(orgId, { name: String(name).trim(), eventDate });
    },

    async update(orgId, id, patch) {
        const next = {};
        if (patch.name !== undefined) next.name = String(patch.name).trim();
        if (patch.eventDate !== undefined) next.eventDate = patch.eventDate || null;
        await openDayRepository.update(orgId, id, next);
        return { ok: true };
    },

    async remove(orgId, id) {
        await openDayRepository.remove(orgId, id);
        return { ok: true };
    },

    // Replace the event's campaign set. A campaign already mapped to ANOTHER
    // event moves here rather than erroring — the repository upserts on the
    // primary key, which is what makes the buckets a partition at all times.
    async setCampaigns(orgId, id, campaigns) {
        return openDayRepository.setCampaigns(orgId, id, PROVIDER, campaigns);
    },

    async setPipeline(orgId, args) {
        // openDayId is already guarded by the database — ad_open_day_pipelines
        // carries FOREIGN KEY (organisation_id, open_day_id) referencing
        // ad_open_days, so a cross-org id has no matching parent and the write
        // fails outright. integrationAccountId carries no such key, so it is
        // guarded here the same way ad-attribution.service.js's
        // setPipelineChannel guards accountId: an org-scoped lookup, 404 on
        // a miss rather than the default 500 a bare Error gets.
        const account = await integrationAccountRepository.getById(orgId, args.integrationAccountId);
        if (!account) throw new AppError('Unknown subaccount', 404);
        await openDayRepository.setPipeline(orgId, args);
        return { ok: true };
    },
};

// ============================================================================
// Lead service — business logic for the leads domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as lead_repository_1 from "../repositories/lead.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as lead_model_1 from "../models/lead.model.js";
import * as date_window_1 from "../lib/date-window.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
// Reused as-is: RFC 4180 quoting (quotes/commas/newlines in a name or note)
// and the UTF-8 BOM Excel needs, exactly like the Data Room's CSV export.
// Pure string encoding, nothing Data-Room-specific about it.
import { BOM, csvLine, rowsToCsv } from "../lib/data-room/csv.js";

// Column order for the Pipeline export. Flat names for the nested
// contact/practice/assignee embeds `exportBatches` selects.
const EXPORT_COLUMNS = [
    'id', 'created_at', 'status', 'treatment', 'estimated_value_pence',
    'source', 'utm_source', 'utm_medium', 'utm_campaign',
    'ghl_pipeline_id', 'ghl_pipeline_stage_id', 'ghl_stage_name',
    'practice', 'contact_first_name', 'contact_last_name', 'contact_email',
    'contact_phone', 'assigned_to_name', 'assigned_to_email',
];
function toExportRow(l) {
    return {
        id: l.id,
        created_at: l.created_at,
        status: l.status,
        treatment: l.treatment,
        estimated_value_pence: l.estimated_value_pence,
        source: l.source,
        utm_source: l.utm_source,
        utm_medium: l.utm_medium,
        utm_campaign: l.utm_campaign,
        ghl_pipeline_id: l.ghl_pipeline_id,
        ghl_pipeline_stage_id: l.ghl_pipeline_stage_id,
        ghl_stage_name: l.ghl_stage_name,
        practice: l.practice?.name ?? '',
        contact_first_name: l.contact?.first_name ?? '',
        contact_last_name: l.contact?.last_name ?? '',
        contact_email: l.contact?.email ?? '',
        contact_phone: l.contact?.phone ?? '',
        assigned_to_name: l.assignee?.full_name ?? '',
        assigned_to_email: l.assignee?.email ?? '',
    };
}
export const leadService = {
    list(orgId, q) {
        return lead_repository_1.leadRepository.list(orgId, q);
    },
    // Filename for the Pipeline export: the pipeline it was filtered to (or
    // "all" when none was given) plus today's London date, matching the Data
    // Room's `${dataset}_${date}.csv` naming.
    exportFilename(q) {
        const pipeline = q.ghl_pipeline_id || 'all';
        const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
        return `pipeline-leads_${pipeline}_${date}.csv`;
    },
    // Stream every lead matching `q` as CSV through `sink` ({ write, end }).
    // All paging happens in the repository (`exportBatches`); this only knows
    // how to turn a page of rows into CSV text.
    async streamExportCsv(orgId, q, sink) {
        sink.write(BOM + csvLine(EXPORT_COLUMNS));
        const { rows } = await lead_repository_1.leadRepository.exportBatches(orgId, q, (batch) => {
            sink.write(rowsToCsv(EXPORT_COLUMNS, batch.map(toExportRow)));
        });
        sink.end();
        return { rows };
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
    // ------------------------------------------------------------------------
    // Lead funnel for a window — the source of truth for every funnel surface.
    //
    // Two correctness rules live here rather than in the browser, because the
    // browser got both of them wrong:
    //
    // 1. COUNT EVERY LEAD, INCLUDING LOST ONES. The stages are cumulative
    //    ("reached this stage or beyond"), so a lead's furthest point decides
    //    which stages it counts in. A lead that reached `consultation_attended`
    //    and then went `not_proceeding` still reached consultation — it must
    //    count at every stage up to there. The old client-side version tested
    //    `allStages.slice(i).includes(status)`, and since `not_proceeding` is
    //    not a stage it matched nothing, dropping such leads out of EVERY
    //    stage including "New". On Plan4growth that hid 415 of 1,388 leads
    //    (30%), so the funnel's top bar read 973 directly beside a header that
    //    said 1,388. `furthestStageOf` maps a terminal status back to the
    //    stage it died at, so lost leads stay in the funnel — which is the
    //    entire point of a funnel.
    //
    // 2. NEVER DERIVE THE FUNNEL FROM A PAGE OF ROWS. Counts come from the
    //    aggregate RPC, so no row cap can distort them.
    //
    // `lost` is reported alongside rather than folded away: a stage count that
    // includes leads which have since died is honest only if the death toll is
    // visible next to it.
    // ------------------------------------------------------------------------
    // CRM Reports payload. Everything the screen draws, from ONE aggregate over
    // ONE window, so the funnel, the KPI tiles and the two breakdown tables
    // cannot disagree with each other.
    //
    // Two things the browser-side version got wrong beyond the row cap:
    //   * it grouped practices by `l.practice?.name` and dropped falsy names,
    //     which silently discarded every lead with no practice — 3,939 of
    //     22,807 on Plan4growth, holding 301 of the 494 conversions. The
    //     by-practice table was missing 61% of all conversions. Unmapped leads
    //     are real leads; they get their own "Unassigned" row.
    //   * it averaged first-response time over whatever rows it had. Averaging
    //     is now done from a sum and a count, so a source with 3 leads cannot
    //     weigh the same as one with 3,000.
    async report(orgId, { since = null, until = null, practiceId = null, accountId = null } = {}) {
        const bounds = (0, date_window_1.dayWindowISO)(since, until);
        const rows = await lead_repository_1.leadRepository.reportAggregate(orgId, {
            since: bounds.sinceISO ?? (0, date_window_1.startOfDayISO)(since),
            until: bounds.untilISO ?? (0, date_window_1.endOfDayISO)(until),
            practiceId,
            accountId,
        });

        const num = (v) => Number(v || 0);
        const shape = (r) => ({
            key: r.key ?? '',
            keyId: r.key_id ?? null,
            total: num(r.total),
            contacted: num(r.contacted),
            consultBooked: num(r.consult_booked),
            consultAttended: num(r.consult_attended),
            treatmentStarted: num(r.treatment_started),
            notProceeding: num(r.not_proceeding),
            failedToAttend: num(r.failed_to_attend),
            convertedValuePence: num(r.converted_value_pence),
            pipelineValuePence: num(r.pipeline_value_pence),
            // A rate over zero leads is not 0% — it is unknown.
            conversionPct: num(r.total)
                ? Math.round((num(r.treatment_started) / num(r.total)) * 1000) / 10
                : null,
        });

        const totals = rows.find((r) => r.dimension === 'all');
        const overall = shape(totals || {});
        const respCount = num(totals?.response_minutes_count);

        return {
            totals: {
                ...overall,
                ftaPct: overall.total
                    ? Math.round((overall.failedToAttend / overall.total) * 1000) / 10
                    : null,
                avgFirstResponseMinutes: respCount
                    ? Math.round(num(totals.response_minutes_sum) / respCount)
                    : null,
            },
            // The funnel is the same cumulative shape the Command Centre uses.
            funnel: [
                { key: 'received', label: 'Leads received', count: overall.total },
                { key: 'contacted', label: 'Contacted', count: overall.contacted },
                { key: 'consult_booked', label: 'Consultation booked', count: overall.consultBooked },
                { key: 'consult_attended', label: 'Consultation attended', count: overall.consultAttended },
                { key: 'treatment_started', label: 'Treatment started', count: overall.treatmentStarted },
            ],
            bySource: rows.filter((r) => r.dimension === 'source').map(shape),
            byPractice: rows.filter((r) => r.dimension === 'practice').map(shape),
        };
    },

    async funnel(orgId, { since = null, until = null, practiceId = null } = {}) {
        // 3. USE THE SAME WINDOW AS THE REST OF THE PAGE. `until` arrives as a
        //    calendar day (YYYY-MM-DD), which a timestamptz parameter parses as
        //    MIDNIGHT AT THE START of that day — so a bare bound silently drops
        //    the whole final day (44 of 1,429 August leads; on day one of an
        //    MTD window, every lead there is). lib/date-window builds both
        //    bounds for every screen, so the funnel and the KPI cards beside it
        //    can never describe different periods.
        const bounds = (0, date_window_1.dayWindowISO)(since, until);
        const rows = await lead_repository_1.leadRepository.funnelCounts(orgId, {
            since: bounds.sinceISO ?? (0, date_window_1.startOfDayISO)(since),
            until: bounds.untilISO ?? (0, date_window_1.endOfDayISO)(until),
            practiceId,
        });

        const byStatus = {};
        for (const status of lead_model_1.LEAD_STATUSES)
            byStatus[status] = { count: 0, valuePence: 0 };
        let total = 0;
        for (const r of rows) {
            const status = r.status;
            if (!byStatus[status]) continue; // unknown status: counted in total only
            byStatus[status].count += Number(r.n || 0);
            byStatus[status].valuePence += Number(r.value_pence || 0);
        }
        for (const r of rows) total += Number(r.n || 0);

        // Cumulative stage counts: a lead counts at its furthest stage and at
        // every stage before it.
        const stages = lead_model_1.FUNNEL_STAGES.map((s, i) => {
            let count = 0;
            for (const status of lead_model_1.LEAD_STATUSES) {
                const reached = lead_model_1.furthestStageIndex(status);
                if (reached >= i) count += byStatus[status].count;
            }
            return { key: s.key, label: s.label, count };
        });

        const started = byStatus.treatment_started.count + byStatus.treatment_completed.count;
        const lost = byStatus.not_proceeding.count + byStatus.failed_to_attend.count;

        return {
            total,
            started,
            lost,
            // One decimal place, and null (not 0) when there is nothing to
            // divide by — a 0% conversion on zero leads is not a real zero.
            conversionPct: total ? Math.round((started / total) * 1000) / 10 : null,
            stages,
            byStatus,
        };
    },
};

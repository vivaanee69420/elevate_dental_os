// Daily Command Cockpit aggregation service — assembles the /api/cockpit
// payload from emergent_daily_cashup (revenue/treatment/cash-up), emergent_
// monthly_pl (current calendar month), and Task 1's lead-attribution channel
// breakdown. Money is integer pence throughout (rule 2).
import { cockpitRepository } from "../repositories/cockpit.repository.js";
import { leadAttributionService, classifyChannel, matchAcceptedValue, buildAcceptedByKey } from "./lead-attribution.service.js";

const num = v => Number(v || 0);

// Lazy detail-endpoint pagination — repo methods take LIMIT/OFFSET; cap at
// 500 rows/page, default 100. Applies to leads/treatments/cashup-days.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
function clampLimit(limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(n), MAX_LIMIT);
}
function clampOffset(offset) {
    const n = Number(offset);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.trunc(n);
}

// Typed emergent_monthly_pl columns -> display name, in the two P&L
// categories the cockpit surfaces. Order doesn't matter here; lineItems()
// sorts largest-first below.
const COST_LINE_COLS = [
    ['principal_fees_pence', 'Principal fees'],
    ['hygienist_therapist_pence', 'Hygienist / therapist'],
    ['lab_fees_pence', 'Lab fees'],
    ['materials_pence', 'Materials'],
    ['sedation_services_pence', 'Sedation services'],
];
const OPEX_LINE_COLS = [
    ['advertising_marketing_pence', 'Advertising & marketing'],
    ['bank_charges_pence', 'Bank charges'],
    ['business_rates_rent_pence', 'Business rates & rent'],
    ['salaries_staff_cost_pence', 'Salaries & staff cost'],
    ['telephone_wifi_pence', 'Telephone & wifi'],
    ['utilities_pence', 'Utilities'],
    ['insurance_pence', 'Insurance'],
    ['management_fees_pence', 'Management fees'],
    ['subscriptions_pence', 'Subscriptions'],
    ['it_expenses_pence', 'IT expenses'],
    ['card_machine_charges_pence', 'Card machine charges'],
];

// Sums the given typed columns across all monthly_pl rows (one per business)
// into a single largest-first [{name,amountPence}] list, dropping zero/absent
// lines. Money is integer pence throughout.
function sumTypedLines(rows, cols) {
    const totals = new Map();
    for (const row of rows || []) {
        for (const [col, name] of cols) {
            const v = num(row[col]);
            if (v === 0) continue;
            totals.set(name, (totals.get(name) || 0) + v);
        }
    }
    return Array.from(totals, ([name, amountPence]) => ({ name, amountPence }))
        .filter(l => l.amountPence !== 0)
        .sort((a, b) => b.amountPence - a.amountPence);
}

// custom_lines is {name: pence} per business row — sum across businesses,
// same shape/ordering as sumTypedLines.
function sumCustomLines(rows) {
    const totals = new Map();
    for (const row of rows || []) {
        for (const [name, pence] of Object.entries(row.custom_lines || {})) {
            const v = num(pence);
            if (v === 0) continue;
            totals.set(name, (totals.get(name) || 0) + v);
        }
    }
    return Array.from(totals, ([name, amountPence]) => ({ name, amountPence }))
        .filter(l => l.amountPence !== 0)
        .sort((a, b) => b.amountPence - a.amountPence);
}

// line_notes is {name: text} per business row — free-text, not money, so it
// carries a `note` string rather than amountPence. Collected across
// businesses, first note wins per name.
function collectLineNotes(rows) {
    const notes = new Map();
    for (const row of rows || []) {
        for (const [name, note] of Object.entries(row.line_notes || {})) {
            if (note == null || String(note).trim() === '') continue;
            if (!notes.has(name)) notes.set(name, String(note));
        }
    }
    return Array.from(notes, ([name, note]) => ({ name, note }));
}

// Derive the current calendar month's period_month DATE ('YYYY-MM-01') from
// `until` when present, else today. emergent_monthly_pl.period_month is
// always the 1st of the month.
function monthStartFrom(until) {
    const d = until ? new Date(until) : new Date();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

export const cockpitService = {
    async build(orgId, { since, until, practiceId } = {}) {
        let periodMonth = monthStartFrom(until);
        const [cashupRows, monthlyRowsForCurrent, leadRoi, acceptedRows] = await Promise.all([
            cockpitRepository.cashupRollup(orgId, since, until, practiceId),
            cockpitRepository.monthlyPl(orgId, periodMonth, practiceId),
            leadAttributionService.channelBreakdown(orgId, { since, until, practiceId }),
            cockpitRepository.acceptedContactsInWindow(orgId, since, until, practiceId),
        ]);

        // Emergent may not have sent the current calendar month's P&L yet —
        // that would otherwise render as a false £0. Fall back to the latest
        // available month for the org and label it accordingly.
        let monthlyRows = monthlyRowsForCurrent;
        if (!monthlyRows || monthlyRows.length === 0) {
            const latest = await cockpitRepository.latestMonthlyPl(orgId);
            if (latest.periodMonth) {
                periodMonth = latest.periodMonth;
                monthlyRows = latest.rows;
            }
        }

        // Aggregate cash-up rows by practice (practice_id, falling back to
        // business_name for practices not yet mapped in emergent_practice_map).
        const byPracticeMap = new Map();
        for (const row of cashupRows || []) {
            const key = row.practice_id ?? `name:${row.business_name ?? 'unmapped'}`;
            if (!byPracticeMap.has(key)) {
                byPracticeMap.set(key, {
                    practiceId: row.practice_id ?? null,
                    name: row.business_name ?? null,
                    collectedPence: 0,
                    detailPence: 0,
                    acceptedCount: 0,
                    acceptedValuePence: 0,
                    txPlansGiven: 0,
                    txPlanValuePence: 0,
                    newLeads: 0,
                    attended: 0,
                });
            }
            const g = byPracticeMap.get(key);
            g.collectedPence += num(row.cash_up_money_taken_pence);
            g.detailPence += num(row.detail_patient_money_total_pence);
            g.txPlansGiven += num(row.tx_plans_given);
            g.txPlanValuePence += num(row.tx_plan_given_value_pence);
            g.newLeads += num(row.num_new_leads);
            g.attended += num(row.num_attended);
        }

        // ACCEPTED count/value come from the canonical Emergent conversions
        // feed (treatment_accepted), not the cash-up's plans-given figure.
        // Union practice keys: a practice may have cash-up data with no
        // accepted rows in-window (or vice versa).
        const acceptedByPractice = new Map();
        for (const row of acceptedRows || []) {
            const key = row.practice_id ?? '__unmapped__';
            if (!acceptedByPractice.has(key)) {
                acceptedByPractice.set(key, { practiceId: row.practice_id ?? null, count: 0, valuePence: 0 });
            }
            const a = acceptedByPractice.get(key);
            a.count += 1;
            a.valuePence += num(row.value_pence);
        }
        for (const [key, a] of acceptedByPractice) {
            let g = a.practiceId !== null ? byPracticeMap.get(a.practiceId) : null;
            if (!g) {
                g = {
                    practiceId: a.practiceId,
                    name: null,
                    collectedPence: 0,
                    detailPence: 0,
                    acceptedCount: 0,
                    acceptedValuePence: 0,
                    txPlansGiven: 0,
                    txPlanValuePence: 0,
                    newLeads: 0,
                    attended: 0,
                };
                byPracticeMap.set(key, g);
            }
            g.acceptedCount = a.count;
            g.acceptedValuePence = a.valuePence;
        }
        const byPractice = Array.from(byPracticeMap.values());

        // Daily cash-in series for the charts task — sum per calendar day
        // across practices/businesses, ascending by date.
        const dailyMap = new Map();
        for (const row of cashupRows || []) {
            const date = row.cashup_date;
            if (!date) continue;
            dailyMap.set(date, (dailyMap.get(date) || 0) + num(row.cash_up_money_taken_pence));
        }
        const dailySeries = Array.from(dailyMap, ([date, cashPence]) => ({ date, cashPence }))
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        const totals = byPractice.reduce((acc, p) => {
            acc.collectedPence += p.collectedPence;
            acc.detailPence += p.detailPence;
            acc.acceptedCount += p.acceptedCount;
            acc.acceptedValuePence += p.acceptedValuePence;
            acc.txPlansGiven += p.txPlansGiven;
            acc.txPlanValuePence += p.txPlanValuePence;
            acc.newLeads += p.newLeads;
            acc.attended += p.attended;
            return acc;
        }, { collectedPence: 0, detailPence: 0, acceptedCount: 0, acceptedValuePence: 0, txPlansGiven: 0, txPlanValuePence: 0, newLeads: 0, attended: 0 });

        // Monthly P&L (current calendar month), grouped by business.
        const byBusiness = (monthlyRows || []).map(row => ({
            practiceId: row.practice_id ?? null,
            name: row.business_name ?? null,
            revenuePence: num(row.revenue_pence),
            netProfitPence: num(row.net_profit_pence),
        }));
        const monthlyTotals = byBusiness.reduce((acc, b) => {
            acc.revenuePence += b.revenuePence;
            acc.netProfitPence += b.netProfitPence;
            return acc;
        }, { revenuePence: 0, netProfitPence: 0 });

        const costLines = sumTypedLines(monthlyRows, COST_LINE_COLS);
        const opexLines = sumTypedLines(monthlyRows, OPEX_LINE_COLS);
        const customLines = sumCustomLines(monthlyRows);
        const lineNotes = collectLineNotes(monthlyRows);

        return {
            window: { since: since ?? null, until: until ?? null },
            revenue: {
                collectedPence: totals.collectedPence,
                byPractice: byPractice.map(p => ({ practiceId: p.practiceId, name: p.name, collectedPence: p.collectedPence })),
                dailySeries,
            },
            treatment: {
                acceptedCount: totals.acceptedCount,
                acceptedValuePence: totals.acceptedValuePence,
                txPlansGiven: totals.txPlansGiven,
                txPlanValuePence: totals.txPlanValuePence,
                newLeads: totals.newLeads,
                attended: totals.attended,
                byPractice: byPractice.map(p => ({
                    practiceId: p.practiceId,
                    name: p.name,
                    acceptedCount: p.acceptedCount,
                    acceptedValuePence: p.acceptedValuePence,
                    txPlansGiven: p.txPlansGiven,
                    txPlanValuePence: p.txPlanValuePence,
                    newLeads: p.newLeads,
                    attended: p.attended,
                })),
            },
            leadRoi,
            cashUp: {
                collectedPence: totals.collectedPence,
                detailPence: totals.detailPence,
                variancePence: totals.collectedPence - totals.detailPence,
                byPractice: byPractice.map(p => ({
                    practiceId: p.practiceId,
                    name: p.name,
                    collectedPence: p.collectedPence,
                    detailPence: p.detailPence,
                    variancePence: p.collectedPence - p.detailPence,
                })),
            },
            monthly: {
                periodMonth,
                revenuePence: monthlyTotals.revenuePence,
                netProfitPence: monthlyTotals.netProfitPence,
                byBusiness,
                costLines,
                opexLines,
                customLines,
                lineNotes,
            },
            updatedAt: new Date().toISOString(),
        };
    },

    // Lazy detail — leads in-window, annotated with channel/pipelineName
    // (Task 1's pipeline->channel map) and converted/matchedValuePence via
    // the SAME phone/email matcher as leadAttributionService.matchBreakdown
    // (buildAcceptedByKey/matchAcceptedValue, both reused — no duplicate
    // normalise/match logic). Optional `channel` filters the shaped lines
    // (applied after classification, since channel isn't a queryable column).
    async leadsDetail(orgId, { since, until, practiceId, channel, limit, offset } = {}) {
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const [pipes, rows, accepted] = await Promise.all([
            cockpitRepository.pipelineChannelMap(orgId),
            cockpitRepository.leadsDetailRows(orgId, since, until, practiceId, lim, off),
            // Open-ended: a lead from this window may only have been accepted
            // after it closed. Same rule as the channel breakdown, so a lead
            // shown as converted in the list is counted as converted on the card.
            cockpitRepository.acceptedForMatching(orgId, since),
        ]);

        const pipeById = new Map((pipes || []).map(p => [p.pipeline_id, p]));
        const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

        let lines = (rows || []).map(row => {
            const pipe = pipeById.get(row.ghl_pipeline_id);
            const contact = row.contacts || {};
            const practiceId = pipe?.practice_id ?? row.practice_id ?? null;
            const matched = matchAcceptedValue({ contacts: contact, practiceId }, acceptedByKey, nameByPractice);
            const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null;
            return {
                id: row.id,
                contactId: row.contact_id ?? null,
                createdAt: row.created_at,
                practiceName: pipe?.practice_label ?? null,
                channel: classifyChannel(pipe?.name),
                pipelineName: pipe?.name ?? null,
                name,
                email: contact.email ?? null,
                phone: contact.phone ?? null,
                converted: matched !== null,
                matchedValuePence: matched ? matched.valuePence : 0,
                matchedTreatmentName: matched ? matched.treatmentName : null,
                matchedPatientName: matched ? matched.patientName : null,
                matchedAcceptedDate: matched ? matched.acceptedDate : null,
            };
        });

        if (channel) lines = lines.filter(l => l.channel === channel);

        return { window: { since: since ?? null, until: until ?? null }, lines, limit: lim, offset: off };
    },

    // Lazy detail — accepted treatments (treatment_accepted, status='accepted')
    // in-window. `source` prefers the typed ext_source column, falling back
    // to raw.source for older rows synced before that column existed.
    //
    // Each line is also tagged with the GHL ad pipeline the patient ORIGINALLY
    // came in on (leadChannel/leadPipelineName) — that's the "which ad paid for
    // this treatment" link. The match runs in SQL (cockpit_accepted_lead_source)
    // because it has to look across every pipeline lead the org has ever had,
    // not just the ones created inside this window.
    async treatmentsDetail(orgId, { since, until, practiceId, limit, offset } = {}) {
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const [rows, pipes, sources] = await Promise.all([
            cockpitRepository.treatmentsDetailRows(orgId, since, until, practiceId, lim, off),
            cockpitRepository.pipelineChannelMap(orgId),
            cockpitRepository.acceptedLeadSource(orgId, since, until, practiceId),
        ]);

        const pipeById = new Map((pipes || []).map(p => [p.pipeline_id, p]));
        const sourceByAccepted = new Map((sources || []).map(s => [s.accepted_id, s]));

        const lines = (rows || []).map(row => {
            const src = sourceByAccepted.get(row.id);
            const pipe = src ? pipeById.get(src.ghl_pipeline_id) : null;
            return {
                id: row.id,
                acceptedDate: row.accepted_date,
                practiceName: row.practices?.name ?? null,
                patientName: row.patient_name ?? null,
                treatmentName: row.treatment_name ?? null,
                valuePence: num(row.value_pence),
                source: row.ext_source ?? row.raw?.source ?? null,
                // null when the patient never came through a GHL ad pipeline
                // (walk-in, referral, or a lead we can't match on phone/email/name).
                leadChannel: pipe ? classifyChannel(pipe.name) : null,
                leadPipelineName: pipe?.name ?? null,
                leadCreatedAt: src?.lead_created_at ?? null,
            };
        });

        return { window: { since: since ?? null, until: until ?? null }, lines, limit: lim, offset: off };
    },

    // Lazy detail — daily cash-up rows in-window, newest-first. variancePence
    // is cashTakenPence minus detailPence (manager total vs detail-patient
    // total); practiceName falls back to the Emergent business_name when the
    // row hasn't been mapped to a practice yet (emergent_practice_map).
    //
    // Also carries the manager-keyed daily counts (tx plans given + value, new
    // leads, attended). Emergent's cash-up sends a COUNT PER DAY and no
    // per-plan or per-lead records, so this day list is the deepest the "Tx
    // plans given" / "New leads" headline numbers can ever be drilled — there
    // is nothing further behind them to open.
    async cashupDaysDetail(orgId, { since, until, practiceId, limit, offset } = {}) {
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const rows = await cockpitRepository.cashupDaysDetailRows(orgId, since, until, practiceId, lim, off);

        const lines = (rows || []).map(row => {
            const cashTakenPence = num(row.cash_up_money_taken_pence);
            const detailPence = num(row.detail_patient_money_total_pence);
            return {
                cashupDate: row.cashup_date,
                practiceName: row.practices?.name ?? row.business_name ?? null,
                cashTakenPence,
                detailPence,
                variancePence: cashTakenPence - detailPence,
                txPlansGiven: num(row.tx_plans_given),
                txPlanValuePence: num(row.tx_plan_given_value_pence),
                newLeads: num(row.num_new_leads),
                attended: num(row.num_attended),
                refunds: row.refunds ?? [],
            };
        });

        return { window: { since: since ?? null, until: until ?? null }, lines };
    },
};

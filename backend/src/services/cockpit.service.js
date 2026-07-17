// Daily Command Cockpit aggregation service — assembles the /api/cockpit
// payload from emergent_daily_cashup (revenue/treatment/cash-up), emergent_
// monthly_pl (current calendar month), and Task 1's lead-attribution channel
// breakdown. Money is integer pence throughout (rule 2).
import { cockpitRepository } from "../repositories/cockpit.repository.js";
import { leadAttributionService, classifyChannel, matchAcceptedValue, buildAcceptedByKey } from "./lead-attribution.service.js";
import { practiceCostModelRepository } from "../repositories/practice-cost-model.repository.js";
import { calculateBreakeven } from "../lib/formulas.js";

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

// The two clinician-pay columns, split out of COST_LINE_COLS for the §5
// "Clinician fees" card. Everything else in COST_LINE_COLS (lab, materials,
// sedation) is lab+overhead.
const CLINICIAN_LINE_COLS = ['principal_fees_pence', 'hygienist_therapist_pence'];

// Sums the named typed columns across all monthly_pl rows.
function sumCols(rows, cols) {
    let total = 0;
    for (const row of rows || []) for (const col of cols) total += num(row[col]);
    return total;
}

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

// The calendar month containing `until` (or today). §1's today/MTD/projected
// cards are anchored to this month, NOT to the window — "month to date" against
// an arbitrary window is meaningless. Each card is labelled with the month.
function monthBoundsFrom(until) {
    const d = until ? new Date(until) : new Date();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return {
        start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
        endExclusive: new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10),
    };
}

// Days the practice ACTUALLY TRADED, from its cash-up rows — not calendar
// weekdays. A day with no cash-up contributes neither revenue nor fixed cost, so
// a missed cash-up shortens the window rather than manufacturing a loss.
function tradedDaysByPractice(rows) {
    const days = new Map();
    for (const row of rows || []) {
        if (!row.practice_id || !row.cashup_date) continue;
        if (!days.has(row.practice_id)) days.set(row.practice_id, new Set());
        days.get(row.practice_id).add(row.cashup_date);
    }
    return days;
}

// §7 Revenue by line — sum invoiced fee per treatment name, largest-first, with
// each line's share of the total. Practice filtering happens here because the
// RPC returns practice_id per row and takes no practice param.
function shapeRevenueByLine(rows, practiceId) {
    const totals = new Map();
    for (const row of rows || []) {
        if (practiceId && row.practice_id !== practiceId) continue;
        const v = num(row.fee_pence);
        if (v === 0) continue;
        const name = row.treatment_name || 'Unspecified';
        totals.set(name, (totals.get(name) || 0) + v);
    }
    const grand = Array.from(totals.values()).reduce((s, v) => s + v, 0);
    return Array.from(totals, ([name, amountPence]) => ({
        name,
        amountPence,
        sharePct: grand > 0 ? Math.round((amountPence / grand) * 1000) / 10 : 0,
    })).sort((a, b) => b.amountPence - a.amountPence);
}

export const cockpitService = {
    async build(orgId, { since, until, practiceId } = {}) {
        let periodMonth = monthStartFrom(until);
        const month = monthBoundsFrom(until);
        const [cashupRows, monthlyRowsForCurrent, leadRoi, acceptedRows, revenueLineRows,
               practices, costModels, monthCashupRows] = await Promise.all([
            cockpitRepository.cashupRollup(orgId, since, until, practiceId),
            cockpitRepository.monthlyPl(orgId, periodMonth, practiceId),
            leadAttributionService.channelBreakdown(orgId, { since, until, practiceId }),
            cockpitRepository.acceptedContactsInWindow(orgId, since, until, practiceId),
            cockpitRepository.revenueByLine(orgId, since, until),
            cockpitRepository.activePractices(orgId, practiceId),
            // As-of the window's START: a March window must be costed with the
            // model in force in March, not the one set last week.
            practiceCostModelRepository.asOf(orgId, (since || month.start).slice(0, 10)),
            cockpitRepository.cashupRollup(orgId, month.start, month.endExclusive, practiceId),
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

        // §5 card split. Clinician fees are the two pay columns; lab+overhead
        // is every other cost line + all opex + custom lines.
        const clinicianFeesPence = sumCols(monthlyRows, CLINICIAN_LINE_COLS);
        const otherCostCols = COST_LINE_COLS.map(([col]) => col).filter(c => !CLINICIAN_LINE_COLS.includes(c));
        const labOverheadPence =
            sumCols(monthlyRows, otherCostCols) +
            sumCols(monthlyRows, OPEX_LINE_COLS.map(([col]) => col)) +
            customLines.reduce((s, l) => s + l.amountPence, 0);

        // Revenue - clinician - lab/overhead SHOULD equal the net profit Emergent
        // sent. Where it doesn't, Emergent's own lines don't add up — surface the
        // gap rather than plugging it, or a broken feed looks like a healthy one.
        const residualPence =
            monthlyTotals.revenuePence - clinicianFeesPence - labOverheadPence - monthlyTotals.netProfitPence;

        const marginPct = monthlyTotals.revenuePence > 0
            ? Math.round((monthlyTotals.netProfitPence / monthlyTotals.revenuePence) * 10000) / 100
            : null;

        // ---- §6 Profit vs Breakeven, and §1's month-anchored cards ----------
        const modelByPractice = new Map((costModels || []).map(m => [m.practice_id, m]));
        const windowTradedDays = tradedDaysByPractice(cashupRows);
        const revenueByPractice = new Map(byPractice.filter(p => p.practiceId).map(p => [p.practiceId, p.collectedPence]));

        const breakevenRows = (practices || []).map(p => {
            const model = modelByPractice.get(p.id);
            const traded = windowTradedDays.get(p.id)?.size ?? 0;
            const revenuePence = revenueByPractice.get(p.id) ?? null;

            // No cash-up at all in this window: the practice is not REPORTING.
            // That is not "£0 revenue" — Warwick Lodge has no Emergent feed.
            if (revenuePence === null) {
                return {
                    practiceId: p.id, name: p.name, revenuePence: null, workingDaysInWindow: 0,
                    breakevenDayPence: null, contributionPence: null, fixedDayPence: null,
                    fixedPence: null, profitPence: null, status: 'not_reporting',
                };
            }

            const b = calculateBreakeven({
                revenuePence,
                fixedCostPenceMonth: num(model?.fixed_cost_pence_month),
                breakevenLowPence: num(model?.breakeven_low_pence),
                breakevenHighPence: num(model?.breakeven_high_pence),
                workingDaysPerMonth: model?.working_days_per_month ?? 20,
                workingDaysInWindow: traded,
            });
            return {
                practiceId: p.id, name: p.name, revenuePence, workingDaysInWindow: traded,
                breakevenDayPence: b.breakevenDayPence, contributionPence: b.contributionPence,
                fixedDayPence: b.fixedDayPence, fixedPence: b.fixedPence,
                profitPence: b.profitPence, status: b.status,
            };
        });

        // Group = sum of the practices that HAVE a usable model and are
        // reporting. Anything else is excluded and counted, never folded in as
        // £0 — a costless practice would silently overstate group profit.
        const counted = breakevenRows.filter(r => r.status === 'above' || r.status === 'below');
        const groupProfit = counted.reduce((s, r) => s + r.profitPence, 0);
        const breakevenGroup = {
            revenuePence: counted.reduce((s, r) => s + r.revenuePence, 0),
            contributionPence: counted.reduce((s, r) => s + r.contributionPence, 0),
            fixedPence: counted.reduce((s, r) => s + r.fixedPence, 0),
            breakevenPence: counted.reduce((s, r) => s + r.breakevenDayPence * r.workingDaysInWindow, 0),
            profitPence: counted.length > 0 ? groupProfit : null,
            status: counted.length === 0 ? 'not_set' : groupProfit >= 0 ? 'above' : 'below',
            excludedCount: breakevenRows.length - counted.length,
        };

        // §1's month-anchored cards.
        const monthTradedDays = tradedDaysByPractice(monthCashupRows);
        const monthByPractice = new Map();
        for (const row of monthCashupRows || []) {
            const key = row.practice_id;
            if (!key) continue;
            if (!monthByPractice.has(key)) monthByPractice.set(key, { mtdPence: 0 });
            monthByPractice.get(key).mtdPence += num(row.cash_up_money_taken_pence);
        }

        const monthRowsOut = (practices || []).map(p => {
            const mtdPence = monthByPractice.get(p.id)?.mtdPence ?? 0;
            const elapsed = monthTradedDays.get(p.id)?.size ?? 0;
            const wdpm = modelByPractice.get(p.id)?.working_days_per_month ?? 20;
            const target = modelByPractice.get(p.id)?.revenue_target_pence_month ?? null;
            return {
                practiceId: p.id,
                name: p.name,
                mtdPence,
                workingDaysElapsed: elapsed,
                // Project each practice separately and sum — same principle as
                // the target: the group is the sum of its parts, so it can't drift.
                projectedPence: elapsed > 0 ? Math.round((mtdPence / elapsed) * wdpm) : null,
                dailyTargetPence: target !== null && wdpm > 0 ? Math.round(target / wdpm) : null,
            };
        });

        const monthMtdPence = monthRowsOut.reduce((s, r) => s + r.mtdPence, 0);
        const monthElapsed = new Set((monthCashupRows || []).map(r => r.cashup_date).filter(Boolean)).size;
        const projectedRows = monthRowsOut.filter(r => r.projectedPence !== null);
        const targetRows = monthRowsOut.filter(r => r.dailyTargetPence !== null);
        const latestDay = (monthCashupRows || []).reduce((a, r) => (r.cashup_date > a ? r.cashup_date : a), '');
        const todayPence = latestDay
            ? (monthCashupRows || []).filter(r => r.cashup_date === latestDay)
                .reduce((s, r) => s + num(r.cash_up_money_taken_pence), 0)
            : null;

        const revenueMonth = {
            periodMonth: month.start,
            todayPence,
            todayDate: latestDay || null,
            mtdPence: monthMtdPence,
            workingDaysElapsed: monthElapsed,
            avgPerDayPence: monthElapsed > 0 ? Math.round(monthMtdPence / monthElapsed) : null,
            projectedPence: projectedRows.length > 0 ? projectedRows.reduce((s, r) => s + r.projectedPence, 0) : null,
            dailyTargetPence: targetRows.length > 0 ? targetRows.reduce((s, r) => s + r.dailyTargetPence, 0) : null,
            byPractice: monthRowsOut,
        };

        return {
            window: { since: since ?? null, until: until ?? null },
            revenue: {
                collectedPence: totals.collectedPence,
                byPractice: byPractice.map(p => ({ practiceId: p.practiceId, name: p.name, collectedPence: p.collectedPence })),
                dailySeries,
                month: revenueMonth,
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
            breakeven: { rows: breakevenRows, group: breakevenGroup },
            revenueByLine: shapeRevenueByLine(revenueLineRows, practiceId),
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
                clinicianFeesPence,
                labOverheadPence,
                residualPence,
                marginPct,
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

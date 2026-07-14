// Daily Command Cockpit aggregation service — assembles the /api/cockpit
// payload from emergent_daily_cashup (revenue/treatment/cash-up), emergent_
// monthly_pl (current calendar month), and Task 1's lead-attribution channel
// breakdown. Money is integer pence throughout (rule 2).
import { cockpitRepository } from "../repositories/cockpit.repository.js";
import { leadAttributionService } from "./lead-attribution.service.js";

const num = v => Number(v || 0);

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
    async build(orgId, { since, until } = {}) {
        const periodMonth = monthStartFrom(until);
        const [cashupRows, monthlyRows, leadRoi] = await Promise.all([
            cockpitRepository.cashupRollup(orgId, since, until),
            cockpitRepository.monthlyPl(orgId, periodMonth),
            leadAttributionService.channelBreakdown(orgId, { since, until }),
        ]);

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
                    // acceptedValuePence: the closest "value of accepted treatment"
                    // figure the daily cash-up captures is tx_plan_given_value_pence
                    // (there is no separate accepted-value column on the table).
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
            g.acceptedCount += num(row.treatments_accepted);
            g.acceptedValuePence += num(row.tx_plan_given_value_pence);
            g.txPlansGiven += num(row.tx_plans_given);
            g.txPlanValuePence += num(row.tx_plan_given_value_pence);
            g.newLeads += num(row.num_new_leads);
            g.attended += num(row.num_attended);
        }
        const byPractice = Array.from(byPracticeMap.values());

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

        return {
            window: { since: since ?? null, until: until ?? null },
            revenue: {
                collectedPence: totals.collectedPence,
                byPractice: byPractice.map(p => ({ practiceId: p.practiceId, name: p.name, collectedPence: p.collectedPence })),
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
            },
            updatedAt: new Date().toISOString(),
        };
    },
};

// ============================================================================
// Analytics service — P&L / valuation / KPI rollups from the saved baseline.
// NOTE: endpoints with no baseline return { error: 'No baseline set' } with a
// 200 status (NOT an error) — preserved exactly from the original.
// ============================================================================
import * as analytics_repository_1 from "../repositories/analytics.repository.js";
import * as formulas_1 from "../lib/formulas.js";
import * as claude_1 from "../lib/claude.js";
export const analyticsService = {
    async dashboard(orgId) {
        const health = await analytics_repository_1.analyticsRepository.baselineMaybe(orgId);
        const baseline = health?.baseline || {};
        return { baseline };
    },
    async pl(orgId) {
        const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
        const b = health?.baseline;
        if (!b?.revenue)
            return { error: 'No baseline set' };
        const revenuePence = b.revenue * 100;
        const result = (0, formulas_1.calculatePL)({
            revenue: revenuePence,
            costs: {
                associates: Math.round(revenuePence * (b.cost_associates || 0) / 100),
                lab: Math.round(revenuePence * (b.cost_lab || 0) / 100),
                materials: Math.round(revenuePence * (b.cost_materials || 0) / 100),
                staff: Math.round(revenuePence * (b.cost_staff || 0) / 100),
                property: Math.round(revenuePence * (b.cost_property || 0) / 100),
                marketing: Math.round(revenuePence * (b.cost_marketing || 0) / 100),
                other: Math.round(revenuePence * (b.cost_other || 0) / 100),
            },
        });
        return result;
    },
    async valuation(orgId) {
        const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
        const b = health?.baseline;
        if (!b?.revenue || !b?.profit)
            return { error: 'No baseline set' };
        const revenuePence = b.revenue * 100;
        const profitPence = b.profit * 100;
        const ebitdaPence = profitPence + Math.round(revenuePence * 0.04); // add back D&A
        const result = (0, formulas_1.calculateValuation)({
            annualRevenue: revenuePence,
            ebitda: ebitdaPence,
            nhsRevenuePct: 100 - (b.private_pct || 50),
            privateRevenuePct: b.private_pct || 50,
        });
        return result;
    },
    async kpis(orgId) {
        const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
        const b = health?.baseline;
        if (!b)
            return { error: 'No baseline set' };
        return (0, formulas_1.calculateKPIs)({
            revenuePence: (b.revenue || 0) * 100,
            netProfitPence: (b.profit || 0) * 100,
            monthlyLeads: b.leads_per_month || 0,
            consultationsBooked: Math.round((b.leads_per_month || 0) * 0.4),
            consultationsAttended: Math.round((b.leads_per_month || 0) * 0.32),
            treatmentsStarted: b.new_per_month || 0,
            treatmentsCompleted: Math.round((b.new_per_month || 0) * 0.9),
            averageCaseValuePence: (b.case_value || 0) * 100,
            recurringRevenuePence: (b.plan_members || 0) * 24 * 12 * 100, // est £24/mo
            chairUtilisationPct: b.utilisation || 0,
            ftaRatePct: b.fta_rate || 0,
            recallCompliancePct: b.recall || 0,
            activePatients: b.active_patients || 0,
            lapsedPatients: b.lapsed || 0,
            newPatientsMonth: b.new_per_month || 0,
        });
    },
    // ------------------------------------------------------------------------
    // Command Centre summary — KPIs + cash position derived from the REAL
    // saved baseline (no fabricated weights). All money returned in pence.
    // Costs are baseline cost_* (% of revenue). cashCollected uses the saved
    // baseline.cash when present, else assumes revenue fully collected (we do
    // NOT invent a collection rate). targetProfit is left to the client (it
    // owns the editable target-margin slider) — we return revenue + margin.
    _costsPence(b, revenuePence) {
        return {
            associates: Math.round(revenuePence * (b.cost_associates || 0) / 100),
            lab: Math.round(revenuePence * (b.cost_lab || 0) / 100),
            materials: Math.round(revenuePence * (b.cost_materials || 0) / 100),
            staff: Math.round(revenuePence * (b.cost_staff || 0) / 100),
            property: Math.round(revenuePence * (b.cost_property || 0) / 100),
            marketing: Math.round(revenuePence * (b.cost_marketing || 0) / 100),
            other: Math.round(revenuePence * (b.cost_other || 0) / 100),
        };
    },
    async dashboardSummary(orgId) {
        const health = await analytics_repository_1.analyticsRepository.baselineMaybe(orgId);
        const b = health?.baseline;
        if (!b?.revenue)
            return { error: 'No baseline set' };
        const revenuePence = b.revenue * 100;
        const pl = (0, formulas_1.calculatePL)({
            revenue: revenuePence,
            costs: this._costsPence(b, revenuePence),
        });
        const cashCollectedPence = b.cash != null ? b.cash * 100 : revenuePence;
        const cashflowPence = cashCollectedPence - pl.totalCosts;
        const reservePence = Math.round((pl.totalCosts / 12) * 2);
        const excessCashPence = Math.max(0, cashflowPence - reservePence);
        return {
            basis: 'baseline',
            revenuePence,
            netProfitPence: pl.netProfit,
            marginPct: pl.marginPct,
            totalCostsPence: pl.totalCosts,
            cashCollectedPence,
            cashflowPence,
            reservePence,
            excessCashPence,
        };
    },
    // 12-month series as a DETERMINISTIC projection of the real baseline —
    // not a hardcoded dataset and not "live" history (the app has no monthly
    // ledger). Gentle growth + a 3-month ripple, centred so the trailing
    // average tracks the baseline run-rate. Clock-injected for tests.
    async revenueSeries(orgId, { months = 12, now = () => new Date() } = {}) {
        const health = await analytics_repository_1.analyticsRepository.baselineMaybe(orgId);
        const b = health?.baseline;
        if (!b?.revenue)
            return { error: 'No baseline set' };
        const revenuePence = b.revenue * 100;
        const monthlyBase = revenuePence / 12;
        const marginFrac = b.profit && b.revenue ? b.profit / b.revenue : 0.1;
        const cashFrac = b.cash && b.revenue ? Math.min(1, b.cash / b.revenue) : 1;
        const ref = now();
        const series = [];
        for (let i = months - 1; i >= 0; i--) {
            const idx = months - 1 - i;
            const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
            const factor = 0.94 + 0.012 * idx + 0.02 * (idx % 3);
            const revenue = Math.round(monthlyBase * factor);
            series.push({
                month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                revenue,
                profit: Math.round(revenue * marginFrac),
                cash: Math.round(revenue * cashFrac),
            });
        }
        return { basis: 'baseline-projection', months: series };
    },
    // Per-practice scorecard from REAL data: practices table + sum of
    // settled payments per practice (turnover). There is no real per-practice
    // margin source, so we attach the group baseline margin and flag it
    // groupDerived — honest, not fabricated per-practice splits.
    async practiceSummary(orgId) {
        const [practices, payments, health] = await Promise.all([
            analytics_repository_1.analyticsRepository.practicesList(orgId),
            analytics_repository_1.analyticsRepository.settledPayments(orgId),
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
        ]);
        const b = health?.baseline || {};
        let marginPct = 0;
        if (b.revenue) {
            const revenuePence = b.revenue * 100;
            marginPct = (0, formulas_1.calculatePL)({
                revenue: revenuePence,
                costs: this._costsPence(b, revenuePence),
            }).marginPct;
        }
        const turnoverByPractice = new Map();
        for (const p of payments) {
            if (!p.practice_id)
                continue;
            turnoverByPractice.set(p.practice_id, (turnoverByPractice.get(p.practice_id) || 0) + (p.amount_pence || 0));
        }
        const LIMIT = analytics_repository_1.LIMIT_GUARD;
        return {
            groupDerived: true,
            marginPct,
            truncated: practices.length >= LIMIT || payments.length >= LIMIT,
            practices: practices.map((p) => ({
                name: p.name,
                turnoverPence: turnoverByPractice.get(p.id) || 0,
                marginPct,
            })),
        };
    },
    // ------------------------------------------------------------------------
    // AI-Insights rollups over a rolling window of REAL leads/payments.
    // Definitions are LOCKED (plan-eng-review D-Q2):
    //   conversionRate = (treatment_started + treatment_completed) / total
    //   pipelineValue  = Σ estimated_value_pence of leads NOT in
    //                    {treatment_completed, not_proceeding, failed_to_attend}
    // Practice rollup excludes NULL practice_id; source rollup buckets a
    // missing source as 'Direct/Unknown'. revenue30d = settled payments in
    // the window, grouped by practice. Clock-injected for deterministic tests.
    async aiInsights(orgId, { days = 30, now = () => new Date() } = {}) {
        const sinceISO = new Date(now().getTime() - days * 86400000).toISOString();
        const [leads, payments, practices] = await Promise.all([
            analytics_repository_1.analyticsRepository.leadsInWindow(orgId, sinceISO),
            analytics_repository_1.analyticsRepository.settledPaymentsInWindow(orgId, sinceISO),
            analytics_repository_1.analyticsRepository.practicesList(orgId),
        ]);
        const CONVERTED = new Set(['treatment_started', 'treatment_completed']);
        const NOT_PIPELINE = new Set(['treatment_completed', 'not_proceeding', 'failed_to_attend']);
        const rate = (converted, total) => total ? Math.round((converted / total) * 1000) / 10 : 0;
        const nameById = new Map(practices.map((p) => [p.id, p.name]));
        // Per-practice conversion (exclude NULL practice_id).
        const byPractice = new Map();
        for (const l of leads) {
            if (!l.practice_id)
                continue;
            const a = byPractice.get(l.practice_id) || { total: 0, converted: 0 };
            a.total += 1;
            if (CONVERTED.has(l.status))
                a.converted += 1;
            byPractice.set(l.practice_id, a);
        }
        const revByPractice = new Map();
        for (const p of payments) {
            if (!p.practice_id)
                continue;
            revByPractice.set(p.practice_id, (revByPractice.get(p.practice_id) || 0) + (p.amount_pence || 0));
        }
        const practiceIds = new Set([...byPractice.keys(), ...revByPractice.keys()]);
        const practiceRows = [...practiceIds].map((id) => {
            const a = byPractice.get(id) || { total: 0, converted: 0 };
            return {
                name: nameById.get(id) || 'Unknown',
                conversionRate: rate(a.converted, a.total),
                revenue30dPence: revByPractice.get(id) || 0,
            };
        }).sort((x, y) => x.name.localeCompare(y.name));
        // Per-source conversion + open pipeline value.
        const bySource = new Map();
        for (const l of leads) {
            const key = l.source && l.source.trim() ? l.source : 'Direct/Unknown';
            const a = bySource.get(key) || { leads: 0, converted: 0, pipelineValuePence: 0 };
            a.leads += 1;
            if (CONVERTED.has(l.status))
                a.converted += 1;
            if (!NOT_PIPELINE.has(l.status))
                a.pipelineValuePence += l.estimated_value_pence || 0;
            bySource.set(key, a);
        }
        const sourceRows = [...bySource.entries()].map(([name, a]) => ({
            name,
            conversionRate: rate(a.converted, a.leads),
            leads: a.leads,
            pipelineValuePence: a.pipelineValuePence,
        })).sort((x, y) => y.conversionRate - x.conversionRate);
        const LIMIT = analytics_repository_1.LIMIT_GUARD;
        return {
            basis: 'live',
            days,
            truncated: leads.length >= LIMIT || payments.length >= LIMIT,
            practices: practiceRows,
            sources: sourceRows,
        };
    },
    // Real-AI insights: Claude analyses the live rollups + baseline and writes
    // insight cards. Button-triggered only (token cost) — never on page load.
    // Any failure / no-data returns {error} + empty insights with HTTP 200 so
    // the frontend cleanly falls back to the deterministic rule-based cards.
    async generateInsights(orgId) {
        const [health, insightsData, seriesData] = await Promise.all([
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            this.aiInsights(orgId),
            this.revenueSeries(orgId),
        ]);
        const rawBaseline = health?.baseline || null;
        const hasBaseline = !!rawBaseline && Object.keys(rawBaseline).length > 0;
        const baseline = hasBaseline ? rawBaseline : null;
        const practices = insightsData?.practices || [];
        const sources = insightsData?.sources || [];
        const series = seriesData?.error ? [] : seriesData?.months || [];
        if (!hasBaseline && practices.length === 0 && sources.length === 0) {
            return { basis: 'ai', insights: [], error: 'No data to analyse' };
        }
        try {
            const insights = await claude_1.generateDataInsights({
                baseline,
                series,
                practices,
                sources,
            });
            return { basis: 'ai', insights };
        }
        catch (err) {
            return { basis: 'ai', insights: [], error: 'AI service unavailable' };
        }
    },
};

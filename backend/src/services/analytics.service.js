// ============================================================================
// Analytics service — P&L / valuation / KPI rollups from the saved baseline.
// NOTE: endpoints with no baseline return { error: 'No baseline set' } with a
// 200 status (NOT an error) — preserved exactly from the original.
// ============================================================================
import * as analytics_repository_1 from "../repositories/analytics.repository.js";
import * as formulas_1 from "../lib/formulas.js";
import * as claude_1 from "../lib/claude.js";
import * as monthlyFinancial_repository_1 from "../repositories/monthlyFinancial.repository.js";
import { bucketsByPeriod, plInputFromBuckets, financeSeriesRowFromBuckets } from "./monthlyFinancial.service.js";
export const analyticsService = {
    // Pull monthly_financials actuals and resolve Xero-overrides-manual
    // precedence per period+bucket. Returns the per-period bucket map plus an
    // `annual` sum over the trailing ≤12 periods (for annual P&L / ratios).
    // hasAny=false ⇒ callers fall back to the baseline projection unchanged.
    async _actualsBundle(orgId, practiceId = null) {
        const all = await monthlyFinancial_repository_1.monthlyFinancialRepository.allForOrg(orgId);
        const rows = practiceId
            ? (Array.isArray(all) ? all : []).filter((r) => r.practice_id === practiceId)
            : all;
        const byPeriod = bucketsByPeriod(rows);
        const periods = [...byPeriod.keys()].sort();
        const recent = periods.slice(-12);
        const annual = {};
        for (const p of recent) {
            for (const [k, v] of Object.entries(byPeriod.get(p))) {
                annual[k] = (annual[k] || 0) + v;
            }
        }
        return { byPeriod, annual, hasAny: periods.length > 0, periodsCovered: recent.length };
    },
    async dashboard(orgId) {
        const health = await analytics_repository_1.analyticsRepository.baselineMaybe(orgId);
        const baseline = health?.baseline || {};
        return { baseline };
    },
    async pl(orgId, { practiceId = null } = {}) {
        // Prefer real actuals (Xero/manual) when present — trailing ≤12 months
        // summed into an annual P&L. Falls back to the baseline projection.
        // Per practice: actuals only (the org baseline is not per-practice).
        const actuals = await this._actualsBundle(orgId, practiceId);
        if (actuals.hasAny && (actuals.annual.revenue || 0) > 0) {
            return {
                ...(0, formulas_1.calculatePL)(plInputFromBuckets(actuals.annual)),
                basis: 'actuals',
                periodsCovered: actuals.periodsCovered,
            };
        }
        if (practiceId)
            return { error: 'No data for this practice' };
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
    // Shared deterministic baseline→curve projection. The ONLY source of the
    // growth+ripple math — revenueSeries AND financeSeries both consume this
    // so their monthly revenue is identical. Returns the raw factor + rounded
    // revenue per month; callers derive their own lines (profit/cash, or P&L
    // cost lines) from `revenue`. Keeping `monthlyBase` and the factor
    // expression here verbatim guarantees revenueSeries stays byte-identical
    // after the extraction (regression-gated in test/analytics.test.mjs).
    _projectMonthly(revenuePence, months, now) {
        const monthlyBase = revenuePence / 12;
        const ref = now();
        const out = [];
        for (let i = months - 1; i >= 0; i--) {
            const idx = months - 1 - i;
            const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
            const factor = 0.94 + 0.012 * idx + 0.02 * (idx % 3);
            const revenue = Math.round(monthlyBase * factor);
            out.push({
                month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                factor,
                revenue,
            });
        }
        return out;
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
        const marginFrac = b.profit && b.revenue ? b.profit / b.revenue : 0.1;
        const cashFrac = b.cash && b.revenue ? Math.min(1, b.cash / b.revenue) : 1;
        const series = this._projectMonthly(revenuePence, months, now).map(
            ({ month, revenue }) => ({
                month,
                revenue,
                profit: Math.round(revenue * marginFrac),
                cash: Math.round(revenue * cashFrac),
            }),
        );
        return { basis: 'baseline-projection', months: series };
    },
    // Bucket settled-payment rows into REAL monthly revenue (pence) by
    // processed_at. This is the real revenue source for the P&L — no projection.
    _monthlyRevenueFromPayments(rows) {
        const m = new Map();
        for (const p of Array.isArray(rows) ? rows : []) {
            if (!p.processed_at) continue;
            const d = new Date(p.processed_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            m.set(key, (m.get(key) || 0) + (p.amount_pence || 0));
        }
        return m;
    },
    // 12-month consolidated P&L lines for /profit — REAL data only.
    //   revenue  = real settled payments per month (Dentally/Stripe), OR the
    //              monthly_financials revenue actual when one exists (Xero/manual).
    //   costs    = monthly_financials actuals when present (real), else the
    //              Business Health baseline cost_* applied to the REAL revenue
    //              as a labelled ESTIMATE (per-row `estimated:true`). There is
    //              no real cost source from Dentally — Xero will supply it.
    // No fabricated revenue curve anywhere. `costsEstimated` flags the response
    // when any row's costs are baseline-derived. basis: 'actuals' (all costs
    // real), 'mixed', or 'actuals-revenue' (real revenue, estimated/no costs).
    async financeSeries(orgId, { months = 12, now = () => new Date(), practiceId = null } = {}) {
        const ref = now();
        const startMonth = new Date(ref.getFullYear(), ref.getMonth() - (months - 1), 1);
        const sinceISO = startMonth.toISOString();
        const [health, actuals, payRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            this._actualsBundle(orgId, practiceId),
            analytics_repository_1.analyticsRepository.settledPaymentsInRange(orgId, sinceISO, practiceId),
        ]);
        const revByMonth = this._monthlyRevenueFromPayments(payRows);
        // Org baseline cost_% used as a labelled ESTIMATE of costs against REAL
        // revenue (org-wide and per-practice — there is no per-practice cost
        // source). Flagged estimated per row.
        const b = health?.baseline;
        const hasCostModel = !!(b && b.revenue);
        const pct = (k) => (b?.[k] || 0) / 100;
        const assocPct = pct('cost_associates');
        const staffPct = pct('cost_staff');
        const labMatPct = pct('cost_lab') + pct('cost_materials');
        const opexPct = pct('cost_property') + pct('cost_marketing') + pct('cost_other');
        const keys = [];
        for (let i = months - 1; i >= 0; i--) {
            const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
            keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        let actualCostMonths = 0;
        let estimatedCostMonths = 0;
        const series = keys.map((month) => {
            // Real costs present (Xero/manual) → use them verbatim.
            if (actuals.byPeriod.has(month)) {
                actualCostMonths++;
                return { ...financeSeriesRowFromBuckets(month, actuals.byPeriod.get(month)), estimated: false };
            }
            // Else real revenue from payments + baseline-estimated costs.
            const revenue = revByMonth.get(month) || 0;
            const associatePay = Math.round(revenue * assocPct);
            const staffCosts = Math.round(revenue * staffPct);
            const labMaterials = Math.round(revenue * labMatPct);
            const opex = Math.round(revenue * opexPct);
            const estimated = revenue > 0 && hasCostModel;
            if (estimated) estimatedCostMonths++;
            return {
                month,
                revenue,
                associatePay,
                staffCosts,
                labMaterials,
                opex,
                profit: revenue - associatePay - staffCosts - labMaterials - opex,
                estimated,
            };
        });
        const basis = estimatedCostMonths === 0 && actualCostMonths > 0 ? 'actuals'
            : actualCostMonths > 0 && estimatedCostMonths > 0 ? 'mixed'
            : 'actuals-revenue';
        return { basis, costsEstimated: estimatedCostMonths > 0, months: series };
    },
    // 13-week REAL cash view (backward-looking, no projection). Each week =
    // sum of REAL settled payments received in that week (by processed_at),
    // deduped by payment id (webhook re-delivery must not double-count) and
    // skipping null processed_at. Opening = real bank balance (0 + flags if no
    // bank / stale sync); closing is the running balance. There are no
    // projected receipts and no cost line (Dentally has no cost source) — so
    // the baseline weekly run-rate is returned separately as a comparison
    // target only, never mixed into the real numbers. practiceId scopes the
    // receipts to one practice. basis is always 'actuals'.
    async cashflow(orgId, { weeks = 13, now = () => new Date(), practiceId = null } = {}) {
        const [bank, health] = await Promise.all([
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
        ]);
        const ref = now();
        const DAY = 86400000, WEEK = 7 * DAY;
        const refMid = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
        const windowEnd = refMid + DAY; // include all of today
        const startMs = windowEnd - weeks * WEEK; // backward window start
        const sinceISO = new Date(startMs).toISOString();
        const realPayments = await analytics_repository_1.analyticsRepository.settledPaymentsForCashflow(orgId, sinceISO, practiceId);
        // Dedupe by payment id, skip null processed_at, bucket by backward week.
        const seenIds = new Set();
        const byWeek = new Map();
        for (const p of realPayments) {
            if (!p.processed_at || seenIds.has(p.id))
                continue;
            seenIds.add(p.id);
            const wk = Math.floor((new Date(p.processed_at).getTime() - startMs) / WEEK);
            if (wk < 0 || wk >= weeks)
                continue;
            byWeek.set(wk, (byWeek.get(wk) || 0) + (p.amount_pence || 0));
        }
        const openingStart = bank.totalPence || 0;
        let opening = openingStart;
        const out = [];
        for (let wi = 0; wi < weeks; wi++) {
            const d = new Date(startMs + wi * WEEK);
            const receiptsPence = byWeek.get(wi) || 0;
            const closingBalancePence = opening + receiptsPence;
            out.push({
                weekStartDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                openingBalancePence: opening,
                receiptsPence,
                paymentsPence: 0,
                closingBalancePence,
            });
            opening = closingBalancePence;
        }
        const b = health?.baseline;
        const STALE_MS = 7 * DAY;
        const bankStale = !bank.lastSyncedAt ||
            (ref.getTime() - new Date(bank.lastSyncedAt).getTime()) > STALE_MS;
        return {
            basis: 'actuals',
            bankConnected: bank.count > 0,
            bankStale,
            lastSyncedAt: bank.lastSyncedAt,
            openingBalancePence: openingStart,
            totalReceiptsPence: out.reduce((s, w) => s + w.receiptsPence, 0),
            // Comparison target only — owner's Business Health run-rate, never
            // mixed into the real receipts above.
            baselineWeeklyRunRatePence: b?.revenue ? Math.round((b.revenue * 100) / 52) : null,
            weeks: out,
        };
    },
    // /financial — Key Ratios + Balance Sheet. Margins are REAL (baseline
    // P&L). The balance sheet has NO accounting source: every line is
    // ESTIMATED from baseline + owner-supplied assumptions (DSO / payable
    // days). Each estimated field carries estimated:true and the response
    // carries basis:'estimated' so the UI can banner it and never present it
    // as filed accounts.
    async financial(orgId, { dsoDays = 45, payableDays = 30, practiceId = null, now = () => new Date() } = {}) {
        const since = new Date(now());
        since.setMonth(since.getMonth() - 12);
        const sinceISO = since.toISOString();
        const [health, actuals, payRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            this._actualsBundle(orgId, practiceId),
            analytics_repository_1.analyticsRepository.settledPaymentsInRange(orgId, sinceISO, practiceId),
        ]);
        const b = health?.baseline;
        const realRevenuePence = (Array.isArray(payRows) ? payRows : [])
            .reduce((s, p) => s + (p.amount_pence || 0), 0);
        const useActuals = actuals.hasAny && (actuals.annual.revenue || 0) > 0;
        // Per practice: never fall back to the org baseline as if it were the
        // practice's. Real per-practice data (actuals or payments) or nothing.
        if (practiceId && !useActuals && realRevenuePence === 0)
            return { error: 'No data for this practice' };
        // Revenue precedence: monthly_financials actuals (real costs too) >
        // REAL settled payments TTM (costs estimated from baseline) > baseline
        // revenue (legacy, only if no real data at all).
        let revenuePence, costs, costsEstimated;
        if (useActuals) {
            const inp = plInputFromBuckets(actuals.annual);
            revenuePence = inp.revenue;
            costs = inp.costs;
            costsEstimated = false;
        } else if (realRevenuePence > 0) {
            revenuePence = realRevenuePence;
            costs = b ? this._costsPence(b, realRevenuePence)
                : { associates: 0, lab: 0, materials: 0, staff: 0, property: 0, marketing: 0, other: 0 };
            costsEstimated = true; // margins not transaction-backed (no cost source)
        } else if (b?.revenue) {
            revenuePence = b.revenue * 100;
            costs = this._costsPence(b, revenuePence);
            costsEstimated = true;
        } else {
            return { error: practiceId ? 'No data for this practice' : 'No baseline set' };
        }
        const pl = (0, formulas_1.calculatePL)({ revenue: revenuePence, costs });
        const cogsPence = costs.associates + costs.lab + costs.materials;
        const grossProfitPence = revenuePence - cogsPence;
        const grossMarginPct = revenuePence > 0
            ? Math.round((grossProfitPence / revenuePence) * 1000) / 10
            : 0;
        // ESTIMATED balance sheet — driven by owner assumptions.
        const cashPence = b?.cash != null ? b.cash * 100 : revenuePence;
        const receivablesPence = Math.round((revenuePence / 365) * dsoDays);
        const payablesPence = Math.round((pl.totalCosts / 365) * payableDays);
        const currentAssetsPence = cashPence + receivablesPence;
        const currentLiabilitiesPence = payablesPence;
        const equityPence = currentAssetsPence - currentLiabilitiesPence;
        const ratio = (n, d) => (d > 0 ? Math.round((n / d) * 100) / 100 : 0);
        const light = (v, amber, green) =>
            v >= green ? 'green' : v >= amber ? 'amber' : 'red';
        return {
            basis: 'estimated',
            assumptions: { dsoDays, payableDays },
            ratios: [
                { key: 'grossMarginPct', value: grossMarginPct, estimated: costsEstimated, light: light(grossMarginPct, 30, 40) },
                { key: 'netMarginPct', value: pl.marginPct, estimated: costsEstimated, light: light(pl.marginPct, 10, 18) },
                { key: 'currentRatio', value: ratio(currentAssetsPence, currentLiabilitiesPence), estimated: true, light: light(ratio(currentAssetsPence, currentLiabilitiesPence), 1, 1.5) },
                { key: 'quickRatio', value: ratio(currentAssetsPence, currentLiabilitiesPence), estimated: true, light: light(ratio(currentAssetsPence, currentLiabilitiesPence), 0.8, 1) },
                { key: 'debtToEquity', value: ratio(currentLiabilitiesPence, equityPence), estimated: true, light: 'amber' },
                { key: 'daysSalesOutstanding', value: dsoDays, estimated: true, light: light(60 - dsoDays, 10, 25) },
            ],
            balanceSheet: {
                cashPence: { value: cashPence, estimated: b?.cash == null },
                receivablesPence: { value: receivablesPence, estimated: true },
                currentAssetsPence: { value: currentAssetsPence, estimated: true },
                payablesPence: { value: payablesPence, estimated: true },
                currentLiabilitiesPence: { value: currentLiabilitiesPence, estimated: true },
                equityPence: { value: equityPence, estimated: true },
            },
        };
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
    // ------------------------------------------------------------------------
    // Business Hub — the "overview of the whole business": group totals + a
    // per-practice comparison joining Finance (settled payments), Ops
    // (appointments → utilisation/DNA), and Growth (leads → conversion). Group
    // target/margin comes from the org's business_health baseline. All amounts
    // integer pence. Zeroes are correct when a source hasn't been fed yet.
    //
    //   payments(settled) ─┐
    //   appointments ──────┼─▶ group + per-practice rollup ─▶ Business Hub
    //   leads ─────────────┘
    //   business_health baseline ─▶ group revenue target + margin
    async businessHub(orgId, { days = 90, now = () => new Date() } = {}) {
        const sinceISO = new Date(now().getTime() - days * 86400000).toISOString();
        const [practices, payments, appts, leads, health] = await Promise.all([
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
            analytics_repository_1.analyticsRepository.settledPayments(orgId),
            analytics_repository_1.analyticsRepository.appointmentsForHub(orgId, sinceISO),
            analytics_repository_1.analyticsRepository.leadsForHub(orgId),
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
        ]);
        const CONVERTED = new Set(['treatment_started', 'treatment_completed']);
        const rate = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

        // Per-practice accumulators.
        const acc = new Map();
        const seed = () => ({ revenuePence: 0, appts: 0, completed: 0, noShows: 0, leads: 0, converted: 0 });
        const get = (id) => { if (!acc.has(id)) acc.set(id, seed()); return acc.get(id); };
        for (const p of payments) if (p.practice_id) get(p.practice_id).revenuePence += p.amount_pence || 0;
        for (const a of appts) {
            if (!a.practice_id) continue;
            const r = get(a.practice_id);
            r.appts += 1;
            if (a.status === 'completed') r.completed += 1;
            if (a.status === 'no_show') r.noShows += 1;
        }
        for (const l of leads) {
            if (!l.practice_id) continue;
            const r = get(l.practice_id);
            r.leads += 1;
            if (CONVERTED.has(l.status)) r.converted += 1;
        }

        const practiceRows = practices.map((p) => {
            const r = acc.get(p.id) || seed();
            return {
                practiceId: p.id,
                name: p.name,
                chairs: p.chairs || 0,
                revenuePence: r.revenuePence,
                appointments: r.appts,
                completed: r.completed,
                noShows: r.noShows,
                noShowRate: rate(r.noShows, r.appts),
                leads: r.leads,
                conversionRate: rate(r.converted, r.leads),
            };
        }).sort((a, b) => b.revenuePence - a.revenuePence);

        // Group totals.
        const sum = (k) => practiceRows.reduce((s, p) => s + p[k], 0);
        const totalRevenue = sum('revenuePence');
        const totalAppts = sum('appointments');
        const totalNoShows = sum('noShows');
        const totalLeads = sum('leads');
        const totalConverted = practiceRows.reduce((s, p) => s + Math.round((p.conversionRate / 100) * p.leads), 0);

        // Group target from baseline (org-level, not per-practice).
        const b = health?.baseline || {};
        let marginPct = 0;
        let revenueTargetPence = 0;
        if (b.revenue) {
            const revenuePence = b.revenue * 100;
            revenueTargetPence = revenuePence;
            marginPct = formulas_1.calculatePL({ revenue: revenuePence, costs: this._costsPence(b, revenuePence) }).marginPct;
        }
        const LIMIT = analytics_repository_1.LIMIT_GUARD;
        return {
            period: { days, since: sinceISO },
            group: {
                practices: practiceRows.length,
                revenuePence: totalRevenue,
                revenueTargetPence,
                marginPct,
                appointments: totalAppts,
                noShows: totalNoShows,
                noShowRate: rate(totalNoShows, totalAppts),
                leads: totalLeads,
                conversionRate: rate(totalConverted, totalLeads),
            },
            practices: practiceRows,
            truncated: payments.length >= LIMIT || appts.length >= LIMIT || leads.length >= LIMIT,
        };
    },
};

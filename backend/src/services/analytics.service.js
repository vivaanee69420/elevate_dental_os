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
    // Turn a validated scope param into a concrete entity filter. Single source
    // (CQ2) so the 6-branch switch isn't copy-pasted across controllers. Only
    // academy/lab need a DB lookup (to resolve their entity ids) — one query,
    // never a per-entity loop (Perf #1). Returns:
    //   { mode, practiceIds, kinds, isAggregate, entities? }
    // practiceIds === null means "no id filter" (all rows of the given kinds).
    async resolveScope(orgId, scope = 'all') {
        if (scope === 'all')
            return { mode: 'all', practiceIds: null, kinds: ['practice', 'academy', 'lab'], isAggregate: true };
        if (scope === 'practices')
            return { mode: 'practices', practiceIds: null, kinds: ['practice'], isAggregate: true };
        if (scope === 'academy' || scope === 'lab') {
            const entities = await analytics_repository_1.analyticsRepository.entitiesByKind(orgId, scope);
            return { mode: scope, practiceIds: entities.map((e) => e.id), kinds: [scope], isAggregate: false, entities };
        }
        // Otherwise a specific practice UUID (already shape-validated by scopeQuerySchema).
        return { mode: 'entity', practiceIds: [scope], kinds: ['practice'], isAggregate: false };
    },
    // Chair Efficiency view (GM Intelligence OS). Per-practice chair economics:
    // occupancy, cost-of-empty-chairs, recoverable-to-benchmark, plus a group
    // recovery projection. Single fetch + in-memory join (no N+1, Perf #1).
    // Revenue is REAL (trailing-12mo settled receipts per practice). utilPct is
    // an owner-editable assumption (practices.assumed_util_pct; defaults to
    // DEFAULT_UTIL_PCT when unset, flagged utilAssumed=true).
    // OCPSPD + profit-per-chair-hour are deferred (need per-practice opex +
    // treatment-minute sourcing) — formulas exist + tested, wiring pending.
    async chairAnalytics(orgId, { scope = 'all', recoverPctPoints = 10, now = () => new Date() } = {}) {
        const DEFAULT_UTIL_PCT = 80;
        const resolved = await this.resolveScope(orgId, scope);
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { applicable: false, scope: resolved.mode,
                message: 'Chair analytics measure clinical surgery capacity — switch scope to the group or a practice.' };
        }
        let practices = await analytics_repository_1.analyticsRepository.practicesFull(orgId);
        if (resolved.mode === 'entity')
            practices = practices.filter((p) => resolved.practiceIds.includes(p.id));

        // Trailing 12 months of settled receipts = annual revenue per practice.
        const since = new Date(now());
        since.setUTCFullYear(since.getUTCFullYear() - 1);
        const revRows = await analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, since.toISOString());
        const revByPractice = new Map(revRows.map((r) => [r.practice_id, Number(r.pence) || 0]));

        const rows = practices.map((p) => {
            const utilAssumed = p.assumed_util_pct == null;
            const utilPct = utilAssumed ? DEFAULT_UTIL_PCT : p.assumed_util_pct;
            const annualRevenuePence = revByPractice.get(p.id) || 0;
            const stats = (0, formulas_1.calculateChairStats)({ chairs: p.chairs || 0, utilPct, annualRevenuePence });
            return { id: p.id, name: p.name, utilAssumed, annualRevenuePence, ...stats };
        });

        // Group rollup — sum hours/£, blended occupancy + yield/hr.
        const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
        const capHrsYr = sum((r) => r.capHrsYr);
        const bookedHrsYr = sum((r) => r.bookedHrsYr);
        const annualRevenuePence = sum((r) => r.annualRevenuePence);
        const groupOccupancyPct = capHrsYr > 0 ? Math.round((bookedHrsYr / capHrsYr) * 1000) / 10 : 0;
        const blendedRevPerBookedHrPence = bookedHrsYr > 0 ? Math.round(annualRevenuePence / bookedHrsYr) : 0;
        const group = {
            chairs: sum((r) => r.chairs),
            capHrsYr,
            bookedHrsYr,
            emptyHrsYr: sum((r) => r.emptyHrsYr),
            occupancyPct: groupOccupancyPct,
            lostPotentialYrPence: sum((r) => r.lostPotentialYrPence),
            recoverRevYrPence: sum((r) => r.recoverRevYrPence),
            revPotentialYrPence: sum((r) => r.revPotentialYrPence),
            blendedRevPerBookedHrPence,
        };
        const recovery = (0, formulas_1.chairRecovery)({
            capHrsYr, upliftPctPoints: recoverPctPoints,
            revPerBookedHrPence: blendedRevPerBookedHrPence, currentOccupancyPct: groupOccupancyPct,
        });

        return {
            applicable: true,
            scope,
            config: formulas_1.CHAIR_CONFIG,
            practices: rows,
            group,
            recovery,
            // Deferred: need per-practice opex + treatment-minute sourcing.
            ocpspd: null,
            profitPerChairHour: null,
            note: 'OCPSPD and profit-per-chair-hour pending per-practice opex/treatment-minute sourcing.',
        };
    },
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
    // Command Centre summary — EXACT real data, real-or-zero (no baseline).
    // revenue = monthly_financials actuals when present, else exact settled
    // payments (TTM). Costs/profit/margin REAL only with a cost source, else 0.
    // cashCollected = exact settled receipts (TTM); cashflow = real bank balance.
    // reserve needs a cost run-rate we don't have → 0; excess = bank.
    async dashboardSummary(orgId, { now = () => new Date(), from = null, to = null, practiceId = null } = {}) {
        // Period: a custom [from,to] range (MTD/QTD/6M/YTD from the UI) overrides
        // the trailing 12-month window. Revenue/cash are scoped to the period.
        let sinceISO, untilISO, ranged = false;
        if (from && to) {
            const [fy, fm, fd] = from.split('-').map(Number);
            const [ty, tm, td] = to.split('-').map(Number);
            sinceISO = new Date(fy, fm - 1, fd).toISOString();
            untilISO = new Date(ty, tm - 1, td, 23, 59, 59).toISOString();
            ranged = true;
        } else {
            const since = new Date(now());
            since.setMonth(since.getMonth() - 12);
            sinceISO = since.toISOString();
            untilISO = null;
        }
        const [dayRows, actuals, bank] = await Promise.all([
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            this._actualsBundle(orgId, practiceId),
            // Bank balance is org-level (not per practice) → only used for "All".
            practiceId ? Promise.resolve({ totalPence: 0 }) : analytics_repository_1.analyticsRepository.bankSummary(orgId),
        ]);
        const periodRevenue = (Array.isArray(dayRows) ? dayRows : []).reduce((s, r) => s + Number(r.pence || 0), 0);
        const bankPence = bank.totalPence || 0;
        // Real costs only apply to the trailing window (monthly_financials is
        // annual, not period-sliceable) — for a custom range, costs/profit are 0.
        const useActuals = !ranged && actuals.hasAny && (actuals.annual.revenue || 0) > 0;
        let revenuePence = periodRevenue, totalCostsPence = 0, netProfitPence = 0, marginPct = 0;
        if (useActuals) {
            const inp = plInputFromBuckets(actuals.annual);
            const pl = (0, formulas_1.calculatePL)(inp);
            revenuePence = inp.revenue;
            totalCostsPence = pl.totalCosts;
            netProfitPence = pl.netProfit;
            marginPct = pl.marginPct;
        }
        return {
            basis: useActuals ? 'actuals' : 'revenue-only',
            revenuePence,
            netProfitPence,
            marginPct,
            totalCostsPence,
            cashCollectedPence: periodRevenue,
            cashflowPence: bankPence,
            reservePence: 0,
            excessCashPence: bankPence,
        };
    },
    // 12-month revenue series — EXACT real settled payments per month (RPC), no
    // projection. profit/cash are 0 (no real per-month source until Xero/bank
    // history). Feeds the dashboard chart + AI-insights input.
    async revenueSeries(orgId, { months = 12, now = () => new Date(), from = null, to = null, practiceId = null } = {}) {
        const ref = now();
        const { keys, sinceISO, untilISO } = this._monthWindow(ref, months, from, to);
        const dayRows = await analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO);
        const revByMonth = this._monthlyRevenueFromDays(dayRows);
        const series = keys.map((month) => ({
            month,
            revenue: revByMonth.get(month) || 0,
            profit: 0,
            cash: 0,
        }));
        return { basis: 'revenue-only', months: series };
    },
    // Resolve the month window: a custom [from,to] range (YYYY-MM-DD) overrides
    // the trailing `months` window. Returns month keys (YYYY-MM, capped at 36)
    // plus the RPC since/until bounds. untilISO null = open (trailing window).
    _monthWindow(ref, months, from, to) {
        const pad = (n) => String(n).padStart(2, '0');
        if (from && to) {
            const [fy, fm] = from.split('-').map(Number);
            const [ty, tm] = to.split('-').map(Number);
            const keys = [];
            let y = fy, m = fm;
            while ((y < ty || (y === ty && m <= tm)) && keys.length < 36) {
                keys.push(`${y}-${pad(m)}`);
                m++; if (m > 12) { m = 1; y++; }
            }
            return {
                keys,
                sinceISO: new Date(fy, fm - 1, 1).toISOString(),
                untilISO: new Date(ty, tm, 0, 23, 59, 59).toISOString(), // last day of `to` month
            };
        }
        const keys = [];
        for (let i = months - 1; i >= 0; i--) {
            const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
            keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
        }
        const startMonth = new Date(ref.getFullYear(), ref.getMonth() - (months - 1), 1);
        return { keys, sinceISO: startMonth.toISOString(), untilISO: null };
    },
    // Bucket exact daily settled-receipt rows ([{day:'YYYY-MM-DD', pence}]) into
    // REAL monthly revenue (pence). The day string's first 7 chars are YYYY-MM.
    _monthlyRevenueFromDays(rows) {
        const m = new Map();
        for (const r of Array.isArray(rows) ? rows : []) {
            const key = String(r.day).slice(0, 7);
            if (key.length !== 7) continue;
            m.set(key, (m.get(key) || 0) + Number(r.pence || 0));
        }
        return m;
    },
    // 12-month consolidated P&L lines for /profit — EXACT data only, no estimate.
    //   revenue = exact real settled payments per month (RPC sum; or the
    //             monthly_financials revenue actual when one exists).
    //   costs   = monthly_financials actuals when present (real). When there is
    //             NO real cost source, cost lines AND profit are 0 (we do not
    //             have them — never estimated from the baseline). `costsAvailable`
    //             marks each row; `costsAvailable` (top) is true only when every
    //             non-zero-revenue month has real costs.
    // basis: 'actuals' (all real costs) | 'mixed' | 'revenue-only' (real revenue,
    // costs/profit 0 — connect Xero for costs).
    async financeSeries(orgId, { months = 12, now = () => new Date(), practiceId = null, from = null, to = null } = {}) {
        const ref = now();
        const { keys, sinceISO, untilISO } = this._monthWindow(ref, months, from, to);
        const [actuals, dayRows] = await Promise.all([
            this._actualsBundle(orgId, practiceId),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
        ]);
        const revByMonth = this._monthlyRevenueFromDays(dayRows);
        let actualCostMonths = 0;
        let revenueOnlyMonths = 0;
        const series = keys.map((month) => {
            // Real costs present (Xero/manual) → use them verbatim.
            if (actuals.byPeriod.has(month)) {
                actualCostMonths++;
                return { ...financeSeriesRowFromBuckets(month, actuals.byPeriod.get(month)), costsAvailable: true };
            }
            // No real cost source → exact revenue, costs and profit 0 (not estimated).
            const revenue = revByMonth.get(month) || 0;
            if (revenue > 0) revenueOnlyMonths++;
            return {
                month,
                revenue,
                associatePay: 0,
                staffCosts: 0,
                labMaterials: 0,
                opex: 0,
                profit: 0,
                costsAvailable: false,
            };
        });
        const basis = revenueOnlyMonths === 0 && actualCostMonths > 0 ? 'actuals'
            : actualCostMonths > 0 && revenueOnlyMonths > 0 ? 'mixed'
            : 'revenue-only';
        return { basis, costsAvailable: revenueOnlyMonths === 0 && actualCostMonths > 0, months: series };
    },
    // 13-week REAL cash view (backward-looking, no projection, no baseline).
    // Each week = EXACT settled receipts that week (RPC daily sums bucketed by
    // week, all UTC-normalised). Opening = real bank balance (0 + flags if no
    // bank / stale sync); closing is the running balance. No projected receipts,
    // no cost line, no baseline comparison — only real money in. practiceId
    // scopes the receipts to one practice. basis is always 'actuals'.
    async cashflow(orgId, { weeks = 13, now = () => new Date(), practiceId = null, from = null, to = null } = {}) {
        const ref = now();
        const DAY = 86400000, WEEK = 7 * DAY;
        // All date math in local time, and day strings parsed as local midnight,
        // so week bucketing is timezone-consistent (no UTC/local boundary skew).
        let startMs, windowEnd, untilISO;
        if (from && to) {
            const [fy, fm, fd] = from.split('-').map(Number);
            const [ty, tm, td] = to.split('-').map(Number);
            startMs = new Date(fy, fm - 1, fd).getTime();
            const endMs = new Date(ty, tm - 1, td).getTime() + DAY;
            weeks = Math.min(53, Math.max(1, Math.ceil((endMs - startMs) / WEEK)));
            windowEnd = startMs + weeks * WEEK;
            untilISO = new Date(endMs).toISOString();
        } else {
            const todayLocal = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
            windowEnd = todayLocal + DAY; // include all of today
            startMs = windowEnd - weeks * WEEK; // backward window start
            untilISO = null;
        }
        const sinceISO = new Date(startMs).toISOString();
        const [bank, dayRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
        ]);
        const dayToMs = (s) => {
            const [Y, M, D] = String(s).slice(0, 10).split('-').map(Number);
            return new Date(Y, (M || 1) - 1, D || 1).getTime();
        };
        const byWeek = new Map();
        for (const r of dayRows) {
            const dayMs = dayToMs(r.day);
            if (Number.isNaN(dayMs)) continue;
            const wk = Math.floor((dayMs - startMs) / WEEK);
            if (wk < 0 || wk >= weeks) continue;
            byWeek.set(wk, (byWeek.get(wk) || 0) + Number(r.pence || 0));
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
            weeks: out,
        };
    },
    // /financial — Key Ratios + Balance Sheet, EXACT data only (no baseline,
    // no assumption-driven estimates). Revenue = exact settled-payment TTM (RPC)
    // or monthly_financials actual. Costs/margins are REAL only when there is a
    // cost source (monthly_financials); otherwise they are 0 (we do NOT have
    // them — never estimated). Balance sheet shows only real bank cash; every
    // other line is 0 until a real accounting source exists. Nothing is flagged
    // `estimated` because nothing is estimated — it is real or zero.
    async financial(orgId, { dsoDays = 45, payableDays = 30, practiceId = null, now = () => new Date(), from = null, to = null } = {}) {
        let sinceISO, untilISO;
        if (from && to) {
            const [fy, fm, fd] = from.split('-').map(Number);
            const [ty, tm, td] = to.split('-').map(Number);
            sinceISO = new Date(fy, fm - 1, fd).toISOString();
            untilISO = new Date(ty, tm - 1, td, 23, 59, 59).toISOString();
        } else {
            const since = new Date(now());
            since.setMonth(since.getMonth() - 12);
            sinceISO = since.toISOString();
            untilISO = null;
        }
        const [actuals, dayRows, bank] = await Promise.all([
            this._actualsBundle(orgId, practiceId),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            practiceId ? Promise.resolve({ totalPence: 0, count: 0 }) : analytics_repository_1.analyticsRepository.bankSummary(orgId),
        ]);
        const realRevenuePence = (Array.isArray(dayRows) ? dayRows : [])
            .reduce((s, r) => s + Number(r.pence || 0), 0);
        const useActuals = actuals.hasAny && (actuals.annual.revenue || 0) > 0;
        if (!useActuals && realRevenuePence === 0)
            return { error: practiceId ? 'No data for this practice' : 'No revenue data' };
        // Revenue: monthly_financials actual (real costs too) else exact payments.
        let revenuePence, costs, costsAvailable;
        if (useActuals) {
            const inp = plInputFromBuckets(actuals.annual);
            revenuePence = inp.revenue;
            costs = inp.costs;
            costsAvailable = true;
        } else {
            revenuePence = realRevenuePence;
            costs = { associates: 0, lab: 0, materials: 0, staff: 0, property: 0, marketing: 0, other: 0 };
            costsAvailable = false; // no real cost source → costs/profit/margins 0
        }
        const pl = (0, formulas_1.calculatePL)({ revenue: revenuePence, costs });
        const cogsPence = costs.associates + costs.lab + costs.materials;
        // Margins are real only with a cost source; otherwise 0 (not 100%).
        const grossMarginPct = costsAvailable && revenuePence > 0
            ? Math.round(((revenuePence - cogsPence) / revenuePence) * 1000) / 10
            : 0;
        const netMarginPct = costsAvailable ? pl.marginPct : 0;
        // Balance sheet: ONLY real bank cash. No accounting source for the rest
        // → 0 (no assumption-derived receivables/payables).
        const cashPence = bank.totalPence || 0;
        const currentAssetsPence = cashPence;
        const ratio = (n, d) => (d > 0 ? Math.round((n / d) * 100) / 100 : 0);
        const light = (v, amber, green) =>
            v >= green ? 'green' : v >= amber ? 'amber' : 'red';
        const zero = { value: 0, estimated: false };
        return {
            basis: costsAvailable ? 'actuals' : 'revenue-only',
            costsAvailable,
            revenuePence,
            assumptions: { dsoDays, payableDays },
            ratios: [
                { key: 'grossMarginPct', value: grossMarginPct, estimated: false, light: light(grossMarginPct, 30, 40) },
                { key: 'netMarginPct', value: netMarginPct, estimated: false, light: light(netMarginPct, 10, 18) },
                { key: 'currentRatio', value: 0, estimated: false, light: 'red' },
                { key: 'quickRatio', value: 0, estimated: false, light: 'red' },
                { key: 'debtToEquity', value: 0, estimated: false, light: 'green' },
                { key: 'daysSalesOutstanding', value: 0, estimated: false, light: 'red' },
            ],
            balanceSheet: {
                cashPence: { value: cashPence, estimated: false },
                receivablesPence: zero,
                currentAssetsPence: { value: currentAssetsPence, estimated: false },
                payablesPence: zero,
                currentLiabilitiesPence: zero,
                equityPence: { value: currentAssetsPence, estimated: false },
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
    // Business Hub — group totals + per-practice comparison. EXACT per-practice
    // rollups via Postgres GROUP BY RPCs (no 1000-row cap): revenue (settled
    // payments), ops (appointments → completed/DNA), growth (leads → conversion).
    // Group revenue target = business_health baseline (a goal). Group margin is
    // REAL only when monthly_financials actuals exist, else 0 (never estimated).
    async businessHub(orgId, { days = 90, now = () => new Date() } = {}) {
        const sinceISO = new Date(now().getTime() - days * 86400000).toISOString();
        const [practices, revRows, apptRows, leadRows, actuals, health] = await Promise.all([
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceISO),
            analytics_repository_1.analyticsRepository.appointmentsRollupByPractice(orgId, sinceISO),
            analytics_repository_1.analyticsRepository.leadsRollupByPractice(orgId),
            this._actualsBundle(orgId),
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
        ]);
        const rate = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
        const num = (v) => Number(v || 0);
        const revBy = new Map(revRows.map((r) => [r.practice_id, num(r.pence)]));
        const apBy = new Map(apptRows.map((r) => [r.practice_id, r]));
        const ldBy = new Map(leadRows.map((r) => [r.practice_id, r]));

        const practiceRows = practices.map((p) => {
            const ap = apBy.get(p.id) || {};
            const ld = ldBy.get(p.id) || {};
            const appointments = num(ap.total);
            const noShows = num(ap.no_shows);
            const leads = num(ld.total);
            const converted = num(ld.converted);
            return {
                practiceId: p.id,
                name: p.name,
                chairs: p.chairs || 0,
                revenuePence: revBy.get(p.id) || 0,
                appointments,
                completed: num(ap.completed),
                noShows,
                noShowRate: rate(noShows, appointments),
                leads,
                conversionRate: rate(converted, leads),
            };
        }).sort((a, b) => b.revenuePence - a.revenuePence);

        // Group totals (sum of exact per-practice rows). totalConverted recomputed
        // from raw rollups so it isn't lost to per-practice rounding.
        const sum = (k) => practiceRows.reduce((s, p) => s + p[k], 0);
        const totalRevenue = sum('revenuePence');
        const totalAppts = sum('appointments');
        const totalNoShows = sum('noShows');
        const totalLeads = sum('leads');
        const totalConverted = leadRows.reduce((s, r) => s + num(r.converted), 0);

        // Revenue target = baseline goal (owner-set). Margin REAL or 0.
        const b = health?.baseline || {};
        const revenueTargetPence = b.revenue ? b.revenue * 100 : 0;
        const marginPct = (actuals.hasAny && (actuals.annual.revenue || 0) > 0)
            ? formulas_1.calculatePL(plInputFromBuckets(actuals.annual)).marginPct
            : 0;
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
            truncated: false, // exact SQL rollups — never truncated
        };
    },
};

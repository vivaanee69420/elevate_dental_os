// ============================================================================
// Business Health service — setup wizard data, snapshots, progress, insights.
// Role rules preserved exactly:
//  - GET /     : reception gets a stub; others get the record.
//  - PUT /     : owner-only.
//  - /insights : owner-only.
//  - POST /snapshots : owner-only.
// ============================================================================
import * as business_health_repository_1 from "../repositories/business-health.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as claude_1 from "../lib/claude.js";
import * as formulas_1 from "../lib/formulas.js";
import { analyticsService } from "./analytics.service.js";
import { METRIC_CATALOG, METRIC_BY_KEY } from "../lib/health-metrics.js";
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
export const businessHealthService = {
    async get(orgId, role) {
        if (role === 'reception') {
            return { setup_completed: false, baseline: {}, targets: {} };
        }
        const data = await business_health_repository_1.businessHealthRepository.getHealth(orgId);
        return data || {
            setup_step: 0,
            setup_completed: false,
            baseline: {},
            targets: {},
        };
    },
    async update(orgId, role, body) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Only owners can edit business health', 403);
        }
        // Upsert
        const existing = await business_health_repository_1.businessHealthRepository.getExisting(orgId);
        const payload = {
            organisation_id: orgId,
            ...body,
        };
        // Merge baseline/targets if existing
        if (existing) {
            if (body.baseline)
                payload.baseline = { ...existing.baseline, ...body.baseline };
            if (body.targets)
                payload.targets = { ...existing.targets, ...body.targets };
        }
        // If marking complete for the first time, set timestamp + capture baseline snapshot
        if (body.setup_completed && (!existing || !existing.baseline?.completed_at)) {
            payload.setup_completed_at = new Date().toISOString();
            // Capture baseline snapshot
            const baseline = payload.baseline || existing?.baseline || {};
            await business_health_repository_1.businessHealthRepository.insertSnapshot({
                organisation_id: orgId,
                snapshot_date: new Date().toISOString().split('T')[0],
                label: 'Baseline',
                metrics: {
                    revenue: baseline.revenue,
                    profit: baseline.profit,
                    cash: baseline.cash,
                    conversion: baseline.conversion,
                    case_value: baseline.case_value,
                    fta_rate: baseline.fta_rate,
                    chair_util: baseline.utilisation,
                    active_patients: baseline.active_patients,
                    new_per_month: baseline.new_per_month,
                },
            });
        }
        const { data, error } = await business_health_repository_1.businessHealthRepository.upsertHealth(payload);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async insights(orgId, role) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Owner-only', 403);
        }
        const health = await business_health_repository_1.businessHealthRepository.getInsightsData(orgId);
        if (!health)
            throw new errors_1.AppError('No health data found', 404);
        try {
            const insights = await (0, claude_1.generateHealthInsights)(health.baseline, health.targets);
            return { insights };
        }
        catch (err) {
            throw new errors_1.AppError('AI service unavailable', 500);
        }
    },
    async listSnapshots(orgId) {
        const data = await business_health_repository_1.businessHealthRepository.listSnapshots(orgId);
        return { snapshots: data || [] };
    },
    async createSnapshot(orgId, role, body) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Owner-only', 403);
        }
        const { data, error } = await business_health_repository_1.businessHealthRepository.insertSnapshotReturning({
            organisation_id: orgId,
            snapshot_date: new Date().toISOString().split('T')[0],
            label: body.label || 'Manual',
            metrics: body.metrics,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async progress(orgId) {
        const health = await business_health_repository_1.businessHealthRepository.getProgressData(orgId);
        if (!health?.setup_completed_at) {
            return { completed: false };
        }
        const snapshots = await business_health_repository_1.businessHealthRepository.listSnapshots(orgId);
        const baseline = health.baseline;
        const targets = health.targets;
        const [summary, hub] = await Promise.all([
            analyticsService.dashboardSummary(orgId),
            analyticsService.businessHub(orgId),
        ]);
        // Real where a source exists; baseline-hold (honest, no fabrication)
        // for the three metrics with no live source yet.
        const latest = {
            revenue: round1(summary.revenuePence / 100),
            profit: round1(summary.netProfitPence / 100),
            cash: round1(summary.cashflowPence / 100),
            conversion: round1(hub.group.conversionRate),
            case_value: baseline.case_value,
            fta_rate: round1(hub.group.noShowRate),
            chair_util: baseline.utilisation,
            new_per_month: baseline.new_per_month,
        };
        const targetProfit = baseline.profit * (targets.profit_multiple || 2);
        const cagr = (0, formulas_1.calculateCAGR)(baseline.profit, targetProfit, targets.years || 3);
        const metrics = [
            { key: 'revenue', label: 'Annual revenue', baseline: baseline.revenue, current: latest.revenue, target: targets.target_revenue || baseline.revenue * 2, better: 'higher', source: summary.basis },
            { key: 'profit', label: 'Net profit', baseline: baseline.profit, current: latest.profit, target: targetProfit, better: 'higher', source: summary.basis },
            { key: 'cash', label: 'Cash at bank', baseline: baseline.cash, current: latest.cash, target: baseline.cash * 1.5, better: 'higher', source: 'bank' },
            { key: 'conversion', label: 'Lead conversion %', baseline: baseline.conversion, current: latest.conversion, target: 18, better: 'higher', source: 'live' },
            { key: 'case_value', label: 'Average case value', baseline: baseline.case_value, current: latest.case_value, target: baseline.case_value * 1.15, better: 'higher', source: 'baseline' },
            { key: 'fta_rate', label: 'FTA rate %', baseline: baseline.fta_rate, current: latest.fta_rate, target: 2.5, better: 'lower', source: 'live' },
            { key: 'chair_util', label: 'Chair utilisation %', baseline: baseline.utilisation, current: latest.chair_util, target: 88, better: 'higher', source: 'baseline' },
            { key: 'new_per_month', label: 'New patients/month', baseline: baseline.new_per_month, current: latest.new_per_month, target: baseline.new_per_month * 1.4, better: 'higher', source: 'baseline' },
        ];
        const progress = metrics.map(m => ({
            ...m,
            ...(0, formulas_1.calculateProgress)({
                baseline: m.baseline,
                current: m.current,
                target: m.target,
                better: m.better,
            }),
        }));
        return {
            completed: true,
            setup_completed_at: health.setup_completed_at,
            target_year: new Date(new Date(health.setup_completed_at).setFullYear(new Date(health.setup_completed_at).getFullYear() + (targets.years || 3))).getFullYear(),
            required_cagr_pct: cagr,
            target_profit: targetProfit,
            metrics: progress,
            snapshots: snapshots || [],
        };
    },
    async metrics(orgId, role) {
        if (role === 'reception') return { metrics: [] };
        const health = await business_health_repository_1.businessHealthRepository.getMetricsData(orgId);
        const baseline = health?.baseline || {};
        const targets = health?.targets || {};
        const manual = health?.manual || {};
        const [summary, hub] = await Promise.all([
            analyticsService.dashboardSummary(orgId),
            analyticsService.businessHub(orgId),
        ]);
        const auto = {
            annual_revenue:    { value: round1(summary.revenuePence / 100), source: summary.basis },
            net_profit:        { value: round1(summary.netProfitPence / 100), source: summary.basis },
            net_profit_margin: { value: round1(summary.marginPct), source: summary.basis },
            cash_at_bank:      { value: round1(summary.cashflowPence / 100), source: 'bank' },
            lead_to_treatment: { value: round1(hub.group.conversionRate), source: 'live' },
            fta_no_show_rate:  { value: round1(hub.group.noShowRate), source: 'live' },
        };
        const metrics = METRIC_CATALOG.map((m) => {
            let current = null, source, asof = null, needsInput = false;
            if (m.sourceType === 'auto') {
                const a = auto[m.key] || {};
                current = a.value ?? null;
                source = a.source || 'live';
            } else {
                const entry = manual[m.key];
                source = 'manual';
                if (entry && typeof entry.value === 'number') {
                    current = entry.value;
                    asof = entry.asof || null;
                } else {
                    needsInput = true;
                }
            }
            const baselineVal = baseline[m.key] ?? null;
            const target = targets[m.key] ?? m.target ?? null;
            const prog = (current != null && baselineVal != null && target != null)
                ? (0, formulas_1.calculateProgress)({ baseline: baselineVal, current, target, better: m.better })
                : { progressPct: 0, deltaFromBaselinePct: 0, remainingToTarget: null };
            return {
                key: m.key, label: m.label, cat: m.cat, unit: m.unit, better: m.better,
                sourceType: m.sourceType, source, asof, needsInput,
                baseline: baselineVal, current, target, ...prog,
            };
        });
        return { metrics };
    },
    async updateCadence(orgId, role, body) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Only owners can change snapshot cadence', 403);
        }
        await business_health_repository_1.businessHealthRepository.updateCadence(orgId, body.snapshot_frequency);
        return { ok: true, snapshot_frequency: body.snapshot_frequency };
    },
};

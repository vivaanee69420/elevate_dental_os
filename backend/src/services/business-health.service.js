"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessHealthService = void 0;
// ============================================================================
// Business Health service — setup wizard data, snapshots, progress, insights.
// Role rules preserved exactly:
//  - GET /     : reception gets a stub; others get the record.
//  - PUT /     : owner-only.
//  - /insights : owner-only.
//  - POST /snapshots : owner-only.
// ============================================================================
const business_health_repository_1 = require("../repositories/business-health.repository");
const errors_1 = require("../middleware/errors");
const claude_1 = require("../lib/claude");
const formulas_1 = require("../lib/formulas");
exports.businessHealthService = {
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
        const latest = snapshots?.[snapshots.length - 1]?.metrics || baseline;
        const targetProfit = baseline.profit * (targets.profit_multiple || 2);
        const cagr = (0, formulas_1.calculateCAGR)(baseline.profit, targetProfit, targets.years || 3);
        const metrics = [
            { key: 'revenue', label: 'Annual revenue', baseline: baseline.revenue, current: latest.revenue, target: targets.target_revenue || baseline.revenue * 2, better: 'higher' },
            { key: 'profit', label: 'Net profit', baseline: baseline.profit, current: latest.profit, target: targetProfit, better: 'higher' },
            { key: 'cash', label: 'Cash at bank', baseline: baseline.cash, current: latest.cash, target: baseline.cash * 1.5, better: 'higher' },
            { key: 'conversion', label: 'Lead conversion %', baseline: baseline.conversion, current: latest.conversion, target: 18, better: 'higher' },
            { key: 'case_value', label: 'Average case value', baseline: baseline.case_value, current: latest.case_value, target: baseline.case_value * 1.15, better: 'higher' },
            { key: 'fta_rate', label: 'FTA rate %', baseline: baseline.fta_rate, current: latest.fta_rate, target: 2.5, better: 'lower' },
            { key: 'chair_util', label: 'Chair utilisation %', baseline: baseline.utilisation, current: latest.chair_util, target: 88, better: 'higher' },
            { key: 'new_per_month', label: 'New patients/month', baseline: baseline.new_per_month, current: latest.new_per_month, target: baseline.new_per_month * 1.4, better: 'higher' },
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
};

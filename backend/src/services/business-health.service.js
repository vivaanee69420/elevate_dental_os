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
import * as claude_1 from "../lib/gemini.js";
import * as formulas_1 from "../lib/formulas.js";
import { analyticsService } from "./analytics.service.js";
import { METRIC_CATALOG, METRIC_BY_KEY } from "../lib/health-metrics.js";
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const todayStr = () => new Date().toISOString().split('T')[0];
const numOrNull = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? null : Number(n));
const penceToPounds = (p) => (p == null ? null : round1(Number(p) / 100));

// Live actuals for the hybrid (computed:true) KPIs, in the units the catalog
// expects (% / count / £). Each source is awaited independently and guarded so
// a missing RPC/table (e.g. before migration 000056 lands, or a non-Dentally
// org) degrades that metric to its manual fallback — never throws. Trailing
// 12-month window for production/lead-response; patient KPIs window internally.
async function resolveComputed(orgId) {
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const sinceISO = since.toISOString();
    const repo = business_health_repository_1.businessHealthRepository;
    const safe = (p) => p.catch(() => null);
    const [patient, production, chairUtil, leadResp] = await Promise.all([
        safe(repo.patientActuals(orgId, null)),
        safe(repo.productionActuals(orgId, sinceISO, null)),
        safe(repo.chairUtilisationSummary(orgId)),
        safe(repo.leadResponseActual(orgId, sinceISO)),
    ]);
    const p = patient || {};
    const prod = production || {};
    return {
        new_patients_month: numOrNull(p.new_patients_month),
        active_patients: numOrNull(p.active_patients),
        retention_12mo: numOrNull(p.retention_12mo),
        recall_compliance: numOrNull(p.recall_compliance),
        chair_utilisation: numOrNull(chairUtil),
        avg_case_value: penceToPounds(prod.avg_case_value_pence),
        production_per_associate: penceToPounds(prod.production_per_associate_pence),
        lead_response_time: numOrNull(leadResp),
    };
}

// Capture a point-in-time copy of the owner's manual inputs (000054) so a past
// period can later show what baseline/targets/manual KPIs WERE at that time.
// `current` is the just-saved business_health row when the caller already has
// it (avoids a re-read); otherwise we fetch it.
async function captureInputs(orgId, current) {
    const row = current || (await business_health_repository_1.businessHealthRepository.getMetricsData(orgId)) || {};
    await business_health_repository_1.businessHealthRepository.upsertInputsSnapshot(orgId, todayStr(), {
        baseline: row.baseline || {},
        targets: row.targets || {},
        manual: row.manual || {},
    });
}

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
        if (body.setup_completed && (!existing || !existing.setup_completed_at)) {
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
        // History: stamp today's manual-input snapshot from the just-saved row.
        await captureInputs(orgId, data);
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
    async progress(orgId, { asOf = null } = {}) {
        const health = await business_health_repository_1.businessHealthRepository.getProgressData(orgId);
        if (!health?.setup_completed_at) {
            return { completed: false };
        }
        const snapshots = await business_health_repository_1.businessHealthRepository.listSnapshots(orgId);
        // As-of read: rewind the manual baseline/targets anchor to `asOf`.
        const snap = asOf ? await business_health_repository_1.businessHealthRepository.getInputsAsOf(orgId, asOf) : null;
        const baseline = snap?.baseline || health.baseline;
        const targets = snap?.targets || health.targets;
        const [summary, hub] = await Promise.all([
            analyticsService.dashboardSummary(orgId, asOf ? { to: new Date(asOf) } : {}),
            analyticsService.businessHub(orgId, asOf ? { until: asOf } : {}),
        ]);
        // Live computed actuals (case value / chair util / new patients) from
        // the same Dentally-backed RPCs the scorecard uses. Live-only — a past
        // as-of view has no RPC history, so it holds the manual baseline. Each
        // source is guarded; a null falls back to baseline (honest, no fake).
        const computed = !asOf ? await resolveComputed(orgId) : {};
        // Real where a source exists; baseline-hold (honest, no fabrication)
        // when a live source returns null.
        const latest = {
            revenue: round1(summary.revenuePence / 100),
            profit: round1(summary.netProfitPence / 100),
            // Bank position, not operating cashflow — dashboardSummary now
            // separates the two. Null-safe: no bank feed => hold the baseline.
            cash: summary.bankBalancePence == null ? baseline.cash : round1(summary.bankBalancePence / 100),
            conversion: round1(hub.group.conversionRate),
            case_value: computed.avg_case_value ?? baseline.case_value,
            fta_rate: round1(hub.group.noShowRate),
            chair_util: computed.chair_utilisation ?? baseline.utilisation,
            new_per_month: computed.new_patients_month ?? baseline.new_per_month,
        };
        const liveCase = computed.avg_case_value != null;
        const liveChair = computed.chair_utilisation != null;
        const liveNew = computed.new_patients_month != null;
        const targetProfit = baseline.profit * (targets.profit_multiple || 2);
        const cagr = (0, formulas_1.calculateCAGR)(baseline.profit, targetProfit, targets.years || 3);
        const metrics = [
            { key: 'revenue', label: 'Annual revenue', baseline: baseline.revenue, current: latest.revenue, target: targets.target_revenue || baseline.revenue * 2, better: 'higher', source: summary.basis },
            { key: 'profit', label: 'Net profit', baseline: baseline.profit, current: latest.profit, target: targetProfit, better: 'higher', source: summary.basis },
            { key: 'cash', label: 'Cash at bank', baseline: baseline.cash, current: latest.cash, target: baseline.cash * 1.5, better: 'higher', source: 'bank' },
            { key: 'conversion', label: 'Lead conversion %', baseline: baseline.conversion, current: latest.conversion, target: 18, better: 'higher', source: 'live' },
            { key: 'case_value', label: 'Average case value', baseline: baseline.case_value, current: latest.case_value, target: baseline.case_value * 1.15, better: 'higher', source: liveCase ? 'live' : 'baseline' },
            { key: 'fta_rate', label: 'FTA rate %', baseline: baseline.fta_rate, current: latest.fta_rate, target: 2.5, better: 'lower', source: 'live' },
            { key: 'chair_util', label: 'Chair utilisation %', baseline: baseline.utilisation, current: latest.chair_util, target: 88, better: 'higher', source: liveChair ? 'live' : 'baseline' },
            { key: 'new_per_month', label: 'New patients/month', baseline: baseline.new_per_month, current: latest.new_per_month, target: baseline.new_per_month * 1.4, better: 'higher', source: liveNew ? 'live' : 'baseline' },
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
    async metrics(orgId, role, { asOf = null } = {}) {
        if (role === 'reception') return { metrics: [] };
        // As-of read: rewind manual baseline/targets/KPIs to what they WERE on
        // `asOf`; live (auto) metrics window to the same upper bound.
        let baseline, targets, manual;
        if (asOf) {
            const snap = await business_health_repository_1.businessHealthRepository.getInputsAsOf(orgId, asOf);
            baseline = snap?.baseline || {};
            targets = snap?.targets || {};
            manual = snap?.manual || {};
        } else {
            const health = await business_health_repository_1.businessHealthRepository.getMetricsData(orgId);
            baseline = health?.baseline || {};
            targets = health?.targets || {};
            manual = health?.manual || {};
        }
        const [summary, hub] = await Promise.all([
            analyticsService.dashboardSummary(orgId, asOf ? { to: new Date(asOf) } : {}),
            analyticsService.businessHub(orgId, asOf ? { until: asOf } : {}),
        ]);
        // Net profit / margin are only real on the 'actuals' basis (cost feed
        // present — QuickBooks/Xero/manual costs). On 'revenue-only' (e.g. a
        // Dentally-only org with no cost feed) calculatePL yields 0 cost → 0
        // profit / 0% margin, which would render as a real "£0 profit" tile and
        // read as a genuine zero, not "no data". Null them out instead so the
        // tile shows "—" / "no data" and prompts the owner to connect accounting.
        const hasActualProfit = summary.basis === 'actuals';
        const auto = {
            annual_revenue:    { value: round1(summary.revenuePence / 100), source: summary.basis },
            net_profit:        { value: hasActualProfit ? round1(summary.netProfitPence / 100) : null, source: hasActualProfit ? summary.basis : 'no data' },
            net_profit_margin: { value: hasActualProfit ? round1(summary.marginPct) : null,           source: hasActualProfit ? summary.basis : 'no data' },
            cash_at_bank:      { value: summary.bankBalancePence == null ? null : round1(summary.bankBalancePence / 100), source: summary.bankBalancePence == null ? 'no data' : 'bank' },
            lead_to_treatment: { value: round1(hub.group.conversionRate), source: 'live' },
            fta_no_show_rate:  { value: round1(hub.group.noShowRate), source: 'live' },
        };
        // Hybrid computed actuals — live only (a past as-of view replays the
        // manual snapshot instead; chair/recall history is not RPC-derivable).
        // A null key here means "no source data" -> fall back to manual below.
        // Each source is independently guarded so a missing RPC/table degrades
        // that one metric to manual rather than failing the whole scorecard.
        const computed = !asOf ? await resolveComputed(orgId) : {};
        const metrics = METRIC_CATALOG.map((m) => {
            let current = null, source, asof = null, needsInput = false;
            let sourceType = m.sourceType;
            if (m.sourceType === 'auto') {
                const a = auto[m.key] || {};
                current = a.value ?? null;
                source = a.source || 'live';
                // An auto metric with no live value (e.g. profit before a cost
                // feed is connected) is "no data", not a real zero.
                if (current == null) needsInput = true;
            } else if (m.computed && computed[m.key] != null) {
                // Live computed value wins over a stale manual entry and renders
                // as an auto/source-chip tile.
                current = computed[m.key];
                source = m.computedSource || 'live';
                sourceType = 'auto';
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
                sourceType, source, asof, needsInput,
                baseline: baselineVal, current, target, ...prog,
            };
        });
        return { metrics };
    },
    async updateMetric(orgId, role, key, value) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Only owners can edit metrics', 403);
        }
        const meta = METRIC_BY_KEY[key];
        if (!meta) {
            throw new errors_1.AppError(`Unknown metric: ${key}`, 400);
        }
        if (meta.sourceType !== 'manual') {
            throw new errors_1.AppError(`Metric ${key} is computed automatically and cannot be set manually`, 400);
        }
        const asof = todayStr();
        const entry = { value, asof };
        await business_health_repository_1.businessHealthRepository.setManualMetric(orgId, key, entry);
        // History: stamp today's manual-input snapshot with the new KPI value.
        await captureInputs(orgId);
        return entry;
    },
    async updateCadence(orgId, role, body) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Only owners can change snapshot cadence', 403);
        }
        await business_health_repository_1.businessHealthRepository.updateCadence(orgId, body.snapshot_frequency);
        return { ok: true, snapshot_frequency: body.snapshot_frequency };
    },
};

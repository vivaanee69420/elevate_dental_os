// ============================================================================
// Analytics service — P&L / valuation / KPI rollups from the saved baseline.
// NOTE: endpoints with no baseline return { error: 'No baseline set' } with a
// 200 status (NOT an error) — preserved exactly from the original.
// ============================================================================
import * as analytics_repository_1 from "../repositories/analytics.repository.js";
import { integrationRepository as integration_repository_1 } from "../repositories/integration.repository.js";
import * as formulas_1 from "../lib/formulas.js";
import * as claude_1 from "../lib/gemini.js";
import * as monthlyFinancial_repository_1 from "../repositories/monthlyFinancial.repository.js";
import { quickbooksFinanceRepository } from "../repositories/quickbooks-finance.repository.js";
import * as associate_repository_1 from "../repositories/associate.repository.js";
import * as payRun_repository_1 from "../repositories/pay-run.repository.js";
import * as valuationInputs_repository_1 from "../repositories/valuationInputs.repository.js";
import * as chairConfig_repository_1 from "../repositories/chairConfig.repository.js";
import * as plSheet_repository_1 from "../repositories/plSheet.repository.js";
import { boardReportRepository } from "../repositories/boardReport.repository.js";
import { orgSettingsRepository } from "../repositories/orgSettings.repository.js";
import { businessHealthRepository } from "../repositories/business-health.repository.js";
import * as aws_ses_1 from "../lib/aws-ses.js";
import { bucketsByPeriod, accountLinesByPeriod, plInputFromBuckets, financeSeriesRowFromBuckets, sumBucketsInWindow } from "./monthlyFinancial.service.js";
import { debtService } from "./debt.service.js";
import { getProvider } from "../lib/ai/index.js";
import { checkBudget, recordUsage } from "../lib/ai/guardrails.js";
import { overlayPeriodReach } from "../lib/marketing-reach.js";
import { fetchPeriodReach } from "../lib/integrations/meta-reach.js";
import { londonParts, londonMonthKey } from "../lib/tz.js";
import * as async_pool_1 from "../lib/async-pool.js";
import * as dashboard_cache_1 from "../lib/dashboard-cache.js";
import { createTtlCache } from "../lib/ttl-cache.js";

// Business Hub payload cache. The endpoint recomputes 16 heavy aggregates per
// call; the same org+window is requested repeatedly (reloads, tab switches,
// two panels on one screen). 60s is short enough that a finished sync shows up
// promptly and long enough to collapse a burst into one computation.
const businessHubCache = createTtlCache({ ttlMs: 60_000, max: 300 });
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
    //
    // DATA LINEAGE:
    //   revenue   = REAL (trailing-12mo settled receipts per practice).
    //   occupancy = the MANUAL chair-utilisation grid (booked/available minutes,
    //               owner-maintained — intentional single source of truth).
    //               No grid data for a practice -> blank: zero capacity/occupancy/
    //               cost (no assumption), flagged occupancySource='none'. The
    //               practice goes live only once its grid is filled.
    //   occupancySource: 'manual' (grid) | 'none' (empty grid).
    // Cost-of-empty / recoverable are modelled off occupancy + chair capacity.
    // OCPSPD + profit-per-chair-hour still deferred.
    async chairAnalytics(orgId, { scope = 'all', recoverPctPoints = 10, since: winSince, until: winUntil, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { applicable: false, scope: resolved.mode,
                message: 'Chair analytics measure clinical surgery capacity — switch scope to the group or a practice.' };
        }
        let practices = await analytics_repository_1.analyticsRepository.practicesFull(orgId);
        if (resolved.mode === 'entity')
            practices = practices.filter((p) => resolved.practiceIds.includes(p.id));

        // Revenue (window if supplied, else trailing 12mo) + the manual chair-
        // utilisation grid (manual, never date-scoped). One query each, aggregated
        // in memory (no N+1).
        let sinceIso, untilIso = null;
        if (winSince && winUntil) {
            sinceIso = new Date(winSince).toISOString();
            untilIso = new Date(winUntil).toISOString();
        } else {
            const s = new Date(now());
            s.setUTCFullYear(s.getUTCFullYear() - 1);
            sinceIso = s.toISOString();
        }
        const [revRows, gridRows, config] = await Promise.all([
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceIso, untilIso),
            analytics_repository_1.analyticsRepository.chairUtilisationRows(orgId),
            this.getChairConfig(orgId),
        ]);
        const revByPractice = new Map(revRows.map((r) => [r.practice_id, Number(r.pence) || 0]));
        // Per-practice manual occupancy = Σ booked / Σ available. The chair count
        // is the DISTINCT chair_name in the grid (the owner-maintained source of
        // truth) — not the stale practices.chairs field, so adding a surgery row
        // scales capacity immediately.
        const grid = new Map(); // practiceId -> { booked, available, revenue, chairs:Set }
        for (const g of gridRows) {
            const a = grid.get(g.practice_id) || { booked: 0, available: 0, revenue: 0, chairs: new Set() };
            a.booked += g.booked_minutes || 0;
            a.available += g.available_minutes || 0;
            a.revenue += g.revenue_pence || 0;
            if (g.chair_name) a.chairs.add(g.chair_name);
            grid.set(g.practice_id, a);
        }
        // Yield per booked chair-hour from the owner-entered grid revenue
        // (Σ revenue / Σ booked hrs — period-independent £/hr). The manual source
        // of truth, replacing the settled-receipts-derived yield on this screen.
        const yieldPerHrPence = (gm) => {
            const bookedHrs = gm.booked / 60;
            return bookedHrs > 0 ? Math.round(gm.revenue / bookedHrs) : 0;
        };

        const rows = practices.map((p) => {
            const annualRevenuePence = revByPractice.get(p.id) || 0;
            const gm = grid.get(p.id);
            const hasManual = !!gm && gm.available > 0;
            if (!hasManual) {
                // No manual chair-utilisation grid -> honest blank: zero capacity,
                // occupancy and cost (no 80% fallback). The practice only becomes
                // "live" once its grid is filled in Chair Utilisation. Real revenue
                // is preserved on the row but yields nothing without booked hours.
                const stats = (0, formulas_1.calculateChairStats)({ chairs: 0, utilPct: 0, annualRevenuePence, config });
                return { id: p.id, name: p.name, utilAssumed: false, occupancySource: 'none', annualRevenuePence, ...stats };
            }
            const utilPct = Math.min(100, Math.round((gm.booked / gm.available) * 1000) / 10);
            // Distinct chairs in the grid is the live chair count; fall back to the
            // practices.chairs field only if no chair_name was recorded.
            const chairs = gm.chairs.size || p.chairs || 0;
            const stats = (0, formulas_1.calculateChairStats)({
                chairs, utilPct, annualRevenuePence,
                revPerBookedHrPence: yieldPerHrPence(gm), config,
            });
            return { id: p.id, name: p.name, utilAssumed: false, occupancySource: 'manual', annualRevenuePence, ...stats };
        });

        // Group rollup — sum hours/£, blended occupancy + yield/hr. Blended yield
        // comes from the grid revenue across in-scope practices (Σ revenue / Σ
        // booked hrs), matching the per-practice manual yield.
        const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
        const capHrsYr = sum((r) => r.capHrsYr);
        const bookedHrsYr = sum((r) => r.bookedHrsYr);
        const annualRevenuePence = sum((r) => r.annualRevenuePence);
        const groupOccupancyPct = capHrsYr > 0 ? Math.round((bookedHrsYr / capHrsYr) * 1000) / 10 : 0;
        let groupGridRevenue = 0, groupGridBookedMin = 0;
        for (const p of practices) {
            const gm = grid.get(p.id);
            if (gm && gm.available > 0) { groupGridRevenue += gm.revenue; groupGridBookedMin += gm.booked; }
        }
        const blendedRevPerBookedHrPence = groupGridBookedMin > 0
            ? Math.round(groupGridRevenue / (groupGridBookedMin / 60)) : 0;
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
            config,
            practices: rows,
            group,
            recovery,
            // Deferred: need per-practice opex + treatment-minute sourcing.
            ocpspd: null,
            profitPerChairHour: null,
            note: 'OCPSPD and profit-per-chair-hour pending per-practice opex/treatment-minute sourcing.',
        };
    },

    // ── Phase 3 / T12 — persisted CONFIG ────────────────────────────────────
    // valuation_inputs and chair_config are per-org saved drivers. Reads merge
    // the saved row over the code defaults; writes upsert the single per-org row
    // (gated on valuation.edit / finance.edit at the route, audited).

    // Saved valuation drivers in the camelCase shape POST /compute/valuation
    // consumes, or null when never configured (the UI then shows its own seed).
    async getValuationInputs(orgId) {
        const row = await valuationInputs_repository_1.valuationInputsRepository.get(orgId);
        if (!row) return null;
        return {
            reportedEbitdaPence: Number(row.reported_ebitda_pence) || 0,
            addBacksPence: Number(row.addbacks_pence) || 0,
            principalSalaryPence: Number(row.principal_salary_pence) || 0,
            principalMultiple: Number(row.principal_multiple) || 0,
            associateMultiple: Number(row.associate_multiple) || 0,
            dsoMultiple: Number(row.dso_multiple) || 0,
            regionFactor: row.region_factor == null ? 1 : Number(row.region_factor),
            growthRatePct: row.growth_rate_pct == null ? 10 : Number(row.growth_rate_pct),
            uiState: row.ui_state ?? null,
            updatedAt: row.updated_at,
        };
    },
    // Persist the validated valuation state. state is the camelCase
    // valuationInputsSchema output; map to the snake_case columns.
    async saveValuationInputs(orgId, state, userId) {
        await valuationInputs_repository_1.valuationInputsRepository.upsert(orgId, {
            reported_ebitda_pence: state.reportedEbitdaPence,
            addbacks_pence: state.addBacksPence,
            principal_salary_pence: state.principalSalaryPence,
            principal_multiple: state.principalMultiple,
            associate_multiple: state.associateMultiple,
            dso_multiple: state.dsoMultiple,
            region_factor: state.regionFactor,
            growth_rate_pct: state.growthRatePct,
            ui_state: state.uiState ?? null,
        }, userId);
        return this.getValuationInputs(orgId);
    },
    // Effective chair config = lib/formulas.js CHAIR_CONFIG defaults overlaid
    // with the saved per-org row (when present). Always returns a full config so
    // the chair formulas never see undefined keys.
    async getChairConfig(orgId) {
        const row = await chairConfig_repository_1.chairConfigRepository.get(orgId);
        if (!row) return { ...formulas_1.CHAIR_CONFIG, isDefault: true };
        return {
            openHrs: row.open_hrs == null ? formulas_1.CHAIR_CONFIG.openHrs : Number(row.open_hrs),
            weeksYr: row.weeks_yr == null ? formulas_1.CHAIR_CONFIG.weeksYr : Number(row.weeks_yr),
            daysWk: row.days_wk == null ? formulas_1.CHAIR_CONFIG.daysWk : Number(row.days_wk),
            benchOccPct: row.bench_occ_pct == null ? formulas_1.CHAIR_CONFIG.benchOccPct : Number(row.bench_occ_pct),
            benchRevHrPence: row.bench_rev_hr_pence == null ? formulas_1.CHAIR_CONFIG.benchRevHrPence : Number(row.bench_rev_hr_pence),
            isDefault: false,
            updatedAt: row.updated_at,
        };
    },
    async saveChairConfig(orgId, cfg, userId) {
        await chairConfig_repository_1.chairConfigRepository.upsert(orgId, {
            open_hrs: cfg.openHrs,
            weeks_yr: cfg.weeksYr,
            days_wk: cfg.daysWk,
            bench_occ_pct: cfg.benchOccPct,
            bench_rev_hr_pence: cfg.benchRevHrPence,
        }, userId);
        return this.getChairConfig(orgId);
    },

    // ── Phase 3 / T13 — editable P&L scenario sheets ────────────────────────
    // SCENARIO OVERLAY ONLY: these sheets are standalone planning grids. They
    // never override the real actuals P&L and never feed EBITDA/valuation (the
    // finance screens stay real-actuals-or-zero). CRUD + CSV export.
    async listPlSheets(orgId) {
        return plSheet_repository_1.plSheetRepository.list(orgId);
    },
    async getPlSheet(orgId, id) {
        return plSheet_repository_1.plSheetRepository.get(orgId, id);
    },
    async createPlSheet(orgId, fields, userId) {
        return plSheet_repository_1.plSheetRepository.create(orgId, fields, userId);
    },
    async updatePlSheet(orgId, id, fields, userId) {
        return plSheet_repository_1.plSheetRepository.update(orgId, id, fields, userId);
    },
    async deletePlSheet(orgId, id) {
        return plSheet_repository_1.plSheetRepository.remove(orgId, id);
    },
    // Render a saved sheet to CSV (lines x columns, money as £ with 2 decimals
    // from integer pence). Pure — no persistence. Returns { filename, csv }.
    plSheetToCsv(sheet) {
        const cols = Array.isArray(sheet.cols) ? sheet.cols : [];
        const lines = Array.isArray(sheet.lines) ? sheet.lines : [];
        const cells = sheet.cells && typeof sheet.cells === 'object' ? sheet.cells : {};
        const esc = (v) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const poundsFromPence = (p) => (Number(p) / 100).toFixed(2);
        const header = ['Line', ...cols.map((c) => c.label || c.id)];
        const rows = lines.map((ln) => {
            const cellVals = cols.map((c) => {
                const v = cells[`${ln.id}:${c.id}`];
                return v == null ? '' : poundsFromPence(v);
            });
            return [ln.label || ln.id, ...cellVals];
        });
        const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
        const safeName = String(sheet.name || 'pl-sheet').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        return { filename: `${safeName}.csv`, csv };
    },
    // Treatment Mix heat matrix (GM Intelligence OS, Phase 2). Appointment
    // VOLUME by treatment type x practice for the selected scope + period. This
    // is clinical ACTIVITY, not revenue: Dentally appointments carry no price
    // (data wall), so there is intentionally no £ here. Scope/period-driven.
    //
    //   columns = practices in scope (sorted by volume desc)
    //   rows    = appointment types (top 12 by volume; the long tail rolls into
    //             one honest 'Other' row so the matrix stays readable)
    //   cell    = appointment count for (type, practice) in the window
    //
    // Insights are volume-framed (top treatment, single-site concentration,
    // busiest practice, Pareto breadth) — never money.
    async treatmentMatrix(orgId, { scope = 'all', period = 'month', periodKey, since: winSince, until: winUntil, label: winLabel, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { applicable: false, scope: resolved.mode,
                message: 'Treatment mix measures clinical appointment volume — switch scope to the group or a practice.' };
        }
        const { since, until, label } = resolveWindow({ since: winSince, until: winUntil, label: winLabel, period, periodKey, now: now() });

        let practicesAll = await analytics_repository_1.analyticsRepository.practicesFull(orgId);
        if (resolved.mode === 'entity')
            practicesAll = practicesAll.filter((p) => resolved.practiceIds.includes(p.id));
        const nameById = new Map(practicesAll.map((p) => [p.id, p.name]));

        const raw = await analytics_repository_1.analyticsRepository.treatmentMixMatrix(orgId, since, until);
        // Keep only appointments belonging to a practice in scope (drops stray
        // academy/lab rows and out-of-scope practices for an entity view).
        const rows = raw.filter((r) => nameById.has(r.practice_id));

        const m = assembleMixMatrix(practicesAll, rows, (r) => r.appointment_type, (r) => r.volume);
        const insights = buildMixInsights({
            grandTotal: m.grandTotal, sortedTypes: m.sortedTypes, practices: m.practices,
            practiceTotals: m.practiceTotals, cell: m.cell, nameById,
        });

        return {
            applicable: true,
            scope,
            period,
            window: { since, until, label },
            practices: m.practices,
            types: m.typeRows,
            distinctTypes: m.distinctTypes,
            grandTotal: m.grandTotal,
            maxCell: m.maxCell,
            insights,
            note: 'Appointment volume only — Dentally provides no per-treatment price, so this ranks clinical activity, not revenue.',
        };
    },
    // Treatment REVENUE heat matrix (GM Intelligence OS, Phase 2). Real invoiced
    // FEE by treatment name x practice for the selected scope + period, from
    // invoice_items (the real per-treatment fee feed). Money in integer pence.
    // This is the patient FEE (retail) — NOT the practice's cost; lab/material
    // cost is never in the Dentally feed and stays owner-entered in the workbench.
    // Same matrix shape as treatmentMatrix so the frontend can toggle Volume/£.
    async treatmentRevenueMatrix(orgId, { scope = 'all', period = 'month', periodKey, since: winSince, until: winUntil, label: winLabel, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { applicable: false, scope: resolved.mode,
                message: 'Treatment revenue measures clinical invoiced fees — switch scope to the group or a practice.' };
        }
        const { since, until, label } = resolveWindow({ since: winSince, until: winUntil, label: winLabel, period, periodKey, now: now() });

        let practicesAll = await analytics_repository_1.analyticsRepository.practicesFull(orgId);
        if (resolved.mode === 'entity')
            practicesAll = practicesAll.filter((p) => resolved.practiceIds.includes(p.id));
        const nameById = new Map(practicesAll.map((p) => [p.id, p.name]));

        const raw = await analytics_repository_1.analyticsRepository.treatmentRevenueMatrix(orgId, since, until);
        const rows = raw.filter((r) => nameById.has(r.practice_id));

        const m = assembleMixMatrix(practicesAll, rows, (r) => r.treatment_name, (r) => r.fee_pence);
        const insights = buildRevenueInsights({
            grandTotal: m.grandTotal, sortedTypes: m.sortedTypes, practices: m.practices,
            cell: m.cell, nameById,
        });

        return {
            applicable: true,
            scope,
            period,
            window: { since, until, label },
            practices: m.practices,
            types: m.typeRows,
            distinctTypes: m.distinctTypes,
            grandTotal: m.grandTotal,   // total fee in pence
            maxCell: m.maxCell,         // biggest single cell in pence
            insights,
            basis: 'invoice_items',
            hasData: m.grandTotal > 0,
            note: 'Real invoiced fees from Dentally (patient price). Lab/material cost is not in the feed — set it in the Workbench.',
        };
    },
    // Flat "by treatment" breakdown for the CRM Reports card. Real invoiced fee +
    // distinct patient count per treatment_name (from invoice_items), org-wide,
    // optionally windowed [since, until). Sorted by fee desc, top `limit`. Money
    // in integer pence. This replaces the old GHL-leads grouping (which grouped
    // by opp.name — junk like "New Lead || 22/03/2026").
    async treatmentBreakdown(orgId, { since = null, until = null, limit = 24 } = {}) {
        const rows = await analytics_repository_1.analyticsRepository.treatmentBreakdown(orgId, since, until);
        const treatments = rows
            .filter((r) => r.item_count > 0)
            .sort((a, b) => b.fee_pence - a.fee_pence)
            .slice(0, Math.max(1, Math.min(100, limit)));
        const grandTotal = rows.reduce((s, r) => s + r.fee_pence, 0);
        return {
            treatments,                 // [{ treatment_name, fee_pence, item_count, patient_count }]
            grandTotal,                 // total invoiced fee in pence (all treatments)
            basis: 'invoice_items',
            hasData: grandTotal > 0,
            note: 'Real invoiced fees from Dentally, grouped by treatment. Patients = unique invoiced patients per treatment.',
        };
    },
    // Drill-down behind the "Plan Fees Collected" card — every treatment-plan
    // invoice line in the SAME window the card uses, plus canonical totals (from
    // the aggregate RPC, which rounds the summed products once) so the header
    // reconciles to the tile EXACTLY. Window rules mirror businessHub(): an
    // explicit [since, until] wins, else the trailing N-day window. Optional
    // practiceId scopes both the lines and the totals to one practice.
    async planFeesLines(orgId, { days = 90, since = null, until = null, label = null, practiceId = null, now = () => new Date() } = {}) {
        const sinceISO = since || new Date(now().getTime() - days * 86400000).toISOString();
        const untilISO = until || null;
        const [lineRows, closedRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.planFeesCollectedLines(orgId, sinceISO, untilISO, practiceId),
            analytics_repository_1.analyticsRepository.treatmentsClosedRevenueByPractice(orgId, sinceISO, untilISO),
        ]);
        // Canonical totals = the same aggregate the tile shows. Per-practice scope
        // keeps only that practice's aggregate row; group sums every practice.
        const scoped = practiceId ? closedRows.filter((r) => r.practice_id === practiceId) : closedRows;
        const billedPence = scoped.reduce((s, r) => s + Number(r.closed_value_pence || 0), 0);
        const collectedPence = scoped.reduce((s, r) => s + Number(r.paid_value_pence || 0), 0);
        const lines = lineRows.map((r) => ({
            id: r.invoice_item_id,
            invoicedOn: r.invoiced_on,
            practiceId: r.practice_id ?? null,
            practiceName: r.practice_name ?? null,
            patientName: r.patient_name ?? null,
            treatmentName: r.treatment_name ?? null,
            treatmentPlanId: r.treatment_plan_id ?? null,
            invoiceId: r.invoice_id ?? null,
            billedPence: Number(r.billed_pence || 0),
            collectedPence: Number(r.collected_pence || 0),
            invoiceAmountPence: r.invoice_amount_pence == null ? null : Number(r.invoice_amount_pence),
            invoiceOutstandingPence: r.invoice_outstanding_pence == null ? null : Number(r.invoice_outstanding_pence),
        }));
        return {
            window: { since: sinceISO, until: untilISO, label: label ?? null },
            totals: { billedPence, collectedPence, lineCount: lines.length },
            lines,
            basis: 'invoice_items',
            note: "Every Dentally treatment-plan invoice line in the window. Collected = each line's share of its invoice's actual payments (invoice gross minus outstanding, pro-rata). Per-line collected is rounded to the penny, so the lines can total a few pence off the header.",
        };
    },
    // Day — Cash Collected (GM Intelligence OS, T9). REAL settled receipts banked
    // by working day across the month containing periodKey, plus a composite
    // collection index (each day vs the month's average working day = 100). This
    // is CASH RECEIPTS by processed_at date — NOT billed production (decision A2).
    //
    // Always month-framed: even when period='day' the screen shows the whole
    // month's by-day breakdown and highlights the selected day, so we resolve the
    // month of periodKey and return every Mon–Sat day (Sundays only if they
    // banked cash). Applicable to any scope that takes payments (incl. academy/lab).
    async cashByDay(orgId, { scope = 'all', period = 'month', periodKey, since: winSince, until: winUntil, label: winLabel, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        // Window: explicit pill window wins; else the whole month of periodKey
        // (legacy day keys collapse to their month).
        const { since, until, label } = (winSince && winUntil)
            ? resolveWindow({ since: winSince, until: winUntil, label: winLabel, now: now() })
            : treatmentWindow('month', (periodKey || '').slice(0, 7), now());

        const byDay = await this._receiptsByDayScoped(orgId, since, until, resolved);
        const penceByDay = new Map(byDay.map((r) => [r.day, Number(r.pence) || 0]));

        // Enumerate every UTC day in [since, until); keep Mon–Sat always, Sun only
        // if it banked. UTC days are exactly 86_400_000 ms apart (no DST drift).
        const days = [];
        for (let t = Date.parse(since); t < Date.parse(until); t += 86_400_000) {
            const date = new Date(t);
            const mo = date.getUTCMonth();
            const d = date.getUTCDate();
            const dow = date.getUTCDay();
            const key = `${date.getUTCFullYear()}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const pence = penceByDay.get(key) || 0;
            if (dow === 0 && pence === 0) continue; // skip empty Sundays
            days.push({ date: key, label: `${DOW_SHORT[dow]} ${d} ${MONTHS_SHORT[mo]}`, dow, pence });
        }

        const totalPence = days.reduce((s, r) => s + r.pence, 0);
        const workingDays = days.filter((r) => r.dow !== 0).length || days.length;
        const avgPerDayPence = workingDays ? Math.round(totalPence / workingDays) : 0;
        const withIndex = days.map((r) => ({
            ...r, index: avgPerDayPence ? Math.round((r.pence / avgPerDayPence) * 1000) / 10 : 0,
        }));
        const peak = withIndex.slice().sort((a, b) => b.pence - a.pence)[0] || null;

        const selected = period === 'day' && periodKey
            ? withIndex.find((r) => r.date === periodKey) || null
            : null;

        const insights = buildCashByDayInsights({ withIndex, avgPerDayPence, peak, totalPence });

        return {
            applicable: true,
            scope, period,
            window: { since, until, label },
            monthLabel: label,
            basis: 'settled_receipts',
            hasData: totalPence > 0,
            totalPence,
            avgPerDayPence,
            workingDays,
            days: withIndex,
            peak,
            selected,
            insights,
            note: 'Cash banked by processed_at date — settled receipts, not billed production.',
        };
    },
    // Sum settled receipts by day across the in-scope entities. practiceIds=null
    // (all/practices) → one whole-org RPC call; otherwise call the bulk method.
    async _receiptsByDayScoped(orgId, since, until, resolved) {
        if (!resolved.practiceIds || resolved.practiceIds.length === 0) {
            return analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, since, null, until);
        }
        return analytics_repository_1.analyticsRepository.settledReceiptsByDayBulk(orgId, since, resolved.practiceIds, until);
    },
    // Treatment Economics Workbench (Arch #3 pure compute). The UI posts a model
    // (debounced); this returns the full money flow. No DB, no persistence.
    treatmentEconomics(model) {
        return (0, formulas_1.computeServiceEconomics)(model);
    },
    // Seed default workbench models (owner-editable client-side; persisted
    // overrides are a later slice).
    treatmentModels() {
        return formulas_1.DEFAULT_SERVICE_MODELS;
    },
    // Real case-fee benchmarks for the Treatment Economics Workbench, derived
    // from Dentally invoice_items over a trailing window. Per workbench category
    // (fullarch/implant/invisalign): the mean INVOICE total for invoices that
    // contain that procedure (a case is billed across many lines — see
    // formulas.classifyCaseFees). This is the patient FEE only; lab/material
    // COST is never in the Dentally feed, so the workbench keeps owner-entered
    // costs and only the case fee is seeded. Returns null per category with no
    // matching invoices; the UI then keeps the hardcoded default for that one.
    async treatmentFeeBenchmarks(orgId, { months = 12, now = () => new Date() } = {}) {
        const since = new Date(now());
        since.setUTCMonth(since.getUTCMonth() - months);
        const invoices = await analytics_repository_1.analyticsRepository.invoiceCaseRollup(orgId, since.toISOString());
        const fees = (0, formulas_1.classifyCaseFees)(invoices);
        return {
            windowMonths: months,
            invoicesAnalysed: invoices.length,
            // { fullarch|implant|invisalign : { feePence, sampleSize } | null }
            benchmarks: fees,
        };
    },
    // Group Valuation (Arch #3 pure compute, Value & Growth view). The UI posts
    // the driver state (debounced); this returns the three-buyer result plus the
    // ranked value-uplift levers. No DB, no persistence. NOTE: this is the
    // server-authoritative successor to `valuation()` below (which keeps using
    // the legacy baseline-derived `calculateValuation` for GET /valuation).
    computeValuation(state) {
        const result = (0, formulas_1.computeGroupValuation)(state);
        const levers = (0, formulas_1.valueUpliftLevers)({
            result,
            principalMultiple: state.principalMultiple,
            associateMultiple: state.associateMultiple,
            dsoMultiple: state.dsoMultiple,
        });
        return { result, levers };
    },
    // Sale Planner trajectory — model a target exit and the year-by-year path.
    computeValuationExitPlan(body) {
        return (0, formulas_1.planExitTrajectory)(body);
    },
    // M&A Acquisition Modeller (buy-side, DentaCFO Phase 3) — EV / NPV / IRR /
    // payback / debt capacity / red flags for a practice you're considering
    // buying. Pure compute (Arch #3); no persistence.
    computeAcquisition(input) {
        return (0, formulas_1.calculateAcquisition)(input);
    },
    // Pull monthly_financials actuals and resolve Xero-overrides-manual
    // precedence per period+bucket. Returns the per-period bucket map plus an
    // `annual` sum over the trailing ≤12 periods (for annual P&L / ratios).
    // hasAny=false ⇒ callers fall back to the baseline projection unchanged.
    async _actualsBundle(orgId, practiceId = null, { source = null, accountId = null, accountingMethod = 'accrual', since = null, until = null } = {}) {
        const all = await monthlyFinancial_repository_1.monthlyFinancialRepository.allForOrg(orgId, { source, accountId });
        const rows = practiceId
            ? (Array.isArray(all) ? all : []).filter((r) => r.practice_id === practiceId)
            : all;
        const byPeriod = bucketsByPeriod(rows, { accountingMethod });
        const periods = [...byPeriod.keys()].sort();
        // Explicit [since,until] window (YYYY-MM-DD) → the months it spans; else the
        // trailing 12 months. Periods are 'YYYY-MM', so compare on the month prefix.
        const recent = (since && until)
            ? periods.filter((pm) => pm >= since.slice(0, 7) && pm <= until.slice(0, 7))
            : periods.slice(-12);
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
    // Profit Benchmarking (Intelligence OS — CoA→P&L). Actual cost/profit ratios
    // vs the UK dental group benchmarks. A FINANCE screen → real actuals or zero,
    // never the baseline projection (FORMULAS §1a). When there is no real cost
    // source we return costsAvailable:false and no rows — the client shows a
    // "connect Xero / enter actuals" empty state rather than fabricating ratios.
    async plBenchmark(orgId, { practiceId = null, source = 'combined', accountId = null, since = null, until = null } = {}) {
        const src = (source === 'dentally' || source === 'quickbooks') ? source : 'combined';
        // Dentally carries no cost data, so a cost/profit benchmark is meaningless
        // for that source → honest empty state (never an estimate, FORMULAS §1b).
        if (src === 'dentally') {
            return { costsAvailable: false, basis: 'none', revenue: 0, rows: [], overspendPence: 0, periodsCovered: 0, source: 'dentally' };
        }
        // QuickBooks source: benchmark built only from QBO actuals (optionally one
        // company); a QB company is not practice-mapped, so practiceId is ignored.
        const actuals = src === 'quickbooks'
            ? await this._actualsBundle(orgId, null, { source: 'quickbooks', accountId, since, until })
            : await this._actualsBundle(orgId, practiceId, { since, until });
        const a = actuals.annual || {};
        const revenue = a.revenue || 0;
        const costTotal = (a.associates || 0) + (a.staff || 0) + (a.lab || 0) + (a.materials || 0) + (a.overhead || 0) + (a.other || 0);
        if (!actuals.hasAny || revenue <= 0 || costTotal <= 0) {
            return { costsAvailable: false, basis: 'none', revenue, rows: [], overspendPence: 0, periodsCovered: actuals.periodsCovered, source: src };
        }
        const plInput = plInputFromBuckets(a);
        const pl = (0, formulas_1.calculatePL)(plInput);
        const result = (0, formulas_1.calculateProfitBenchmark)({ revenue: plInput.revenue, costs: plInput.costs, netProfit: pl.netProfit });
        return { ...result, marginPct: pl.marginPct, netProfit: pl.netProfit, totalCosts: pl.totalCosts, costsAvailable: true, basis: 'actuals', periodsCovered: actuals.periodsCovered, source: src };
    },
    // P&L & Margin (GM Intelligence OS, T11). Scope/period-aware group P&L
    // statement + per-entity breakdown from REAL monthly_financials actuals
    // (Xero/QuickBooks override manual, per bucketsByPeriod). A FINANCE screen →
    // real actuals or an honest empty state, NEVER a fabricated projection.
    //
    // Granularity is the honest CoA→P&L bucket set: revenue, lab+materials,
    // staff (Xero folds associate/clinician pay into staff — `dentistStaffSeparable:false`
    // banners this), other opex (overhead+other); `tax` is below the operating
    // line and excluded. Period: the selected month's actuals when present, else
    // the trailing ≤12mo annual sum (basis flags which). Per-entity rows appear
    // only when monthly_financials carries practice_id; org-level-only data →
    // `perEntityAvailable:false` and a group statement alone.
    async plMargin(orgId, { scope = 'all', period = 'month', periodKey, since, until, label, source = null, accountId = null, accountingMethod = 'accrual', now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        // Months the window touches ('YYYY-MM'). Explicit pill window wins; else
        // the single month of periodKey (legacy month|day path).
        const windowMonths = (since && until)
            ? monthsInWindow(since, until)
            : [(periodKey || '').slice(0, 7) || londonMonthKey(now())];
        const monthKey = windowMonths[0];
        const multiMonth = windowMonths.length > 1;

        // Optional data-source narrowing. 'quickbooks'|'xero'|'manual' filter
        // monthly_financials to that one feed; anything else (incl. 'combined'/
        // 'dentally'/undefined) leaves it unfiltered (all accounting feeds). A
        // single QuickBooks company is selected via accountId (integration_account_id).
        const finSource = ['quickbooks', 'xero', 'manual'].includes(source) ? source : null;
        const method = accountingMethod === 'cash' ? 'cash' : 'accrual';

        const [entityRows, allFin] = await Promise.all([
            analytics_repository_1.analyticsRepository.allEntities(orgId),
            monthlyFinancial_repository_1.monthlyFinancialRepository.allForOrg(orgId, { source: finSource, accountId }),
        ]);
        const entityById = new Map(entityRows.map((e) => [e.id, e]));
        const practiceKindIds = new Set(entityRows.filter((e) => e.kind === 'practice').map((e) => e.id));

        // Entity key for a row. Practice-tagged rows (Xero/manual) key by
        // practice_id; QuickBooks rows carry no practice_id but DO carry
        // integration_account_id (the QB company = a legal entity) → key by
        // company. Untagged rows fall to the group bucket.
        const keyOf = (r) => r.practice_id
            ? r.practice_id
            : (r.integration_account_id ? `qbo:${r.integration_account_id}` : '__org__');

        // Which rows count for this scope. __org__ (untagged) and QB-company rows
        // belong to the whole group → included for all/practices, excluded from a
        // specific practice/academy/lab scope (QB is not practice-mapped).
        const inScope = (r) => {
            const pid = r.practice_id;
            if (resolved.mode === 'all') return true;
            if (resolved.mode === 'practices') return !pid || practiceKindIds.has(pid);
            return pid && resolved.practiceIds.includes(pid); // entity/academy/lab
        };

        // Group rows by entity key, then resolve period buckets per group.
        const byKey = new Map(); // entityKey -> rows
        for (const r of allFin) {
            if (!inScope(r)) continue;
            const key = keyOf(r);
            (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
        }

        // For a row set: sum the buckets for every month the window touches that
        // carries data (revenue>0 across the window). A single-month window keeps
        // basis 'month'; a multi-month window sums to basis 'annual'. When the
        // window has no actuals, fall back to the trailing ≤12mo annual sum.
        const resolveBuckets = (rows) => {
            const byPeriod = bucketsByPeriod(rows, { accountingMethod: method });
            const hit = windowMonths.filter((mk) => byPeriod.has(mk));
            if (hit.length > 0) {
                const summed = {};
                for (const mk of hit)
                    for (const [k, v] of Object.entries(byPeriod.get(mk))) summed[k] = (summed[k] || 0) + v;
                if ((summed.revenue || 0) > 0) {
                    return { buckets: summed, basis: multiMonth ? 'annual' : 'month', periodsCovered: hit.length, periodsUsed: hit };
                }
            }
            const periods = [...byPeriod.keys()].sort().slice(-12);
            const annual = {};
            for (const p of periods)
                for (const [k, v] of Object.entries(byPeriod.get(p))) annual[k] = (annual[k] || 0) + v;
            return { buckets: annual, basis: 'annual', periodsCovered: periods.length, periodsUsed: periods };
        };

        // Which summary P&L line each monthly_financials bucket rolls into — drives
        // the drill-down: a clicked summary row expands to the account_code lines
        // whose bucket maps here. 'tax' is below the operating line → no drill-down.
        const SUMMARY_OF_BUCKET = {
            revenue: 'revPence',
            lab: 'labMaterialsPence', materials: 'labMaterialsPence',
            staff: 'staffPence', associates: 'staffPence',
            overhead: 'otherOpexPence', other: 'otherOpexPence',
        };
        // Group-level account-line detail, keyed by summary line -> code -> pence.
        // Accumulated across every in-scope key (incl. __org__) over the SAME
        // periods that key contributed to the statement total.
        const groupBreakdown = {
            revPence: new Map(), labMaterialsPence: new Map(),
            staffPence: new Map(), otherOpexPence: new Map(),
        };
        const addBreakdown = (rows, periodsUsed) => {
            const byPeriod = accountLinesByPeriod(rows, { accountingMethod: method });
            for (const mk of periodsUsed) {
                const byBucket = byPeriod.get(mk);
                if (!byBucket) continue;
                for (const [bucket, byCode] of byBucket) {
                    const grp = SUMMARY_OF_BUCKET[bucket];
                    if (!grp) continue;
                    const target = groupBreakdown[grp];
                    for (const [code, amt] of byCode) target.set(code, (target.get(code) || 0) + amt);
                }
            }
        };

        // QuickBooks company labels (only fetched when company-keyed rows exist —
        // a Xero/manual-only org never pays for this query). company_name lives in
        // integration_accounts.config; fall back to label, then a generic name.
        const hasCompanyKeys = [...byKey.keys()].some((k) => k.startsWith('qbo:'));
        const companyLabelById = new Map();
        if (hasCompanyKeys) {
            const accts = await quickbooksFinanceRepository.accounts(orgId);
            for (const a of (accts || []))
                companyLabelById.set(a.id, a.config?.company_name ?? a.label ?? 'QuickBooks company');
        }

        // Resolve EACH key (entity or __org__) independently — Xero-overrides-
        // manual precedence is per-entity, so never merge sources across entities
        // before resolving (that would let one practice's synced row suppress
        // another's manual row). The group statement is the SUM of per-key lines.
        const entities = [];
        const groupLine = { revPence: 0, labMaterialsPence: 0, grossPence: 0, staffPence: 0, otherOpexPence: 0, netPence: 0 };
        let anyMonth = false, anyAnnual = false, groupPeriods = 0;
        for (const [key, rows] of byKey) {
            const { buckets, basis, periodsCovered, periodsUsed } = resolveBuckets(rows);
            const line = plLineFromBuckets(buckets);
            if (line.revPence <= 0 && line.netPence === 0) continue;
            // Accumulate into the group statement (all in-scope keys, incl. __org__).
            for (const f of Object.keys(groupLine)) groupLine[f] += line[f];
            // Same keys + same periods feed the drill-down account-line detail.
            addBreakdown(rows, periodsUsed);
            if (basis === 'month') anyMonth = true; else anyAnnual = true;
            groupPeriods = Math.max(groupPeriods, periodsCovered);
            if (key === '__org__') continue; // org-level stays in the total, not a row
            if (key.startsWith('qbo:')) {
                // QuickBooks company entity (no practice mapping).
                const iaid = key.slice(4);
                entities.push({
                    id: key,
                    name: companyLabelById.get(iaid) || 'QuickBooks company',
                    kind: 'company',
                    region: 'QuickBooks company',
                    basis, periodsCovered, ...line,
                });
                continue;
            }
            const ent = entityById.get(key);
            entities.push({
                id: key,
                name: ent?.name || 'Unknown entity',
                kind: ent?.kind || 'practice',
                region: ent?.kind === 'academy' ? 'Academy' : ent?.kind === 'lab' ? 'Lab' : '',
                basis, periodsCovered, ...line,
            });
        }
        entities.sort((a, b) => b.revPence - a.revPence);

        const statement = {
            ...groupLine,
            marginPct: groupLine.revPence ? Math.round((groupLine.netPence / groupLine.revPence) * 1000) / 10 : 0,
        };
        const hasData = statement.revPence > 0 || statement.netPence !== 0;
        const basis = !hasData ? 'none'
            : anyMonth && anyAnnual ? 'actuals-mixed'
            : anyMonth ? 'actuals-month' : 'actuals-annual';

        // Per-entity rows are either QuickBooks companies or tagged practices —
        // tells the UI how to label the split and which empty-state copy to show.
        const perEntityKind = entities.length === 0 ? null
            : entities.every((e) => e.kind === 'company') ? 'company'
            : 'practice';

        return {
            applicable: true,
            scope, period,
            monthKey,
            basis,
            // Echo the resolved feed + accounting basis so the UI can label the
            // statement and keep its filter controls in sync with what was summed.
            source: finSource || 'combined',
            accountingMethod: method,
            hasData,
            costsAvailable: hasData,
            periodsCovered: groupPeriods,
            statement,
            // Xero folds associate/clinician pay into the staff bucket — never
            // show a separate clinician line off this source (it would read false).
            dentistStaffSeparable: false,
            perEntityAvailable: entities.length > 0,
            perEntityKind,
            entityBasisMixed: anyMonth && anyAnnual,
            entities,
            // Account-level drill-down per summary line (largest first). Lets the
            // UI expand e.g. "Other operating costs" into Council Tax, Advertising,
            // Utilities... exactly as the accounting feed books them.
            breakdown: Object.fromEntries(Object.entries(groupBreakdown).map(([grp, m]) => [
                grp,
                [...m.entries()]
                    .map(([name, amountPence]) => ({ name, amountPence }))
                    .sort((a, b) => b.amountPence - a.amountPence),
            ])),
            note: 'Real P&L from monthly_financials (Xero/QuickBooks override manual; QuickBooks is split per company). Staff includes associate/clinician pay (Xero books them together; QuickBooks folds its associates bucket into the same line). Editable scenario sheets + account-level CoA mapping are the persistence slice.',
        };
    },
    // Marketing & ROI (GM Intelligence OS, T11). Per-channel acquisition economics
    // from REAL sources: ad spend from `ad_metrics` (paid providers), channel
    // attribution + conversions from CRM `leads`, revenue from settled payments.
    //
    // HONEST DATA WALL: spend and leads are real per channel; REVENUE IS NOT
    // attributable per channel (no per-touch attribution), so there is NO
    // per-channel ROAS/revenue here — only a business-level blended paid ROAS
    // (settled revenue ÷ paid spend). Per-channel ranks on spend → leads → CPL →
    // patients → CPA. Conversions use one consistent definition across all
    // channels: a CRM lead that reached treatment_started/treatment_completed.
    async marketingRoi(orgId, { scope = 'all', period = 'month', periodKey, since: winSince, until: winUntil, label: winLabel, accountIds: accountIdsArg, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        const { since, until, label } = resolveWindow({ since: winSince, until: winUntil, label: winLabel, period, periodKey, now: now() });
        const fromDate = since.slice(0, 10);
        const untilD = new Date(until); untilD.setUTCDate(untilD.getUTCDate() - 1);
        const toDate = untilD.toISOString().slice(0, 10); // inclusive last day of window

        // Dynamic, org-isolated ad-account filter. Explicit ?account_ids= wins;
        // else fall back to the org's selected accounts (null => no filter when
        // the org has no ad_accounts rows yet, preserving old behaviour).
        const accountIds = (typeof accountIdsArg === 'string' && accountIdsArg.trim())
            ? accountIdsArg.split(',').map((s) => s.trim()).filter(Boolean)
            : await integration_repository_1.selectedAdAccountIds(orgId, null);

        const pids = resolved.practiceIds; // null = whole org
        const [adRows, leads, revRows, practices, adAccounts] = await Promise.all([
            analytics_repository_1.analyticsRepository.adMetricsInWindow(orgId, fromDate, toDate, pids, accountIds),
            analytics_repository_1.analyticsRepository.leadsForMarketing(orgId, since, until, pids),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, since, until),
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
            integration_repository_1.listAdAccounts(orgId, null),
        ]);
        // Each practice runs its own ad account, so account.practice_id is how
        // spend + platform conversions attribute to a site (see migration 000069).
        const acctPractice = new Map();
        for (const a of adAccounts) if (a.practice_id) acctPractice.set(`${a.provider}::${a.customer_id}`, a.practice_id);
        const nameById = new Map(practices.map((p) => [p.id, p.name]));
        const inScopeRev = revRows.filter((r) => !pids || pids.includes(r.practice_id));

        // Per-channel accumulators (spend from ad_metrics; leads/conversions from CRM).
        // `conversions`/`leads` on a channel are the CRM funnel (lead -> patient).
        // `adConversions`/`reach` are platform-reported (ad_metrics) — lead-form /
        // pixel actions from Meta + Google conversions. Kept separate so the CRM
        // funnel stays internally consistent while paid cards can show real
        // platform performance even when CRM attribution is empty.
        const ch = new Map(MKT_CHANNELS.map((c) => [c.key, { ...c, spendPence: 0, impressions: 0, clicks: 0, reach: 0, adConversions: 0, leads: 0, conversions: 0 }]));
        for (const a of adRows) {
            const c = ch.get(a.provider);
            if (!c) continue;
            c.spendPence += a.spend_pence || 0;
            c.impressions += a.impressions || 0;
            c.clicks += a.clicks || 0;
            c.reach += a.reach || 0;
            c.adConversions += a.conversions || 0;
        }
        for (const l of leads) {
            const c = ch.get(attributeChannel(l));
            if (!c) continue;
            c.leads += 1;
            if (CONVERTED_STATUSES.has(l.status)) c.conversions += 1;
        }

        // Period-deduplicated reach overlay (see lib/marketing-reach.js). The
        // c.reach summed above over-counts unique people ~3x; replace it with a
        // live per-window Meta query for the EXACT window (cached), falling back
        // to the rolling ad_accounts snapshot when the live query is unavailable.
        const scopeKeysByProvider = new Map();
        const scopeMetaCids = new Set();
        for (const a of adRows) {
            const set = scopeKeysByProvider.get(a.provider) ?? scopeKeysByProvider.set(a.provider, new Set()).get(a.provider);
            set.add(`${a.provider}::${a.customer_id}`);
            if (a.provider === 'meta_ads' && a.customer_id) scopeMetaCids.add(a.customer_id);
        }
        const liveReach = await fetchPeriodReach(orgId, [...scopeMetaCids], fromDate, toDate);
        const fallbackByKey = new Map(adAccounts.map((a) => [`${a.provider}::${a.customer_id}`, a]));
        const snapForKey = (k) => liveReach.get(k) ?? fallbackByKey.get(k);
        const providerReach = (provider, impressions) => overlayPeriodReach(
            impressions,
            [...(scopeKeysByProvider.get(provider) ?? [])].map(snapForKey).filter(Boolean),
            fromDate, toDate,
        );

        const totalLeads = leads.length;
        const channels = [...ch.values()]
            .filter((c) => c.leads > 0 || c.spendPence > 0)
            .map((c) => {
              const pr = providerReach(c.key, c.impressions);
              return {
                key: c.key, label: c.label, color: c.color, paid: c.paid, group: c.group,
                spendPence: c.spendPence, impressions: c.impressions, clicks: c.clicks,
                reach: pr.reach, reachIsApprox: pr.reach_is_approx, frequency: pr.frequency,
                adConversions: c.adConversions,
                leads: c.leads, conversions: c.conversions,
                cplPence: c.leads ? Math.round(c.spendPence / c.leads) : 0,
                cpaPence: c.conversions ? Math.round(c.spendPence / c.conversions) : 0,
                // Platform-reported economics (from ad_metrics, not CRM).
                costPerAdConvPence: c.adConversions ? Math.round(c.spendPence / c.adConversions) : 0,
                ctrPct: c.impressions ? Math.round((c.clicks / c.impressions) * 1000) / 10 : 0,
                adConvRatePct: c.clicks ? Math.round((c.adConversions / c.clicks) * 1000) / 10 : 0,
                leadSharePct: totalLeads ? Math.round((c.leads / totalLeads) * 1000) / 10 : 0,
                convRatePct: c.leads ? Math.round((c.conversions / c.leads) * 1000) / 10 : 0,
              };
            })
            .sort((a, b) => b.spendPence - a.spendPence || b.leads - a.leads);

        const paidSpendPence = channels.filter((c) => c.paid).reduce((s, c) => s + c.spendPence, 0);
        const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);
        const settledRevenuePence = inScopeRev.reduce((s, r) => s + (Number(r.pence) || 0), 0);
        const blendedRoas = paidSpendPence ? Math.round((settledRevenuePence / paidSpendPence) * 100) / 100 : null;
        const blendedRoiPct = paidSpendPence ? Math.round(((settledRevenuePence - paidSpendPence) / paidSpendPence) * 100) : null;

        const google = channels.find((c) => c.key === 'google_ads') || null;
        const meta = channels.find((c) => c.key === 'meta_ads') || null;

        // Per-practice acquisition. Leads + spend come from the ad platforms
        // (Meta/Google), attributed via the account->practice mapping; patients
        // (treatment outcomes) come from the CRM; revenue from settled invoices.
        // With spend now per-practice, per-site ROAS (revenue/spend) is real.
        const adSpendByPractice = new Map();
        const adConvByPractice = new Map();
        let adSpendPerPracticeAvailable = false;
        for (const a of adRows) {
            const pid = acctPractice.get(`${a.provider}::${a.customer_id}`);
            if (!pid) continue; // unmapped account -> stays in group totals only
            adSpendPerPracticeAvailable = true;
            adSpendByPractice.set(pid, (adSpendByPractice.get(pid) || 0) + (a.spend_pence || 0));
            adConvByPractice.set(pid, (adConvByPractice.get(pid) || 0) + (a.conversions || 0));
        }
        const revByPractice = new Map(inScopeRev.map((r) => [r.practice_id, Number(r.pence) || 0]));
        // CRM patients per practice (treatment outcome). Own practice_id wins,
        // else inherit the linked contact's practice (the patient's home site).
        const patientsByPractice = new Map();
        for (const l of leads) {
            const id = l.practice_id ?? l.contact?.practice_id ?? null;
            if (!id || !CONVERTED_STATUSES.has(l.status)) continue;
            patientsByPractice.set(id, (patientsByPractice.get(id) || 0) + 1);
        }
        const practiceIdsSeen = new Set([...adConvByPractice.keys(), ...revByPractice.keys(), ...adSpendByPractice.keys(), ...patientsByPractice.keys()]);
        const byPractice = [...practiceIdsSeen]
            .filter((id) => nameById.has(id))
            .map((id) => {
                const leadsP = adConvByPractice.get(id) || 0;       // platform conversions
                const patients = patientsByPractice.get(id) || 0;   // CRM treatment outcomes
                const spendPence = adSpendByPractice.get(id) || 0;
                const revenuePence = revByPractice.get(id) || 0;
                return {
                    id, name: nameById.get(id),
                    leads: leadsP, conversions: patients,
                    convRatePct: leadsP ? Math.round((patients / leadsP) * 1000) / 10 : 0,
                    revenuePence,
                    spendPence,
                    cpaPence: patients && spendPence ? Math.round(spendPence / patients) : 0,
                    roas: spendPence ? Math.round((revenuePence / spendPence) * 100) / 100 : null,
                };
            })
            .sort((a, b) => b.spendPence - a.spendPence || b.revenuePence - a.revenuePence);

        const insights = buildMarketingInsights({ channels, blendedRoas, paidSpendPence, settledRevenuePence, connected: adRows.length > 0, adSpendPerPracticeAvailable });

        // Per-account spend breakdown (the selected ad accounts), labelled from
        // the ad_accounts dimension (already loaded above). Org-isolated.
        const acctMeta = new Map(adAccounts.map((a) => [`${a.provider}::${a.customer_id}`, a]));
        const acctMap = new Map();
        for (const a of adRows) {
            const k = `${a.provider}::${a.customer_id ?? 'unknown'}`;
            const acc = acctMap.get(k) ?? acctMap.set(k, { provider: a.provider, customerId: a.customer_id, spendPence: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0 }).get(k);
            acc.spendPence += a.spend_pence || 0;
            acc.impressions += a.impressions || 0;
            acc.clicks += a.clicks || 0;
            acc.reach += a.reach || 0;
            acc.conversions += a.conversions || 0;
        }
        const byAccount = [...acctMap.entries()]
            .map(([k, a]) => {
                // Period-deduplicated reach for this account (not the daily sum).
                const pr = overlayPeriodReach(a.impressions, [snapForKey(k)].filter(Boolean), fromDate, toDate);
                return {
                    ...a,
                    reach: pr.reach, reachIsApprox: pr.reach_is_approx, frequency: pr.frequency,
                    name: acctMeta.get(k)?.name ?? null,
                    currency: acctMeta.get(k)?.currency ?? null,
                    status: acctMeta.get(k)?.status ?? null,
                    cpaPence: a.conversions ? Math.round(a.spendPence / a.conversions) : 0,
                    cpcPence: a.clicks ? Math.round(a.spendPence / a.clicks) : 0,
                };
            })
            .sort((a, b) => b.spendPence - a.spendPence);

        return {
            applicable: true,
            scope, period,
            window: { since, until, label },
            connected: adRows.length > 0,
            hasLeads: totalLeads > 0,
            accountFilter: accountIds, // null = all; [] = none; [...] = explicit
            byAccount,
            channels,
            paidSpendPence,
            totalLeads,
            totalConversions,
            settledRevenuePence,
            blendedRoas,
            blendedRoiPct,
            google,
            meta,
            revenuePerChannelAvailable: false,
            byPracticeAvailable: byPractice.length > 0,
            adSpendPerPracticeAvailable,
            byPractice,
            insights,
            note: 'Spend (ad_metrics) and leads (CRM) are real per channel. Revenue is NOT attributable per channel — only a business-level blended paid ROAS is shown. Conversions = leads reaching treatment_started/completed.',
        };
    },
    // Clinicians (GM Intelligence OS, T2). Per-clinician production, pay splits
    // and NHS/UDA obligation from REAL data: associate roster (names/splits),
    // per-associate completed production (treatment_plans via associate_production
    // RPC), appointment activity (associate_appointment_stats), and owner-entered
    // NHS contract UDA per practice.
    //
    // HONEST DATA WALLS (no fabrication — the prototype's revenue-share model is
    // gone): production £ exists only when Dentally treatment_plans are synced
    // (`productionAvailable`); appointment stats only where appointments carry a
    // resolved associate_id (`appointmentsAvailable`); UDA-completed needs the
    // same treatment_plan feed (`nhs.completedAvailable`). Lab cost / OCPSPD per
    // clinician have no real per-clinician source and are intentionally omitted.
    async clinicians(orgId, { scope = 'all', period = 'month', periodKey, since: winSince, until: winUntil, label: winLabel, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { applicable: false, scope: resolved.mode,
                message: 'Clinician analytics apply to the dental practices — switch scope to the group or a practice.' };
        }
        const { since, until, label } = resolveWindow({ since: winSince, until: winUntil, label: winLabel, period, periodKey, now: now() });

        const [roster, prodMap, apptMap, nhsPractices] = await Promise.all([
            analytics_repository_1.analyticsRepository.cliniciansRoster(orgId),
            payRun_repository_1.payRunRepository.productionByAssociate(orgId, { start: since, end: until }),
            associate_repository_1.associateRepository.appointmentStatsByAssociate(orgId, since),
            analytics_repository_1.analyticsRepository.practicesNhs(orgId),
        ]);

        // Scope filter: a specific practice narrows the roster to its associates.
        const scoped = resolved.mode === 'entity'
            ? roster.filter((a) => resolved.practiceIds.includes(a.primary_practice_id))
            : roster;

        const productionAvailable = [...prodMap.values()].some((v) => v > 0);
        const appointmentsAvailable = apptMap.size > 0;

        // Dentally never sends pay terms, so an associate with no owner-set split
        // carries the seed default (45% pay / 50% lab). Fees/net computed off the
        // default are ESTIMATES, not real pay — flag them so the UI can say so
        // rather than presenting a precise £ the practice never agreed.
        const DEFAULT_PAY_PCT = 4500; // basis points
        const clinicians = scoped.map((a) => {
            const payDefault = a.pay_pct == null || a.pay_pct === DEFAULT_PAY_PCT;
            const payPct = (a.pay_pct ?? DEFAULT_PAY_PCT) / 100;  // basis points → %
            const labSplitPct = (a.lab_split_pct ?? 5000) / 100;
            const productionPence = prodMap.get(a.id) || 0;
            const feesPence = Math.round(productionPence * payPct / 100);
            const netToPracticePence = productionPence - feesPence;
            const stats = apptMap.get(a.id) || { total: 0, completed: 0, no_shows: 0 };
            return {
                id: a.id,
                name: a.full_name,
                role: a.specialty || 'Associate Dentist',
                practiceId: a.primary_practice_id,
                practiceName: a.practice?.name || '—',
                active: a.active !== false,
                payPct, labSplitPct, payDefault,
                productionPence, feesPence, netToPracticePence,
                appointments: stats.total, completed: stats.completed, noShows: stats.no_shows,
            };
        })
            // Dentally creates a separate practitioner record per site, so a group
            // roster carries many dead duplicates: leavers and per-site shells with
            // no activity (e.g. 216 rows where only ~55 are active and ~22 produced
            // this period). Showing all of them buries the real clinicians under a
            // wall of empty rows. Keep a row only if the clinician is active OR has
            // real production/appointments in THIS window — so a leaver who still
            // produced in the period stays visible (honest), but idle shells drop.
            .filter((c) => c.active || c.productionPence > 0 || c.appointments > 0)
            .sort((x, y) => y.productionPence - x.productionPence || y.appointments - x.appointments);

        const totalProductionPence = clinicians.reduce((s, c) => s + c.productionPence, 0);
        const totalFeesPence = clinicians.reduce((s, c) => s + c.feesPence, 0);
        const totalNetPence = clinicians.reduce((s, c) => s + c.netToPracticePence, 0);
        // Fees/net are ESTIMATED while any producing clinician is on the default
        // split — true once every clinician with production has owner-set terms.
        const payTermsEstimated = clinicians.some((c) => c.payDefault && c.productionPence > 0);

        // NHS/UDA — owner-entered contract per practice. Completed UDA needs the
        // treatment_plan feed (not yet populated), so it's flagged unavailable.
        const scopedNhs = (resolved.mode === 'entity'
            ? nhsPractices.filter((p) => resolved.practiceIds.includes(p.id))
            : nhsPractices
        ).filter((p) => (p.nhs_contract_uda || 0) > 0);
        const nhs = {
            available: scopedNhs.length > 0,
            completedAvailable: false, // treatment_plan UDA feed empty
            practices: scopedNhs.map((p) => ({
                id: p.id, name: p.name,
                contractUda: p.nhs_contract_uda || 0,
                udaRatePence: p.nhs_uda_rate_pence || 2850,
            })),
        };

        const insights = buildCliniciansInsights({ clinicians, productionAvailable, appointmentsAvailable, totalProductionPence, totalFeesPence });

        return {
            applicable: true,
            scope, period,
            window: { since, until, label },
            productionAvailable,
            appointmentsAvailable,
            clinicians,
            totalProductionPence,
            totalFeesPence,
            totalNetPence,
            payTermsEstimated,
            nhs,
            insights,
            note: payTermsEstimated
                ? 'Roster shows active clinicians plus anyone with production or appointments in this period (idle per-site duplicate records from Dentally are hidden). Production £ is from completed Dentally treatment plans; appointment counts are practitioner-tagged appointments. Associate fees and Net to practice are ESTIMATED at the default 45% split — Dentally does not provide pay terms, so set each clinician\'s real split under Team for these to reflect actual pay. NHS contract is owner-entered. Lab cost / operating-cost-per-surgery per clinician have no real per-clinician source and are omitted (use the Treatment Workbench).'
                : 'Roster shows active clinicians plus anyone with production or appointments in this period (idle per-site duplicate records from Dentally are hidden). Pay splits and NHS contract are live. Production £ is from completed Dentally treatment plans; appointment counts are practitioner-tagged appointments. Lab cost / operating-cost-per-surgery per clinician have no real per-clinician source and are omitted (use the Treatment Workbench).',
        };
    },
    // Drill-down behind the "Treatments Completed" card — every completed Dentally
    // treatment in the window with patient + clinician + treatment + the revenue
    // it generated. Same scope/window resolution as clinicians() so the totals
    // reconcile to the card. Academy/Lab carry no clinical treatment items.
    async treatmentsCompletedLines(orgId, { scope = 'all', period = 'month', periodKey, since: winSince, until: winUntil, label: winLabel, limit = 100, offset = 0, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        const { since, until, label } = resolveWindow({ since: winSince, until: winUntil, label: winLabel, period, periodKey, now: now() });
        const note = "Every completed Dentally treatment in the window (completed, excluding base-chart). Revenue = the treatment's price. Clinician is the practitioner who completed it; some items have no linked patient record.";
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { window: { since, until, label }, totals: { count: 0, valuePence: 0 }, lines: [],
                limit, offset, basis: 'dentally_treatment_items', note: 'No completed clinical treatments for this scope.' };
        }
        const practiceId = resolved.mode === 'entity' ? resolved.practiceIds[0] : null;
        const rows = await analytics_repository_1.analyticsRepository.treatmentsCompletedLines(orgId, since, until, practiceId, limit, offset);
        const lines = rows.map((r) => ({
            id: r.item_id,
            completedAt: r.completed_at,
            practiceId: r.practice_id ?? null,
            practiceName: r.practice_name ?? null,
            patientName: r.patient_name ?? null,
            clinicianName: r.clinician_name ?? null,
            treatmentName: r.treatment_name ?? null,
            valuePence: Number(r.value_pence || 0),
        }));
        // Totals (count + revenue over the WHOLE window, not just this page) come
        // from the cheap aggregate, computed only on the first page — later pages
        // reuse the client's cached total. Reconciles to the card exactly.
        let totals = null;
        if (offset === 0) {
            const agg = await analytics_repository_1.analyticsRepository.treatmentsCompletedByPractice(orgId, since, until);
            const scoped = practiceId ? agg.filter((r) => r.practice_id === practiceId) : agg;
            totals = {
                count: scoped.reduce((s, r) => s + Number(r.completed_count || 0), 0),
                valuePence: scoped.reduce((s, r) => s + Number(r.value_pence || 0), 0),
            };
        }
        return { window: { since, until, label }, totals, lines, limit, offset, basis: 'dentally_treatment_items', note };
    },
    // AI Analyst (GM Intelligence OS). Prioritised, £-ranked findings over the
    // group's LIVE numbers for the current scope/period, plus a natural-language
    // answer to a free-text question. The findings are REAL — they aggregate the
    // data-derived Decision-Lens insights already produced by the P&L, Marketing,
    // Clinicians and Cash views (no fabrication). When a question is asked and
    // ANTHROPIC_API_KEY is set, Claude writes the answer (+ may re-rank findings)
    // grounded ONLY in a compact real summary; otherwise we return the
    // deterministic findings with no Claude call (graceful, no hard dependency).
    async aiAsk(orgId, { scope = 'all', period = 'month', periodKey, since, until, label, question = '', now = () => new Date() } = {}) {
        const win = { scope, period, periodKey, since, until, label, now };
        const resolvedWin = (since && until)
            ? resolveWindow({ since, until, label, now: now() })
            : treatmentWindow('month', (periodKey || '').slice(0, 7), now());

        // Historical periods must ground on the baseline/targets in effect THEN,
        // not today's overwrite-in-place blob (see baselineAsOf).
        const baselineP = baselineAsOf(orgId, resolvedWin, now());

        const [pl, mkt, clin, cash, settledRevRows, entityRows, leakage, debt, chair, health, bank] = await Promise.all([
            this.plMargin(orgId, win),
            this.marketingRoi(orgId, win),
            this.clinicians(orgId, win),
            this.cashByDay(orgId, win),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, resolvedWin.since, resolvedWin.until),
            analytics_repository_1.analyticsRepository.allEntities(orgId),
            this.revenueLeakage(orgId, win),
            debtService.list(orgId),
            this.chairAnalytics(orgId, win),
            baselineP,
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
        ]);

        // Aggregate settled cash by practice
        const cashByPractice = new Map();
        if (Array.isArray(settledRevRows)) {
            for (const r of settledRevRows) {
                if (r.practice_id) {
                    const current = cashByPractice.get(r.practice_id) || 0;
                    cashByPractice.set(r.practice_id, current + (Number(r.pence) || 0));
                }
            }
        }

        // Aggregate clinician production by practice
        const productionByPractice = new Map();
        if (clin && Array.isArray(clin.clinicians)) {
            for (const c of clin.clinicians) {
                if (c.practiceId) {
                    const current = productionByPractice.get(c.practiceId) || 0;
                    productionByPractice.set(c.practiceId, current + (c.productionPence || 0));
                }
            }
        }

        // Extract P&L financials by practice
        const plByPractice = new Map();
        if (pl && Array.isArray(pl.entities)) {
            for (const e of pl.entities) {
                if (e.id) {
                    plByPractice.set(e.id, {
                        revPence: e.revPence,
                        netPence: e.netPence,
                        marginPct: e.marginPct,
                    });
                }
            }
        }

        // Construct practice breakdown array
        const practiceBreakdown = entityRows
            .filter((e) => e.kind === 'practice')
            .map((e) => {
                const cashPence = cashByPractice.get(e.id) || 0;
                const productionPence = productionByPractice.get(e.id) || 0;
                const plData = plByPractice.get(e.id) || null;
                return {
                    name: e.name,
                    cashPence,
                    productionPence,
                    revPence: plData ? plData.revPence : null,
                    netPence: plData ? plData.netPence : null,
                    marginPct: plData ? plData.marginPct : null,
                };
            });
        practiceBreakdown.sort((a, b) => b.cashPence - a.cashPence || a.name.localeCompare(b.name));

        // Aggregate the real, data-derived insight cards into Insight-shaped
        // findings ({ sev, t, d, v }), ranked bad > warn > good > info.
        const toFinding = (i) => ({ sev: i.tone, t: i.title, d: i.body, v: i.value || '' });
        const pool = [
            ...(pl.hasData ? pl.insights ?? [] : []).map(toFinding),
            ...(mkt.insights ?? []).map(toFinding),
            ...(clin.applicable !== false ? clin.insights ?? [] : []).map(toFinding),
            ...(cash.insights ?? []).map(toFinding),
        ];
        // Cross-cutting headline facts straight off the real rollups.
        const facts = [];
        if (pl.hasData) facts.push({ sev: pl.statement.marginPct >= 18 ? 'good' : pl.statement.marginPct >= 10 ? 'warn' : 'bad', t: `Group net margin ${pl.statement.marginPct.toFixed(1)}%`, d: `${gbpPence(pl.statement.netPence)} net on ${gbpPence(pl.statement.revPence)} revenue (${pl.basis}).`, v: `${pl.statement.marginPct.toFixed(1)}%` });
        if (mkt.connected && mkt.blendedRoas != null) facts.push({ sev: mkt.blendedRoas >= 3.5 ? 'good' : mkt.blendedRoas < 2.5 ? 'warn' : 'info', t: `Blended paid ROAS ${mkt.blendedRoas.toFixed(2)}×`, d: `${gbpPence(mkt.settledRevenuePence)} revenue on ${gbpPence(mkt.paidSpendPence)} ad spend (business-level).`, v: `${mkt.blendedRoas.toFixed(2)}×` });
        if (cash.hasData) facts.push({ sev: 'info', t: `${gbpPence(cash.totalPence)} cash collected · ${cash.monthLabel}`, d: `${gbpPence(cash.avgPerDayPence)} per working day across ${cash.workingDays} days.`, v: gbpPence(cash.totalPence) });

        const SEV_RANK = { bad: 0, warn: 1, good: 2, info: 3 };
        const findings = dedupeFindings([...facts, ...pool])
            .sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev])
            .slice(0, 8);

        const scopeLabel = { all: 'Whole Group', practices: 'All Practices', academy: 'Academy', lab: 'Lab' }[scope] || 'Practice';
        const periodLabel = cash.monthLabel || pl.monthKey || '';

        // No question → just the prioritised findings (the screen's default view).
        const q = (question || '').trim();
        if (!q) {
            return { scope, period, question: '', answer: null, findings, basis: 'rollups', model: null, practiceBreakdown };
        }

        // Compact, real summary for Claude (small token footprint, no raw dumps).
        const summary = {
            scopeLabel, periodLabel,
            data: {
                pl: pl.hasData ? { revenuePence: pl.statement.revPence, netPence: pl.statement.netPence, marginPct: pl.statement.marginPct, basis: pl.basis, entities: pl.entities.map((e) => ({ name: e.name, revPence: e.revPence, netPence: e.netPence, marginPct: e.marginPct })) } : null,
                marketing: { connected: mkt.connected, paidSpendPence: mkt.paidSpendPence, settledRevenuePence: mkt.settledRevenuePence, blendedRoas: mkt.blendedRoas, channels: mkt.channels.map((c) => ({ label: c.label, spendPence: c.spendPence, leads: c.leads, conversions: c.conversions, cpaPence: c.cpaPence })) },
                clinicians: clin.applicable === false ? null : { productionAvailable: clin.productionAvailable, totalProductionPence: clin.totalProductionPence, totalFeesPence: clin.totalFeesPence, top: clin.clinicians.slice(0, 5).map((c) => ({ name: c.name, productionPence: c.productionPence, payPct: c.payPct })) },
                cash: {
                    totalPence: cash.hasData ? cash.totalPence : 0,
                    avgPerDayPence: cash.hasData ? cash.avgPerDayPence : 0,
                    peak: (cash.hasData && cash.peak) ? { label: cash.peak.label, pence: cash.peak.pence } : null,
                    bankBalancePence: bank ? bank.totalPence : 0,
                    bankLastSyncedAt: bank ? bank.lastSyncedAt : null,
                },
                practices: practiceBreakdown.map((p) => ({
                    name: p.name,
                    cashPence: p.cashPence,
                    productionPence: p.productionPence,
                    revPence: p.revPence,
                    netPence: p.netPence,
                    marginPct: p.marginPct,
                })),
                debt: {
                    outstandingPence: debt.outstanding_pence,
                    overdue90Pence: debt.overdue90_pence,
                    collectionRatePct: debt.collection_rate_pct,
                },
                leakage: {
                    totalAnnualLeakagePence: leakage.annualTotalPence,
                    lines: leakage.lines.map((l) => ({
                        label: l.label,
                        annualPence: l.annualPence,
                        owner: l.owner,
                    })),
                },
                chairs: chair && chair.applicable !== false ? {
                    totalChairs: chair.group.chairs,
                    occupancyPct: chair.group.occupancyPct,
                    lostPotentialYrPence: chair.group.lostPotentialYrPence,
                    recoverRevYrPence: chair.group.recoverRevYrPence,
                    practices: chair.practices.map((p) => ({
                        name: p.name,
                        chairs: p.chairs,
                        occupancyPct: p.occupancyPct,
                    })),
                } : null,
                baseline: health?.baseline || null,
                targets: health?.targets || null,
            },
        };

        await checkBudget(orgId); // throws AppError 429 when over the monthly token budget
        try {
            const ai = await claude_1.askAnalyst(orgId, q, summary);
            await recordUsage(orgId, { feature: 'analyst', model: getProvider().model, usage: ai.usage });
            const answerFindings = ai.findings && ai.findings.length ? ai.findings : findings.slice(0, 4);
            return { scope, period, question: q, answer: ai.answer, findings, answerFindings, basis: 'claude', model: getProvider().model, practiceBreakdown };
        } catch (err) {
            console.error('[aiAsk] AI call failed:', err.message, err.stack?.split('\n')[1]);
            // Graceful fallback — no Claude key or a transient error: keyword-match
            // the question against the real findings so the Ask box still works.
            const ql = q.toLowerCase();
            const hits = findings.filter((f) => `${f.t} ${f.d}`.toLowerCase().split(/\W+/).some((w) => w.length > 3 && ql.includes(w)));
            return {
                scope, period, question: q,
                answer: null,
                findings,
                answerFindings: (hits.length ? hits : findings).slice(0, 3),
                basis: 'rollups',
                model: null,
                note: 'AI answer unavailable (no model configured) — showing the closest matching findings from your live data.',
                practiceBreakdown,
            };
        }
    },
    // Assemble the live aggregated context for a period. Pure assembly (no cache);
    // ai-context.service wraps this with snapshot caching + meta. period: 'current'
    // | 'YYYY-MM' resolves the window. Returns the same shape it always did.
    async assembleLiveContext(orgId, opts = 'current') {
        const o = typeof opts === 'string' ? { period: opts } : (opts || {});
        const now = new Date();
        const scope = o.scope || 'all';
        let win;
        let resolvedWin;
        if (o.since && o.until) {
          win = { scope, period: 'month', since: o.since, until: o.until, now: () => now };
          resolvedWin = resolveWindow({ since: o.since, until: o.until, now });
        } else {
          const periodKey = (!o.period || o.period === 'current')
            ? londonMonthKey(now)
            : o.period;
          win = { scope, period: 'month', periodKey, now: () => now };
          resolvedWin = treatmentWindow('month', periodKey, now);
        }

        // Historical periods must ground on the baseline/targets in effect THEN,
        // not today's overwrite-in-place blob (see baselineAsOf).
        const baselineP = baselineAsOf(orgId, resolvedWin, now);

        const [pl, mkt, clin, cash, settledRevRows, entityRows, leakage, debt, chair, health, bank, leadRows, treatments] = await Promise.all([
            this.plMargin(orgId, win),
            this.marketingRoi(orgId, win),
            this.clinicians(orgId, win),
            this.cashByDay(orgId, win),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, resolvedWin.since, resolvedWin.until),
            analytics_repository_1.analyticsRepository.allEntities(orgId),
            this.revenueLeakage(orgId, win),
            debtService.list(orgId),
            this.chairAnalytics(orgId, win),
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
            analytics_repository_1.analyticsRepository.leadsRollupByPractice(orgId, resolvedWin.since, resolvedWin.until),
            analytics_repository_1.analyticsRepository.treatmentsRollupByOrg(orgId, resolvedWin.since, resolvedWin.until),
        ]);

        // Live acquisition funnel for the window. Same locked definitions as
        // Business Hub: conversionRate = leads reaching treatment / total leads
        // (lead->treatment). Lets the AI cite the REAL conversion, not only the
        // baseline goal. Leads + converted summed from the raw rollup so the
        // null-practice (GHL) bucket isn't dropped.
        const fnlRate = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
        const fnlNum = (v) => Number(v || 0);
        const totalLeads = leadRows.reduce((s, r) => s + fnlNum(r.total), 0);
        const totalConverted = leadRows.reduce((s, r) => s + fnlNum(r.converted), 0);
        const treatmentsStarted = fnlNum(treatments.started);
        const funnel = totalLeads > 0 ? {
            leads: totalLeads,
            converted: totalConverted,
            conversionRatePct: fnlRate(totalConverted, totalLeads),
            leadToStartRatePct: fnlRate(treatmentsStarted, totalLeads),
            treatmentsStarted,
            treatmentsCompleted: fnlNum(treatments.completed),
        } : null;

        const cashByPractice = new Map();
        if (Array.isArray(settledRevRows)) {
            for (const r of settledRevRows) {
                if (r.practice_id) {
                    const current = cashByPractice.get(r.practice_id) || 0;
                    cashByPractice.set(r.practice_id, current + (Number(r.pence) || 0));
                }
            }
        }

        const productionByPractice = new Map();
        if (clin && Array.isArray(clin.clinicians)) {
            for (const c of clin.clinicians) {
                if (c.practiceId) {
                    const current = productionByPractice.get(c.practiceId) || 0;
                    productionByPractice.set(c.practiceId, current + (c.productionPence || 0));
                }
            }
        }

        const plByPractice = new Map();
        if (pl && Array.isArray(pl.entities)) {
            for (const e of pl.entities) {
                if (e.id) {
                    plByPractice.set(e.id, {
                        revPence: e.revPence,
                        netPence: e.netPence,
                        marginPct: e.marginPct,
                    });
                }
            }
        }

        const practiceBreakdown = entityRows
            .filter((e) => e.kind === 'practice')
            .map((e) => {
                const cashPence = cashByPractice.get(e.id) || 0;
                const productionPence = productionByPractice.get(e.id) || 0;
                const plData = plByPractice.get(e.id) || null;
                return {
                    name: e.name,
                    cashPence,
                    productionPence,
                    revPence: plData ? plData.revPence : null,
                    netPence: plData ? plData.netPence : null,
                    marginPct: plData ? plData.marginPct : null,
                };
            });
        practiceBreakdown.sort((a, b) => b.cashPence - a.cashPence || a.name.localeCompare(b.name));

        return {
            pl: pl.hasData ? { revenuePence: pl.statement.revPence, netPence: pl.statement.netPence, marginPct: pl.statement.marginPct, basis: pl.basis, entities: pl.entities.map((e) => ({ name: e.name, revPence: e.revPence, netPence: e.netPence, marginPct: e.marginPct })) } : null,
            marketing: { connected: mkt.connected, paidSpendPence: mkt.paidSpendPence, settledRevenuePence: mkt.settledRevenuePence, blendedRoas: mkt.blendedRoas, channels: mkt.channels.map((c) => ({ label: c.label, spendPence: c.spendPence, leads: c.leads, conversions: c.conversions, cpaPence: c.cpaPence })) },
            clinicians: clin.applicable === false ? null : { productionAvailable: clin.productionAvailable, totalProductionPence: clin.totalProductionPence, totalFeesPence: clin.totalFeesPence, top: clin.clinicians.slice(0, 5).map((c) => ({ name: c.name, productionPence: c.productionPence, payPct: c.payPct })) },
            cash: {
                totalPence: cash.hasData ? cash.totalPence : 0,
                avgPerDayPence: cash.hasData ? cash.avgPerDayPence : 0,
                peak: (cash.hasData && cash.peak) ? { label: cash.peak.label, pence: cash.peak.pence } : null,
                bankBalancePence: bank ? bank.totalPence : 0,
                bankLastSyncedAt: bank ? bank.lastSyncedAt : null,
            },
            practices: practiceBreakdown.map((p) => ({
                name: p.name,
                cashPence: p.cashPence,
                productionPence: p.productionPence,
                revPence: p.revPence,
                netPence: p.netPence,
                marginPct: p.marginPct,
            })),
            debt: {
                outstandingPence: debt.outstanding_pence,
                overdue90Pence: debt.overdue90_pence,
                collectionRatePct: debt.collection_rate_pct,
            },
            leakage: {
                totalAnnualLeakagePence: leakage.annualTotalPence,
                lines: leakage.lines.map((l) => ({
                    label: l.label,
                    annualPence: l.annualPence,
                    owner: l.owner,
                })),
            },
            chairs: chair && chair.applicable !== false ? {
                totalChairs: chair.group.chairs,
                occupancyPct: chair.group.occupancyPct,
                lostPotentialYrPence: chair.group.lostPotentialYrPence,
                recoverRevYrPence: chair.group.recoverRevYrPence,
                practices: chair.practices.map((p) => ({
                    name: p.name,
                    chairs: p.chairs,
                    occupancyPct: p.occupancyPct,
                })),
            } : null,
            funnel,
            baseline: health?.baseline || null,
            targets: health?.targets || null,
        };
    },
    // Back-compat drop-in: existing AI callers get the cached snapshot (which
    // spreads the same top-level fields plus meta/trailing12) instead of a fresh
    // assembly each call. Lazy import avoids the analytics <-> ai-context cycle.
    async getLiveContextData(orgId, period = 'current') {
      const { getSnapshot } = await import("./ai-context.service.js");
      return getSnapshot(orgId, period);
    },
    // Group valuation midpoint. Precedence: (1) the manual business_health
    // baseline (revenue+profit you typed in Setup & Targets); (2) when no
    // baseline exists, seed from the REAL synced turnover (invoice_items TTM)
    // with an assumed EBITDA margin — so the Exit Plan / Value & Growth screens
    // reflect what the app already knows instead of returning "No baseline set"
    // (and £0). `opts.marginPct` overrides the assumed margin (Exit Plan slider).
    // Always exposes a lowercase `midpoint` alias + a `basis` tag for the UI.
    async valuation(orgId, { marginPct } = {}) {
        const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
        const b = health?.baseline;
        if (b?.revenue && b?.profit) {
            const revenuePence = b.revenue * 100;
            const profitPence = b.profit * 100;
            const ebitdaPence = profitPence + Math.round(revenuePence * 0.04); // add back D&A
            const result = (0, formulas_1.calculateValuation)({
                annualRevenue: revenuePence,
                ebitda: ebitdaPence,
                nhsRevenuePct: 100 - (b.private_pct || 50),
                privateRevenuePct: b.private_pct || 50,
            });
            return { ...result, midpoint: result.midPoint, basis: 'baseline',
                annualRevenuePence: revenuePence, ebitdaPence };
        }
        // No baseline → real-turnover seed (trailing 12 months).
        const real = await this._realTurnoverValuation(orgId, marginPct);
        if (real)
            return real;
        return { error: 'No baseline set' };
    },
    // Value the group from real invoiced turnover (invoice_items TTM) + an
    // assumed EBITDA margin. Returns null when there is no turnover to value
    // (caller then yields the legacy "No baseline set"). Pure money in pence.
    async _realTurnoverValuation(orgId, marginPct) {
        const until = new Date();
        const since = new Date(until);
        since.setFullYear(since.getFullYear() - 1);
        let totalPence = 0;
        let privatePence = 0;
        try {
            ({ totalPence, privatePence } = await analytics_repository_1.analyticsRepository
                .turnoverTTM(orgId, since.toISOString(), until.toISOString()));
        } catch {
            return null;
        }
        if (!(totalPence > 0))
            return null;
        const privateRevenuePct = Math.round((100 * privatePence) / totalPence);
        const v = (0, formulas_1.valuationFromTurnover)({
            annualRevenuePence: totalPence,
            ebitdaMarginPct: marginPct ?? 18,
            privateRevenuePct,
        });
        return { ...v, basis: 'real-turnover' };
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
        const [dayRows, actuals, bank, billedRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            this._actualsBundle(orgId, practiceId),
            // Bank balance is org-level (not per practice) → only used for "All".
            practiceId ? Promise.resolve({ totalPence: 0 }) : analytics_repository_1.analyticsRepository.bankSummary(orgId),
            // Billed production (invoiced fees) for the SAME window — the accrual
            // turnover number. Grouped RPC (small row count). Empty when PMS hidden.
            // Never let a billing-source failure break the dashboard → fall back to
            // settled receipts for turnover.
            analytics_repository_1.analyticsRepository.treatmentRevenueMatrix(orgId, sinceISO, untilISO).catch(() => []),
        ]);
        const periodRevenue = (Array.isArray(dayRows) ? dayRows : []).reduce((s, r) => s + Number(r.pence || 0), 0);
        const bankPence = bank.totalPence || 0;
        // Invoiced production banked into the window — scoped to the practice when
        // one is selected (the matrix carries practice_id; the RPC is org-wide).
        const billedPence = (Array.isArray(billedRows) ? billedRows : [])
            .filter((r) => !practiceId || r.practice_id === practiceId)
            .reduce((s, r) => s + (Number(r.fee_pence) || 0), 0);
        // monthly_financials.period is 'YYYY-MM' — fully period-sliceable. For a
        // custom [from,to] range, sum the bucket actuals for the periods the
        // window covers; otherwise use the trailing-12 annual sum. Costs are
        // org-level (practice_id null), so a practice-scoped request with no
        // per-practice cost split still yields 0 actuals — acceptable.
        const actualBuckets = ranged
            ? sumBucketsInWindow(actuals.byPeriod, from, to)
            : actuals.annual;
        const useActuals = actuals.hasAny && ((actualBuckets.revenue || 0) > 0);
        let revenuePence = periodRevenue, totalCostsPence = 0, netProfitPence = 0, marginPct = 0;
        let turnoverBasis = 'settled';
        if (useActuals) {
            const inp = plInputFromBuckets(actualBuckets);
            const pl = (0, formulas_1.calculatePL)(inp);
            revenuePence = inp.revenue;
            totalCostsPence = pl.totalCosts;
            netProfitPence = pl.netProfit;
            marginPct = pl.marginPct;
            turnoverBasis = 'actuals';
        } else if (billedPence > 0) {
            // Turnover = invoiced production (billed) whenever billing data exists,
            // so it agrees with Group Overview and never collapses to == cash in
            // short windows (where settled cash for prior work can exceed in-window
            // billing). Cash collected stays settled receipts; collection rate
            // (cash/turnover) can legitimately exceed 100% over a short window.
            revenuePence = billedPence;
            turnoverBasis = 'billed';
        }
        return {
            basis: useActuals ? 'actuals' : 'revenue-only',
            turnoverBasis,
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
    async financeSeries(orgId, { months = 12, now = () => new Date(), practiceId = null, from = null, to = null, source = 'combined', accountId = null, accountingMethod = 'accrual' } = {}) {
        const ref = now();
        const { keys, sinceISO, untilISO } = this._monthWindow(ref, months, from, to);
        const src = (source === 'dentally' || source === 'quickbooks') ? source : 'combined';

        // QuickBooks source: the P&L is built ENTIRELY from QBO actuals
        // (revenue + costs in monthly_financials, source='quickbooks'), optionally
        // scoped to one connected company (accountId). No Dentally revenue feed,
        // and no practice scoping — a QB company is not practice-mapped.
        if (src === 'quickbooks') {
            const actuals = await this._actualsBundle(orgId, null, { source: 'quickbooks', accountId, accountingMethod });
            let qbMonths = 0;
            const series = keys.map((month) => {
                if (actuals.byPeriod.has(month)) {
                    qbMonths++;
                    return { ...financeSeriesRowFromBuckets(month, actuals.byPeriod.get(month)), costsAvailable: true };
                }
                return { month, revenue: 0, associatePay: 0, staffCosts: 0, labMaterials: 0, opex: 0, profit: 0, costsAvailable: false };
            });
            return { basis: qbMonths > 0 ? 'actuals' : 'revenue-only', costsAvailable: qbMonths > 0, source: 'quickbooks', months: series };
        }

        const [actuals, dayRows, billedRows] = await Promise.all([
            // Dentally source: revenue only — Dentally provides no cost data, so the
            // cost actuals bundle is skipped and costs/profit stay £0 (not estimated).
            src === 'dentally'
                ? Promise.resolve({ byPeriod: new Map(), annual: {}, hasAny: false, periodsCovered: 0 })
                : this._actualsBundle(orgId, practiceId, { accountingMethod }),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            // Billed production by month (invoice_items) — the accrual turnover feed
            // the Business Hub uses, so Value & Growth's TTM base agrees with the
            // dashboard turnover instead of settled cash. Read only the keys we want
            // (untilISO omitted to avoid a month-boundary off-by-one). Never let a
            // billing-source failure break the series → fall back to settled cash.
            analytics_repository_1.analyticsRepository.billedRevenueByMonth(orgId, sinceISO, null, practiceId).catch(() => []),
        ]);
        const revByMonth = this._monthlyRevenueFromDays(dayRows);
        const billedByMonth = new Map(
            (Array.isArray(billedRows) ? billedRows : []).map((r) => [String(r.month), Number(r.pence) || 0]),
        );
        let actualCostMonths = 0;
        let revenueOnlyMonths = 0;
        const series = keys.map((month) => {
            // Real costs present (Xero/manual) → use them verbatim.
            if (actuals.byPeriod.has(month)) {
                actualCostMonths++;
                return { ...financeSeriesRowFromBuckets(month, actuals.byPeriod.get(month)), costsAvailable: true };
            }
            // No real cost source → exact revenue, costs and profit 0 (not estimated).
            // Turnover basis matches Business Hub: prefer billed production (invoice_
            // items) when present, else settled cash receipts.
            const billed = billedByMonth.get(month) || 0;
            const revenue = billed > 0 ? billed : (revByMonth.get(month) || 0);
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
        return { basis, costsAvailable: revenueOnlyMonths === 0 && actualCostMonths > 0, source: src, months: series };
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
        const totalReceiptsPence = out.reduce((s, w) => s + w.receiptsPence, 0);

        // Runway: free cash now (real bank balance) vs monthly burn. Receipts are
        // the window's settled receipts annualised to a monthly rate; costs come
        // from the P&L (monthly_financials actuals preferred, else the org
        // baseline). There is NO scheduled-bills source, so bills-to-plan is
        // omitted and the burn is the P&L cost base — flagged when no cost source.
        // monthly rate = receipts/week × (52/12) weeks per month.
        const monthlyReceiptsPence = weeks > 0
            ? Math.round((totalReceiptsPence * 52) / (weeks * 12))
            : 0;
        const actuals = await this._actualsBundle(orgId, practiceId);
        let monthlyCostsPence = 0;
        let costsAvailable = false;
        let costsBasis = 'none';
        if (actuals.hasAny) {
            const pl = (0, formulas_1.calculatePL)(plInputFromBuckets(actuals.annual));
            if (pl.totalCosts > 0 && actuals.periodsCovered > 0) {
                monthlyCostsPence = Math.round(pl.totalCosts / actuals.periodsCovered);
                costsAvailable = true;
                costsBasis = 'actuals';
            }
        }
        if (!costsAvailable && !practiceId) {
            const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
            const b = health?.baseline;
            if (b?.revenue) {
                const revenuePence = b.revenue * 100;
                const totalCostPct = (b.cost_associates || 0) + (b.cost_lab || 0) + (b.cost_materials || 0)
                    + (b.cost_staff || 0) + (b.cost_property || 0) + (b.cost_marketing || 0) + (b.cost_other || 0);
                if (totalCostPct > 0) {
                    monthlyCostsPence = Math.round((revenuePence * totalCostPct / 100) / 12);
                    costsAvailable = true;
                    costsBasis = 'baseline';
                }
            }
        }
        const runway = {
            ...(0, formulas_1.calculateRunway)({
                cashOnHandPence: openingStart,
                monthlyReceiptsPence,
                monthlyCostsPence,
            }),
            costsAvailable,
            costsBasis,
            billsToPlanPence: null, // no payables / scheduled-bill source
        };

        return {
            basis: 'actuals',
            bankConnected: bank.count > 0,
            bankStale,
            lastSyncedAt: bank.lastSyncedAt,
            openingBalancePence: openingStart,
            totalReceiptsPence,
            weeks: out,
            runway,
        };
    },
    // Cashflow & Runway OUTLOOK (Intelligence OS) — month-by-month cash in vs out,
    // a forward-projected closing-balance trail ("will I run out?"), tax bills to
    // plan for, and a free-cash decision. Honesty rules:
    //   • IN  = exact settled receipts per month (real).
    //   • OUT = P&L cost base per month (monthly_financials actuals) — an accrual
    //           proxy for cash out, flagged; 0 + costsAvailable:false when no source.
    //   • Forward months are PROJECTED from a recent run-rate (flagged projected).
    //   • Closing balances are anchored to TODAY's real bank balance: the current
    //     month closes at the real bank balance, earlier months are reconstructed
    //     from it (balancesReconstructed:true), later months projected forward.
    //   • Bills are tax ESTIMATES from profit; no payables/scheduled-bill source.
    async cashflowOutlook(orgId, { months = 4, forward = 2, now = () => new Date(), practiceId = null } = {}) {
        const ref = now();
        // Cash IN must be EXACT settled receipts (real money landed), per this
        // view's contract. financeSeries.revenue prefers BILLED production
        // (invoice_items accrual turnover) when present — correct for Value &
        // Growth, but wrong for a cashflow view: it overstates "cash in" by the
        // billed-but-not-yet-collected gap (e.g. £378k billed vs £309k settled).
        // So source IN from settled receipts directly and use financeSeries ONLY
        // for the cost (OUT) buckets.
        const { keys, sinceISO, untilISO } = this._monthWindow(ref, months, null, null);
        const [series, bank, settledDays, inSrcSlugs, outSrcSlugs] = await Promise.all([
            this.financeSeries(orgId, { months, now, practiceId }),
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            analytics_repository_1.analyticsRepository.settledReceiptSources(orgId, sinceISO, practiceId, untilISO).catch(() => []),
            monthlyFinancial_repository_1.monthlyFinancialRepository.distinctSources(orgId).catch(() => []),
        ]);
        const settledByMonth = this._monthlyRevenueFromDays(settledDays);
        const anchorBank = bank.totalPence || 0;
        const costsByMonth = new Map(series.months.map((m) => [m.month, m]));
        const real = keys.map((month) => {
            const c = costsByMonth.get(month);
            const out = c ? (c.associatePay || 0) + (c.staffCosts || 0) + (c.labMaterials || 0) + (c.opex || 0) : 0;
            // Prefer real settled cash. Fall back to financeSeries revenue ONLY when
            // there is no settled-receipts feed for the month (e.g. a QBO-only org
            // with no Dentally payments) so cash-in doesn't drop to 0 there; an
            // active Dentally org always has settled receipts and uses them.
            const settled = settledByMonth.get(month) || 0;
            const inPence = settled > 0 ? settled : (c ? (c.revenue || 0) : 0);
            return { month, inPence, outPence: out, costsAvailable: !!(c && c.costsAvailable), projected: false };
        });

        // Run-rate: average of recent COMPLETE months.
        //
        // The current calendar month is excluded, and that exclusion is the
        // whole point. On the 3rd of September this window's last month held
        // three days of takings (£9,475 against a £133,083 August), and
        // averaging it in as though it were a whole month dragged the run-rate
        // from £146,601 to £100,892 — a third low. The same stub month cut the
        // cost side too, so the two errors did not cancel: they made a burning
        // practice look self-funding. A forward number that is most wrong at the
        // start of every month is worse than no forward number.
        const currentKey = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
        const isComplete = (m) => m.month !== currentKey;
        // Fall back to whatever exists only when NO month is complete (a brand
        // new org in its first month) — a rough figure beats a zero there.
        const completeReal = real.filter(isComplete).length ? real.filter(isComplete) : real;
        const recentIn = completeReal.slice(-3);
        const inRunRate = recentIn.length ? Math.round(recentIn.reduce((s, m) => s + m.inPence, 0) / recentIn.length) : 0;
        const costMonthsAll = real.filter((m) => m.costsAvailable);
        const costMonths = costMonthsAll.filter(isComplete).length
            ? costMonthsAll.filter(isComplete)
            : costMonthsAll;
        let outRunRate = costMonths.length
            ? Math.round(costMonths.slice(-3).reduce((s, m) => s + m.outPence, 0) / Math.min(3, costMonths.length))
            : 0;
        // No per-month costs at all → fall back to the org baseline cost base.
        let costsBasis = costMonthsAll.length ? 'actuals' : 'none';
        if (!costMonthsAll.length && !practiceId) {
            const health = await analytics_repository_1.analyticsRepository.baselineSingle(orgId);
            const b = health?.baseline;
            if (b?.revenue) {
                const revenuePence = b.revenue * 100;
                const totalCostPct = (b.cost_associates || 0) + (b.cost_lab || 0) + (b.cost_materials || 0)
                    + (b.cost_staff || 0) + (b.cost_property || 0) + (b.cost_marketing || 0) + (b.cost_other || 0);
                if (totalCostPct > 0) {
                    outRunRate = Math.round((revenuePence * totalCostPct / 100) / 12);
                    costsBasis = 'baseline';
                }
            }
        }
        const costsAvailable = costsBasis !== 'none';

        // Name the data feed behind each line. Cash IN = the settled-payment
        // source (Dentally / Stripe / GoCardless); when a month fell back to
        // financeSeries revenue (no settled receipts), it came from the cost
        // source instead. Cash OUT = the cost source (QuickBooks / Xero / manual).
        const SOURCE_LABELS = { dentally: 'Dentally', quickbooks: 'QuickBooks', xero: 'Xero', manual: 'manual entry', stripe: 'Stripe', gocardless: 'GoCardless' };
        const labelSources = (slugs) => {
            const names = [...new Set((slugs || []).map((s) => SOURCE_LABELS[s] || s))];
            return names.length ? names.join(' + ') : null;
        };
        const outSource = costsBasis === 'actuals' ? labelSources(outSrcSlugs)
            : costsBasis === 'baseline' ? 'business baseline (estimate)'
            : null;
        const hasSettled = real.some((m) => m.inPence > 0 && (settledByMonth.get(m.month) || 0) > 0);
        const inSource = (hasSettled && labelSources(inSrcSlugs)) || outSource || null;

        // Forward projected months (next `forward` calendar months).
        const pad = (n) => String(n).padStart(2, '0');
        const lastKey = real.length ? real[real.length - 1].month : `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}`;
        const [ly, lm] = lastKey.split('-').map(Number);
        const projected = [];
        for (let i = 1; i <= forward; i++) {
            const d = new Date(ly, lm - 1 + i, 1);
            projected.push({
                month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
                inPence: inRunRate,
                outPence: outRunRate,
                costsAvailable,
                projected: true,
            });
        }

        const all = [...real, ...projected].map((m) => ({ ...m, netPence: m.inPence - m.outPence }));
        const currentIdx = real.length - 1; // last real month closes at the real bank balance
        // Anchor closing[currentIdx] = anchorBank; reconstruct earlier, project later.
        if (currentIdx >= 0) {
            all[currentIdx].closingPence = anchorBank;
            all[currentIdx].openingPence = anchorBank - all[currentIdx].netPence;
            for (let i = currentIdx - 1; i >= 0; i--) {
                all[i].closingPence = all[i + 1].openingPence;
                all[i].openingPence = all[i].closingPence - all[i].netPence;
            }
            for (let i = currentIdx + 1; i < all.length; i++) {
                all[i].openingPence = all[i - 1].closingPence;
                all[i].closingPence = all[i].openingPence + all[i].netPence;
            }
        }
        const lowestProjectedPence = all.length ? Math.min(...all.map((m) => m.closingPence ?? anchorBank)) : anchorBank;

        // Annual profit for the tax estimate: real (sum of months with costs,
        // annualised) when available, else baseline-derived; else 0 (no estimate).
        let annualProfitPence = 0;
        let profitBasis = 'none';
        if (costMonths.length) {
            const avgNet = costMonths.slice(-3).reduce((s, m) => s + (m.inPence - m.outPence), 0) / Math.min(3, costMonths.length);
            annualProfitPence = Math.round(avgNet * 12);
            profitBasis = 'actuals';
        } else if (!practiceId && outRunRate > 0) {
            annualProfitPence = Math.round((inRunRate - outRunRate) * 12);
            profitBasis = 'baseline';
        }
        const corpTaxPence = annualProfitPence > 0 ? (0, formulas_1.estimateCorporationTax)(annualProfitPence) : 0;
        const bills = corpTaxPence > 0
            ? [{ item: 'Corporation tax', type: 'tax', window: 'annual estimate', amountPence: corpTaxPence, estimated: true }]
            : [];

        const decision = (0, formulas_1.freeCashDecision)({
            cashOnHandPence: anchorBank,
            monthlyCostsPence: outRunRate,
            lowestProjectedPence,
            bufferWeeks: 2,
        });
        const runway = (0, formulas_1.calculateRunway)({
            cashOnHandPence: anchorBank,
            monthlyReceiptsPence: inRunRate,
            monthlyCostsPence: outRunRate,
        });

        return {
            basis: series.basis,
            bankConnected: bank.count > 0,
            anchorBankPence: anchorBank,
            costsAvailable,
            costsBasis,
            // WHY cash out is missing, so the screen stops telling an owner to
            // connect a feed they already connected.
            //
            // 'org-level-costs' is BY DESIGN, not a gap awaiting a mapping: a
            // QuickBooks company is an independent entity and is deliberately
            // never mapped to a practice (owner's decision, see the QuickBooks
            // multi-account model). Costs therefore exist only at org level, so
            // every practice-scoped view has none however healthy the feed is.
            // Do not "fix" this by adding a practice mapping.
            costsUnavailableReason: costsAvailable ? null
                : (outSrcSlugs?.length ? (practiceId ? 'org-level-costs' : 'no-rows') : 'no-feed'),
            inSource,  // human label for the cash-in feed (e.g. 'Dentally')
            outSource, // human label for the cash-out feed (e.g. 'QuickBooks')
            balancesReconstructed: currentIdx >= 1, // historical closings derived from today's balance
            months: all,
            currentIndex: currentIdx,
            lowestProjectedPence,
            runway: { ...runway, costsAvailable, costsBasis },
            bills,
            billsBasis: profitBasis, // how the tax estimate was derived
            billsNote: 'Committed bills (VAT, PAYE, supplier invoices) need an accounting/payables feed — not connected. Dental treatment income is largely VAT-exempt.',
            decision,
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
        await checkBudget(orgId); // throws AppError 429 when over the monthly token budget
        try {
            const insights = await claude_1.generateDataInsights(orgId, {
                baseline,
                series,
                practices,
                sources,
            });
            await recordUsage(orgId, { feature: 'insights', model: getProvider().model, usage: insights?.usage });
            return { basis: 'ai', insights };
        }
        catch (err) {
            return { basis: 'ai', insights: [], error: 'AI service unavailable' };
        }
    },
    // ------------------------------------------------------------------------
    // Decision Lens (AI) — surface-specific "what to act on now" cards, cached
    // per org+surface+scope+period on a 6h TTL (refresh=true forces a rebuild).
    // Assembles the surface's already-aggregated rollups server-side, hands them
    // to Gemini, and returns {basis:'ai', items:[...]}. On any failure returns
    // {basis:'unavailable', items:[]} — the frontend then renders its
    // deterministic rule-based lens, so the card is never blank.
    async decisionLens(orgId, { surface = 'group', scope = 'all', period = 'month', periodKey = null, since = null, until = null, label = null, refresh = false, now = () => new Date() } = {}) {
        const cacheKey = [scope, period, since || '', until || '', label || ''].join('|');
        const TTL_MS = 6 * 3600 * 1000;
        if (!refresh) {
            const cached = await analytics_repository_1.analyticsRepository.getDecisionLensCache(orgId, surface, cacheKey).catch(() => null);
            if (cached?.items && (now().getTime() - Date.parse(cached.generated_at)) < TTL_MS)
                return { basis: 'ai', cached: true, generatedAt: cached.generated_at, items: cached.items };
        }
        const periodLabel = label || (until ? `${(since || '').slice(0, 10)} → ${until.slice(0, 10)}` : period);
        let data = {};
        let scopeLabel = 'Group';
        try {
            if (surface === 'marketing') {
                const roi = await this.marketingRoi(orgId, { scope, period, periodKey, since, until, label, now });
                scopeLabel = roi.scope && roi.scope !== 'all' && roi.scope !== 'practices' ? (roi.byPractice?.[0]?.name || 'Practice') : 'Group';
                data = {
                    paidSpendPence: roi.paidSpendPence, blendedRoas: roi.blendedRoas, settledRevenuePence: roi.settledRevenuePence,
                    totalLeads: roi.totalLeads, totalConversions: roi.totalConversions,
                    channels: (roi.channels || []).map((c) => ({ label: c.label, paid: c.paid, spendPence: c.spendPence, adConversions: c.adConversions, leads: c.leads, costPerAdConvPence: c.costPerAdConvPence, costPerLeadPence: c.cplPence })),
                    byPractice: roi.byPractice,
                };
            }
            else if (surface === 'clinicians') {
                data = await this.clinicians(orgId, { scope, period, periodKey, since, until, label, now });
                scopeLabel = data?.scope === 'practice' ? 'Practice' : 'Group';
            }
            else { // group | day
                const hub = await this.businessHub(orgId, { since, until, label, now });
                const scoped = (scope !== 'all' && scope !== 'practices') ? hub.practices.find((p) => p.practiceId === scope) : null;
                scopeLabel = scoped?.name || 'Group';
                data = {
                    group: hub.group,
                    practices: (hub.practices || []).map((p) => ({ name: p.name, revenuePence: p.revenuePence, treatmentsClosedPence: p.treatmentsClosedPence, appointments: p.appointments, noShows: p.noShows, noShowRate: p.noShowRate, newPatients: p.newPatients, leads: p.leads })),
                    revenueByLine: hub.revenueByLine,
                    focus: surface === 'day' ? 'cash_collected' : 'group',
                };
            }
        }
        catch (err) {
            return { basis: 'unavailable', items: [], error: 'Could not assemble data' };
        }
        await checkBudget(orgId); // throws AppError 429 when over the monthly token budget
        try {
            const { items, usage } = await claude_1.generateDecisionLens(orgId, { surface, scopeLabel, periodLabel, data });
            await recordUsage(orgId, { feature: 'decision_lens', model: getProvider().model, usage });
            if (!items.length) return { basis: 'unavailable', items: [] };
            await analytics_repository_1.analyticsRepository.upsertDecisionLensCache(orgId, surface, cacheKey, items).catch(() => {});
            return { basis: 'ai', cached: false, generatedAt: new Date().toISOString(), items };
        }
        catch (err) {
            return { basis: 'unavailable', items: [] };
        }
    },
    // ------------------------------------------------------------------------
    // Business Hub — group totals + per-practice comparison. EXACT per-practice
    // rollups via Postgres GROUP BY RPCs (no 1000-row cap): revenue (settled
    // payments), ops (appointments → completed/DNA), growth (leads → conversion).
    // Group revenue target = business_health baseline (a goal). Group margin is
    // REAL only when monthly_financials actuals exist, else 0 (never estimated).
    // Revenue Leakage — "money left on the table" over the window. Pulls the
    // same real rollups Business Hub uses (settled turnover, appointments/no-
    // shows, treatment-plan value, banked receipts) and runs them through
    // calculateRevenueLeakage. The window total is annualised by the caller's
    // window length. `rates` (0-100 per pool) tunes the recoverable share.
    async revenueLeakage(orgId, { days = 90, since = null, until = null, rates = {}, practiceId = null, now = () => new Date() } = {}) {
        const nowMs = now().getTime();
        const sinceISO = since || new Date(nowMs - days * 86400000).toISOString();
        const untilISO = until || null;
        const windowEndMs = untilISO ? Date.parse(untilISO) : nowMs;
        const windowDays = Math.max(1, Math.round((windowEndMs - Date.parse(sinceISO)) / 86400000));
        const [revRowsAll, apptRowsAll, planVal, cashRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.appointmentsRollupByPractice(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.treatmentPlanValueByStatus(orgId, sinceISO, untilISO),
            // cashRows pre-filtered in SQL when scoped (p_practice).
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
        ]);
        // Practice scope: narrow the per-practice feeds to the selected practice.
        // treatment_plans carry no practice_id, so the plans pool can't be
        // attributed — zero presented/accepted when scoped (honest, not group-wide).
        const mine = (r) => r.practice_id === practiceId;
        const revRows = practiceId ? revRowsAll.filter(mine) : revRowsAll;
        const apptRows = practiceId ? apptRowsAll.filter(mine) : apptRowsAll;
        const scopedPlanVal = practiceId ? { presentedPence: 0, acceptedPence: 0 } : planVal;
        const num = (v) => Number(v || 0);
        const revenuePence = revRows.reduce((s, r) => s + num(r.pence), 0);
        const appointments = apptRows.reduce((s, r) => s + num(r.total), 0);
        const noShows = apptRows.reduce((s, r) => s + num(r.no_shows), 0);
        const cashCollectedPence = cashRows.reduce((s, r) => s + num(r.pence), 0);
        const result = formulas_1.calculateRevenueLeakage(
            {
                revenuePence,
                presentedPlanPence: scopedPlanVal.presentedPence,
                acceptedPlanPence: scopedPlanVal.acceptedPence,
                appointments,
                noShows,
                cashCollectedPence,
            },
            rates,
        );
        // Annualise the window total + each pool (window may not be a clean month).
        const annualise = (p) => Math.round((p * 365) / windowDays);
        const LINE_META = {
            plans: { label: 'Unaccepted / lost treatment plans', sub: 'Presented but not closed — TCO follow-up', owner: 'COO' },
            fta: { label: 'Failed appointments (FTA)', sub: 'Lost chair time from no-shows', owner: 'Site managers' },
            recall: { label: 'Unbooked hygiene recalls', sub: 'Recurring revenue not rebooked', owner: 'Reception' },
            lapsed: { label: 'Lapsed patients (>12 mo)', sub: 'Reactivation campaign opportunity', owner: 'Marketing' },
            collect: { label: 'Uncollected / open balances', sub: 'Completed work not yet paid', owner: 'Accounts' },
        };
        const lines = Object.entries(result.pools).map(([k, windowPence]) => ({
            key: k,
            ...LINE_META[k],
            windowPence,
            annualPence: annualise(windowPence),
            monthlyPence: Math.round(annualise(windowPence) / 12),
        })).sort((a, b) => b.annualPence - a.annualPence);
        const annualTotalPence = lines.reduce((s, l) => s + l.annualPence, 0);
        return {
            windowDays,
            since: sinceISO,
            until: untilISO,
            rates: result.rates,
            ftaRatePct: result.ftaRatePct,
            windowTotalPence: result.windowTotalPence,
            annualTotalPence,
            monthlyTotalPence: Math.round(annualTotalPence / 12),
            asPctOfRevenue: revenuePence > 0
                ? formulas_1.pct((result.windowTotalPence / revenuePence) * 100)
                : 0,
            inputs: { revenuePence, appointments, noShows, cashCollectedPence, ...scopedPlanVal },
            lines,
        };
    },
    // Cache-aside wrapper. Keyed on everything that changes the numbers, so a
    // different org, practice or window never reads another's payload. Callers
    // that pass a custom `now` (tests) bypass the cache entirely.
    async businessHub(orgId, opts = {}) {
        if (opts.now) return this._businessHubUncached(orgId, opts);
        const { days = 90, since = null, until = null, label = null, practiceId = null } = opts;
        const key = `${orgId}|${days}|${since}|${until}|${label}|${practiceId}`;

        // Tier 1 — in-process. Fastest, but per-instance and lost on deploy.
        const hot = businessHubCache.get(key);
        if (hot) return hot;

        // Tier 2 — Postgres. Survives deploys and is shared across instances,
        // so the first load after a push doesn't pay for 16 aggregates again.
        const warm = await (0, dashboard_cache_1.readDashboardCache)(orgId, `hub:${key}`);
        if (warm) return businessHubCache.set(key, warm);

        const fresh = await this._businessHubUncached(orgId, opts);
        // 10 minutes for a live window — deliberately longer than the 5-minute
        // `business-hub-warm` cron, so a single slow warm never leaves a gap
        // where a real page load has to compute 16 aggregates itself. Sources
        // sync nightly, and invalidateBusinessHub() clears both tiers the
        // moment new rows land, so this is not a staleness risk.
        // Closed windows (an explicit past `until`) are held far longer — their
        // numbers only move if a sync backfills history.
        const ttlMs = until && Date.parse(until) < Date.now() ? 6 * 60 * 60_000 : 10 * 60_000;
        await (0, dashboard_cache_1.writeDashboardCache)(orgId, `hub:${key}`, fresh, ttlMs);
        return businessHubCache.set(key, fresh);
    },

    // Drop cached Business Hub payloads for one org (after a sync writes new
    // rows), or all of them when called bare.
    invalidateBusinessHub(orgId) {
        businessHubCache.invalidate(orgId ? `${orgId}|` : undefined);
        // Best-effort: clear the durable tier too, else a sync's new numbers
        // would stay hidden behind a warm row.
        if (orgId) (0, dashboard_cache_1.purgeDashboardCache)(orgId).catch(() => {});
    },

    async _businessHubUncached(orgId, { days = 90, since = null, until = null, label = null, practiceId = null, now = () => new Date() } = {}) {
        // Window: an explicit [since, until] (a picked month/day) takes priority;
        // otherwise fall back to the trailing N-day window (until open).
        const sinceISO = since || new Date(now().getTime() - days * 86400000).toISOString();
        const untilISO = until || null;
        // Leads are windowed only when an upper bound is set (month/day mode); in
        // the trailing-days mode they stay all-time, as before.
        const leadSinceISO = untilISO ? sinceISO : null;
        // Ad-platform lead window as YYYY-MM-DD (ad_metrics.metric_date is a date).
        // Upper bound is inclusive of the last full day; trailing mode runs to today.
        const adFromDate = sinceISO.slice(0, 10);
        const adToDate = (untilISO ? new Date(new Date(untilISO).getTime() - 86400000) : now()).toISOString().slice(0, 10);
        // Bounded fan-out. These are 16 heavy aggregates; firing them all at
        // once starved individual statements past the 8s statement_timeout
        // (panels failed while their neighbours on the same page loaded).
        let [practices, revRows, apptRows, leadRows, treatments, closedRows, actuals, health, noShowTracked, revLineRows, cashRows, adLeadsBy, newPatientRows, acceptedAgg, acceptedByPractice, completedRows] = await (0, async_pool_1.mapWithConcurrency)([
            () => analytics_repository_1.analyticsRepository.practicesFull(orgId),
            () => analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceISO, untilISO),
            () => analytics_repository_1.analyticsRepository.appointmentsRollupByPractice(orgId, sinceISO, untilISO),
            () => analytics_repository_1.analyticsRepository.leadsRollupByPractice(orgId, leadSinceISO, untilISO),
            () => analytics_repository_1.analyticsRepository.treatmentsRollupByOrg(orgId, sinceISO, untilISO),
            () => analytics_repository_1.analyticsRepository.treatmentsClosedRevenueByPractice(orgId, sinceISO, untilISO),
            () => this._actualsBundle(orgId),
            () => analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            () => analytics_repository_1.analyticsRepository.hasNoShowData(orgId),
            () => analytics_repository_1.analyticsRepository.treatmentRevenueMatrix(orgId, sinceISO, untilISO),
            // Cash banked in window — settled receipts (payments processed).
            // Pre-filtered in SQL when scoped to a practice (p_practice).
            // Distinct from turnover (settled invoices); the gap is outstanding/debtors.
            () => analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            // Real ad-platform leads (Google + Meta conversions) + Dentally new
            // patients by registration ("joined") date — matches Dentally's New
            // Patients report. Live sources for the Leads / New Patients KPIs (CRM
            // `leads` is empty for Dentally-only orgs).
            () => analytics_repository_1.analyticsRepository.adLeadsByProvider(orgId, adFromDate, adToDate),
            () => analytics_repository_1.analyticsRepository.newPatientsRegisteredByPractice(orgId, sinceISO, untilISO),
            // Treatments ACCEPTED (Emergent ops app) — count + value in window.
            // Gated on an active emergent integration; zeros (placeholder) until connected.
            () => analytics_repository_1.analyticsRepository.treatmentAcceptedRollup(orgId, sinceISO, untilISO, practiceId),
            // Treatments ACCEPTED split by practice — feeds the card's click-to-
            // breakdown (which practice's data the card reflects). Group-wide
            // regardless of practiceId scope; [] until Emergent is connected.
            () => analytics_repository_1.analyticsRepository.treatmentAcceptedByPractice(orgId, sinceISO, untilISO),
            // Treatments COMPLETED per practice — the REAL Practitioner Activity feed
            // (dentally_treatment_items, migration 000099): completed treatments by
            // completed_at, charting rows excluded, attributed to a practice via the
            // practitioner's site. Replaces the old org-wide treatments_rollup_by_org
            // count (plan headers + planned-estimate value) so the card matches
            // Dentally's report and scopes per practice.
            () => analytics_repository_1.analyticsRepository.treatmentsCompletedByPractice(orgId, sinceISO, untilISO),
        ], 4);
        // Practice name lookup BEFORE the practiceId filter narrows `practices`, so
        // the accepted breakdown can name every practice even under a scoped call.
        const practiceNameById = new Map((practices || []).map((p) => [p.id, p.name]));
        // Practice scope (board report): collapse the group view to one practice by
        // narrowing every per-practice feed; group totals below then sum to it.
        // Feeds with no practice attribution degrade honestly: the treatment_plans
        // funnel (no practice_id) is zeroed, ad-platform leads (ad_metrics.practice_id
        // unreliable — usually one account per group) are dropped, and P&L margin +
        // baseline target stay org-level (no per-practice P&L feed exists). cashRows
        // is already practice-filtered in SQL above.
        if (practiceId) {
            const mine = (r) => r.practice_id === practiceId;
            practices = practices.filter((p) => p.id === practiceId);
            revRows = revRows.filter(mine);
            apptRows = apptRows.filter(mine);
            leadRows = leadRows.filter(mine);
            closedRows = closedRows.filter(mine);
            revLineRows = revLineRows.filter(mine);
            newPatientRows = newPatientRows.filter(mine);
            completedRows = (completedRows || []).filter(mine);
            treatments = { started: 0, completed: 0, closed_value_pence: 0 };
            adLeadsBy = new Map();
        }
        const rate = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
        const num = (v) => Number(v || 0);
        // Per-practice new patients (Dentally registration date) -> map by practice.
        // null-practice rows (unassigned patients) fold into the group total only.
        const newPatientsBy = new Map();
        for (const r of newPatientRows) newPatientsBy.set(r.practice_id, num(r.new_patients));
        // Turnover = billed production (invoice_items), so Group Overview agrees
        // with the Command Centre. cashCollected stays settled receipts. revBy
        // (settled per practice) is surfaced as the per-practice cash figure.
        const billedBy = new Map();
        for (const r of revLineRows) billedBy.set(r.practice_id, (billedBy.get(r.practice_id) || 0) + num(r.fee_pence));
        // Treatments-Closed value per practice (real invoiced plan fees) — same
        // invoice_items feed as turnover, so it's practice-attributed too. closed =
        // billed (sold); paid = amount actually COLLECTED on plan lines, allocated
        // pro-rata from each invoice's settled portion (migration 000101) — counts
        // partial payments, matching Dentally's collected basis (not the old
        // all-or-nothing invoice_paid flag). The gap is real outstanding debtors.
        const closedBy = new Map();
        const paidBy = new Map();
        for (const r of closedRows) {
            closedBy.set(r.practice_id, (closedBy.get(r.practice_id) || 0) + num(r.closed_value_pence));
            paidBy.set(r.practice_id, (paidBy.get(r.practice_id) || 0) + num(r.paid_value_pence));
        }
        // Treatments-Completed per practice (Practitioner Activity feed): count of
        // completed treatments + their value, attributed via the practitioner's site
        // so the card scopes to a selected practice. Null-practice rows (practitioner
        // with no mapped site) fold into the group total only, not any practice row.
        const completedCountBy = new Map();
        const completedValueBy = new Map();
        for (const r of (completedRows || [])) {
            completedCountBy.set(r.practice_id, (completedCountBy.get(r.practice_id) || 0) + num(r.completed_count));
            completedValueBy.set(r.practice_id, (completedValueBy.get(r.practice_id) || 0) + num(r.value_pence));
        }
        // Group total sums EVERY row (incl. null-practice), so unmapped completions
        // aren't lost by the per-practice attribution.
        const completedTotalCount = (completedRows || []).reduce((s, r) => s + num(r.completed_count), 0);
        const completedTotalValuePence = (completedRows || []).reduce((s, r) => s + num(r.value_pence), 0);
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
                revenuePence: billedBy.get(p.id) || 0,      // turnover = invoiced production
                takingsPence: revBy.get(p.id) || 0,         // Takings = settled payments received (matches Patient Payments "Received")
                treatmentsClosedPence: closedBy.get(p.id) || 0, // plan fees billed (sold), this practice
                treatmentsPaidPence: paidBy.get(p.id) || 0,     // plan fees paid (collected), this practice
                treatmentsCompleted: completedCountBy.get(p.id) || 0, // Practitioner Activity completed count, this practice
                treatmentsCompletedValuePence: completedValueBy.get(p.id) || 0, // value of those completed treatments
                cashCollectedPence: revBy.get(p.id) || 0,   // settled receipts for this practice (== takings)
                appointments,
                completed: num(ap.completed),
                noShows,
                noShowRate: rate(noShows, appointments),
                leads,
                conversionRate: rate(converted, leads),
                newPatients: newPatientsBy.get(p.id) || 0, // Dentally registrations, this practice
            };
        }).sort((a, b) => b.revenuePence - a.revenuePence);

        // Group totals (sum of exact per-practice rows).
        const sum = (k) => practiceRows.reduce((s, p) => s + p[k], 0);
        const totalRevenue = sum('revenuePence');
        const totalAppts = sum('appointments');
        const totalNoShows = sum('noShows');
        // CRM (GHL) leads from the raw rollups, not the per-practice rows: GHL
        // leads arrive with a null practice_id, so summing practiceRows would
        // silently drop them (they never match a practice). The raw leadRows
        // include the null-practice bucket.
        const crmLeads = leadRows.reduce((s, r) => s + num(r.total), 0);
        // Leads come from ALL acquisition sources, surfaced as named sections so
        // the card isn't just the (often-empty) GHL/CRM feed: Google Ads + Meta
        // report lead-form / pixel conversions in ad_metrics; GHL is the CRM
        // enquiry feed. Total = sum of every source.
        const googleLeads = num(adLeadsBy.get('google_ads'));
        const metaLeads = num(adLeadsBy.get('meta_ads'));
        const leadsBySource = [
            { source: 'Google Ads', leads: googleLeads },
            { source: 'Meta Ads', leads: metaLeads },
            { source: 'GHL / CRM', leads: crmLeads },
        ];
        const totalLeads = leadsBySource.reduce((s, x) => s + x.leads, 0);
        // New patients = patients registered (Dentally "joined" date) in the
        // window — matches Dentally's New Patients report, NOT the old CRM
        // "converted leads" proxy (0 for Dentally-only orgs). Group total sums
        // EVERY row (incl. any null-practice patients), so it isn't lost by the
        // per-practice mapping. conversionRate = new patients per lead.
        const newPatients = newPatientRows.reduce((s, r) => s + num(r.new_patients), 0);
        // Treatments STARTED: org-wide treatment_plans funnel (plans aren't reliably
        // practice-attributed, so this stays a group figure).
        const treatmentsStarted = num(treatments.started);
        // Treatments COMPLETED: the REAL Practitioner Activity feed
        // (dentally_treatment_items) — count + value of completed treatments in the
        // window, summed across practices. Matches Dentally's report to the penny and
        // is practice-scopable (per-practice rows above feed the card's filter). The
        // old org-wide treatments_rollup_by_org count (plan headers, planned-estimate
        // value) is no longer used for this card.
        const treatmentsCompleted = completedTotalCount;
        const treatmentsCompletedValuePence = completedTotalValuePence;
        // Treatments ACCEPTED (Emergent ops app) — placeholder zeros until the
        // emergent integration is connected (Dentally has no accepted flag).
        const treatmentsAcceptedCount = num(acceptedAgg?.count);
        const treatmentsAcceptedValuePence = num(acceptedAgg?.value_pence);
        // Per-practice accepted breakdown for the card's click-to-expand. null
        // practice_id (Emergent business_name didn't resolve to a practice) folds
        // into a single "Unmapped" row. Sorted high-to-low by count.
        const treatmentsAcceptedByPractice = (acceptedByPractice || [])
            .map((r) => ({
                practiceId: r.practice_id,
                name: r.practice_id ? (practiceNameById.get(r.practice_id) || 'Unknown practice') : 'Unmapped',
                count: num(r.count),
                valuePence: num(r.value_pence),
            }))
            .sort((a2, b2) => b2.count - a2.count);
        // "Closed" value = REAL invoiced treatment-plan fees in the window (same
        // feed as turnover), not the planned private estimate the rollup returns.
        // Group total = sum of the per-practice rows (invoice_items always carry a
        // practice_id, so nothing is dropped). Closed = billed; Paid = collected.
        const treatmentsClosedPence = sum('treatmentsClosedPence');
        const treatmentsPaidPence = sum('treatmentsPaidPence');
        // Cash banked = sum of settled receipts in the window (real payments).
        const cashCollectedPence = cashRows.reduce((s, r) => s + num(r.pence), 0);

        // Period-over-period deltas — turnover and cash vs the SAME-LENGTH window
        // immediately before the selected one (Jun vs May, this-year vs last-year,
        // trailing-30d vs the prior 30d). Compared like-for-like (in-window vs
        // in-window of equal length), so unlike cash-vs-turnover this is an honest
        // ratio. Same RPCs, shifted window.
        const winMs = untilISO
            ? (new Date(untilISO).getTime() - new Date(sinceISO).getTime())
            : days * 86400000;
        const prevUntilISO = sinceISO;
        const prevSinceISO = new Date(new Date(sinceISO).getTime() - winMs).toISOString();
        const [prevBillRowsAll, prevCashRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.treatmentRevenueMatrix(orgId, prevSinceISO, prevUntilISO),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, prevSinceISO, practiceId, prevUntilISO),
        ]);
        const prevBillRows = practiceId ? prevBillRowsAll.filter((r) => r.practice_id === practiceId) : prevBillRowsAll;
        const prevRevenuePence = prevBillRows.reduce((s, r) => s + num(r.fee_pence), 0);
        const prevCashPence = prevCashRows.reduce((s, r) => s + num(r.pence), 0);
        // null when there's no prior-period base (don't show ±∞ / a fake 0%).
        const pctDelta = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
        const turnoverDeltaPct = pctDelta(totalRevenue, prevRevenuePence);
        const cashDeltaPct = pctDelta(cashCollectedPence, prevCashPence);
        const prevPeriodLabel = prevWindowLabel(sinceISO, untilISO, days);

        // Revenue by clinical line — bucket the per-treatment invoiced fee feed
        // (invoice_items, real Dentally data) into ~8 clinical categories. Group-
        // wide (sums across practices); the card is "where group turnover comes
        // from". Lines with no revenue are dropped; sorted high-to-low. Cost/
        // profit are filled below once the P&L margin is known.
        const lineAgg = new Map();
        for (const r of revLineRows) {
            const line = categoriseTreatmentLine(r.treatment_name);
            const a = lineAgg.get(line) || { fee_pence: 0, item_count: 0 };
            a.fee_pence += num(r.fee_pence);
            a.item_count += num(r.item_count);
            lineAgg.set(line, a);
        }
        const revenueByLine = [...lineAgg.entries()]
            .map(([line, v]) => ({ line, fee_pence: v.fee_pence, item_count: v.item_count, cost_pence: 0, profit_pence: v.fee_pence }))
            .filter((l) => l.fee_pence > 0)
            .sort((a, b2) => b2.fee_pence - a.fee_pence);

        // Revenue target = baseline goal (owner-set). Margin REAL or 0.
        const b = health?.baseline || {};
        const revenueTargetPence = b.revenue ? b.revenue * 100 : 0;
        const marginPct = (actuals.hasAny && (actuals.annual.revenue || 0) > 0)
            ? formulas_1.calculatePL(plInputFromBuckets(actuals.annual)).marginPct
            : 0;

        // Profit contribution by line. Real cost comes from the P&L feed
        // (monthly_financials — Xero/QuickBooks, manual override); Dentally has no
        // cost side. The feed gives org-level cost, not per-treatment, so allocate
        // it pro-rata by each line's revenue at the group net margin — the honest
        // split org-level costs allow (per-line cost tags would refine it later).
        // No P&L feed (marginPct 0) => cost 0, profit == revenue (gross), exactly
        // what the card shows until Xero/QuickBooks is connected.
        const revenueLineCostBasis = marginPct > 0 ? 'pl_margin' : null; // null => costs not connected, profit is gross
        if (revenueLineCostBasis) {
            for (const l of revenueByLine) {
                l.profit_pence = Math.round((l.fee_pence * marginPct) / 100);
                l.cost_pence = l.fee_pence - l.profit_pence;
            }
        }
        return {
            period: { days, since: sinceISO, until: untilISO, label },
            group: {
                practices: practiceRows.length,
                revenuePence: totalRevenue,
                revenueTargetPence,
                marginPct,
                appointments: totalAppts,
                noShows: totalNoShows,
                noShowRate: rate(totalNoShows, totalAppts),
                noShowTracked, // false => no_show state never synced; show "—" not 0%
                leads: totalLeads,
                leadsBySource, // named per-source breakdown (Google / Meta / GHL)
                conversionRate: rate(newPatients, totalLeads), // new patients booked per lead
                newPatients, // booked Dentally new-patient appointments (real PMS)
                treatmentsStarted,
                treatmentsCompleted, // completed plan count in window (practitioner activity)
                treatmentsCompletedValuePence, // value of completed plans (private treatment value)
                treatmentsAcceptedCount, // accepted treatments (Emergent) — 0 until connected
                treatmentsAcceptedValuePence, // value of accepted treatments (Emergent)
                treatmentsAcceptedByPractice, // per-practice split for the card's click-to-breakdown ([] until connected)
                treatmentsClosedPence, // billed (sold) plan fees
                treatmentsPaidPence,   // collected (paid) plan fees
                takingsPence: cashCollectedPence, // Takings = settled payments received (matches Patient Payments "Received")
                cashCollectedPence, // settled receipts banked in window (== takings)
                // Like-for-like deltas vs the prior same-length period (null when
                // no prior base). prevPeriodLabel names it for the chip ("May 2026").
                turnoverDeltaPct,
                cashDeltaPct,
                prevPeriodLabel,
                prevRevenuePence,
                prevCashPence,
                leadToStartRate: rate(treatmentsStarted, totalLeads),
            },
            practices: practiceRows,
            revenueByLine, // clinical lines from Dentally invoice_items
            revenueLineCostBasis, // 'pl_margin' when costs allocated from a P&L feed; null => gross (Xero/QuickBooks not connected, cost 0)
            revenueLineMarginPct: marginPct, // group net margin used for the per-line cost allocation (0 when no P&L feed)
            truncated: false, // exact SQL rollups — never truncated
        };
    },
    // ------------------------------------------------------------------------
    // Group turnover source (owner toggle). Defaults to 'dentally' (today's
    // behaviour, no double-count) when no row exists. Read by boardReport.
    async getTurnoverSource(orgId) {
        const row = await orgSettingsRepository.get(orgId);
        return row?.turnover_source || 'dentally';
    },
    async saveTurnoverSource(orgId, turnoverSource, userId) {
        await orgSettingsRepository.upsert(orgId, { turnover_source: turnoverSource }, userId);
        return { turnoverSource };
    },
    // ------------------------------------------------------------------------
    // Board Report Generator (DentaCFO gap module, Phase 2). Assembles a board
    // pack from the SAME live rollups as Business Hub + Revenue Leakage (no
    // stored snapshot): group turnover/margin, conversion, banked cash, top vs
    // weakest practice, and the single biggest recoverable leak. Claude writes
    // the executive summary + RAG priorities; on any failure / no API key it
    // falls back to a deterministic, data-driven pack (HTTP 200 always). Money
    // is integer pence throughout.
    async boardReport(orgId, { since = null, until = null, label = null, practiceId = null, now = () => new Date() } = {}) {
        const [hub, leak, turnoverSource] = await Promise.all([
            this.businessHub(orgId, { since, until, label, practiceId, now }),
            this.revenueLeakage(orgId, { since, until, practiceId, now }),
            this.getTurnoverSource(orgId),
        ]);
        const g = hub.group;
        // Scope label for the AI narrative: the practice name when scoped, else Group.
        const scopeLabel = practiceId ? (hub.practices?.[0]?.name || 'Practice') : 'Group';
        const periodLabel = label || (until ? `${(since || '').slice(0, 10)} → ${until.slice(0, 10)}` : `last ${hub.period.days} days`);

        // Group turnover source (owner toggle). Dentally turnover = invoice_items
        // clinical production (hub.group.revenuePence). QuickBooks turnover = QBO
        // P&L revenue (monthly_financials), which is ORG-LEVEL only — QBO has no
        // practice attribution — so when the pack is scoped to one practice we fall
        // back to Dentally (the QBO portion can't be split per practice).
        const dentallyTurnoverPence = g.revenuePence;
        const wantsQbo = !practiceId && (turnoverSource === 'quickbooks' || turnoverSource === 'both');
        const qboTurnoverPence = wantsQbo
            ? await analytics_repository_1.analyticsRepository.quickbooksTurnover(orgId, since, until)
            : 0;
        const effectiveSource = practiceId && turnoverSource !== 'dentally' ? 'dentally' : turnoverSource;
        const turnoverPence = effectiveSource === 'quickbooks'
            ? qboTurnoverPence
            : effectiveSource === 'both'
                ? dentallyTurnoverPence + qboTurnoverPence
                : dentallyTurnoverPence;
        const TURNOVER_LABEL = { dentally: 'Dentally', quickbooks: 'QuickBooks', both: 'Dentally + QuickBooks' };
        const turnoverSourceLabel = (practiceId && turnoverSource !== 'dentally')
            ? 'Dentally (per-practice; QuickBooks is group-only)'
            : TURNOVER_LABEL[effectiveSource];

        // Annualise window turnover by the leakage window length (same window).
        const days = Math.max(1, leak.windowDays);
        const revAnnualPence = Math.round((turnoverPence * 365) / days);
        const ebitdaWindowPence = Math.round((turnoverPence * (g.marginPct || 0)) / 100);
        const practiceRows = hub.practices || [];
        const top = practiceRows[0] || null; // already sorted by revenue desc
        // Weakest = highest no-show rate among practices with appointments.
        const weak = practiceRows
            .filter((p) => p.appointments > 0)
            .slice()
            .sort((a, b) => b.noShowRate - a.noShowRate)[0] || null;
        const biggest = (leak.lines || [])[0] || null; // sorted by annualPence desc

        const metrics = {
            revenuePence: turnoverPence,
            revenueAnnualisedPence: revAnnualPence,
            revenueTargetPence: g.revenueTargetPence,
            marginPct: g.marginPct,
            ebitdaWindowPence,
            appointments: g.appointments,
            noShows: g.noShows,
            noShowRate: g.noShowRate,
            noShowTracked: g.noShowTracked,
            leads: g.leads,
            conversionRate: g.conversionRate,
            newPatients: g.newPatients,
            cashCollectedPence: g.cashCollectedPence,
            practiceCount: g.practices,
            leakageAnnualPence: leak.annualTotalPence,
            leakageMonthlyPence: leak.monthlyTotalPence,
            leakagePctOfRevenue: leak.asPctOfRevenue,
            topPractice: top ? { name: top.name, revenuePence: top.revenuePence } : null,
            weakPractice: weak ? { name: weak.name, noShowRate: weak.noShowRate } : null,
            biggestLeak: biggest ? { label: biggest.label, annualPence: biggest.annualPence, owner: biggest.owner } : null,
            // Owner-selected turnover source + the integration feeds behind each
            // headline card (surfaced as a per-card caption in the UI).
            turnoverSource: effectiveSource,
            sources: {
                turnover: turnoverSourceLabel,
                margin: 'Xero + QuickBooks + manual',
                leakage: 'Dentally + QuickBooks',
                conversion: 'Google Ads + Meta Ads + GHL · Dentally new patients',
            },
        };

        const empty = turnoverPence === 0 && g.appointments === 0 && g.leads === 0;
        let summary = [];
        let priorities = [];
        let basis = 'deterministic';
        if (!empty) {
            await checkBudget(orgId); // throws AppError 429 when over the monthly token budget
            try {
                const ai = await claude_1.generateBoardReport(orgId, {
                    scopeLabel,
                    periodLabel,
                    data: metrics,
                });
                await recordUsage(orgId, { feature: 'board_report', model: getProvider().model, usage: ai.usage });
                if (ai.summary.length) { summary = ai.summary; priorities = ai.priorities; basis = 'ai'; }
            } catch (err) {
                // fall through to deterministic
            }
        }
        if (!summary.length) ({ summary, priorities } = boardReportFallback(metrics, periodLabel));

        return {
            generatedAt: now().toISOString(),
            period: { since: leak.since, until: leak.until, label: periodLabel, days },
            metrics,
            summary,
            priorities,
            basis,
            empty,
        };
    },
    // Generate the pack + email it now to one address via SES. Returns the
    // report plus a delivery result. SES failure (no creds in dev) is NOT an
    // error — the caller surfaces {sent:false} and the UI offers a mailto draft.
    async emailBoardReport(orgId, { recipientEmail, since = null, until = null, label = null, practiceId = null, now = () => new Date() } = {}) {
        const report = await this.boardReport(orgId, { since, until, label, practiceId, now });
        const html = renderBoardReportHtml(report);
        const subject = `Board Report — ${report.period.label}`;
        let delivery;
        try {
            const messageId = await aws_ses_1.sendEmail({ to: recipientEmail, subject, html });
            delivery = { sent: true, messageId, to: recipientEmail };
        } catch (err) {
            delivery = { sent: false, error: err.message, to: recipientEmail };
        }
        return { report, delivery };
    },
    // Schedule CRUD (recurring delivery config). Mutations are audited upstream.
    listBoardSchedules(orgId) {
        return boardReportRepository.list(orgId);
    },
    createBoardSchedule(orgId, fields, userId) {
        return boardReportRepository.create(orgId, fields, userId);
    },
    updateBoardSchedule(orgId, id, fields) {
        return boardReportRepository.update(orgId, id, fields);
    },
    deleteBoardSchedule(orgId, id) {
        return boardReportRepository.remove(orgId, id);
    },
    // ------------------------------------------------------------------------
    // Data Quality Engine (DentaCFO gap Phase 5). Per-practice "cleanliness"
    // score + connector health + a prioritised alert list. Reads ONLY data
    // already in the warehouse (appointments / invoices / integrations) — no new
    // integration. The score is a weighted blend of present dimensions (coded
    // appts, linked patients, matched invoices, collection rate); see
    // scoreCleanliness. associate_id (clinician) is surfaced as a flag, not
    // scored — it is null on every synced Dentally appt (data wall), so scoring
    // it would crater every practice. RAG: green >=90, amber >=70, else red.
    async dataQuality(orgId, { now = () => new Date() } = {}) {
        const [practices, dqRows, connectors] = await Promise.all([
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
            analytics_repository_1.analyticsRepository.dataQualityByPractice(orgId),
            analytics_repository_1.analyticsRepository.connectorStates(orgId),
        ]);
        const num = (v) => Number(v || 0);
        const nameBy = new Map(practices.map((p) => [p.id, p.name]));
        const dqBy = new Map(dqRows.map((r) => [r.practice_id, r]));
        // Union of practice ids: known practices + any practice_id that appears
        // in the defect rows (a row may reference a non-'practice' kind).
        const ids = new Set([
            ...practices.map((p) => p.id),
            ...dqRows.map((r) => r.practice_id).filter(Boolean),
        ]);
        const practiceScores = [...ids].map((pid) => {
            const r = dqBy.get(pid) || {};
            const raw = {
                totalAppts: num(r.total_appts),
                uncodedAppts: num(r.uncoded_appts),
                unlinkedAppts: num(r.unlinked_appts),
                unassignedAppts: num(r.unassigned_appts),
                totalInvoices: num(r.total_invoices),
                unmatchedInvoices: num(r.unmatched_invoices),
                invoicedPence: num(r.invoiced_pence),
                outstandingPence: num(r.outstanding_pence),
            };
            return { practiceId: pid, name: nameBy.get(pid) || 'Unknown practice', ...scoreCleanliness(raw), raw };
        }).sort((a, b) => a.score - b.score); // worst first

        // Org rollup — record-volume-weighted over practices that have any data.
        const scored = practiceScores.filter((p) => p.dims.length > 0);
        const totalRecords = scored.reduce((s, p) => s + p.records, 0);
        const orgScore = totalRecords > 0
            ? Math.round(scored.reduce((s, p) => s + p.score * p.records, 0) / totalRecords)
            : 100;
        const totals = practiceScores.reduce((acc, p) => {
            for (const k of Object.keys(acc)) acc[k] += p.raw[k];
            return acc;
        }, { totalAppts: 0, uncodedAppts: 0, unlinkedAppts: 0, unassignedAppts: 0, totalInvoices: 0, unmatchedInvoices: 0, invoicedPence: 0, outstandingPence: 0 });

        const connectorHealth = scoreConnectors(connectors, now());
        const alerts = buildDataQualityAlerts(practiceScores, totals, connectorHealth);
        return {
            orgScore,
            rag: ragBand(orgScore),
            practices: practiceScores,
            totals,
            connectors: connectorHealth,
            alerts,
            generatedAt: now().toISOString(),
        };
    },
    // Attrition & Retention (DentaCFO Phase 6). Per-practice patient cohorts by
    // last-visit recency (active <12mo / lapsed 12-24mo / dormant >24mo), the
    // group retention + attrition rate, and the RECOVERABLE reactivation revenue
    // pool (lapsed patients x avg patient value x recall recovery rate).
    //
    // DATA LINEAGE / WALLS:
    //   cohorts        = REAL — distinct patients off Dentally appointments, keyed
    //                    by COALESCE(contact_id, pms_patient_id), bucketed by their
    //                    most recent non-cancelled past visit (RPC, p_now-relative).
    //   avgPatientValue= REAL — trailing-12mo settled receipts / active patients,
    //                    per practice (org-blended fallback when a practice has
    //                    revenue but no active patients linked).
    //   unlinkedAppts  = the linkage data wall (contact_id AND pms_patient_id null)
    //                    — those patients are unrecoverable, so they're FLAGGED,
    //                    never counted in a cohort (would understate retention).
    // Not applicable to academy/lab scope (no patient recall book).
    async retention(orgId, { scope = 'all', reactivationRate, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        if (resolved.mode === 'academy' || resolved.mode === 'lab') {
            return { applicable: false, scope: resolved.mode,
                message: 'Patient retention applies to the dental practices — switch scope to the group or a practice.' };
        }
        const nowDate = now();
        // Trailing 12 months for the average-patient-value denominator.
        const since = new Date(nowDate);
        since.setUTCFullYear(since.getUTCFullYear() - 1);
        const sinceIso = since.toISOString();

        const [practices, retRows, revRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
            analytics_repository_1.analyticsRepository.patientRetentionByPractice(orgId, nowDate.toISOString()),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceIso, null),
        ]);
        const num = (v) => Number(v || 0);
        const nameBy = new Map(practices.map((p) => [p.id, p.name]));
        const revByPractice = new Map(revRows.map((r) => [r.practice_id, num(r.pence)]));
        const retBy = new Map(retRows.map((r) => [r.practice_id, r]));

        // Scope filter: a specific practice narrows to that id; otherwise every
        // practice plus any practice_id seen in the cohort rows.
        let ids = new Set([
            ...practices.map((p) => p.id),
            ...retRows.map((r) => r.practice_id).filter(Boolean),
        ]);
        if (resolved.mode === 'entity') ids = new Set([...ids].filter((id) => resolved.practiceIds.includes(id)));

        // Org-blended avg patient value — used as the per-practice fallback when a
        // practice banked revenue but has no active patients linked (data wall).
        const orgActiveAll = retRows.reduce((s, r) => s + num(r.active_patients), 0);
        const orgRev12mAll = revRows.reduce((s, r) => s + num(r.pence), 0);
        const orgAvgValuePence = orgActiveAll > 0 ? Math.round(orgRev12mAll / orgActiveAll) : 0;

        const rate = reactivationRate == null ? formulas_1.RETENTION_DEFAULTS.reactivationRate : Math.min(1, Math.max(0, reactivationRate));

        const rows = [...ids].map((pid) => {
            const r = retBy.get(pid) || {};
            const active = num(r.active_patients), lapsed = num(r.lapsed_patients), dormant = num(r.dormant_patients);
            const rev12m = revByPractice.get(pid) || 0;
            const avgPatientValuePence = active > 0 ? Math.round(rev12m / active) : orgAvgValuePence;
            const calc = (0, formulas_1.calculateRetention)({ active, lapsed, dormant }, { avgPatientValuePence, reactivationRate: rate });
            return {
                practiceId: pid,
                name: nameBy.get(pid) || 'Unknown practice',
                unlinkedAppts: num(r.unlinked_appts),
                revenue12mPence: rev12m,
                rag: retentionRagBand(calc.retentionRatePct),
                ...calc,
            };
        }).sort((a, b) => b.reactivationValuePence - a.reactivationValuePence || b.lapsedPatients - a.lapsedPatients);

        // Group rollup — sum cohorts, blend the avg value over org active patients.
        const totals = rows.reduce((acc, p) => {
            acc.active += p.activePatients; acc.lapsed += p.lapsedPatients; acc.dormant += p.dormantPatients;
            acc.unlinkedAppts += p.unlinkedAppts; acc.revenue12mPence += p.revenue12mPence;
            return acc;
        }, { active: 0, lapsed: 0, dormant: 0, unlinkedAppts: 0, revenue12mPence: 0 });
        const orgAvgValueScopedPence = totals.active > 0 ? Math.round(totals.revenue12mPence / totals.active) : 0;
        const org = {
            ...(0, formulas_1.calculateRetention)(
                { active: totals.active, lapsed: totals.lapsed, dormant: totals.dormant },
                { avgPatientValuePence: orgAvgValueScopedPence, reactivationRate: rate }),
            rag: retentionRagBand(totals.active + totals.lapsed + totals.dormant > 0
                ? Math.round((totals.active / (totals.active + totals.lapsed + totals.dormant)) * 1000) / 10 : 0),
            unlinkedAppts: totals.unlinkedAppts,
            revenue12mPence: totals.revenue12mPence,
        };
        const hasData = org.knownPatients > 0;
        const insights = buildRetentionInsights({ org, rows, hasData });

        return {
            applicable: true,
            scope,
            hasData,
            reactivationRate: rate,
            org,
            practices: rows,
            insights,
            generatedAt: nowDate.toISOString(),
            note: 'Cohorts are distinct Dentally patients by last non-cancelled visit. Avg patient value = trailing-12mo settled receipts / active patients. Reactivation pool targets lapsed (12-24mo) patients only — dormant (>24mo) are treated as largely gone. Appointments with no patient identity are flagged, not counted.',
        };
    },
};

// Deterministic board pack from real metrics — the no-AI fallback. Mirrors the
// demo's board[] + rag[] shape (exec bullets + 3 RAG-coded priorities), built
// only from figures already in `metrics`. British English, money in £.
function boardReportFallback(m, periodLabel) {
    const summary = [];
    if (m.revenuePence > 0) {
        summary.push(`Group turnover ${formulas_1.formatPounds(m.revenuePence)} for ${periodLabel} (~${formulas_1.formatPounds(m.revenueAnnualisedPence)}/yr)${m.marginPct > 0 ? `; EBITDA proxy ${formulas_1.formatPounds(m.ebitdaWindowPence)} at ${m.marginPct}% net margin` : '; connect Xero/QuickBooks for a live margin'}.`);
    }
    if (m.topPractice && m.practiceCount > 1) {
        summary.push(`Revenue concentration: ${m.topPractice.name} is the largest site at ${formulas_1.formatPounds(m.topPractice.revenuePence)} — replicating it is the de-risking priority.`);
    }
    if (m.leakageAnnualPence > 0) {
        summary.push(`Recoverable leakage of ${formulas_1.formatPounds(m.leakageAnnualPence)}/yr identified${m.leakagePctOfRevenue ? ` (${m.leakagePctOfRevenue}% of turnover)` : ''} — the single biggest near-term lever, no capex required.`);
    }
    if (m.noShowTracked && m.appointments > 0) {
        summary.push(`Appointment no-show rate ${m.noShowRate}% across ${m.appointments.toLocaleString('en-GB')} appointments — chair time recoverable without new sites.`);
    }
    if (m.leads > 0) {
        summary.push(`Lead-to-treatment conversion ${m.conversionRate}% on ${m.leads.toLocaleString('en-GB')} leads; ${formulas_1.formatPounds(m.cashCollectedPence)} banked in the window.`);
    }
    const priorities = [];
    if (m.biggestLeak) {
        priorities.push({ rag: 'red', text: `Recover ${formulas_1.formatPounds(m.biggestLeak.annualPence)}/yr from ${m.biggestLeak.label} — owner: ${m.biggestLeak.owner}. Highest-value, lowest-cost fix.` });
    }
    if (m.weakPractice && m.weakPractice.noShowRate > 0) {
        priorities.push({ rag: 'amber', text: `Cut ${m.weakPractice.name} no-show rate from ${m.weakPractice.noShowRate}% toward the 5% benchmark — owner: Site managers.` });
    }
    if (m.topPractice) {
        priorities.push({ rag: 'green', text: `Protect ${m.topPractice.name}'s production — the group's largest revenue base. Replicate its playbook across sites.` });
    }
    return { summary, priorities };
}

// ----------------------------------------------------------------------------
// Data Quality Engine helpers (Phase 5) — pure, module-scope so the service can
// be unit-tested with stubbed repositories.
const CLEANLINESS_WEIGHTS = { coded: 0.30, linked: 0.30, invoiceMatch: 0.20, collection: 0.20 };
// Per-provider sync staleness budget (hours). Dentally/GHL run nightly (~24h
// cadence + slack); Xero/QuickBooks pulled less often.
const CONNECTOR_STALE_HOURS = { dentally: 36, ghl: 36, gohighlevel: 36, xero: 48, quickbooks: 48 };
const CONNECTOR_STALE_DEFAULT_HOURS = 48;
const HEALTH_ORDER = { error: 0, expired: 1, disconnected: 2, never: 3, stale: 4, ok: 5 };
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function ragBand(score) {
    if (score >= 90) return 'green';
    if (score >= 70) return 'amber';
    return 'red';
}
// Clean rate as a 0-100 pct (one decimal). Empty denominator -> 100 (nothing to
// be wrong about), so a dimension with no records never drags a score down.
function pctClean(clean, total) {
    return total > 0 ? Math.round((clean / total) * 1000) / 10 : 100;
}
// Per-practice cleanliness 0-100. Only dimensions with a denominator are
// included; weights re-normalise over the present dimensions so e.g. a practice
// with no invoices isn't penalised for the invoice dimensions.
function scoreCleanliness(raw) {
    const dims = [];
    if (raw.totalAppts > 0) {
        dims.push({ key: 'coded', label: 'Appointments coded', weight: CLEANLINESS_WEIGHTS.coded,
            ratePct: pctClean(raw.totalAppts - raw.uncodedAppts, raw.totalAppts), defects: raw.uncodedAppts, of: raw.totalAppts });
        dims.push({ key: 'linked', label: 'Patient identity linked', weight: CLEANLINESS_WEIGHTS.linked,
            ratePct: pctClean(raw.totalAppts - raw.unlinkedAppts, raw.totalAppts), defects: raw.unlinkedAppts, of: raw.totalAppts });
    }
    if (raw.totalInvoices > 0) {
        dims.push({ key: 'invoiceMatch', label: 'Invoices patient-matched', weight: CLEANLINESS_WEIGHTS.invoiceMatch,
            ratePct: pctClean(raw.totalInvoices - raw.unmatchedInvoices, raw.totalInvoices), defects: raw.unmatchedInvoices, of: raw.totalInvoices });
    }
    if (raw.invoicedPence > 0) {
        dims.push({ key: 'collection', label: 'Collection rate', weight: CLEANLINESS_WEIGHTS.collection,
            ratePct: pctClean(raw.invoicedPence - raw.outstandingPence, raw.invoicedPence), defects: raw.outstandingPence, of: raw.invoicedPence });
    }
    const records = raw.totalAppts + raw.totalInvoices;
    if (dims.length === 0) {
        return { score: 100, rag: 'green', dims: [], records, unassignedAppts: raw.unassignedAppts };
    }
    const wTotal = dims.reduce((s, d) => s + d.weight, 0);
    const score = Math.round(dims.reduce((s, d) => s + d.ratePct * d.weight, 0) / wTotal);
    return { score, rag: ragBand(score), dims, records, unassignedAppts: raw.unassignedAppts };
}
// Classify each connector by status + sync staleness.
function scoreConnectors(rows, now) {
    const nowMs = now.getTime();
    return rows.map((c) => {
        const provider = String(c.provider || '').toLowerCase();
        const limitH = CONNECTOR_STALE_HOURS[provider] ?? CONNECTOR_STALE_DEFAULT_HOURS;
        const lastMs = c.last_synced_at ? Date.parse(c.last_synced_at) : null;
        const ageHours = lastMs ? Math.round((nowMs - lastMs) / 3_600_000) : null;
        let health = 'ok';
        if (c.status === 'error') health = 'error';
        else if (c.status === 'expired') health = 'expired';
        else if (c.status === 'disconnected') health = 'disconnected';
        else if (ageHours == null) health = 'never';
        else if (ageHours > limitH) health = 'stale';
        return {
            provider: c.provider,
            label: connectorLabel(c.provider),
            status: c.status,
            lastSyncedAt: c.last_synced_at || null,
            ageHours,
            staleAfterHours: limitH,
            lastError: c.last_error || null,
            health,
        };
    }).sort((a, b) => (HEALTH_ORDER[a.health] ?? 9) - (HEALTH_ORDER[b.health] ?? 9));
}
function connectorLabel(provider) {
    const M = { dentally: 'Dentally', ghl: 'GoHighLevel', gohighlevel: 'GoHighLevel', xero: 'Xero', quickbooks: 'QuickBooks', stripe: 'Stripe', truelayer: 'TrueLayer', gocardless: 'GoCardless' };
    return M[String(provider || '').toLowerCase()] || provider;
}
// Build a single prioritised alert list from connectors + practice scores. A
// dead connector starves every downstream metric, so connector issues rank
// first; then red practices; then the worst individual defect pools.
function buildDataQualityAlerts(practices, totals, connectors) {
    const alerts = [];
    for (const c of connectors) {
        if (c.health === 'error' || c.health === 'expired' || c.health === 'disconnected') {
            alerts.push({ severity: 'high', area: 'connector', key: `connector:${c.provider}`,
                text: `${c.label} connector is ${c.health}${c.lastError ? ` — ${c.lastError}` : ''}. Reconnect to keep data flowing.` });
        } else if (c.health === 'stale') {
            alerts.push({ severity: 'medium', area: 'connector', key: `connector:${c.provider}`,
                text: `${c.label} last synced ${c.ageHours}h ago (expected within ${c.staleAfterHours}h). Sync may be stuck.` });
        }
    }
    for (const p of practices) {
        if (p.dims.length === 0) continue;
        if (p.rag === 'red') {
            alerts.push({ severity: 'high', area: 'practice', key: `practice:${p.practiceId}`,
                text: `${p.name} data cleanliness ${p.score}/100 — below the 70 threshold.` });
        }
        const linked = p.dims.find((d) => d.key === 'linked');
        if (linked && linked.defects > 0 && linked.ratePct < 90) {
            alerts.push({ severity: 'medium', area: 'practice', key: `linked:${p.practiceId}`,
                text: `${p.name}: ${linked.defects.toLocaleString('en-GB')} appointments (${pctDefect(linked)}%) have no patient link — names unrecoverable without re-sync.` });
        }
        const coded = p.dims.find((d) => d.key === 'coded');
        if (coded && coded.defects > 0 && coded.ratePct < 90) {
            alerts.push({ severity: 'medium', area: 'practice', key: `coded:${p.practiceId}`,
                text: `${p.name}: ${coded.defects.toLocaleString('en-GB')} appointments (${pctDefect(coded)}%) have no treatment code.` });
        }
    }
    if (totals.totalAppts > 0 && totals.unassignedAppts === totals.totalAppts) {
        alerts.push({ severity: 'low', area: 'org', key: 'org:unassigned',
            text: `No clinician is mapped on any of ${totals.totalAppts.toLocaleString('en-GB')} appointments — Dentally practitioner mapping not yet wired, so per-associate analytics are unavailable.` });
    } else if (totals.unassignedAppts > 0) {
        alerts.push({ severity: 'low', area: 'org', key: 'org:unassigned',
            text: `${totals.unassignedAppts.toLocaleString('en-GB')} appointments have no clinician assigned.` });
    }
    return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
function pctDefect(dim) {
    return Math.round((100 - dim.ratePct) * 10) / 10;
}

// ----------------------------------------------------------------------------
// Attrition & Retention helpers (Phase 6) — pure, module-scope.
// Retention RAG: a healthy recall book keeps most of the ever-seen base active.
function retentionRagBand(retentionRatePct) {
    if (retentionRatePct >= 80) return 'green';
    if (retentionRatePct >= 60) return 'amber';
    return 'red';
}
// Decision-Lens cards for Attrition & Retention — derived purely from the real
// cohort + value rollup. Each { tone, title, body, value }. Honest about the
// linkage data wall. Returns [] when there is no patient data.
function buildRetentionInsights({ org, rows, hasData }) {
    const cards = [];
    const gbp = (p) => '£' + Math.round((p || 0) / 100).toLocaleString('en-GB');
    if (!hasData) {
        cards.push({
            tone: 'info',
            title: 'No patient visit history yet',
            body: 'Retention cohorts come from Dentally appointments keyed by patient. Connect / sync Dentally to populate active, lapsed and dormant patient counts.',
            value: 'Sync needed',
        });
        return cards;
    }
    // 1. Headline reactivation opportunity (the whole lapsed pool).
    if (org.reactivationValuePence > 0) {
        cards.push({
            tone: 'good',
            title: `${gbp(org.reactivationValuePence)}/yr recoverable from lapsed patients`,
            body: `${org.lapsedPatients.toLocaleString('en-GB')} patients last visited 12-24 months ago. At a ${Math.round(org.reactivationRate * 100)}% recall win-back and ${gbp(org.avgPatientValuePence)} average patient value, that is ${gbp(org.reactivationValuePence)} of low-cost revenue — a recall campaign, not new acquisition.`,
            value: gbp(org.reactivationValuePence),
        });
    }
    // 2. Retention / attrition rate framing.
    cards.push({
        tone: org.retentionRatePct >= 80 ? 'good' : org.retentionRatePct >= 60 ? 'warn' : 'bad',
        title: `Patient retention ${org.retentionRatePct}%`,
        body: `${org.activePatients.toLocaleString('en-GB')} of ${org.knownPatients.toLocaleString('en-GB')} known patients are active (visited in the last 12 months). Attrition is ${org.attritionRatePct}% — ${org.lapsedPatients.toLocaleString('en-GB')} lapsed + ${org.dormantPatients.toLocaleString('en-GB')} dormant.`,
        value: `${org.retentionRatePct}%`,
    });
    // 3. Practice with the biggest recoverable pool.
    const top = rows.find((r) => r.reactivationValuePence > 0);
    if (top && rows.length > 1) {
        cards.push({
            tone: 'info',
            title: `${top.name} has the largest reactivation pool`,
            body: `${top.lapsedPatients.toLocaleString('en-GB')} lapsed patients worth ${gbp(top.reactivationValuePence)}/yr if recalled. Prioritise its recall list first.`,
            value: gbp(top.reactivationValuePence),
        });
    }
    // 4. Data wall — unrecoverable patients.
    if (org.unlinkedAppts > 0) {
        cards.push({
            tone: 'warn',
            title: 'Some appointments have no patient identity',
            body: `${org.unlinkedAppts.toLocaleString('en-GB')} appointments carry neither a CRM contact nor a Dentally patient id, so those patients can't be placed in a cohort or recalled. A Dentally re-sync recovers the link.`,
            value: 'Re-sync',
        });
    }
    return cards;
}

// Render a board pack to a standalone HTML email (British English, no emojis,
// light theme per project rule 1). Used for SES sends + scheduled delivery.
function renderBoardReportHtml(report) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const RAG = { red: '#c0392b', amber: '#c6a253', green: '#2e9e6a' };
    const bullets = report.summary.map((s) => `<li style="margin:0 0 8px;line-height:1.55">${esc(s)}</li>`).join('');
    const prios = report.priorities.map((p) =>
        `<tr><td style="vertical-align:top;padding:6px 10px 6px 0"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${RAG[p.rag] || RAG.amber}"></span></td><td style="padding:6px 0;font-size:13px;line-height:1.5">${esc(p.text)}</td></tr>`).join('');
    return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d21">
<div style="max-width:640px;margin:0 auto;padding:24px">
  <div style="background:#fff;border:1px solid #e6e8eb;border-radius:14px;padding:24px 26px">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a9099;font-weight:700">Board Report</div>
    <h1 style="margin:4px 0 2px;font-size:20px">${esc(report.period.label)}</h1>
    <div style="font-size:12px;color:#8a9099">Generated ${esc(report.generatedAt.slice(0, 10))} · ${report.basis === 'ai' ? 'AI-written from live data' : 'Generated from live data'}</div>
    <div style="font-weight:700;font-size:12px;color:#8a9099;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px">Executive summary</div>
    <ul style="margin:0;padding-left:18px;font-size:13px;color:#1a1d21">${bullets}</ul>
    <div style="font-weight:700;font-size:12px;color:#8a9099;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 6px">Priorities</div>
    <table style="width:100%;border-collapse:collapse">${prios}</table>
    <div style="border-top:1px solid #e6e8eb;margin-top:20px;padding-top:12px;font-size:11px;color:#8a9099">Generated by Elevate Dental OS — figures computed live from your Dentally / Xero / GoHighLevel data.</div>
  </div>
</div></body></html>`;
}

// Bucket a raw Dentally treatment name into a clinical revenue line. Ordered:
// implants win over crown/bridge (e.g. "Implant Crown", "Implant - Bridge"),
// surgery wins over restorative for bone grafts/extractions. Keyword match on a
// lowercased name; anything unmatched -> 'Other'. Pure; no DB.
const REVENUE_LINE_RULES = [
    ['Implants', /implant|all[\s-]?on[\s-]?\d|fixed teeth/],
    ['Orthodontics', /invisalign|ortho|aligner|brace/],
    ['Whitening', /whiten|bleach/],
    ['Oral Surgery', /extraction|surgical|surgery|bone graft|grafting|sinus|wisdom|implant placement|placement of implant/],
    ['Hygiene & Prevention', /scale|polish|hygiene|exam|x-?ray|radiograph|check[\s-]?up|fluoride|periodontal|perio /],
    ['Restorative', /crown|bridge|filling|composite|veneer|inlay|onlay|root canal|endo|restorat|post /],
    ['Prosthetics', /denture|prosth|chrome/],
];
function categoriseTreatmentLine(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return 'Other';
    for (const [line, rx] of REVENUE_LINE_RULES) {
        if (rx.test(n)) return line;
    }
    return 'Other';
}

// Human label for the comparison (previous) window of a period-over-period delta.
// Recognises calendar month / year / single day; falls back to "prev Nd" for a
// trailing-days window or "prev period" otherwise. All UTC (windows are ISO/UTC).
function prevWindowLabel(sinceISO, untilISO, days) {
    const d = new Date(sinceISO);
    if (untilISO) {
        const spanDays = Math.round((new Date(untilISO).getTime() - d.getTime()) / 86400000);
        if (spanDays <= 1) { // single day
            const p = new Date(d.getTime() - 86400000);
            return p.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        }
        if (d.getUTCDate() === 1 && spanDays >= 27 && spanDays <= 31) { // calendar month
            const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
            return p.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        }
        if (d.getUTCMonth() === 0 && d.getUTCDate() === 1 && spanDays >= 360) // calendar year
            return String(d.getUTCFullYear() - 1);
        return 'prev period';
    }
    return `prev ${days}d`;
}

// ----------------------------------------------------------------------------
// Treatment Mix helpers (module-level; pure, no DB).
// ----------------------------------------------------------------------------

// AI Analyst helpers (module-level; pure, no DB).
const gbpPence = (p) => '£' + Math.round((p || 0) / 100).toLocaleString('en-GB');
// Drop duplicate findings (same title), keeping the first (higher-priority) one.
function dedupeFindings(list) {
    const seen = new Set();
    const out = [];
    for (const f of list) {
        const key = (f.t || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
    }
    return out;
}

// Marketing & ROI helpers (module-level; pure, no DB).
// A CRM lead counts as a converted patient once it reaches treatment.
const CONVERTED_STATUSES = new Set(['treatment_started', 'treatment_completed']);
// Paid-provider matchers (mirror growth.routes attributeProvider).
const AD_PROVIDER_MATCH = { google_ads: /google|adwords|gads/i, meta_ads: /facebook|meta|instagram|\bfb\b|\big\b/i };
// Channel catalog: 2 paid (ad_metrics providers) + organic CRM lead buckets.
const MKT_CHANNELS = [
    { key: 'google_ads', label: 'Google Ads', color: '#2f6fb0', paid: true, group: 'paid' },
    { key: 'meta_ads', label: 'Facebook / Meta', color: '#3b5998', paid: true, group: 'paid' },
    { key: 'seo', label: 'SEO / Website', color: '#1d6e5f', paid: false, group: 'organic' },
    { key: 'referral', label: 'Referrals', color: '#5aa674', paid: false, group: 'organic' },
    { key: 'recall', label: 'Internal Recall', color: '#c6a253', paid: false, group: 'organic' },
    { key: 'other', label: 'Other / Direct', color: '#84958c', paid: false, group: 'organic' },
];
// Attribute a CRM lead to a channel from its utm/source free-text.
function attributeChannel(lead) {
    const hay = `${lead.utm_source ?? ''} ${lead.utm_medium ?? ''} ${lead.source ?? ''}`.toLowerCase();
    for (const [provider, re] of Object.entries(AD_PROVIDER_MATCH)) if (re.test(hay)) return provider;
    if (/seo|organic|website|search|\bweb\b/.test(hay)) return 'seo';
    if (/refer/.test(hay)) return 'referral';
    if (/recall|reactiv|internal/.test(hay)) return 'recall';
    return 'other';
}
// Decision-Lens cards for Marketing & ROI — derived purely from the real
// channel data. Each { tone, title, body, value }; never invents per-channel
// revenue. Returns [] when there is nothing real to say.
function buildMarketingInsights({ channels, blendedRoas, paidSpendPence, settledRevenuePence, connected, adSpendPerPracticeAvailable }) {
    const cards = [];
    const gbp = (p) => '£' + Math.round((p || 0) / 100).toLocaleString('en-GB');
    if (!channels.length) return cards;

    // 1. Blended paid ROAS (business-level, clearly labelled).
    if (connected && paidSpendPence > 0 && blendedRoas != null) {
        cards.push({
            tone: blendedRoas >= 3.5 ? 'good' : blendedRoas < 2.5 ? 'warn' : 'info',
            title: `Blended paid ROAS ${blendedRoas.toFixed(2)}× (business-level)`,
            body: `${gbp(settledRevenuePence)} settled revenue against ${gbp(paidSpendPence)} of ad spend. This is group-level — revenue can't be attributed per channel without per-touch tracking.`,
            value: `${blendedRoas.toFixed(2)}×`,
        });
    } else if (!connected) {
        cards.push({
            tone: 'info',
            title: 'No ad spend connected',
            body: 'Connect Google Ads / Meta Ads (Integrations) to see spend, CPL and blended ROAS. Lead volumes below are from the CRM and are already live.',
            value: 'Not connected',
        });
    }

    // 2. Best converting channel by patient conversion rate (floor 3 leads).
    const conv = channels.filter((c) => c.leads >= 3).sort((a, b) => b.convRatePct - a.convRatePct)[0];
    if (conv) {
        cards.push({
            tone: 'good',
            title: `${conv.label} converts best at ${conv.convRatePct}%`,
            body: `${conv.conversions} of ${conv.leads} leads reached treatment. Protect and scale the channels that turn enquiries into patients, not just the cheapest leads.`,
            value: `${conv.convRatePct}%`,
        });
    }

    // 3. Cheapest paid cost-per-patient (where spend is tracked).
    const paid = channels.filter((c) => c.paid && c.cpaPence > 0).sort((a, b) => a.cpaPence - b.cpaPence);
    if (paid.length >= 2) {
        const best = paid[0], worst = paid[paid.length - 1];
        cards.push({
            tone: 'info',
            title: `${best.label} is the cheapest patient acquisition`,
            body: `${gbp(best.cpaPence)}/patient vs ${gbp(worst.cpaPence)} on ${worst.label}. Shift incremental budget toward the lower CPA while volume holds.`,
            value: `${gbp(best.cpaPence)}/pt`,
        });
    }

    // 4. Honest gap: spend not tagged per practice.
    if (connected && !adSpendPerPracticeAvailable) {
        cards.push({
            tone: 'warn',
            title: 'Ad spend is group-level, not per practice',
            body: 'Your ad accounts run at group level (no practice tag), so per-practice ROAS below leads with real leads → patients → revenue; paid spend/ROAS per site needs practice-tagged campaigns.',
            value: 'Group only',
        });
    }
    return cards;
}

// Decision-Lens cards for the Clinicians view — from real roster + production +
// appointment data only. Honest about the data walls. { tone,title,body,value }.
function buildCliniciansInsights({ clinicians, productionAvailable, appointmentsAvailable, totalProductionPence, totalFeesPence }) {
    const cards = [];
    const gbp = (p) => '£' + Math.round((p || 0) / 100).toLocaleString('en-GB');
    if (!clinicians.length) return cards;

    if (!productionAvailable) {
        cards.push({
            tone: 'warn',
            title: 'Production £ not yet available',
            body: 'Per-clinician production comes from completed Dentally treatment plans, which are not synced for this org yet. Roster, pay splits and appointment activity below are live; connect/resync Dentally treatment plans to populate production and fees.',
            value: 'Sync needed',
        });
    } else {
        // Top producer + fee ratio.
        const top = clinicians[0];
        if (top && top.productionPence > 0) {
            cards.push({
                tone: 'good',
                title: `${top.name} leads production at ${gbp(top.productionPence)}`,
                body: `${gbp(top.feesPence)} in associate fees (${top.payPct}% split), leaving ${gbp(top.netToPracticePence)} to the practice before lab and chair cost.`,
                value: gbp(top.productionPence),
            });
        }
        const feeRatio = totalProductionPence ? Math.round((totalFeesPence / totalProductionPence) * 1000) / 10 : 0;
        cards.push({
            tone: feeRatio > 45 ? 'warn' : 'info',
            title: `Clinician fee ratio is ${feeRatio}% of production`,
            body: `${gbp(totalFeesPence)} of associate pay against ${gbp(totalProductionPence)} of production across ${clinicians.length} clinicians. Watch the blend as higher-split principals take more chair time.`,
            value: `${feeRatio}%`,
        });
    }

    if (!appointmentsAvailable) {
        cards.push({
            tone: 'info',
            title: 'Appointment activity needs practitioner tagging',
            body: 'Legacy Dentally appointments were synced before practitioner mapping, so per-clinician appointment counts are blank until a relink/backfill runs. New appointments tag automatically.',
            value: 'Relink',
        });
    }
    return cards;
}

// Resolve a monthly_financials bucket set into the honest P&L line shape (pence).
// lab+materials are direct costs (above gross); staff (incl. associate pay) +
// overhead+other are operating costs. `tax` is below the operating line and
// excluded — matches plInputFromBuckets / the baseline P&L. Pure, no DB.
function plLineFromBuckets(b = {}) {
    const revPence = b.revenue || 0;
    const labMaterialsPence = (b.lab || 0) + (b.materials || 0);
    // Staff & clinician pay = the staff bucket PLUS the associates bucket. Xero
    // books associate/clinician pay inside staff (associates=0), but QuickBooks
    // classifies it into its own `associates` bucket — dropping it here would
    // omit clinician pay entirely and overstate net profit. dentistStaffSeparable
    // is false, so the two belong on the same line (matches plInputFromBuckets /
    // financeSeriesRowFromBuckets which both include associates).
    const staffPence = (b.staff || 0) + (b.associates || 0);
    const otherOpexPence = (b.overhead || 0) + (b.other || 0);
    const netPence = revPence - labMaterialsPence - staffPence - otherOpexPence;
    return {
        revPence,
        labMaterialsPence,
        grossPence: revPence - labMaterialsPence,
        staffPence,
        otherOpexPence,
        netPence,
        marginPct: revPence ? Math.round((netPence / revPence) * 1000) / 10 : 0,
    };
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Resolve the [since, until) window + a human label from the scope/period
// control. month: the whole calendar month of pk ('YYYY-MM'); day: the single
// day of pk ('YYYY-MM-DD'). A missing/unparseable pk falls back to the current
// month from `now` (UTC, stable across server/client).
function treatmentWindow(period, periodKey, now) {
    // "Current" day/month is the LONDON calendar date (client timezone), so a
    // late-evening request near UTC midnight doesn't resolve to the wrong day.
    const lp = londonParts(now);
    const y0 = lp.year;
    const m0 = lp.month - 1; // 0-indexed to match the rest of this function
    if (period === 'day') {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey || '');
        const y = m ? Number(m[1]) : y0;
        const mo = m ? Number(m[2]) - 1 : m0;
        const d = m ? Number(m[3]) : lp.day;
        const since = new Date(Date.UTC(y, mo, d));
        const until = new Date(Date.UTC(y, mo, d + 1));
        return {
            since: since.toISOString(),
            until: until.toISOString(),
            label: `${d} ${MONTHS_SHORT[mo]} ${y}`,
        };
    }
    const m = /^(\d{4})-(\d{2})$/.exec(periodKey || '');
    const y = m ? Number(m[1]) : y0;
    const mo = m ? Number(m[2]) - 1 : m0;
    const since = new Date(Date.UTC(y, mo, 1));
    const until = new Date(Date.UTC(y, mo + 1, 1));
    return {
        since: since.toISOString(),
        until: until.toISOString(),
        label: `${MONTHS_LONG[mo]} ${y}`,
    };
}

// Resolve the active [since, until) window. The pill bar (Recent/This month/
// This year/Pick month/Custom) sends an explicit ISO [since, until] + label,
// which wins. Falls back to the legacy period/pk month|day window when absent
// (back-compat for any caller not yet on the window params).
function resolveWindow({ since, until, label, period, periodKey, now }) {
    if (since && until) {
        return {
            since: new Date(since).toISOString(),
            until: new Date(until).toISOString(),
            label: label || null,
        };
    }
    return treatmentWindow(period, periodKey, now);
}

// Resolve the manual baseline/targets the AI should ground on for a window.
// Manual inputs are HISTORISED (business_health_snapshots.inputs, migration 000054)
// but the live `business_health` row OVERWRITES in place. For a CLOSED (past)
// window the AI must use the values in effect THEN, else every historical answer
// is anchored to today's goals. `resolvedWin.until` is the EXCLUSIVE next-period
// start, so `until − 1ms` is the period's last calendar day; a window ending
// on/after today is the live current period (use the live blob directly). Missing
// snapshot fields fall back to the live blob — honest, never fabricated. Mirrors
// business-health.service.progress()'s as-of read. `nowDate` is a Date.
function baselineAsOf(orgId, resolvedWin, nowDate) {
    const lp = londonParts(nowDate);
    const todayYmd = `${lp.year}-${String(lp.month).padStart(2, '0')}-${String(lp.day).padStart(2, '0')}`;
    const asOfDate = new Date(Date.parse(resolvedWin.until) - 1).toISOString().slice(0, 10);
    if (asOfDate >= todayYmd) {
        return analytics_repository_1.analyticsRepository.baselineMaybe(orgId);
    }
    return Promise.all([
        businessHealthRepository.getInputsAsOf(orgId, asOfDate),
        analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
    ]).then(([snap, live]) => ({
        baseline: snap?.baseline ?? live?.baseline,
        targets: snap?.targets ?? live?.targets,
    }));
}

// Every calendar month ('YYYY-MM', UTC) the [since, until) window touches. until
// is exclusive. Capped at 120 months so a hostile range can't loop unbounded.
function monthsInWindow(since, until) {
    // Month keys must be read in LONDON local time, not UTC. The window's `since`
    // is London-local midnight stored as a UTC instant — during BST that is the
    // PRIOR day's 23:00 UTC, so the 1st of a summer month (e.g. 1 Jun) is stored
    // as 2026-05-31T23:00Z. Reading getUTCMonth() off that yields May and leaks an
    // extra month into every BST window. londonMonthKey resolves the instant in
    // Europe/London (DST-aware), so the boundary lands in the right month.
    const startKey = londonMonthKey(new Date(since));
    const endKey = londonMonthKey(new Date(Date.parse(until) - 1)); // inclusive last instant
    let [y, m] = startKey.split('-').map(Number); // m is 1-12
    const [ey, em] = endKey.split('-').map(Number);
    const out = [];
    while ((y < ey || (y === ey && m <= em)) && out.length < 120) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        if (++m > 12) { m = 1; y++; }
    }
    return out.length ? out : [startKey];
}

// Shared matrix assembler for the Treatment Mix views. Turns flat
// { practice_id, ... } rows into the columns/rows/cells the heat matrix renders.
// keyOf(row) -> the row dimension (appointment_type | treatment_name); metricOf
// (row) -> the additive measure (volume | fee_pence). Columns = every in-scope
// practice (even zero-metric ones), sorted by metric desc. Rows = top 12 by
// metric; the long tail collapses into one 'Other treatment types' row. maxCell
// excludes that tail so the aggregate can't wash out the heat scale.
function assembleMixMatrix(practicesAll, rows, keyOf, metricOf) {
    const typeTotals = new Map();
    const practiceTotals = new Map();
    const cell = new Map(); // `${type}|${practiceId}` -> metric
    let grandTotal = 0;
    for (const r of rows) {
        const type = keyOf(r);
        const metric = metricOf(r) || 0;
        const key = `${type}|${r.practice_id}`;
        typeTotals.set(type, (typeTotals.get(type) ?? 0) + metric);
        practiceTotals.set(r.practice_id, (practiceTotals.get(r.practice_id) ?? 0) + metric);
        cell.set(key, (cell.get(key) ?? 0) + metric);
        grandTotal += metric;
    }

    const practices = practicesAll
        .map((p) => ({ id: p.id, name: p.name, total: practiceTotals.get(p.id) ?? 0 }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const TOP = 12;
    const sortedTypes = [...typeTotals.entries()]
        .map(([type, total]) => ({ type, total }))
        .sort((a, b) => b.total - a.total);
    const head = sortedTypes.slice(0, TOP);
    const tail = sortedTypes.slice(TOP);
    const share = (n) => (grandTotal ? Math.round((1000 * n) / grandTotal) / 10 : 0);
    const buildCells = (type) => practices.map((p) => cell.get(`${type}|${p.id}`) ?? 0);

    const typeRows = head.map((t) => ({
        type: t.type, total: t.total, sharePct: share(t.total), isOther: false, cells: buildCells(t.type),
    }));
    if (tail.length > 1) {
        const otherTotal = tail.reduce((s, t) => s + t.total, 0);
        const otherCells = practices.map((p) => tail.reduce((s, t) => s + (cell.get(`${t.type}|${p.id}`) ?? 0), 0));
        // 'Other treatment types' (not 'Other') so it never collides with a real
        // type literally named 'Other' in the feed.
        typeRows.push({ type: 'Other treatment types', total: otherTotal, sharePct: share(otherTotal), isOther: true, cells: otherCells });
    } else if (tail.length === 1) {
        typeRows.push({ type: tail[0].type, total: tail[0].total, sharePct: share(tail[0].total), isOther: false, cells: buildCells(tail[0].type) });
    }

    let maxCell = 0;
    for (const row of typeRows) {
        if (row.isOther) continue;
        for (const v of row.cells) if (v > maxCell) maxCell = v;
    }

    return { practices, typeRows, grandTotal, maxCell, distinctTypes: typeTotals.size, sortedTypes, cell, practiceTotals };
}

// Money-framed insight cards for the REVENUE matrix. Real invoiced fees, so £ is
// honest here (unlike the volume view). Each card { tone, title, body }.
function buildRevenueInsights({ grandTotal, sortedTypes, practices, cell, nameById }) {
    const cards = [];
    if (!grandTotal || sortedTypes.length === 0) return cards;
    const gbp = (pence) => formulas_1.formatPounds(pence);

    const top = sortedTypes[0];
    cards.push({
        tone: 'info',
        title: `${top.type} earns the most`,
        body: `${gbp(top.total)} (${Math.round((1000 * top.total) / grandTotal) / 10}% of invoiced fees in scope).`,
    });

    if (practices.length > 1) {
        const floor = grandTotal * 0.05;
        let best = null;
        for (const t of sortedTypes) {
            if (t.total < floor) continue;
            let maxVol = 0, maxPid = null;
            for (const p of practices) {
                const v = cell.get(`${t.type}|${p.id}`) ?? 0;
                if (v > maxVol) { maxVol = v; maxPid = p.id; }
            }
            const sh = t.total ? maxVol / t.total : 0;
            if (maxPid && (!best || sh > best.share)) best = { type: t.type, practiceId: maxPid, share: sh };
        }
        if (best && best.share >= 0.7) {
            cards.push({
                tone: 'warn',
                title: `${best.type} revenue concentrated at one site`,
                body: `${Math.round(best.share * 100)}% of ${best.type} fees come from ${nameById.get(best.practiceId) ?? 'one practice'} — single-site dependency.`,
            });
        }
    }

    if (practices.length > 1 && practices[0].total > 0) {
        const busiest = practices[0];
        cards.push({
            tone: 'good',
            title: `${busiest.name} bills the most`,
            body: `${gbp(busiest.total)} — ${Math.round((1000 * busiest.total) / grandTotal) / 10}% of group invoiced fees.`,
        });
    }

    let cum = 0, n = 0;
    for (const t of sortedTypes) { cum += t.total; n += 1; if (cum >= grandTotal * 0.8) break; }
    cards.push({
        tone: 'info',
        title: 'Revenue concentration',
        body: `${n} of ${sortedTypes.length} treatment ${sortedTypes.length === 1 ? 'type' : 'types'} make up 80% of invoiced fees.`,
    });

    return cards;
}

// Volume-framed insight cards for the heat matrix. NEVER money — appointments
// carry no price. Each card is { tone, title, body }; empty data -> [].
function buildMixInsights({ grandTotal, sortedTypes, practices, practiceTotals, cell, nameById }) {
    const cards = [];
    if (!grandTotal || sortedTypes.length === 0) return cards;

    // 1. Top treatment by share of all appointments.
    const top = sortedTypes[0];
    const topShare = Math.round((1000 * top.total) / grandTotal) / 10;
    cards.push({
        tone: 'info',
        title: `${top.type} leads the mix`,
        body: `${topShare}% of appointments in scope (${top.total.toLocaleString('en-GB')} of ${grandTotal.toLocaleString('en-GB')}).`,
    });

    // 2. Single-site concentration — the type most dependent on one practice.
    // Only meaningful with >1 practice and a type of real volume (floor 5%).
    if (practices.length > 1) {
        const floor = grandTotal * 0.05;
        let best = null; // { type, practiceId, share }
        for (const t of sortedTypes) {
            if (t.total < floor) continue;
            let maxVol = 0, maxPid = null;
            for (const p of practices) {
                const v = cell.get(`${t.type}|${p.id}`) ?? 0;
                if (v > maxVol) { maxVol = v; maxPid = p.id; }
            }
            const share = t.total ? maxVol / t.total : 0;
            if (maxPid && (!best || share > best.share)) best = { type: t.type, practiceId: maxPid, share };
        }
        if (best && best.share >= 0.7) {
            cards.push({
                tone: 'warn',
                title: `${best.type} concentrated at one site`,
                body: `${Math.round(best.share * 100)}% of ${best.type} appointments run through ${nameById.get(best.practiceId) ?? 'one practice'} — single-site dependency.`,
            });
        }
    }

    // 3. Busiest practice + its dominant treatment.
    if (practices.length > 1 && practices[0].total > 0) {
        const busiest = practices[0];
        let domType = null, domVol = 0;
        for (const t of sortedTypes) {
            const v = cell.get(`${t.type}|${busiest.id}`) ?? 0;
            if (v > domVol) { domVol = v; domType = t.type; }
        }
        const share = Math.round((1000 * busiest.total) / grandTotal) / 10;
        cards.push({
            tone: 'good',
            title: `${busiest.name} is the busiest site`,
            body: `${share}% of group appointments${domType ? `; ${domType} is its top treatment` : ''}.`,
        });
    }

    // 4. Pareto breadth — how few types make up 80% of all volume.
    let cum = 0, n = 0;
    for (const t of sortedTypes) { cum += t.total; n += 1; if (cum >= grandTotal * 0.8) break; }
    cards.push({
        tone: 'info',
        title: 'Mix breadth',
        body: `${n} of ${sortedTypes.length} treatment ${sortedTypes.length === 1 ? 'type' : 'types'} make up 80% of appointment volume.`,
    });

    return cards;
}

// Decision Lens cards for the Day (Cash Collected) view — derived purely from
// the real by-day receipts. Each card is { tone, title, body, value }; no data
// -> []. Money in pence; the £ string is for display only.
function buildCashByDayInsights({ withIndex, avgPerDayPence, peak, totalPence }) {
    const cards = [];
    if (!totalPence || !withIndex.length) return cards;
    const gbp = (p) => '£' + Math.round((p || 0) / 100).toLocaleString('en-GB');

    // 1. Peak collection day vs the average working day.
    if (peak && peak.pence > 0) {
        cards.push({
            tone: 'good',
            title: `Peak collection on ${peak.label}`,
            body: `${gbp(peak.pence)} banked — index ${Math.round(peak.index)} vs the average working day (100).`,
            value: gbp(peak.pence),
        });
    }

    // 2. Saturday softness — avg Saturday cash vs avg Mon–Fri cash.
    const sats = withIndex.filter((r) => r.dow === 6);
    const weekdays = withIndex.filter((r) => r.dow >= 1 && r.dow <= 5);
    if (sats.length && weekdays.length) {
        const satAvg = sats.reduce((s, r) => s + r.pence, 0) / sats.length;
        const wdAvg = weekdays.reduce((s, r) => s + r.pence, 0) / weekdays.length;
        if (wdAvg > 0 && satAvg < wdAvg * 0.6) {
            const down = Math.round((1 - satAvg / wdAvg) * 100);
            cards.push({
                tone: 'info',
                title: 'Saturdays run light on collections',
                body: `Saturday banks ~${down}% below the weekday average — expected for a part-day, but check card-on-file settlement is firing on weekend treatment.`,
                value: `-${down}%`,
            });
        }
    }

    // 3. Strongest weekday on average (where to concentrate high-value diary).
    const byDow = new Map();
    for (const r of weekdays) {
        const a = byDow.get(r.dow) || { sum: 0, n: 0 };
        a.sum += r.pence; a.n += 1; byDow.set(r.dow, a);
    }
    let bestDow = null, bestAvg = 0;
    for (const [dow, a] of byDow) {
        const avg = a.n ? a.sum / a.n : 0;
        if (avg > bestAvg) { bestAvg = avg; bestDow = dow; }
    }
    if (bestDow != null && avgPerDayPence > 0 && bestAvg > avgPerDayPence * 1.1) {
        const up = Math.round((bestAvg / avgPerDayPence - 1) * 100);
        cards.push({
            tone: 'info',
            title: `${DOW_SHORT[bestDow]} is the strongest collection day`,
            body: `${DOW_SHORT[bestDow]} averages ${gbp(Math.round(bestAvg))}, ~${up}% above the typical working day — weight high-value, high-deposit cases here.`,
            value: `+${up}%`,
        });
    }

    return cards;
}

// Test-only surface for module-private helpers.
export const __test = { baselineAsOf };

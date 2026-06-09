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
import * as associate_repository_1 from "../repositories/associate.repository.js";
import * as payRun_repository_1 from "../repositories/pay-run.repository.js";
import * as valuationInputs_repository_1 from "../repositories/valuationInputs.repository.js";
import * as chairConfig_repository_1 from "../repositories/chairConfig.repository.js";
import * as plSheet_repository_1 from "../repositories/plSheet.repository.js";
import { boardReportRepository } from "../repositories/boardReport.repository.js";
import * as aws_ses_1 from "../lib/aws-ses.js";
import { bucketsByPeriod, plInputFromBuckets, financeSeriesRowFromBuckets } from "./monthlyFinancial.service.js";
import { debtService } from "./debt.service.js";
import { getProvider } from "../lib/ai/index.js";
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
    //               No grid data for a practice -> fall back to assumed_util_pct
    //               (or 80%) and flag occupancySource='assumption'.
    //   occupancySource: 'manual' (grid) | 'assumption'.
    // Cost-of-empty / recoverable are modelled off occupancy + chair capacity.
    // OCPSPD + profit-per-chair-hour still deferred.
    async chairAnalytics(orgId, { scope = 'all', recoverPctPoints = 10, since: winSince, until: winUntil, now = () => new Date() } = {}) {
        const DEFAULT_UTIL_PCT = 80;
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
        // Per-practice manual occupancy = Σ booked / Σ available.
        const grid = new Map(); // practiceId -> { booked, available }
        for (const g of gridRows) {
            const a = grid.get(g.practice_id) || { booked: 0, available: 0 };
            a.booked += g.booked_minutes || 0;
            a.available += g.available_minutes || 0;
            grid.set(g.practice_id, a);
        }

        const rows = practices.map((p) => {
            const annualRevenuePence = revByPractice.get(p.id) || 0;
            const gm = grid.get(p.id);
            const hasManual = !!gm && gm.available > 0;
            const occupancySource = hasManual ? 'manual' : 'assumption';
            const utilAssumed = !hasManual;
            const utilPct = hasManual
                ? Math.min(100, Math.round((gm.booked / gm.available) * 1000) / 10)
                : (p.assumed_util_pct == null ? DEFAULT_UTIL_PCT : p.assumed_util_pct);
            const stats = (0, formulas_1.calculateChairStats)({ chairs: p.chairs || 0, utilPct, annualRevenuePence, config });
            return { id: p.id, name: p.name, utilAssumed, occupancySource, annualRevenuePence, ...stats };
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
    // (all/practices) → one whole-org RPC call; otherwise call per resolved id
    // and merge (academy/lab/specific practice — at most a handful, no N+1 risk).
    async _receiptsByDayScoped(orgId, since, until, resolved) {
        if (!resolved.practiceIds || resolved.practiceIds.length === 0) {
            return analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, since, null, until);
        }
        const parts = await Promise.all(resolved.practiceIds.map((id) =>
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, since, id, until)));
        const merged = new Map();
        for (const rows of parts)
            for (const r of rows)
                merged.set(r.day, (merged.get(r.day) || 0) + (Number(r.pence) || 0));
        return [...merged].map(([day, pence]) => ({ day, pence }));
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
    // Profit Benchmarking (Intelligence OS — CoA→P&L). Actual cost/profit ratios
    // vs the UK dental group benchmarks. A FINANCE screen → real actuals or zero,
    // never the baseline projection (FORMULAS §1a). When there is no real cost
    // source we return costsAvailable:false and no rows — the client shows a
    // "connect Xero / enter actuals" empty state rather than fabricating ratios.
    async plBenchmark(orgId, { practiceId = null } = {}) {
        const actuals = await this._actualsBundle(orgId, practiceId);
        const a = actuals.annual || {};
        const revenue = a.revenue || 0;
        const costTotal = (a.staff || 0) + (a.lab || 0) + (a.materials || 0) + (a.overhead || 0) + (a.other || 0);
        if (!actuals.hasAny || revenue <= 0 || costTotal <= 0) {
            return { costsAvailable: false, basis: 'none', revenue, rows: [], overspendPence: 0, periodsCovered: actuals.periodsCovered };
        }
        const plInput = plInputFromBuckets(a);
        const pl = (0, formulas_1.calculatePL)(plInput);
        const result = (0, formulas_1.calculateProfitBenchmark)({ revenue: plInput.revenue, costs: plInput.costs, netProfit: pl.netProfit });
        return { ...result, marginPct: pl.marginPct, netProfit: pl.netProfit, totalCosts: pl.totalCosts, costsAvailable: true, basis: 'actuals', periodsCovered: actuals.periodsCovered };
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
    async plMargin(orgId, { scope = 'all', period = 'month', periodKey, since, until, label, now = () => new Date() } = {}) {
        const resolved = await this.resolveScope(orgId, scope);
        // Months the window touches ('YYYY-MM'). Explicit pill window wins; else
        // the single month of periodKey (legacy month|day path).
        const windowMonths = (since && until)
            ? monthsInWindow(since, until)
            : [(periodKey || '').slice(0, 7) ||
                `${now().getUTCFullYear()}-${String(now().getUTCMonth() + 1).padStart(2, '0')}`];
        const monthKey = windowMonths[0];
        const multiMonth = windowMonths.length > 1;

        const [entityRows, allFin] = await Promise.all([
            analytics_repository_1.analyticsRepository.allEntities(orgId),
            monthlyFinancial_repository_1.monthlyFinancialRepository.allForOrg(orgId),
        ]);
        const entityById = new Map(entityRows.map((e) => [e.id, e]));
        const practiceKindIds = new Set(entityRows.filter((e) => e.kind === 'practice').map((e) => e.id));

        // Which practice_ids count for this scope. __org__ (null practice_id) rows
        // belong to the whole group → included for all/practices, excluded from a
        // specific entity/academy/lab scope.
        const inScope = (pid) => {
            const key = pid || '__org__';
            if (resolved.mode === 'all') return true;
            if (resolved.mode === 'practices') return key === '__org__' || practiceKindIds.has(pid);
            return resolved.practiceIds.includes(pid); // entity/academy/lab
        };

        // Group rows by practiceKey, then resolve period buckets per group.
        const byKey = new Map(); // practiceKey -> rows
        for (const r of allFin) {
            if (!inScope(r.practice_id)) continue;
            const key = r.practice_id || '__org__';
            (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
        }

        // For a row set: sum the buckets for every month the window touches that
        // carries data (revenue>0 across the window). A single-month window keeps
        // basis 'month'; a multi-month window sums to basis 'annual'. When the
        // window has no actuals, fall back to the trailing ≤12mo annual sum.
        const resolveBuckets = (rows) => {
            const byPeriod = bucketsByPeriod(rows);
            const hit = windowMonths.filter((mk) => byPeriod.has(mk));
            if (hit.length > 0) {
                const summed = {};
                for (const mk of hit)
                    for (const [k, v] of Object.entries(byPeriod.get(mk))) summed[k] = (summed[k] || 0) + v;
                if ((summed.revenue || 0) > 0) {
                    return { buckets: summed, basis: multiMonth ? 'annual' : 'month', periodsCovered: hit.length };
                }
            }
            const periods = [...byPeriod.keys()].sort().slice(-12);
            const annual = {};
            for (const p of periods)
                for (const [k, v] of Object.entries(byPeriod.get(p))) annual[k] = (annual[k] || 0) + v;
            return { buckets: annual, basis: 'annual', periodsCovered: periods.length };
        };

        // Resolve EACH key (entity or __org__) independently — Xero-overrides-
        // manual precedence is per-entity, so never merge sources across entities
        // before resolving (that would let one practice's synced row suppress
        // another's manual row). The group statement is the SUM of per-key lines.
        const entities = [];
        const groupLine = { revPence: 0, labMaterialsPence: 0, grossPence: 0, staffPence: 0, otherOpexPence: 0, netPence: 0 };
        let anyMonth = false, anyAnnual = false, groupPeriods = 0;
        for (const [key, rows] of byKey) {
            const { buckets, basis, periodsCovered } = resolveBuckets(rows);
            const line = plLineFromBuckets(buckets);
            if (line.revPence <= 0 && line.netPence === 0) continue;
            // Accumulate into the group statement (all in-scope keys, incl. __org__).
            for (const f of Object.keys(groupLine)) groupLine[f] += line[f];
            if (basis === 'month') anyMonth = true; else anyAnnual = true;
            groupPeriods = Math.max(groupPeriods, periodsCovered);
            if (key === '__org__') continue; // org-level stays in the total, not a row
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

        return {
            applicable: true,
            scope, period,
            monthKey,
            basis,
            hasData,
            costsAvailable: hasData,
            periodsCovered: groupPeriods,
            statement,
            // Xero folds associate/clinician pay into the staff bucket — never
            // show a separate clinician line off this source (it would read false).
            dentistStaffSeparable: false,
            perEntityAvailable: entities.length > 0,
            entityBasisMixed: anyMonth && anyAnnual,
            entities,
            note: 'Real P&L from monthly_financials (Xero/QuickBooks override manual). Staff includes associate/clinician pay (Xero books them together). Editable scenario sheets + account-level CoA mapping are the persistence slice.',
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
        const [adRows, leads, revRows, practices] = await Promise.all([
            analytics_repository_1.analyticsRepository.adMetricsInWindow(orgId, fromDate, toDate, pids, accountIds),
            analytics_repository_1.analyticsRepository.leadsForMarketing(orgId, since, until, pids),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, since, until),
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
        ]);
        const nameById = new Map(practices.map((p) => [p.id, p.name]));
        const inScopeRev = revRows.filter((r) => !pids || pids.includes(r.practice_id));

        // Per-channel accumulators (spend from ad_metrics; leads/conversions from CRM).
        const ch = new Map(MKT_CHANNELS.map((c) => [c.key, { ...c, spendPence: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 }]));
        for (const a of adRows) {
            const c = ch.get(a.provider);
            if (!c) continue;
            c.spendPence += a.spend_pence || 0;
            c.impressions += a.impressions || 0;
            c.clicks += a.clicks || 0;
        }
        for (const l of leads) {
            const c = ch.get(attributeChannel(l));
            if (!c) continue;
            c.leads += 1;
            if (CONVERTED_STATUSES.has(l.status)) c.conversions += 1;
        }

        const totalLeads = leads.length;
        const channels = [...ch.values()]
            .filter((c) => c.leads > 0 || c.spendPence > 0)
            .map((c) => ({
                key: c.key, label: c.label, color: c.color, paid: c.paid, group: c.group,
                spendPence: c.spendPence, impressions: c.impressions, clicks: c.clicks,
                leads: c.leads, conversions: c.conversions,
                cplPence: c.leads ? Math.round(c.spendPence / c.leads) : 0,
                cpaPence: c.conversions ? Math.round(c.spendPence / c.conversions) : 0,
                leadSharePct: totalLeads ? Math.round((c.leads / totalLeads) * 1000) / 10 : 0,
                convRatePct: c.leads ? Math.round((c.conversions / c.leads) * 1000) / 10 : 0,
            }))
            .sort((a, b) => b.spendPence - a.spendPence || b.leads - a.leads);

        const paidSpendPence = channels.filter((c) => c.paid).reduce((s, c) => s + c.spendPence, 0);
        const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);
        const settledRevenuePence = inScopeRev.reduce((s, r) => s + (Number(r.pence) || 0), 0);
        const blendedRoas = paidSpendPence ? Math.round((settledRevenuePence / paidSpendPence) * 100) / 100 : null;
        const blendedRoiPct = paidSpendPence ? Math.round(((settledRevenuePence - paidSpendPence) / paidSpendPence) * 100) : null;

        const google = channels.find((c) => c.key === 'google_ads') || null;
        const meta = channels.find((c) => c.key === 'meta_ads') || null;

        // Per-practice acquisition: leads/conversions (CRM) + revenue (settled);
        // ad spend per practice only when ad_metrics carries practice_id.
        const adSpendByPractice = new Map();
        let adSpendPerPracticeAvailable = false;
        for (const a of adRows) {
            if (!a.practice_id) continue;
            adSpendPerPracticeAvailable = true;
            adSpendByPractice.set(a.practice_id, (adSpendByPractice.get(a.practice_id) || 0) + (a.spend_pence || 0));
        }
        const revByPractice = new Map(inScopeRev.map((r) => [r.practice_id, Number(r.pence) || 0]));
        const leadsByPractice = new Map();
        for (const l of leads) {
            const id = l.practice_id;
            if (!id) continue;
            const a = leadsByPractice.get(id) || { leads: 0, conversions: 0 };
            a.leads += 1;
            if (CONVERTED_STATUSES.has(l.status)) a.conversions += 1;
            leadsByPractice.set(id, a);
        }
        const practiceIdsSeen = new Set([...leadsByPractice.keys(), ...revByPractice.keys(), ...adSpendByPractice.keys()]);
        const byPractice = [...practiceIdsSeen]
            .filter((id) => nameById.has(id))
            .map((id) => {
                const lp = leadsByPractice.get(id) || { leads: 0, conversions: 0 };
                const spendPence = adSpendByPractice.get(id) || 0;
                const revenuePence = revByPractice.get(id) || 0;
                return {
                    id, name: nameById.get(id),
                    leads: lp.leads, conversions: lp.conversions,
                    convRatePct: lp.leads ? Math.round((lp.conversions / lp.leads) * 1000) / 10 : 0,
                    revenuePence,
                    spendPence,
                    cpaPence: lp.conversions && spendPence ? Math.round(spendPence / lp.conversions) : 0,
                    roas: spendPence ? Math.round((revenuePence / spendPence) * 100) / 100 : null,
                };
            })
            .sort((a, b) => b.leads - a.leads || b.revenuePence - a.revenuePence);

        const insights = buildMarketingInsights({ channels, blendedRoas, paidSpendPence, settledRevenuePence, connected: adRows.length > 0, adSpendPerPracticeAvailable });

        // Per-account spend breakdown (the selected ad accounts), labelled from
        // the ad_accounts dimension. Org-isolated.
        const adAccounts = await integration_repository_1.listAdAccounts(orgId, null);
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
            .map(([k, a]) => ({
                ...a,
                name: acctMeta.get(k)?.name ?? null,
                currency: acctMeta.get(k)?.currency ?? null,
                status: acctMeta.get(k)?.status ?? null,
                cpaPence: a.conversions ? Math.round(a.spendPence / a.conversions) : 0,
                cpcPence: a.clicks ? Math.round(a.spendPence / a.clicks) : 0,
            }))
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

        const clinicians = scoped.map((a) => {
            const payPct = (a.pay_pct ?? 4500) / 100;        // basis points → %
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
                payPct, labSplitPct,
                productionPence, feesPence, netToPracticePence,
                appointments: stats.total, completed: stats.completed, noShows: stats.no_shows,
            };
        }).sort((x, y) => y.productionPence - x.productionPence || y.appointments - x.appointments);

        const totalProductionPence = clinicians.reduce((s, c) => s + c.productionPence, 0);
        const totalFeesPence = clinicians.reduce((s, c) => s + c.feesPence, 0);
        const totalNetPence = clinicians.reduce((s, c) => s + c.netToPracticePence, 0);

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
            nhs,
            insights,
            note: 'Roster, pay splits and NHS contract are live. Production £ is from completed Dentally treatment plans; appointment counts need practitioner-tagged appointments. Lab cost / operating-cost-per-surgery per clinician have no real per-clinician source and are omitted (use the Treatment Workbench).',
        };
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
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
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

        try {
            const ai = await claude_1.askAnalyst(q, summary);
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
            ? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
            : o.period;
          win = { scope, period: 'month', periodKey, now: () => now };
          resolvedWin = treatmentWindow('month', periodKey, now);
        }

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
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
        ]);

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
        const [series, bank] = await Promise.all([
            this.financeSeries(orgId, { months, now, practiceId }),
            analytics_repository_1.analyticsRepository.bankSummary(orgId),
        ]);
        const anchorBank = bank.totalPence || 0;
        const real = series.months.map((m) => {
            const out = (m.associatePay || 0) + (m.staffCosts || 0) + (m.labMaterials || 0) + (m.opex || 0);
            return { month: m.month, inPence: m.revenue || 0, outPence: out, costsAvailable: !!m.costsAvailable, projected: false };
        });

        // Run-rate for projection: average of recent months (IN always real;
        // OUT only from months that have a real cost source).
        const recentIn = real.slice(-3);
        const inRunRate = recentIn.length ? Math.round(recentIn.reduce((s, m) => s + m.inPence, 0) / recentIn.length) : 0;
        const costMonths = real.filter((m) => m.costsAvailable);
        let outRunRate = costMonths.length
            ? Math.round(costMonths.slice(-3).reduce((s, m) => s + m.outPence, 0) / Math.min(3, costMonths.length))
            : 0;
        // No per-month costs at all → fall back to the org baseline cost base.
        let costsBasis = costMonths.length ? 'actuals' : 'none';
        if (!costMonths.length && !practiceId) {
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
    // Revenue Leakage — "money left on the table" over the window. Pulls the
    // same real rollups Business Hub uses (settled turnover, appointments/no-
    // shows, treatment-plan value, banked receipts) and runs them through
    // calculateRevenueLeakage. The window total is annualised by the caller's
    // window length. `rates` (0-100 per pool) tunes the recoverable share.
    async revenueLeakage(orgId, { days = 90, since = null, until = null, rates = {}, now = () => new Date() } = {}) {
        const nowMs = now().getTime();
        const sinceISO = since || new Date(nowMs - days * 86400000).toISOString();
        const untilISO = until || null;
        const windowEndMs = untilISO ? Date.parse(untilISO) : nowMs;
        const windowDays = Math.max(1, Math.round((windowEndMs - Date.parse(sinceISO)) / 86400000));
        const [revRows, apptRows, planVal, cashRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.appointmentsRollupByPractice(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.treatmentPlanValueByStatus(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, null, untilISO),
        ]);
        const num = (v) => Number(v || 0);
        const revenuePence = revRows.reduce((s, r) => s + num(r.pence), 0);
        const appointments = apptRows.reduce((s, r) => s + num(r.total), 0);
        const noShows = apptRows.reduce((s, r) => s + num(r.no_shows), 0);
        const cashCollectedPence = cashRows.reduce((s, r) => s + num(r.pence), 0);
        const result = formulas_1.calculateRevenueLeakage(
            {
                revenuePence,
                presentedPlanPence: planVal.presentedPence,
                acceptedPlanPence: planVal.acceptedPence,
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
            inputs: { revenuePence, appointments, noShows, cashCollectedPence, ...planVal },
            lines,
        };
    },
    async businessHub(orgId, { days = 90, since = null, until = null, label = null, now = () => new Date() } = {}) {
        // Window: an explicit [since, until] (a picked month/day) takes priority;
        // otherwise fall back to the trailing N-day window (until open).
        const sinceISO = since || new Date(now().getTime() - days * 86400000).toISOString();
        const untilISO = until || null;
        // Leads are windowed only when an upper bound is set (month/day mode); in
        // the trailing-days mode they stay all-time, as before.
        const leadSinceISO = untilISO ? sinceISO : null;
        const [practices, revRows, apptRows, leadRows, treatments, actuals, health, noShowTracked, revLineRows, cashRows] = await Promise.all([
            analytics_repository_1.analyticsRepository.practicesFull(orgId),
            analytics_repository_1.analyticsRepository.settledRevenueByPractice(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.appointmentsRollupByPractice(orgId, sinceISO, untilISO),
            analytics_repository_1.analyticsRepository.leadsRollupByPractice(orgId, leadSinceISO, untilISO),
            analytics_repository_1.analyticsRepository.treatmentsRollupByOrg(orgId, sinceISO, untilISO),
            this._actualsBundle(orgId),
            analytics_repository_1.analyticsRepository.baselineMaybe(orgId),
            analytics_repository_1.analyticsRepository.hasNoShowData(orgId),
            analytics_repository_1.analyticsRepository.treatmentRevenueMatrix(orgId, sinceISO, untilISO),
            // Cash banked in window — settled receipts (payments processed), org-wide.
            // Distinct from turnover (settled invoices); the gap is outstanding/debtors.
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, null, untilISO),
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
        // Leads + converted from the raw rollups, not the per-practice rows:
        // GHL leads arrive with a null practice_id, so summing practiceRows
        // would silently drop them (they never match a practice). The raw
        // leadRows include the null-practice bucket.
        const totalLeads = leadRows.reduce((s, r) => s + num(r.total), 0);
        const totalConverted = leadRows.reduce((s, r) => s + num(r.converted), 0);
        // Treatment funnel (org-wide; treatment_plans are not practice-attributed).
        const treatmentsStarted = num(treatments.started);
        const treatmentsCompleted = num(treatments.completed);
        const treatmentsClosedPence = num(treatments.closed_value_pence);
        // Cash banked = sum of settled receipts in the window (real payments).
        const cashCollectedPence = cashRows.reduce((s, r) => s + num(r.pence), 0);

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
                conversionRate: rate(totalConverted, totalLeads),
                newPatients: totalConverted, // leads reaching treatment (real Dentally/GHL)
                treatmentsStarted,
                treatmentsCompleted, // accepted/completed plan count in window
                treatmentsClosedPence,
                cashCollectedPence, // settled receipts banked in window
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
    // Board Report Generator (DentaCFO gap module, Phase 2). Assembles a board
    // pack from the SAME live rollups as Business Hub + Revenue Leakage (no
    // stored snapshot): group turnover/margin, conversion, banked cash, top vs
    // weakest practice, and the single biggest recoverable leak. Claude writes
    // the executive summary + RAG priorities; on any failure / no API key it
    // falls back to a deterministic, data-driven pack (HTTP 200 always). Money
    // is integer pence throughout.
    async boardReport(orgId, { since = null, until = null, label = null, now = () => new Date() } = {}) {
        const [hub, leak] = await Promise.all([
            this.businessHub(orgId, { since, until, label, now }),
            this.revenueLeakage(orgId, { since, until, now }),
        ]);
        const g = hub.group;
        const periodLabel = label || (until ? `${(since || '').slice(0, 10)} → ${until.slice(0, 10)}` : `last ${hub.period.days} days`);
        // Annualise window turnover by the leakage window length (same window).
        const days = Math.max(1, leak.windowDays);
        const revAnnualPence = Math.round((g.revenuePence * 365) / days);
        const ebitdaWindowPence = Math.round((g.revenuePence * (g.marginPct || 0)) / 100);
        const practiceRows = hub.practices || [];
        const top = practiceRows[0] || null; // already sorted by revenue desc
        // Weakest = highest no-show rate among practices with appointments.
        const weak = practiceRows
            .filter((p) => p.appointments > 0)
            .slice()
            .sort((a, b) => b.noShowRate - a.noShowRate)[0] || null;
        const biggest = (leak.lines || [])[0] || null; // sorted by annualPence desc

        const metrics = {
            revenuePence: g.revenuePence,
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
        };

        const empty = g.revenuePence === 0 && g.appointments === 0 && g.leads === 0;
        let summary = [];
        let priorities = [];
        let basis = 'deterministic';
        if (!empty) {
            try {
                const ai = await claude_1.generateBoardReport({
                    scopeLabel: 'Group',
                    periodLabel,
                    data: metrics,
                });
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
    async emailBoardReport(orgId, { recipientEmail, since = null, until = null, label = null, now = () => new Date() } = {}) {
        const report = await this.boardReport(orgId, { since, until, label, now });
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
    const staffPence = b.staff || 0;
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
    const y0 = now.getUTCFullYear();
    const m0 = now.getUTCMonth();
    if (period === 'day') {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey || '');
        const y = m ? Number(m[1]) : y0;
        const mo = m ? Number(m[2]) - 1 : m0;
        const d = m ? Number(m[3]) : now.getUTCDate();
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

// Every calendar month ('YYYY-MM', UTC) the [since, until) window touches. until
// is exclusive. Capped at 120 months so a hostile range can't loop unbounded.
function monthsInWindow(since, until) {
    const s = new Date(since);
    const e = new Date(Date.parse(until) - 1); // inclusive last instant
    let y = s.getUTCFullYear(), m = s.getUTCMonth();
    const ey = e.getUTCFullYear(), em = e.getUTCMonth();
    const out = [];
    while ((y < ey || (y === ey && m <= em)) && out.length < 120) {
        out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
        if (++m > 11) { m = 0; y++; }
    }
    return out.length ? out : [`${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`];
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

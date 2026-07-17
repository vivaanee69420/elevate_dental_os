// ============================================================================
// FINANCIAL FORMULAS — Pure functions, fully tested (native ESM)
// ============================================================================
// ALL monetary values are INTEGER PENCE. Never floats.
// All functions are pure — same input always returns same output.
// ============================================================================

// ---------- Helpers ----------
export const pence = (n) => Math.round(n);
export const pct = (n, decimals = 1) => Number(n.toFixed(decimals));
export const formatPounds = (penceVal) => `£${(penceVal / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

export function calculatePL(input) {
    const totalCosts = Object.values(input.costs).reduce((a, b) => a + b, 0);
    const netProfit = input.revenue - totalCosts;
    const marginPct = input.revenue > 0 ? (netProfit / input.revenue) * 100 : 0;
    const costsAsPctOfRevenue = {};
    for (const [key, value] of Object.entries(input.costs)) {
        costsAsPctOfRevenue[key] = input.revenue > 0 ? (value / input.revenue) * 100 : 0;
    }
    return {
        revenue: input.revenue,
        totalCosts,
        netProfit,
        marginPct: pct(marginPct, 2),
        costsAsPctOfRevenue,
    };
}

// Profit Benchmarking (Intelligence OS — CoA→P&L). UK dental GROUP constants —
// the standard cost/profit ratios a healthy private practice runs at. Documented
// in docs/FORMULAS.md §1b; per-org overrides are a later TODO (plan TODO2).
export const PROFIT_BENCHMARKS = { dentist: 45, staff: 18, labMaterial: 15, otherFixed: 12, profit: 10 };

// Compare a P&L's actual cost/profit ratios to PROFIT_BENCHMARKS. Pure; integer
// pence in. Takes calculatePL-shaped input ({revenue, costs, netProfit}) and maps
// its seven cost lines into the five benchmark categories:
//   dentist     = costs.associates
//   staff       = costs.staff
//   labMaterial = costs.lab + costs.materials
//   otherFixed  = costs.property + costs.marketing + costs.other
//   profit      = netProfit            (a target floor, not a cost)
// Verdict logic mirrors the prototype benchPanel: a cost line UNDER benchmark is
// good ("Lean"); profit OVER the 10% floor is good ("Above target"); a ±1pt dead
// band reads "On benchmark". `overspendPence` totals only cost lines above their
// benchmark — the recoverable margin ("move a line to benchmark, it drops to the
// bottom line"). `dentistStaffSeparable` is false when Xero has folded associate
// pay into the staff bucket (associates = 0 while staff carries it) — the caller
// surfaces that so the green/lean dentist row is not read as a real saving.
export function calculateProfitBenchmark(input) {
    const revenue = input.revenue || 0;
    const c = input.costs || {};
    const cats = [
        { key: 'dentist', label: 'Dentist / associate', bm: PROFIT_BENCHMARKS.dentist, actual: c.associates || 0 },
        { key: 'staff', label: 'Support staff', bm: PROFIT_BENCHMARKS.staff, actual: c.staff || 0 },
        { key: 'labMaterial', label: 'Lab + material', bm: PROFIT_BENCHMARKS.labMaterial, actual: (c.lab || 0) + (c.materials || 0) },
        { key: 'otherFixed', label: 'Other fixed costs', bm: PROFIT_BENCHMARKS.otherFixed, actual: (c.property || 0) + (c.marketing || 0) + (c.other || 0) },
        { key: 'profit', label: 'Profit', bm: PROFIT_BENCHMARKS.profit, actual: input.netProfit || 0, isProfit: true },
    ];
    let overspendPence = 0;
    const rows = cats.map((cat) => {
        const actualPct = revenue > 0 ? pct((cat.actual / revenue) * 100, 1) : 0;
        const benchmarkPence = pence((revenue * cat.bm) / 100);
        const variancePts = pct(actualPct - cat.bm, 1);
        const good = cat.isProfit ? variancePts >= 0 : variancePts <= 0;
        const severity = Math.abs(variancePts) <= 1 ? 'neutral' : good ? 'good' : 'bad';
        const verdict = Math.abs(variancePts) < 1
            ? 'On benchmark'
            : good ? (cat.isProfit ? 'Above target' : 'Lean')
                : (cat.isProfit ? 'Below target' : 'Overspending');
        if (!cat.isProfit && cat.actual > benchmarkPence) overspendPence += cat.actual - benchmarkPence;
        return { key: cat.key, label: cat.label, benchmarkPct: cat.bm, benchmarkPence, actualPence: cat.actual, actualPct, variancePts, good, severity, verdict };
    });
    return { revenue, rows, overspendPence, dentistStaffSeparable: (c.associates || 0) > 0 };
}

export function calculateValuation(input) {
    // Determine practice type
    const isPrivate = input.privateRevenuePct >= 75;
    const isMixed = input.privateRevenuePct >= 30 && input.privateRevenuePct < 75;
    const isNHS = input.privateRevenuePct < 30;
    // Multiples per buyer type (× EBITDA)
    let principalMultiple;
    let associateMultiple;
    let dsoMultiple;
    if (isPrivate) {
        principalMultiple = 7.3;
        associateMultiple = 3.5;
        dsoMultiple = 7.0;
    }
    else if (isMixed) {
        principalMultiple = 7.0;
        associateMultiple = 3.3;
        dsoMultiple = 6.5;
    }
    else {
        // NHS
        principalMultiple = 6.4;
        associateMultiple = 2.9;
        dsoMultiple = 5.5;
    }
    const principalLed = pence(input.ebitda * principalMultiple);
    const associateLed = pence(input.ebitda * associateMultiple);
    const dso = pence(input.ebitda * dsoMultiple);
    return {
        principalLed,
        associateLed,
        dso,
        midPoint: pence((principalLed + dso) / 2),
        highRange: Math.max(principalLed, associateLed, dso),
        lowRange: Math.min(principalLed, associateLed, dso),
    };
}

// ── Real-turnover valuation seed (DentaCFO Exit Plan) ────────────────────────
// Value the group from the REAL synced turnover (invoice_items TTM) when there
// is no manual baseline or Xero EBITDA. Dentally carries revenue but no cost
// side, so EBITDA is an assumed margin on turnover (owner-adjustable). Returns
// the EBITDA-multiple valuation (primary, via calculateValuation's buyer-type
// multiples) PLUS a direct revenue-multiple cross-check, so the owner sees both
// reference points. All integer pence.
//   annualRevenuePence  TTM billed turnover (integer pence)
//   ebitdaMarginPct     assumed EBITDA margin, default 18 (clamped 0..100)
//   privateRevenuePct   private share, drives the multiple tier (default 100)
//   revenueMultiple     goodwill multiple of turnover for the cross-check (default 1.15)
export function valuationFromTurnover({
    annualRevenuePence,
    ebitdaMarginPct = 18,
    privateRevenuePct = 100,
    revenueMultiple = 1.15,
} = {}) {
    const revenue = Math.max(0, Math.round(annualRevenuePence || 0));
    const marginPct = Math.min(100, Math.max(0, ebitdaMarginPct ?? 18));
    const privatePct = Math.min(100, Math.max(0, privateRevenuePct ?? 100));
    const revMult = Math.max(0, revenueMultiple ?? 1.15);
    const ebitdaPence = pence((revenue * marginPct) / 100);
    const valuation = calculateValuation({
        annualRevenue: revenue,
        ebitda: ebitdaPence,
        nhsRevenuePct: 100 - privatePct,
        privateRevenuePct: privatePct,
    });
    return {
        annualRevenuePence: revenue,
        ebitdaMarginPct: marginPct,
        ebitdaPence,
        ...valuation, // principalLed, associateLed, dso, midPoint, highRange, lowRange
        midpoint: valuation.midPoint, // lowercase alias for consumers
        privateRevenuePct: privatePct,
        revenueMultiple: revMult,
        revenueMultipleValuePence: pence(revenue * revMult),
    };
}

export function calculateAssociatePay(input) {
    const grossPence = pence((input.productionPence * input.payPct) / 10000);
    const labDeductionPence = pence((input.labCostPence * input.labSplitPct) / 10000);
    const prevBalancePence = input.prevBalancePence || 0;
    const netPence = grossPence - labDeductionPence + prevBalancePence;
    return { grossPence, labDeductionPence, prevBalancePence, netPence };
}

// Cash runway (Intelligence OS — Cashflow & Runway view). Pure; integer pence.
// freeCash = cash on hand now (real bank balance). monthlyNet = receipts − costs;
// when negative the group is burning, and runway = months of cash left at that
// burn. Cash-positive ⇒ runwayMonths = null (no finite runway — not a bug).
// NB "bills-to-plan" is intentionally absent: there is no payables/scheduled-bill
// source, so the burn is derived from the P&L cost base, not future bills.
export function calculateRunway({ cashOnHandPence = 0, monthlyReceiptsPence = 0, monthlyCostsPence = 0 } = {}) {
    const freeCashPence = Math.round(cashOnHandPence);
    const receipts = Math.round(monthlyReceiptsPence);
    const costs = Math.round(monthlyCostsPence);
    const monthlyNetPence = receipts - costs;
    const cashPositive = monthlyNetPence >= 0;
    const monthlyBurnPence = cashPositive ? 0 : -monthlyNetPence;
    let runwayMonths = null;
    let status = 'healthy';
    if (!cashPositive && monthlyBurnPence > 0) {
        runwayMonths = pct(freeCashPence / monthlyBurnPence, 1);
        status = runwayMonths < 3 ? 'critical' : runwayMonths < 6 ? 'warning' : 'healthy';
    }
    return {
        freeCashPence,
        monthlyReceiptsPence: receipts,
        monthlyCostsPence: costs,
        monthlyNetPence,
        monthlyBurnPence,
        runwayMonths,
        cashPositive,
        status,
    };
}

// UK Corporation Tax estimate on annual profit (FY2024/25 rates). A planning
// ESTIMATE only — assumes no reliefs/allowances/group adjustments; the
// accountant's figure is authoritative. Small-profits 19% ≤ £50k; main 25% ≥
// £250k; marginal relief (3/200) between. Input/output integer pence.
const CT_SMALL_RATE = 0.19;
const CT_MAIN_RATE = 0.25;
const CT_LOWER_LIMIT_PENCE = 50_000_00;
const CT_UPPER_LIMIT_PENCE = 250_000_00;
const CT_MARGINAL_FRACTION = 3 / 200;
export function estimateCorporationTax(annualProfitPence = 0) {
    const profit = Math.max(0, Math.round(annualProfitPence));
    if (profit <= CT_LOWER_LIMIT_PENCE) return pence(profit * CT_SMALL_RATE);
    if (profit >= CT_UPPER_LIMIT_PENCE) return pence(profit * CT_MAIN_RATE);
    // Marginal relief band.
    return pence(profit * CT_MAIN_RATE - (CT_UPPER_LIMIT_PENCE - profit) * CT_MARGINAL_FRACTION);
}

// Free-cash decision — how much sits above a prudent operating buffer and is
// therefore deployable. Buffer = `bufferWeeks` of monthly outgoings. Pure pence.
// `lowestProjectedPence` is the lowest closing balance over the forecast; cash
// is only "free" once that low point clears the buffer.
export function freeCashDecision({ cashOnHandPence = 0, monthlyCostsPence = 0, lowestProjectedPence = null, bufferWeeks = 2 } = {}) {
    const bufferPence = pence((monthlyCostsPence * 12 / 52) * bufferWeeks);
    const freeAbsPence = Math.max(0, cashOnHandPence - bufferPence);
    const low = lowestProjectedPence == null ? cashOnHandPence : lowestProjectedPence;
    const lowClearsBuffer = low >= bufferPence;
    // Sweepable now only if the LOWEST projected point still clears the buffer.
    const sweepablePence = lowClearsBuffer ? Math.max(0, low - bufferPence) : 0;
    return {
        bufferPence,
        freeCashPence: freeAbsPence,
        sweepablePence,
        lowClearsBuffer,
        action: !lowClearsBuffer ? 'build_buffer' : sweepablePence > 0 ? 'sweep' : 'hold',
    };
}

export function calculateCashFlow(weeks) {
    return weeks.map(w => {
        const closing = w.openingBalancePence + w.receiptsPence - w.paymentsPence;
        let status = 'healthy';
        if (closing < 0)
            status = 'critical';
        else if (closing < w.openingBalancePence * 0.5)
            status = 'warning';
        return {
            weekStartDate: w.weekStartDate,
            opening: w.openingBalancePence,
            receipts: w.receiptsPence,
            payments: w.paymentsPence,
            closing,
            status,
        };
    });
}

export function calculateKPIs(input) {
    const leadToConsult = input.monthlyLeads > 0 ? (input.consultationsBooked / input.monthlyLeads) * 100 : 0;
    const consultToTreatment = input.consultationsAttended > 0 ? (input.treatmentsStarted / input.consultationsAttended) * 100 : 0;
    const leadToTreatment = input.monthlyLeads > 0 ? (input.treatmentsStarted / input.monthlyLeads) * 100 : 0;
    const monthlyRevenuePerLead = input.monthlyLeads > 0 ? pence(input.revenuePence / 12 / input.monthlyLeads) : 0;
    const netMarginPct = input.revenuePence > 0 ? (input.netProfitPence / input.revenuePence) * 100 : 0;
    const recurringRevenuePct = input.revenuePence > 0 ? (input.recurringRevenuePence / input.revenuePence) * 100 : 0;
    const totalPatients = input.activePatients + input.lapsedPatients;
    const retentionRatePct = totalPatients > 0 ? (input.activePatients / totalPatients) * 100 : 0;
    // Traffic light thresholds based on UK dental benchmarks
    const trafficLights = {
        leadToTreatment: leadToTreatment >= 18 ? 'green' :
            leadToTreatment >= 12 ? 'amber' : 'red',
        netMargin: netMarginPct >= 18 ? 'green' :
            netMarginPct >= 12 ? 'amber' : 'red',
        chairUtilisation: input.chairUtilisationPct >= 85 ? 'green' :
            input.chairUtilisationPct >= 70 ? 'amber' : 'red',
        ftaRate: input.ftaRatePct <= 5 ? 'green' :
            input.ftaRatePct <= 8 ? 'amber' : 'red',
        recall: input.recallCompliancePct >= 80 ? 'green' :
            input.recallCompliancePct >= 65 ? 'amber' : 'red',
        retention: retentionRatePct >= 80 ? 'green' :
            retentionRatePct >= 65 ? 'amber' : 'red',
    };
    return {
        leadToConsult: pct(leadToConsult),
        consultToTreatment: pct(consultToTreatment),
        leadToTreatment: pct(leadToTreatment),
        monthlyRevenuePerLead,
        netMarginPct: pct(netMarginPct, 2),
        recurringRevenuePct: pct(recurringRevenuePct),
        retentionRatePct: pct(retentionRatePct),
        trafficLights,
    };
}

// ============================================================================
// CAGR (Compound Annual Growth Rate)
// ============================================================================
export function calculateCAGR(startValue, endValue, years) {
    if (years <= 0 || startValue <= 0)
        return 0;
    return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

export function calculateLTV(input) {
    const lifetimeRevenue = input.averageAnnualSpendPence * input.averageRetentionYears;
    const lifetimeProfit = lifetimeRevenue * (input.netMarginPct / 100);
    return pence(lifetimeProfit);
}

// Patient LTV (lifetime net profit, in pence) derived from the saved Business
// Health baseline. The baseline stores `revenue`/`profit` in WHOLE POUNDS
// (business-health.service writes revenuePence/100), so they are scaled back to
// pence here. Inputs to calculateLTV are grounded, not assumed:
//   averageAnnualSpendPence = annual revenue / active patients
//   averageRetentionYears   = active patients / annual new patients   (Little's
//                             law: steady-state stock / inflow = mean tenure)
//   netMarginPct            = profit / revenue
// Returns 0 when the baseline lacks the patient counts needed (the LTV:CAC
// caller then hides the ratio rather than showing a divide-by-zero figure).
export function ltvFromBaseline(baseline) {
    if (!baseline) return 0;
    const activePatients = Number(baseline.active_patients) || 0;
    const newPerMonth = Number(baseline.new_per_month) || 0;
    const revenuePounds = Number(baseline.revenue) || 0;
    const profitPounds = Number(baseline.profit) || 0;
    if (activePatients <= 0 || newPerMonth <= 0 || revenuePounds <= 0) return 0;
    const averageAnnualSpendPence = (revenuePounds * 100) / activePatients;
    const averageRetentionYears = activePatients / (newPerMonth * 12);
    const netMarginPct = (profitPounds / revenuePounds) * 100;
    return calculateLTV({ averageAnnualSpendPence, averageRetentionYears, netMarginPct });
}

export function calculateMarketingROI(input) {
    return {
        costPerLeadPence: input.leads > 0 ? pence(input.spendPence / input.leads) : 0,
        costPerTreatmentPence: input.treatments > 0 ? pence(input.spendPence / input.treatments) : 0,
        roas: input.spendPence > 0 ? input.totalRevenuePence / input.spendPence : 0,
        conversionPct: input.leads > 0 ? pct((input.treatments / input.leads) * 100) : 0,
    };
}

// Revenue Leakage — "money left on the table". Five recoverable pools, each
// scaled by a recoverable-rate (0-100, the share you realistically claw back).
// All inputs/outputs are integer pence for the window passed in; annualisation
// is done by the caller (it knows the window length). Mirrors the GM demo's
// leakageModel but driven by real Dentally/payment rollups.
export const LEAKAGE_DEFAULT_RATES = { plans: 30, fta: 50, recall: 60, lapsed: 40, collect: 70 };
// Constants the demo bakes in: hygiene share of revenue feeding recall, and the
// lapsed-patient share of revenue. Overridable per call.
export const LEAKAGE_HYGIENE_SHARE = 0.12;
export const LEAKAGE_LAPSED_SHARE = 0.06;

export function calculateRevenueLeakage(input = {}, rates = {}) {
    const r = { ...LEAKAGE_DEFAULT_RATES, ...rates };
    const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    const {
        revenuePence = 0,
        presentedPlanPence = 0,
        acceptedPlanPence = 0,
        appointments = 0,
        noShows = 0,
        cashCollectedPence = 0,
        hygieneShare = LEAKAGE_HYGIENE_SHARE,
        lapsedShare = LEAKAGE_LAPSED_SHARE,
    } = input;
    const ftaRate = appointments > 0 ? noShows / appointments : 0;
    const lostPlanPence = Math.max(0, presentedPlanPence - acceptedPlanPence);
    const uncollectedPence = Math.max(0, revenuePence - cashCollectedPence);
    const pools = {
        plans: pence(lostPlanPence * clamp(r.plans)),
        fta: pence(revenuePence * ftaRate * clamp(r.fta)),
        recall: pence(revenuePence * hygieneShare * 0.25 * clamp(r.recall)),
        lapsed: pence(revenuePence * lapsedShare * clamp(r.lapsed)),
        collect: pence(uncollectedPence * clamp(r.collect)),
    };
    const windowTotalPence = pools.plans + pools.fta + pools.recall + pools.lapsed + pools.collect;
    return { pools, windowTotalPence, rates: r, ftaRatePct: pct(ftaRate * 100) };
}

export function calculateProgress(input) {
    if (!input.baseline || !input.target || input.baseline === input.target) {
        return { progressPct: 0, deltaFromBaselinePct: 0, remainingToTarget: 0 };
    }
    let progressPct;
    if (input.better === 'higher') {
        const total = input.target - input.baseline;
        const done = input.current - input.baseline;
        progressPct = total === 0 ? 100 : Math.max(0, Math.min(100, (done / total) * 100));
    }
    else {
        const total = input.baseline - input.target;
        const done = input.baseline - input.current;
        progressPct = total === 0 ? 100 : Math.max(0, Math.min(100, (done / total) * 100));
    }
    const deltaFromBaselinePct = ((input.current - input.baseline) / input.baseline) * 100;
    const remainingToTarget = input.target - input.current;
    return {
        progressPct: pct(progressPct),
        deltaFromBaselinePct: pct(deltaFromBaselinePct),
        remainingToTarget,
    };
}

// ===========================================================================
// Chair economics (GM Intelligence OS — Chair Efficiency view).
// Pure functions, integer pence. Group operating standards are documented
// constants here (FORMULAS.md §11); per-org overrides will live in a
// chair_config table (plan TODO2). All hour figures are annual.
// ===========================================================================

// Default group chair operating standards. benchRevHrPence = £300/chair-hour.
export const CHAIR_CONFIG = {
    openHrs: 8,          // surgery open hours per day
    weeksYr: 46,         // working weeks per year
    daysWk: 5,           // working days per week
    benchOccPct: 88,     // industry benchmark chair occupancy
    benchRevHrPence: 30000, // £300 revenue per chair-hour ceiling
};

/** Working days per year from a config (default 230). */
export function workDaysYr(config = CHAIR_CONFIG) {
    return config.weeksYr * config.daysWk;
}

// True chair economics: capacity vs booked, the cost of empty chairs, and the
// hours/£ recoverable to benchmark. `annualRevenuePence` is the entity's annual
// turnover; `utilPct` its current occupancy (0-100).
export function calculateChairStats(input) {
    const config = { ...CHAIR_CONFIG, ...(input.config || {}) };
    const chairs = Math.max(0, input.chairs || 0);
    const utilPct = Math.max(0, Math.min(100, input.utilPct || 0));
    const annualRevenuePence = Math.max(0, input.annualRevenuePence || 0);

    const capHrsYr = chairs * config.openHrs * workDaysYr(config);
    const bookedHrsYr = capHrsYr * utilPct / 100;
    const emptyHrsYr = capHrsYr - bookedHrsYr;
    // Yield per booked chair-hour. Prefer the owner-entered grid revenue
    // (revPerBookedHrPence override) — the manual source of truth — falling back
    // to deriving it from annual settled revenue / booked hours when not supplied.
    const revPerBookedHrPence = input.revPerBookedHrPence != null
        ? Math.max(0, Math.round(input.revPerBookedHrPence))
        : (bookedHrsYr > 0 ? pence(annualRevenuePence / bookedHrsYr) : 0);
    const revPotentialYrPence = pence(capHrsYr * config.benchRevHrPence);
    const lostPotentialYrPence = pence(emptyHrsYr * config.benchRevHrPence);
    // Hours to climb from current occupancy to benchmark (never negative).
    const recoverableToBenchHrsYr = Math.max(0, capHrsYr * (config.benchOccPct - utilPct) / 100);
    // Recovered revenue valued at the entity's OWN yield/hr, not the ceiling (conservative).
    const recoverRevYrPence = pence(recoverableToBenchHrsYr * revPerBookedHrPence);
    const surgeryDaysYr = chairs * workDaysYr(config);

    return {
        chairs,
        occupancyPct: pct(utilPct),
        capHrsYr: Math.round(capHrsYr),
        bookedHrsYr: Math.round(bookedHrsYr),
        emptyHrsYr: Math.round(emptyHrsYr),
        revPerBookedHrPence,
        revPotentialYrPence,
        lostPotentialYrPence,
        recoverableToBenchHrsYr: Math.round(recoverableToBenchHrsYr),
        recoverRevYrPence,
        surgeryDaysYr,
        occVariancePct: pct(utilPct - config.benchOccPct),
    };
}

// Operating cost per surgery per day / per hour. `annualOpexPence` is the fixed
// run cost (staff + premises + admin), EXCLUDING clinician pay, lab, marketing.
export function calculateOcpspd(input) {
    const config = { ...CHAIR_CONFIG, ...(input.config || {}) };
    const surgeryDaysYr = Math.max(0, input.surgeryDaysYr || 0);
    const annualOpexPence = Math.max(0, input.annualOpexPence || 0);
    const perDayPence = surgeryDaysYr > 0 ? pence(annualOpexPence / surgeryDaysYr) : 0;
    const perHrPence = config.openHrs > 0 ? pence(perDayPence / config.openHrs) : 0;
    return { perDayPence, perHrPence, surgeryDaysYr };
}

// Profit per chair-hour by treatment — the booking-priority ranking. Each input
// row: { key, label, minutes, units, revenuePence, profitPence }. Returns rows
// (descending profit/hr) + group totals. The one resource you can't make more of.
export function profitPerChairHour(input) {
    const rows = (input.treatments || [])
        .filter((t) => (t.units || 0) > 0 && (t.minutes || 0) > 0)
        .map((t) => {
            const hrs = (t.minutes * t.units) / 60;
            return {
                key: t.key,
                label: t.label,
                minutes: t.minutes,
                units: t.units,
                chairHrs: Math.round(hrs),
                revenuePence: pence(t.revenuePence || 0),
                profitPence: pence(t.profitPence || 0),
                revPerHrPence: hrs > 0 ? pence((t.revenuePence || 0) / hrs) : 0,
                profitPerHrPence: hrs > 0 ? pence((t.profitPence || 0) / hrs) : 0,
            };
        })
        .sort((a, b) => b.profitPerHrPence - a.profitPerHrPence);
    const totalHrs = rows.reduce((s, r) => s + (r.minutes * r.units) / 60, 0);
    const totalProfit = rows.reduce((s, r) => s + r.profitPence, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.revenuePence, 0);
    return {
        rows,
        totalChairHrs: Math.round(totalHrs),
        blendedProfitPerHrPence: totalHrs > 0 ? pence(totalProfit / totalHrs) : 0,
        blendedRevPerHrPence: totalHrs > 0 ? pence(totalRevenue / totalHrs) : 0,
    };
}

// Recovery engine: pick occupancy points to win back, see hours + revenue
// unlocked (valued at the entity's own yield/hr). upliftPctPoints is additive.
export function chairRecovery(input) {
    const capHrsYr = Math.max(0, input.capHrsYr || 0);
    const upliftPctPoints = Math.max(0, input.upliftPctPoints || 0);
    const revPerBookedHrPence = Math.max(0, input.revPerBookedHrPence || 0);
    const currentOccupancyPct = Math.max(0, Math.min(100, input.currentOccupancyPct || 0));
    // Cap uplift to the real headroom — you can't recover past 100% occupancy.
    // Without this, a fully-booked entity still shows phantom "revenue unlocked".
    const headroomPctPoints = Math.max(0, 100 - currentOccupancyPct);
    const effectiveUpliftPctPoints = Math.min(upliftPctPoints, headroomPctPoints);
    const recoveryHrsYr = capHrsYr * effectiveUpliftPctPoints / 100;
    return {
        recoveryHrsYr: Math.round(recoveryHrsYr),
        revenueUnlockedPence: pence(recoveryHrsYr * revPerBookedHrPence),
        newOccupancyPct: pct(Math.min(100, currentOccupancyPct + effectiveUpliftPctPoints)),
    };
}

// ===========================================================================
// Treatment Economics Workbench (GM Intelligence OS — Treatment Profitability).
// Pure function, integer pence. The full money flow for a flagship treatment:
// fee -> CBCT/lab/components -> gross -> clinician/marketing/run cost ->
// practice profit -> add back in-house margins -> net profit/case. Plus the
// target-price solver, max-ad/CAC, and principal-vs-associate planning.
// Drives the live workbench: the UI posts a model, this returns the figures
// (server-authoritative, no client formula duplication — Arch #3).
// ===========================================================================

// Seed defaults (pence). Owner-editable in the workbench; persisted overrides
// are a later slice. Documented in FORMULAS.md §12.
export const DEFAULT_SERVICE_MODELS = {
    fullarch: {
        key: 'fullarch', label: 'Full Arch', unit: 'case',
        pricePence: 1_000_000, cbctPence: 19_900, marketingPct: 10, utilitiesPence: 0,
        surgeryRunCostPence: 60_000, labBillPence: 350_000, labMarginPct: 30,
        dentistPct: 40, targetMarginPct: 35, surgeries: 1, casesPerSurgery: 2, implantsPerPatient: 1,
        components: [
            { name: 'Implant', qty: 4, retailPence: 21_000, costPence: 10_500 },
            { name: 'MUA', qty: 4, retailPence: 15_000, costPence: 7_500 },
            { name: 'Temp cylinder', qty: 4, retailPence: 5_500, costPence: 3_500 },
            { name: 'Healing cap', qty: 4, retailPence: 3_500, costPence: 2_000 },
            { name: 'Bridge components', qty: 1, retailPence: 78_000, costPence: 54_000 },
        ],
    },
    implant: {
        key: 'implant', label: 'Single Implant', unit: 'implant',
        pricePence: 205_000, cbctPence: 19_900, marketingPct: 10, utilitiesPence: 0,
        surgeryRunCostPence: 15_000, labBillPence: 0, labMarginPct: 0,
        dentistPct: 40, targetMarginPct: 35, surgeries: 1, casesPerSurgery: 20, implantsPerPatient: 2,
        components: [
            { name: 'Implant fixture', qty: 1, retailPence: 38_000, costPence: 21_000 },
            { name: 'Crown', qty: 1, retailPence: 20_000, costPence: 18_000 },
            { name: 'Consumables', qty: 1, retailPence: 12_000, costPence: 12_000 },
        ],
    },
    invisalign: {
        key: 'invisalign', label: 'Invisalign', unit: 'case',
        pricePence: 350_000, cbctPence: 0, marketingPct: 10, utilitiesPence: 15_000,
        surgeryRunCostPence: 15_000, labBillPence: 130_000, labMarginPct: 0,
        dentistPct: 40, targetMarginPct: 35, surgeries: 1, casesPerSurgery: 8, implantsPerPatient: 1,
        components: [
            { name: 'Attachments / composite', qty: 1, retailPence: 12_000, costPence: 4_000 },
            { name: 'IPR / bonding kit', qty: 1, retailPence: 6_000, costPence: 2_000 },
            { name: 'Vivera retainers', qty: 1, retailPence: 20_000, costPence: 9_000 },
        ],
    },
};

// Treatment Economics Workbench — real case-fee seeding from Dentally invoice
// items. A dental "case" is billed as MANY line items across visits (an implant
// = placement + abutment + crown), so the honest case fee = the average INVOICE
// total for invoices that contain the procedure, not a single line. Names are
// the practice's own Dentally catalog labels; these patterns matched the live
// data (e.g. "All-on-4 Surgery Single Arch", "Placement Of Implant",
// "Invisalign Comprehensive"). Keys match DEFAULT_SERVICE_MODELS.
export const TREATMENT_CASE_RULES = {
    fullarch: { match: /all[\s-]?on|full[\s-]?arch|arch surgery|hybrid bridge/i },
    implant: { match: /implant/i, not: /consult|review|x[\s-]?ray|radiograph|assess|planning|scan/i },
    invisalign: { match: /invisalign|clear[\s-]?aligner/i, not: /review/i },
};

// invoices: [{ names: string[], total_pence }]. Returns, per category, the mean
// invoice total across invoices containing a matching (and non-excluded) line,
// or null when there are no matches. Pure (no I/O) so it is unit-tested directly
// against real catalog names.
export function classifyCaseFees(invoices, rules = TREATMENT_CASE_RULES) {
    const acc = {};
    for (const key of Object.keys(rules)) acc[key] = { sum: 0, n: 0 };
    for (const inv of invoices || []) {
        const names = (inv.names || []).filter(Boolean);
        const total = Number(inv.total_pence) || 0;
        if (total <= 0 || names.length === 0) continue;
        for (const [key, r] of Object.entries(rules)) {
            const hit = names.some((nm) => r.match.test(nm) && !(r.not && r.not.test(nm)));
            if (hit) { acc[key].sum += total; acc[key].n += 1; }
        }
    }
    const out = {};
    for (const [key, a] of Object.entries(acc)) {
        out[key] = a.n > 0 ? { feePence: Math.round(a.sum / a.n), sampleSize: a.n } : null;
    }
    return out;
}

export function computeServiceEconomics(model) {
    const price = Math.max(0, model.pricePence || 0);
    const cbct = Math.max(0, model.cbctPence || 0);
    const utilities = Math.max(0, model.utilitiesPence || 0);
    const surgeryRunCost = Math.max(0, model.surgeryRunCostPence || 0);
    const labBill = Math.max(0, model.labBillPence || 0);
    const components = Array.isArray(model.components) ? model.components : [];

    const marketing = pence(price * (model.marketingPct || 0) / 100);
    const labProfit = pence(labBill * (model.labMarginPct || 0) / 100);
    const compRetail = components.reduce((s, c) => s + (c.retailPence || 0) * (c.qty || 0), 0);
    const compCost = components.reduce((s, c) => s + (c.costPence || 0) * (c.qty || 0), 0);
    const compProfit = compRetail - compCost;
    const directTreatmentCost = compCost + labBill;

    const grossBeforeDentist = Math.max(price - cbct - directTreatmentCost, 0);
    const dentistGross = pence((model.dentistPct || 0) / 100 * grossBeforeDentist);
    const practiceProfit = grossBeforeDentist - dentistGross - marketing - utilities - surgeryRunCost;
    const groupProfit = practiceProfit + compProfit + labProfit + cbct;
    const marginPct = price > 0 ? pct(groupProfit / price * 100) : 0;

    // Target-price solver: price that yields targetMarginPct at fixed costs.
    const contributionSlope = price > 0 ? (grossBeforeDentist - dentistGross) / price : 0;
    const fixedBase = -(cbct + directTreatmentCost + utilities + surgeryRunCost) + compProfit + labProfit + cbct;
    const targetMarginFrac = (model.targetMarginPct || 0) / 100;
    const targetPricePence = contributionSlope > targetMarginFrac
        ? pence(-fixedBase / (contributionSlope - targetMarginFrac)) : 0;
    // Most ad spend per case that still holds a 20% acquisition cost.
    const maxAdAt20Pence = pence(groupProfit + marketing - 0.2 * price);

    const monthlyCases = Math.max(0, (model.surgeries || 0) * (model.casesPerSurgery || 0));
    const ipp = Math.max(model.implantsPerPatient || 1, 1);
    const patients = model.unit === 'implant' ? Math.round(monthlyCases / ipp) : monthlyCases;
    const cacPence = pence(marketing * (model.unit === 'implant' ? ipp : 1));
    const monthlyRevenuePence = monthlyCases * price;
    const monthlyProfitPence = monthlyCases * groupProfit;
    const annualProfitPence = monthlyProfitPence * 12;

    return {
        key: model.key, label: model.label, unit: model.unit,
        pricePence: price, cbctPence: cbct, marketingPence: marketing, utilitiesPence: utilities,
        surgeryRunCostPence: surgeryRunCost, labBillPence: labBill, labProfitPence: labProfit,
        compRetailPence: compRetail, compCostPence: compCost, compProfitPence: compProfit,
        directTreatmentCostPence: directTreatmentCost,
        grossBeforeDentistPence: grossBeforeDentist, dentistGrossPence: dentistGross,
        practiceProfitPence: practiceProfit, groupProfitPence: groupProfit, marginPct,
        targetPricePence, maxAdAt20Pence, cacPence,
        monthlyCases, patients,
        monthlyRevenuePence, monthlyProfitPence, annualProfitPence,
        // Profit planning — who completes the work.
        associateProfitPence: groupProfit,
        principalProfitPence: groupProfit + dentistGross,
        principalUpliftPence: dentistGross,
        components: components.map((c) => ({
            name: c.name, qty: c.qty, retailPence: c.retailPence, costPence: c.costPence,
            profitPence: ((c.retailPence || 0) - (c.costPence || 0)) * (c.qty || 0),
        })),
    };
}

// ===========================================================================
// GROUP VALUATION — driver-based 3-buyer engine (Intelligence OS — Value &
// Growth view). Integer pence; server-authoritative (FORMULAS.md §13).
//
// VERSIONING: this is a NEW function alongside the legacy `calculateValuation`
// (§2), which is intentionally LEFT UNTOUCHED so its existing caller
// (GET /api/analytics/valuation) keeps producing identical numbers. The model
// below is the one the Value & Growth screen posts to. The two differ on EBITDA
// treatment by design: the legacy one fabricates EBITDA (profit + revenue*0.04)
// from the baseline; this one takes a REPORTED EBITDA and applies EXPLICIT
// owner-entered add-backs + a notional principal salary (no fabrication).
//
// All money inputs are pence; multiples/factors are plain numbers. Pure: the
// classification/region/tier tables live client-side (UI defaults + benchmark
// display) and the resolved multiples + region factor are passed in, so the
// formula is pure arithmetic with no enum coupling.
// ===========================================================================

// Growth premium applied to the DSO method: 10% YoY is neutral; +1pt of uplift
// per 5pts above (capped +20%), penalty below (floor -15%). Mirrors the shipped
// client model exactly so moving the compute server-side changes no output.
export function valuationGrowthAdjust(growthRatePct) {
    return 1 + Math.max(-0.15, Math.min(0.2, ((growthRatePct || 0) - 10) / 50));
}

export function computeGroupValuation(input) {
    const reportedEbitda = Math.round(input.reportedEbitdaPence || 0);
    const addBacks = Math.round(input.addBacksPence || 0);
    const principalSalary = Math.round(input.principalSalaryPence || 0);
    const principalMultiple = input.principalMultiple || 0;
    const associateMultiple = input.associateMultiple || 0;
    const dsoMultiple = input.dsoMultiple || 0;
    const regionFactor = input.regionFactor || 1;

    // Adjusted EBITDA (Associate/DSO basis) adds the notional principal salary
    // back — clinical work is covered by associates. ANP (Principal-led basis)
    // does not — the owner-buyer funds their own clinical work out of it.
    const associateEbitda = reportedEbitda + addBacks + principalSalary;
    const principalNetProfit = reportedEbitda + addBacks;
    const growthAdjust = valuationGrowthAdjust(input.growthRatePct);

    const principalValuation = pence(principalNetProfit * principalMultiple * regionFactor);
    const associateValuation = pence(associateEbitda * associateMultiple * regionFactor);
    const dsoValuation = pence(associateEbitda * dsoMultiple * regionFactor * growthAdjust);
    const midpoint = pence((associateValuation + principalValuation) / 2);
    const strategic = pence(dsoValuation * 1.1); // 10% earn-out / platform uplift

    return {
        reportedEbitda, associateEbitda, principalNetProfit,
        principalValuation, associateValuation, dsoValuation,
        midpoint, strategic,
        regionFactor, growthAdjust: pct(growthAdjust, 4),
    };
}

// Value-uplift levers — each line is the £ added to a headline figure if the
// owner pulls that lever today, ranked by impact. Pure: derived from an already
// computed valuation result + the resolved multiples. Pence. Mirrors the
// shipped client levers (amounts are EBITDA deltas × multiple, etc.).
export function valueUpliftLevers({ result, principalMultiple, associateMultiple, dsoMultiple }) {
    const avgMultiple = ((principalMultiple || 0) + (associateMultiple || 0) + (dsoMultiple || 0)) / 3;
    const levers = [
        { key: 'growth', label: 'Increase growth rate to 15% (DSO buyers love this)', impactPence: pence(result.dsoValuation * 0.1) },
        { key: 'lab_cost', label: 'Cut lab cost from 18% to 15% target (+£50k EBITDA)', impactPence: pence(5_000_000 * avgMultiple) },
        { key: 'add_backs', label: 'Identify £30k more legitimate add-backs', impactPence: pence(3_000_000 * avgMultiple) },
        { key: 'second_site', label: 'Add second site (scale into DSO interest zone)', impactPence: pence(result.dsoValuation * 0.15) },
        { key: 'private_mix', label: 'Shift to private/mixed (+0.5x multiple)', impactPence: pence(0.5 * result.associateEbitda) },
        { key: 'recurring', label: 'Add £100k recurring private revenue at 35% margin', impactPence: pence(3_500_000 * avgMultiple) },
    ];
    return levers.sort((a, b) => b.impactPence - a.impactPence);
}

// Sale Planner trajectory — model a target exit and the path to reach it. Pure;
// integer pence. `baselinePence` is today's midpoint (passed from the valuation
// result so the formula isn't duplicated). The advisory `focus`/action copy per
// year is intentionally NOT here — it's UI text, computed client-side from these
// numbers. Mirrors the shipped client planner math.
export function planExitTrajectory({ base, plan, baselinePence, principalSalaryPence = 0 }) {
    const ttmRevenue = Math.round(base?.ttmRevenuePence || 0);
    const reportedEbitda = Math.round(base?.reportedEbitdaPence || 0);
    const targetValue = Math.round(plan?.targetValuePence || 0);
    const targetYears = Math.max(1, Math.round(plan?.targetYears || 1));
    const futureEbitda = Math.round(plan?.futureEbitdaPence || 0);
    const futureRevenue = Math.round(plan?.futureRevenuePence || 0);
    const futureMultiple = plan?.futureMultiple || 0;
    const buyer = plan?.futureBuyerType || 'associate';
    const addedSites = Math.max(0, Math.round(plan?.addedSites || 0));
    const siteCount = Math.max(0, Math.round(plan?.siteCount || 0));
    const baseline = Math.round(baselinePence || 0);

    const totalSites = siteCount + addedSites;
    const dsoPremium = (s) => (buyer === 'dso' && s >= 10 ? 1.1 : 1);
    const projected = pence(
        (buyer === 'principal' ? futureEbitda - principalSalaryPence : futureEbitda)
        * futureMultiple * dsoPremium(totalSites),
    );

    const gap = Math.max(0, targetValue - baseline);
    const cagrNeededPct = baseline > 0 && targetYears > 0
        ? pct((Math.pow(targetValue / baseline, 1 / targetYears) - 1) * 100, 2) : 0;
    const ebitdaNeededPence = futureMultiple > 0 ? pence(targetValue / futureMultiple) : 0;
    const ebitdaMarginPct = futureRevenue > 0 ? pct((futureEbitda / futureRevenue) * 100, 2) : 0;
    const currentEbitdaMarginPct = ttmRevenue > 0 ? pct((reportedEbitda / ttmRevenue) * 100, 2) : 0;
    const revenueGrowthPct = ttmRevenue > 0 ? pct((futureRevenue / ttmRevenue - 1) * 100, 2) : 0;

    const years = [];
    for (let i = 0; i <= targetYears; i++) {
        const t = i / targetYears;
        const revPence = pence(ttmRevenue + (futureRevenue - ttmRevenue) * t);
        const ebitdaPence = pence(reportedEbitda + (futureEbitda - reportedEbitda) * t);
        const sites = Math.round(siteCount + (totalSites - siteCount) * t);
        const marginPct = revPence > 0 ? pct((ebitdaPence / revPence) * 100, 2) : 0;
        const valYearPence = pence(ebitdaPence * futureMultiple * dsoPremium(sites));
        years.push({ year: i, revPence, ebitdaPence, sites, marginPct, valYearPence });
    }

    return {
        projectedPence: projected,
        baselinePence: baseline,
        gapPence: gap,
        cagrNeededPct,
        ebitdaNeededPence,
        ebitdaMarginPct,
        currentEbitdaMarginPct,
        revenueGrowthPct,
        totalSites,
        years,
    };
}

// ── M&A Acquisition Modeller (buy-side, DentaCFO gap Phase 3) ───────────────
// Model a practice you are considering BUYING: enterprise value, NPV, IRR,
// payback and debt capacity, scored against UK dental M&A benchmarks. Pure
// compute, integer pence in/out. Ports the GM demo's `mnaCalc` faithfully
// (EBITDA × multiple = EV; EBITDA grown at g as annual cashflow; EV grown at g
// as the terminal exit; discounted at d) and adds buy-side red flags.
export const ACQUISITION_BENCHMARKS = {
    leverageMultiple: 3.5, // supportable acquisition debt × EBITDA (UK dental 3-4×)
    targetIrrPct: 20, // buy-side hurdle 20-25%
    maxPaybackYears: 6, // 4-6 yrs is normal
    maxMultiple: 10, // established groups 7-10×; PE-backed 8-12×; >10 = rich
    minMarginPct: 12, // thin EBITDA margin below this
    maxLeverageMultiple: 4, // lending norm ceiling
};

export function calculateAcquisition(input = {}) {
    const {
        targetRevenuePence = 0,
        marginPct = 0,
        multiple = 0,
        growthPct = 0,
        horizonYears = 5,
        discountPct = 0,
        leverageMultiple = ACQUISITION_BENCHMARKS.leverageMultiple,
        askingPricePence = null,
    } = input;
    const H = Math.max(1, Math.round(horizonYears));
    const g = growthPct / 100;
    const d = discountPct / 100;

    const ebitdaPence = pence(targetRevenuePence * marginPct / 100);
    const evPence = pence(ebitdaPence * multiple);
    const debtCapacityPence = pence(ebitdaPence * leverageMultiple);
    const equityRequiredPence = Math.max(0, evPence - debtCapacityPence);

    // Annual cashflow = EBITDA grown at g; terminal = EV grown at g (exit at the
    // entry multiple). NPV(r) discounts both back to today against the EV outlay.
    const cf = (t) => ebitdaPence * Math.pow(1 + g, t);
    const terminalPence = evPence * Math.pow(1 + g, H);
    const npvAt = (r) => {
        let v = -evPence;
        for (let t = 1; t <= H; t++) v += cf(t) / Math.pow(1 + r, t);
        v += terminalPence / Math.pow(1 + r, H);
        return v;
    };
    const npvPence = pence(npvAt(d));

    // IRR via bisection — only solvable when the deal is value-positive at r=0.
    let irrPct = null;
    if (npvAt(0) > 0) {
        let lo = 0;
        let hi = 2;
        for (let i = 0; i < 80; i++) {
            const mid = (lo + hi) / 2;
            if (npvAt(mid) > 0) lo = mid;
            else hi = mid;
        }
        irrPct = pct(((lo + hi) / 2) * 100, 2);
    }

    // Payback — undiscounted cumulative cashflow to recover the EV outlay.
    let paybackYears = null;
    let cum = 0;
    for (let t = 1; t <= 80; t++) {
        const prev = cum;
        cum += cf(t);
        if (cum >= evPence) {
            paybackYears = pct((t - 1) + (evPence - prev) / cf(t), 2);
            break;
        }
    }

    // Asking-price gap (optional) — how the seller's price compares to modelled EV.
    const premiumPence = askingPricePence == null ? null : pence(askingPricePence - evPence);
    const premiumPct = (askingPricePence == null || evPence === 0)
        ? null
        : pct((askingPricePence - evPence) / evPence * 100, 2);

    // Buy-side red flags.
    const b = ACQUISITION_BENCHMARKS;
    const flags = [];
    if (npvPence < 0) flags.push({ key: 'npv', severity: 'high', message: 'Negative NPV — value destroyed at this entry price.' });
    if (irrPct == null) flags.push({ key: 'irr', severity: 'high', message: 'No positive IRR — returns never recover the entry price.' });
    else if (irrPct < discountPct) flags.push({ key: 'irr', severity: 'high', message: `IRR ${irrPct}% is below the ${discountPct}% hurdle.` });
    if (paybackYears == null) flags.push({ key: 'payback', severity: 'medium', message: 'Payback beyond 80 years — EV never recovered.' });
    else if (paybackYears > b.maxPaybackYears) flags.push({ key: 'payback', severity: 'medium', message: `Payback ${paybackYears} yrs exceeds the ${b.maxPaybackYears}-yr norm.` });
    if (multiple > b.maxMultiple) flags.push({ key: 'multiple', severity: 'medium', message: `${multiple}× is above the 7-10× bolt-on range.` });
    if (leverageMultiple > b.maxLeverageMultiple) flags.push({ key: 'leverage', severity: 'medium', message: `${leverageMultiple}× leverage exceeds the 3-4× lending norm.` });
    if (marginPct < b.minMarginPct) flags.push({ key: 'margin', severity: 'medium', message: `${marginPct}% EBITDA margin is thin for a dental practice.` });
    if (premiumPct != null && premiumPct > 10) flags.push({ key: 'asking', severity: 'high', message: `Asking price is ${premiumPct}% above modelled EV.` });

    return {
        ebitdaPence,
        evPence,
        debtCapacityPence,
        equityRequiredPence,
        terminalPence: pence(terminalPence),
        npvPence,
        irrPct,
        paybackYears,
        premiumPence,
        premiumPct,
        horizonYears: H,
        leverageMultiple,
        benchmarks: b,
        flags,
    };
}

// ── Exit Plan — personal wealth / FIRE (DentaCFO gap Phase 4) ────────────────
// The owner's PERSONAL exit, not the business sale (that is the Sale Planner,
// `planExitTrajectory`). Two pure pence calculators:
//   1. calculateSaleWaterfall — what the owner NETS in cash from selling their
//      practice equity: debt cleared, equity split by ownership %, UK CGT with
//      Business Asset Disposal Relief, plus freehold proceeds.
//   2. calculateFirePlan — does net worth (incl. that sale cash) clear the FIRE
//      number (the "4% rule": annual spend / withdrawal rate = pot needed), and
//      the compounding path to get there.
//
// UK_TAX is the 2026/27 capital-gains position (England). BADR rate rose to 14%
// (6 Apr 2025) then 18% (6 Apr 2026); the lifetime cap is £1m of qualifying
// gains. Gains above the cap fall to the main higher CGT rate (24% on non-
// residential since 30 Oct 2024). Rates/cap are inputs-with-defaults so the
// accountant can re-point them in one place when the Budget moves.
export const UK_TAX = {
    badrRatePct: 18, // Business Asset Disposal Relief, 2026/27
    badrLifetimeCapPence: 100_000_000, // £1,000,000 lifetime qualifying gains
    cgtHigherRatePct: 24, // main higher CGT rate above the BADR cap
};

export const FIRE_DEFAULTS = {
    withdrawalRatePct: 4, // the "4% rule" → 25× annual spend
    growthRatePct: 7, // assumed net real growth on the invested pot
    horizonYears: 10,
    maxSolveYears: 50, // cap when solving years-to-FIRE so it always terminates
};

// What the owner personally banks from a practice sale. Pure; integer pence.
//   enterpriseValuePence  business EV (e.g. the live valuation midpoint)
//   businessDebtPence     company debt cleared from EV at completion
//   ownerSharePct         this owner's equity share (0–100; co-owners take rest)
//   acquisitionCostPence  owner's original base cost (for the chargeable gain)
//   freeholdEquityPence   owner's freehold equity sold alongside, already net of
//                         its own mortgage and any property-specific tax — added
//                         straight to net cash (kept simple; flagged in UI)
//   badrLifetimeUsedPence BADR lifetime allowance the owner has already consumed
export function calculateSaleWaterfall(input = {}) {
    const {
        enterpriseValuePence = 0,
        businessDebtPence = 0,
        ownerSharePct = 100,
        acquisitionCostPence = 0,
        freeholdEquityPence = 0,
        badrLifetimeUsedPence = 0,
        badrRatePct = UK_TAX.badrRatePct,
        cgtHigherRatePct = UK_TAX.cgtHigherRatePct,
        badrLifetimeCapPence = UK_TAX.badrLifetimeCapPence,
    } = input;

    const share = Math.min(100, Math.max(0, ownerSharePct)) / 100;
    const equityValuePence = Math.max(0, pence(enterpriseValuePence) - pence(businessDebtPence));
    const ownerEquityProceedsPence = pence(equityValuePence * share);
    const ownerGainPence = Math.max(0, ownerEquityProceedsPence - pence(acquisitionCostPence));

    // BADR taxes qualifying gains up to the remaining lifetime cap at the BADR
    // rate; the excess falls to the main higher CGT rate.
    const badrCapRemainingPence = Math.max(0, pence(badrLifetimeCapPence) - pence(badrLifetimeUsedPence));
    const badrGainPence = Math.min(ownerGainPence, badrCapRemainingPence);
    const standardGainPence = Math.max(0, ownerGainPence - badrGainPence);
    const cgtPence = pence(badrGainPence * (badrRatePct / 100) + standardGainPence * (cgtHigherRatePct / 100));
    const effectiveCgtPct = ownerGainPence > 0 ? pct((cgtPence / ownerGainPence) * 100, 2) : 0;

    const netBusinessProceedsPence = ownerEquityProceedsPence - cgtPence;
    const totalNetProceedsPence = netBusinessProceedsPence + pence(freeholdEquityPence);

    return {
        equityValuePence,
        ownerEquityProceedsPence,
        ownerGainPence,
        badrGainPence,
        standardGainPence,
        cgtPence,
        effectiveCgtPct,
        netBusinessProceedsPence,
        freeholdEquityPence: pence(freeholdEquityPence),
        totalNetProceedsPence,
    };
}

// Personal FIRE projection. Pure; integer pence.
//   liquidAssetsPence        marketable personal assets (pensions + ISA + cash +
//                            investments) — NOT the primary residence
//   liabilitiesPence         total personal liabilities
//   businessNetProceedsPence net cash the business would realise on exit (from
//                            calculateSaleWaterfall.totalNetProceedsPence)
//   targetAnnualSpendPence   desired post-exit annual income
//   withdrawalRatePct        safe withdrawal rate (4% → 25× pot)
//   growthRatePct            assumed net growth on net worth
//   annualSavingsPence       amount added to the pot each year
//   horizonYears             planning window for the path + required-savings solve
export function calculateFirePlan(input = {}) {
    const {
        liquidAssetsPence = 0,
        liabilitiesPence = 0,
        businessNetProceedsPence = 0,
        targetAnnualSpendPence = 0,
        withdrawalRatePct = FIRE_DEFAULTS.withdrawalRatePct,
        growthRatePct = FIRE_DEFAULTS.growthRatePct,
        annualSavingsPence = 0,
        horizonYears = FIRE_DEFAULTS.horizonYears,
    } = input;

    const wr = Math.max(0.01, withdrawalRatePct) / 100; // guard /0
    const g = growthRatePct / 100;
    const H = Math.max(1, Math.round(horizonYears));
    const savings = pence(annualSavingsPence);

    const currentNetWorthPence = pence(liquidAssetsPence) + pence(businessNetProceedsPence) - pence(liabilitiesPence);
    const fireNumberPence = pence(targetAnnualSpendPence / wr);
    const gapPence = Math.max(0, fireNumberPence - currentNetWorthPence);
    const progressPct = fireNumberPence > 0 ? pct((currentNetWorthPence / fireNumberPence) * 100, 1) : 0;
    // What 4% of today's net worth would yield — the "are you there yet" income.
    const sustainableAnnualIncomePence = pence(currentNetWorthPence * wr);

    // Net worth at year y: pot compounds at g; each year's savings compound too
    // (future value of an ordinary annuity). g==0 degrades to the linear sum.
    const nwAt = (y) => {
        const grown = currentNetWorthPence * Math.pow(1 + g, y);
        const fvSavings = g === 0 ? savings * y : savings * ((Math.pow(1 + g, y) - 1) / g);
        return pence(grown + fvSavings);
    };

    const years = [];
    for (let y = 0; y <= H; y++) {
        const nwPence = nwAt(y);
        years.push({ year: y, nwPence, hitFire: nwPence >= fireNumberPence });
    }

    // Years until net worth first clears the FIRE number (capped so it always
    // terminates); null if not reached within the cap.
    let yearsToFire = null;
    for (let y = 0; y <= FIRE_DEFAULTS.maxSolveYears; y++) {
        if (nwAt(y) >= fireNumberPence) { yearsToFire = y; break; }
    }

    // Annual savings needed to hit the FIRE number by the horizon, given growth.
    // Solve fireNumber = currentNW*(1+g)^H + s * annuityFactor for s, floored 0.
    const annuityFactor = g === 0 ? H : (Math.pow(1 + g, H) - 1) / g;
    const potFromGrowthPence = currentNetWorthPence * Math.pow(1 + g, H);
    const requiredAnnualSavingsPence = annuityFactor > 0
        ? Math.max(0, pence((fireNumberPence - potFromGrowthPence) / annuityFactor)) : 0;

    return {
        currentNetWorthPence,
        fireNumberPence,
        gapPence,
        progressPct,
        sustainableAnnualIncomePence,
        targetAnnualSpendPence: pence(targetAnnualSpendPence),
        withdrawalRatePct,
        growthRatePct,
        annualSavingsPence: savings,
        horizonYears: H,
        yearsToFire,
        requiredAnnualSavingsPence,
        years,
    };
}

// ── Exit Plan — personal endgame (faithful port of the GM demo `exitCalc`) ───
// "The income you want to retire on → the 4%-rule pot it demands → what the
// freehold rent + business sale cover → exactly what to grow the group to."
// This is the canonical DentaCFO Exit Plan (preview/GM-Group-Intelligence-OS_2
// `exitCalc`), NOT the generic calculateFirePlan above. Money is INTEGER PENCE.

// UK income tax 2025/26 (accountant-repointable). Pence. The personal allowance
// tapers £1 for every £2 of income over £100,000.
export const UK_INCOME_TAX = {
    personalAllowancePence: 1_257_000,   // £12,570
    taperThresholdPence: 10_000_000,     // £100,000
    // [upperLimitPence, ratePct] — limits are absolute income thresholds.
    bands: [
        [5_027_000, 20],                 // basic rate to £50,270
        [12_514_000, 40],                // higher rate to £125,140
        [Infinity, 45],                  // additional rate
    ],
};

export const EXIT_PLAN_DEFAULTS = {
    baseYear: 2026,
    withdrawPct: 4,      // safe withdrawal rate (the 4% rule)
    returnPct: 8,        // assumed investment return
    agentPct: 1.5,       // sale agent / broker fee
    cgtPct: 18,          // capital gains tax on the sale (BADR default)
    projectionYears: 30, // drawdown projection horizon
};

// UK income tax due on a GROSS income (integer pence in, integer pence out).
export function ukIncomeTaxPence(grossPence) {
    const g = Math.max(0, Math.round(grossPence));
    let pa = UK_INCOME_TAX.personalAllowancePence;
    if (g > UK_INCOME_TAX.taperThresholdPence) {
        pa = Math.max(0, pa - Math.floor((g - UK_INCOME_TAX.taperThresholdPence) / 2));
    }
    let tax = 0, lower = pa;
    for (const [lim, rate] of UK_INCOME_TAX.bands) {
        if (g > lower) { tax += (Math.min(g, lim) - lower) * (rate / 100); lower = lim; }
        if (g <= lim) break;
    }
    return Math.round(tax);
}

// Gross income required to take home `netPence` after UK income tax (bisection).
export function grossUpPence(netPence) {
    const net = Math.max(0, Math.round(netPence));
    if (net <= 0) return 0;
    let lo = net, hi = net * 3;
    for (let i = 0; i < 80; i++) {
        const m = (lo + hi) / 2;
        if (m - ukIncomeTaxPence(m) < net) lo = m; else hi = m;
    }
    return Math.round((lo + hi) / 2);
}

// The Exit Plan. All money is INTEGER PENCE; ages/percents are plain numbers.
//   incomePence        desired POST-TAX annual income to retire on
//   people[]           { name, share } — splitting income across earners, each
//                      using their own allowance/bands, cuts the gross required
//   currentAge, retireAge
//   freeholds[]        { name, valuePence, rentPence } — rent offsets the pot
//   withdrawPct        safe withdrawal rate (4% rule sizes the pot)
//   returnPct          investment return for the 30-year drawdown projection
//   currentValuePence  group value today (live valuation midpoint or override)
//   agentPct, cgtPct   sale costs; baseCostPence = CGT-free cost base
//   existingInvestPence already-invested capital added to sale proceeds
//   targetSalePence    planned sale price (0 → defaults to requiredSale)
//   baseYear           year-0 of the projection (current year)
export function calculateExitPlan(input = {}) {
    const D = EXIT_PLAN_DEFAULTS;
    const {
        incomePence = 0,
        people = [{ name: 'You', share: 1 }],
        currentAge = 45,
        retireAge = 57,
        freeholds = [],
        withdrawPct = D.withdrawPct,
        returnPct = D.returnPct,
        currentValuePence = 0,
        agentPct = D.agentPct,
        cgtPct = D.cgtPct,
        baseCostPence = 0,
        existingInvestPence = 0,
        targetSalePence = 0,
        baseYear = D.baseYear,
    } = input;

    const annualNetPence = Math.max(0, Math.round(incomePence));
    const years = Math.max(0, Math.round(retireAge) - Math.round(currentAge));
    const exitYear = baseYear + years;

    // Income split across people — each share grossed up under its own allowance.
    const pplIn = (people && people.length ? people : [{ name: 'You', share: 1 }]);
    const shareSum = pplIn.reduce((s, p) => s + (p.share > 0 ? p.share : 0), 0) || 1;
    const ppl = pplIn.map((p) => {
        const netPence = Math.round(annualNetPence * (p.share > 0 ? p.share : 0) / shareSum);
        const grossPence = grossUpPence(netPence);
        return { name: p.name || '—', netPence, grossPence, taxPence: grossPence - netPence };
    });
    const grossRequiredPence = ppl.reduce((s, p) => s + p.grossPence, 0);
    const singleGrossPence = grossUpPence(annualNetPence);
    const taxSavingPence = Math.max(0, singleGrossPence - grossRequiredPence);

    const totalRentPence = freeholds.reduce((s, f) => s + Math.max(0, Math.round(f.rentPence || 0)), 0);
    const totalFreeholdPence = freeholds.reduce((s, f) => s + Math.max(0, Math.round(f.valuePence || 0)), 0);

    // Pot only has to cover the gross left AFTER freehold rent. 4% rule sizes it.
    const portfolioGrossPence = Math.max(0, grossRequiredPence - totalRentPence);
    const wr = Math.max(0.01, withdrawPct) / 100;
    const potNeededPence = Math.round(portfolioGrossPence / wr);
    const requiredNetPence = Math.max(0, potNeededPence - Math.round(existingInvestPence));

    // Reverse-solve the sale price that nets `requiredNet` after agent + CGT.
    const a = agentPct / 100, c = cgtPct / 100;
    const denom = Math.max(0.01, 1 - a - c);
    const requiredSalePence = Math.max(0, Math.round((requiredNetPence - c * Math.round(baseCostPence)) / denom));
    const reqGrowthPct = (years > 0 && currentValuePence > 0)
        ? pct((Math.pow(requiredSalePence / currentValuePence, 1 / years) - 1) * 100, 2) : 0;

    // Forward waterfall on the planned target (defaults to the required sale).
    const targetSale = targetSalePence > 0 ? Math.round(targetSalePence) : requiredSalePence;
    const agentFeePence = Math.round(targetSale * a);
    const cgtPence = Math.max(0, Math.round((targetSale - Math.round(baseCostPence)) * c));
    const netProceedsPence = targetSale - agentFeePence - cgtPence;
    const investablePence = netProceedsPence + Math.round(existingInvestPence);
    const gapPence = potNeededPence - investablePence;
    const targetGrowthPct = (years > 0 && currentValuePence > 0)
        ? pct((Math.pow(targetSale / currentValuePence, 1 / years) - 1) * 100, 2) : 0;

    // 30-year drawdown: pot grows at return%, draws withdraw% each year. With
    // return > withdrawal the pot AND the income compound upward — never depletes.
    const r = returnPct / 100;
    const projection = [];
    let pot = investablePence;
    for (let t = 0; t <= D.projectionYears; t++) {
        const incomeP = Math.round(pot * wr);
        const growP = Math.round(pot * r);
        const endP = Math.round(pot * (1 + r) - incomeP);
        projection.push({ year: exitYear + t, age: Math.round(retireAge) + t, startPence: Math.round(pot), growthPence: growP, incomePence: incomeP, endPence: endP });
        pot = pot * (1 + r) - incomeP;
    }

    const onTrack = gapPence <= Math.max(100_000, Math.round(potNeededPence * 0.003));

    return {
        annualNetPence, years, exitYear,
        people: ppl, grossRequiredPence, singleGrossPence, taxSavingPence,
        totalRentPence, totalFreeholdPence, portfolioGrossPence,
        potNeededPence, requiredNetPence, requiredSalePence, reqGrowthPct,
        targetSalePence: targetSale, agentFeePence, cgtPence, netProceedsPence,
        investablePence, gapPence, targetGrowthPct, onTrack,
        withdrawPct, returnPct, projection,
    };
}

// ── Attrition & Retention (DentaCFO Phase 6) ────────────────────────────────
// reactivationRate = the share of LAPSED patients (12-24mo since last visit) a
// recall campaign realistically wins back. Dormant patients (>24mo) are treated
// as largely gone and are NOT in the reactivation pool. Accountant-repointable.
export const RETENTION_DEFAULTS = { reactivationRate: 0.25 };

// Patient retention / attrition economics. Cohorts are integer patient counts
// (active <12mo, lapsed 12-24mo, dormant >24mo since last visit). avgPatient
// value is integer pence (trailing-12mo revenue per active patient). Returns the
// retention/attrition rates plus the recoverable reactivation revenue pool —
// lapsed patients x avg value x recovery rate. Pure; no DB, integer pence.
export function calculateRetention({ active = 0, lapsed = 0, dormant = 0 } = {}, { avgPatientValuePence = 0, reactivationRate = RETENTION_DEFAULTS.reactivationRate } = {}) {
    const a = Math.max(0, Math.round(active));
    const l = Math.max(0, Math.round(lapsed));
    const d = Math.max(0, Math.round(dormant));
    const known = a + l + d;
    // Retention = active share of the entire ever-seen patient base. Attrition is
    // its complement (lapsed + dormant as a share of all known patients).
    const retentionRatePct = known > 0 ? Math.round((a / known) * 1000) / 10 : 0;
    const attritionRatePct = known > 0 ? Math.round(((l + d) / known) * 1000) / 10 : 0;
    const rate = Math.min(1, Math.max(0, reactivationRate));
    const avg = Math.max(0, Math.round(avgPatientValuePence));
    const reactivatablePatients = Math.round(l * rate);
    const reactivationValuePence = Math.round(l * avg * rate);
    return {
        activePatients: a,
        lapsedPatients: l,
        dormantPatients: d,
        knownPatients: known,
        retentionRatePct,
        attritionRatePct,
        reactivationRate: rate,
        avgPatientValuePence: avg,
        reactivatablePatients,
        reactivationValuePence,
    };
}

// Per-practice breakeven and profit (Daily Command Cockpit — §6 Profit vs
// Breakeven). Pure; integer pence.
//
// THE MARGIN. contributionMargin is fixed/breakevenMid, NOT 1 - fixed/breakevenMid.
// At breakeven, revenue covers fixed + variable, so variable/revenue =
// 1 - fixed/breakeven — that quantity is the VARIABLE-COST RATIO, and what's
// left over, fixed/breakeven, is the contribution margin. The source mockup
// used the variable ratio as the margin (0.629 instead of 0.371); with
// £31k fixed and £83.5k breakeven that reports a group £4,050/day better than
// reality and flips practices from below to above breakeven.
//
// The identity breakevenDay === breakevenMid/workingDays is the check that the
// margin is right: fixedDay/margin = (fixed/wd)/(fixed/mid) = mid/wd. This
// REDUCES to that identity within +/-1p: fixedDay is itself a rounded pence
// value (fixed/workingDaysPerMonth), so breakevenDay = pence(fixedDay/margin)
// can differ from round(mid/wd) by a penny when fixed doesn't divide evenly
// across the month. The mockup's own £2,464/day implied a £49,280/mo
// breakeven, contradicting the £81-86k/mo it stated two lines earlier.
//
// NULLS, NOT ZEROS. Without a usable model every derived figure — including
// breakevenMidPence — is null and status is 'not_set'. A practice with no cost
// model has not made £0 profit — we simply cannot say, and £0 would drag a
// group total down with a fiction.
export function calculateBreakeven({
    revenuePence = 0,
    fixedCostPenceMonth = 0,
    breakevenLowPence = 0,
    breakevenHighPence = 0,
    workingDaysPerMonth = 20,
    workingDaysInWindow = 0,
} = {}) {
    const breakevenMidPence = Math.round((breakevenLowPence + breakevenHighPence) / 2);

    // margin = fixed/mid must land in (0, 1]. mid < fixed would mean revenue has
    // to cover more than 100% contribution — a bad input, not a great practice.
    const usable =
        fixedCostPenceMonth > 0 &&
        breakevenMidPence > 0 &&
        fixedCostPenceMonth <= breakevenMidPence &&
        workingDaysPerMonth > 0;

    if (!usable) {
        return {
            breakevenMidPence: null,
            contributionMarginPct: null,
            fixedDayPence: null,
            breakevenDayPence: null,
            contributionPence: null,
            fixedPence: null,
            profitPence: null,
            status: 'not_set',
        };
    }

    const margin = fixedCostPenceMonth / breakevenMidPence;
    const fixedDayPence = pence(fixedCostPenceMonth / workingDaysPerMonth);
    const breakevenDayPence = pence(fixedDayPence / margin);
    const contributionPence = pence(revenuePence * margin);
    const fixedPence = pence(fixedDayPence * workingDaysInWindow);
    const profitPence = contributionPence - fixedPence;

    return {
        breakevenMidPence,
        contributionMarginPct: pct(margin * 100, 2),
        fixedDayPence,
        breakevenDayPence,
        contributionPence,
        fixedPence,
        profitPence,
        status: profitPence >= 0 ? 'above' : 'below',
    };
}

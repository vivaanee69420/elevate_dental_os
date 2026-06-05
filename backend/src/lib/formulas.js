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
    const revPerBookedHrPence = bookedHrsYr > 0 ? pence(annualRevenuePence / bookedHrsYr) : 0;
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
    const recoveryHrsYr = capHrsYr * upliftPctPoints / 100;
    return {
        recoveryHrsYr: Math.round(recoveryHrsYr),
        revenueUnlockedPence: pence(recoveryHrsYr * revPerBookedHrPence),
        newOccupancyPct: pct(Math.min(100, currentOccupancyPct + upliftPctPoints)),
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

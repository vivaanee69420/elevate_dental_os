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

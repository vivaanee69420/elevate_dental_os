"use strict";
// ============================================================================
// FINANCIAL FORMULAS — Pure functions, fully tested
// ============================================================================
// ALL monetary values are INTEGER PENCE. Never floats.
// All functions are pure — same input always returns same output.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPounds = exports.pct = exports.pence = void 0;
exports.calculatePL = calculatePL;
exports.calculateValuation = calculateValuation;
exports.calculateAssociatePay = calculateAssociatePay;
exports.calculateCashFlow = calculateCashFlow;
exports.calculateKPIs = calculateKPIs;
exports.calculateCAGR = calculateCAGR;
exports.calculateLTV = calculateLTV;
exports.calculateMarketingROI = calculateMarketingROI;
exports.calculateProgress = calculateProgress;
// ---------- Helpers ----------
const pence = (n) => Math.round(n);
exports.pence = pence;
const pct = (n, decimals = 1) => Number(n.toFixed(decimals));
exports.pct = pct;
const formatPounds = (penceVal) => `£${(penceVal / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
exports.formatPounds = formatPounds;
function calculatePL(input) {
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
        marginPct: (0, exports.pct)(marginPct, 2),
        costsAsPctOfRevenue,
    };
}
function calculateValuation(input) {
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
    const principalLed = (0, exports.pence)(input.ebitda * principalMultiple);
    const associateLed = (0, exports.pence)(input.ebitda * associateMultiple);
    const dso = (0, exports.pence)(input.ebitda * dsoMultiple);
    return {
        principalLed,
        associateLed,
        dso,
        midPoint: (0, exports.pence)((principalLed + dso) / 2),
        highRange: Math.max(principalLed, associateLed, dso),
        lowRange: Math.min(principalLed, associateLed, dso),
    };
}
function calculateAssociatePay(input) {
    const grossPence = (0, exports.pence)((input.productionPence * input.payPct) / 10000);
    const labDeductionPence = (0, exports.pence)((input.labCostPence * input.labSplitPct) / 10000);
    const prevBalancePence = input.prevBalancePence || 0;
    const netPence = grossPence - labDeductionPence + prevBalancePence;
    return { grossPence, labDeductionPence, prevBalancePence, netPence };
}
function calculateCashFlow(weeks) {
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
function calculateKPIs(input) {
    const leadToConsult = input.monthlyLeads > 0 ? (input.consultationsBooked / input.monthlyLeads) * 100 : 0;
    const consultToTreatment = input.consultationsAttended > 0 ? (input.treatmentsStarted / input.consultationsAttended) * 100 : 0;
    const leadToTreatment = input.monthlyLeads > 0 ? (input.treatmentsStarted / input.monthlyLeads) * 100 : 0;
    const monthlyRevenuePerLead = input.monthlyLeads > 0 ? (0, exports.pence)(input.revenuePence / 12 / input.monthlyLeads) : 0;
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
        leadToConsult: (0, exports.pct)(leadToConsult),
        consultToTreatment: (0, exports.pct)(consultToTreatment),
        leadToTreatment: (0, exports.pct)(leadToTreatment),
        monthlyRevenuePerLead,
        netMarginPct: (0, exports.pct)(netMarginPct, 2),
        recurringRevenuePct: (0, exports.pct)(recurringRevenuePct),
        retentionRatePct: (0, exports.pct)(retentionRatePct),
        trafficLights,
    };
}
// ============================================================================
// CAGR (Compound Annual Growth Rate)
// ============================================================================
function calculateCAGR(startValue, endValue, years) {
    if (years <= 0 || startValue <= 0)
        return 0;
    return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}
function calculateLTV(input) {
    const lifetimeRevenue = input.averageAnnualSpendPence * input.averageRetentionYears;
    const lifetimeProfit = lifetimeRevenue * (input.netMarginPct / 100);
    return (0, exports.pence)(lifetimeProfit);
}
function calculateMarketingROI(input) {
    return {
        costPerLeadPence: input.leads > 0 ? (0, exports.pence)(input.spendPence / input.leads) : 0,
        costPerTreatmentPence: input.treatments > 0 ? (0, exports.pence)(input.spendPence / input.treatments) : 0,
        roas: input.spendPence > 0 ? input.totalRevenuePence / input.spendPence : 0,
        conversionPct: input.leads > 0 ? (0, exports.pct)((input.treatments / input.leads) * 100) : 0,
    };
}
function calculateProgress(input) {
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
        progressPct: (0, exports.pct)(progressPct),
        deltaFromBaselinePct: (0, exports.pct)(deltaFromBaselinePct),
        remainingToTarget,
    };
}

import { api } from '@/lib/api';
import {
  REGION_ADJUSTMENTS,
  type ValuationState,
  type ValuationBase,
  type ValuationResult,
} from './mock';

// Server-authoritative Group Valuation (Intelligence OS — Value & Growth).
// The valuation FORMULA lives in the backend (lib/formulas.js, FORMULAS.md §13,
// tested) — no client duplication. The screen works in whole pounds; these
// adapters convert pounds→pence on the way in and pence→pounds on the way out,
// so the rest of the screen keeps consuming the same pound-denominated shapes.
// Pure compute, debounced, no persistence (Arch #3).

const toPence = (pounds: number) => Math.round((pounds || 0) * 100);
const toPounds = (pence: number) => (pence || 0) / 100;

export interface ValuationLever {
  key: string;
  label: string;
  impact: number; // pounds
}

export interface ValuationCompute {
  result: ValuationResult; // pounds
  levers: ValuationLever[];
}

// Build the pence + factors body the backend expects from the screen's state.
function stateToBody(state: ValuationState, base: ValuationBase) {
  return {
    reportedEbitdaPence: toPence(base.reportedEbitda),
    addBacksPence: toPence(state.addBacks),
    principalSalaryPence: toPence(state.principalSalary),
    principalMultiple: state.principalMultiple,
    associateMultiple: state.associateMultiple,
    dsoMultiple: state.dsoMultiple,
    regionFactor: REGION_ADJUSTMENTS[state.region]?.factor ?? 1,
    growthRatePct: state.growthRate,
  };
}

export async function computeValuation(
  state: ValuationState,
  base: ValuationBase,
): Promise<ValuationCompute> {
  const raw = await api<{
    result: Record<keyof ValuationResult, number>;
    levers: { key: string; label: string; impactPence: number }[];
  }>('/api/analytics/compute/valuation', {
    method: 'POST',
    body: JSON.stringify(stateToBody(state, base)),
  });
  const r = raw.result;
  return {
    result: {
      reportedEbitda: toPounds(r.reportedEbitda),
      associateEbitda: toPounds(r.associateEbitda),
      principalNetProfit: toPounds(r.principalNetProfit),
      principalValuation: toPounds(r.principalValuation),
      associateValuation: toPounds(r.associateValuation),
      dsoValuation: toPounds(r.dsoValuation),
      midpoint: toPounds(r.midpoint),
      strategic: toPounds(r.strategic),
      regionFactor: r.regionFactor, // factor, not money
      growthAdjust: r.growthAdjust, // factor, not money
    },
    levers: raw.levers.map((l) => ({ key: l.key, label: l.label, impact: toPounds(l.impactPence) })),
  };
}

// --- Sale Planner trajectory -------------------------------------------------
export interface ExitPlanInput {
  base: ValuationBase;
  baseline: number; // today's midpoint, pounds
  principalSalary: number; // pounds
  targetValue: number;
  targetYears: number;
  futureEbitda: number;
  futureRevenue: number;
  futureMultiple: number;
  futureBuyerType: 'principal' | 'associate' | 'dso';
  addedSites: number;
  siteCount: number;
}

export interface ExitPlanYear {
  year: number;
  rev: number;
  ebitda: number;
  sites: number;
  margin: number; // percent
  valYear: number;
}

export interface ExitPlan {
  projected: number;
  baseline: number;
  gap: number;
  cagrNeeded: number; // percent
  ebitdaNeeded: number;
  ebitdaMargin: number; // percent
  currentEbitdaMargin: number; // percent
  revenueGrowthPct: number; // percent
  totalSites: number;
  years: ExitPlanYear[];
}

export async function computeExitPlan(input: ExitPlanInput): Promise<ExitPlan> {
  const raw = await api<{
    projectedPence: number;
    baselinePence: number;
    gapPence: number;
    cagrNeededPct: number;
    ebitdaNeededPence: number;
    ebitdaMarginPct: number;
    currentEbitdaMarginPct: number;
    revenueGrowthPct: number;
    totalSites: number;
    years: { year: number; revPence: number; ebitdaPence: number; sites: number; marginPct: number; valYearPence: number }[];
  }>('/api/analytics/compute/valuation/exit-plan', {
    method: 'POST',
    body: JSON.stringify({
      base: {
        ttmRevenuePence: toPence(input.base.ttmRevenue),
        reportedEbitdaPence: toPence(input.base.reportedEbitda),
      },
      baselinePence: toPence(input.baseline),
      principalSalaryPence: toPence(input.principalSalary),
      plan: {
        targetValuePence: toPence(input.targetValue),
        targetYears: input.targetYears,
        futureEbitdaPence: toPence(input.futureEbitda),
        futureRevenuePence: toPence(input.futureRevenue),
        futureMultiple: input.futureMultiple,
        futureBuyerType: input.futureBuyerType,
        addedSites: input.addedSites,
        siteCount: input.siteCount,
      },
    }),
  });
  return {
    projected: toPounds(raw.projectedPence),
    baseline: toPounds(raw.baselinePence),
    gap: toPounds(raw.gapPence),
    cagrNeeded: raw.cagrNeededPct,
    ebitdaNeeded: toPounds(raw.ebitdaNeededPence),
    ebitdaMargin: raw.ebitdaMarginPct,
    currentEbitdaMargin: raw.currentEbitdaMarginPct,
    revenueGrowthPct: raw.revenueGrowthPct,
    totalSites: raw.totalSites,
    years: raw.years.map((y) => ({
      year: y.year,
      rev: toPounds(y.revPence),
      ebitda: toPounds(y.ebitdaPence),
      sites: y.sites,
      margin: y.marginPct,
      valYear: toPounds(y.valYearPence),
    })),
  };
}

import { api } from '@/lib/api';

// Wealth — personal Exit Plan / FIRE (DentaCFO gap Phase 4). Owner-only.
// Persisted personal balance sheet + the assembled live FIRE plan. Money is
// integer PENCE end to end (rule 2); screens convert with lib/format.formatPence
// or the compact helper at the display edge.

export type AssetType = 'Business' | 'Property' | 'Pension' | 'Investments' | 'Cash';

export interface WealthAsset {
  name: string;
  valuePence: number;
  type: AssetType;
  growthPct: number;
  liquid: boolean;
}
export interface WealthLiability {
  name: string;
  valuePence: number;
  ratePct: number;
}
export interface WealthPension {
  name: string;
  balancePence: number;
  contributionsYtdPence: number;
  type: 'SIPP' | 'NHS' | 'Director';
}
export interface WealthProperty {
  name: string;
  address: string;
  valuePence: number;
  mortgagePence: number;
  monthlyIncomePence: number;
  monthlyCostPence: number;
  yieldPct: number | null;
  type: 'Residential' | 'Buy-to-let';
}
// ── Exit Plan (canonical, faithful to the GM demo `exitCalc`) ────────────────
export interface ExitPerson { name: string; share: number }
export interface ExitFreehold { name: string; valuePence: number; rentPence: number }

export interface ExitPlanInput {
  incomePence: number;            // annual post-tax income wanted
  incomePer: 'year' | 'month';    // display preference
  people: ExitPerson[];
  currentAge: number;
  retireAge: number;
  freeholds: ExitFreehold[];
  withdrawPct: number;            // safe withdrawal rate (4% rule sizes the pot)
  returnPct: number;              // investment return for the drawdown projection
  currentValuePence: number;      // group value today (manual override)
  useLiveValuation: boolean;      // seed currentValue from the live valuation midpoint
  agentPct: number;
  cgtPct: number;
  baseCostPence: number;
  existingInvestPence: number;
  targetSalePence: number;        // 0 = use the reverse-solved required sale
}

export interface WealthInputs {
  assets: WealthAsset[];
  liabilities: WealthLiability[];
  pensions: WealthPension[];
  properties: WealthProperty[];
  exit: ExitPlanInput;
  updatedAt: string | null;
}

export interface NetWorth {
  assets: WealthAsset[];
  liabilities: WealthLiability[];
  byType: Partial<Record<AssetType, number>>;
  totalAssetsPence: number;
  totalLiabilitiesPence: number;
  netWorthPence: number;
}

export interface ExitProjectionRow {
  year: number;
  age: number;
  startPence: number;
  growthPence: number;
  incomePence: number;
  endPence: number;
}

export interface ExitPlanResult {
  annualNetPence: number;
  years: number;
  exitYear: number;
  people: { name: string; netPence: number; grossPence: number; taxPence: number }[];
  grossRequiredPence: number;
  singleGrossPence: number;
  taxSavingPence: number;
  totalRentPence: number;
  totalFreeholdPence: number;
  portfolioGrossPence: number;
  potNeededPence: number;
  requiredNetPence: number;
  requiredSalePence: number;
  reqGrowthPct: number;
  targetSalePence: number;
  agentFeePence: number;
  cgtPence: number;
  netProceedsPence: number;
  investablePence: number;
  gapPence: number;
  targetGrowthPct: number;
  onTrack: boolean;
  withdrawPct: number;
  returnPct: number;
  projection: ExitProjectionRow[];
}

export interface ExitPlanResponse {
  valuation: { currentValuePence: number; source: 'live' | 'manual' };
  plan: ExitPlanResult;
  inputs: ExitPlanInput & { baseYear: number };
  seeds: { liquidAssetsPence: number; pensionPence: number; existingInvestSeeded: boolean; freeholdsSeeded: boolean };
}

// Body PUT /inputs accepts — everything optional, server applies defaults.
export type WealthInputsBody = Partial<Omit<WealthInputs, 'updatedAt'>>;

export function fetchWealthInputs(): Promise<WealthInputs> {
  return api<WealthInputs>('/api/wealth/inputs');
}
export function saveWealthInputs(body: WealthInputsBody): Promise<WealthInputs> {
  return api<WealthInputs>('/api/wealth/inputs', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
export function fetchNetWorth(): Promise<NetWorth> {
  return api<NetWorth>('/api/wealth/net');
}
// Assembled live Exit Plan (seeds group value + existing investments + freeholds).
export function fetchExitPlan(): Promise<ExitPlanResponse> {
  return api<ExitPlanResponse>('/api/wealth/fire');
}
// Pure slider recompute (audit-exempt). The screen passes the full input incl.
// the currentValuePence it seeded from /fire.
export function computeExitPlan(body: ExitPlanInput): Promise<ExitPlanResult> {
  return api<ExitPlanResult>('/api/wealth/compute/exit-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

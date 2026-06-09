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
export interface FireSettings {
  targetAnnualSpendPence: number;
  withdrawalRatePct: number;
  growthRatePct: number;
  annualSavingsPence: number;
  horizonYears: number;
}
export interface SaleSettings {
  ownerSharePct: number;
  businessDebtPence: number;
  freeholdEquityPence: number;
  acquisitionCostPence: number;
  badrLifetimeUsedPence: number;
  useLiveValuation: boolean;
  enterpriseValuePence: number;
}

export interface WealthInputs {
  assets: WealthAsset[];
  liabilities: WealthLiability[];
  pensions: WealthPension[];
  properties: WealthProperty[];
  fire: FireSettings;
  sale: SaleSettings;
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

export interface SaleWaterfall {
  equityValuePence: number;
  ownerEquityProceedsPence: number;
  ownerGainPence: number;
  badrGainPence: number;
  standardGainPence: number;
  cgtPence: number;
  effectiveCgtPct: number;
  netBusinessProceedsPence: number;
  freeholdEquityPence: number;
  totalNetProceedsPence: number;
}

export interface FirePlan {
  currentNetWorthPence: number;
  fireNumberPence: number;
  gapPence: number;
  progressPct: number;
  sustainableAnnualIncomePence: number;
  targetAnnualSpendPence: number;
  withdrawalRatePct: number;
  growthRatePct: number;
  annualSavingsPence: number;
  horizonYears: number;
  yearsToFire: number | null;
  requiredAnnualSavingsPence: number;
  years: { year: number; nwPence: number; hitFire: boolean }[];
}

export interface ExitPlan {
  valuation: { enterpriseValuePence: number; source: 'live' | 'manual' };
  waterfall: SaleWaterfall;
  fire: FirePlan;
  inputs: {
    liquidAssetsPence: number;
    liabilitiesPence: number;
    fire: FireSettings;
    sale: SaleSettings;
  };
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
export function fetchExitPlan(): Promise<ExitPlan> {
  return api<ExitPlan>('/api/wealth/fire');
}

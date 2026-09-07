// ============================================================================
// Tax API. Everything is scoped to the caller's organisation server-side —
// the org is never a parameter here, so a sub-account can only ever read and
// write its own settings, mapping and figures.
// ============================================================================
import { api } from '@/lib/api';

export type EntityType = 'limited_company' | 'sole_trader' | 'partnership' | 'llp';
export type Liability = 'exempt' | 'standard' | 'outside_scope';

export interface TaxSettings {
  entity_type: EntityType | null;
  vat_registered: boolean;
  vat_number: string | null;
  vat_scheme: 'standard' | 'cash' | 'flat_rate' | 'annual' | null;
  prices_include_vat: boolean;
  year_end_day: number | null;
  year_end_month: number | null;
  associated_companies: number;
}

export interface VatBlock {
  state: 'ok' | 'no_rates';
  window?: { since: string; until: string };
  exemptPence: number;
  standardPence: number;
  outsideScopePence: number;
  unmappedPence: number;
  /** Revenue counted under the default rather than an explicit decision. */
  assumedPence?: number;
  totalPence: number;
  outputVatPence: number;
  pricesIncludeVat: boolean;
  registration: {
    taxableTurnover12mPence: number;
    registrationThresholdPence: number;
    overThreshold: boolean;
    belowDeregistrationThreshold: boolean;
    indeterminate: boolean;
    unmappedTurnover12mPence: number;
  };
  ratesSource?: string;
  taxYear?: string;
  caveats: string[];
}

export interface CtBlock {
  state: 'ok' | 'not_applicable' | 'no_period' | 'no_rates' | 'no_financials';
  reason?: string;
  period?: { start: string; end: string; days: number };
  profitPence?: number;
  /** null on a loss — an effective rate over no profit is undefined, not 0. */
  taxPence?: number;
  band?: 'none' | 'small' | 'marginal' | 'main';
  effectiveRatePct?: number | null;
  marginalReliefPence?: number;
  lowerLimitPence?: number;
  upperLimitPence?: number;
  deadlines?: { payBy: string; fileBy: string };
  associatedCompanies?: number;
  ratesSource?: string;
  financialYear?: string;
  caveats: string[];
}

export interface TaxOverview {
  state: 'ok' | 'not_configured';
  settings: TaxSettings | null;
  /** What was actually used, including any assumed value. */
  effectiveSettings?: TaxSettings;
  /** Plain-English list of what was assumed, empty when everything is set. */
  assumptions?: string[];
  revenuePence?: number | null;
  profitPence?: number | null;
  totalTaxPence?: number;
  period?: { start: string; end: string; days: number } | null;
  vat: VatBlock | null;
  corporationTax: CtBlock | null;
  caveats: string[];
}

export interface TreatmentRow {
  description: string;
  amountPence: number;
  lineCount: number;
  liability: Liability | null;
  /** What it is counted as right now, mapped or defaulted. */
  effectiveLiability?: Liability;
  cumulativeSharePct: number | null;
}

export interface TreatmentsPayload {
  treatments: TreatmentRow[];
  totalPence: number;
  mappedPence: number;
  unmappedPence: number;
  coveragePct: number | null;
}

export const fetchTaxOverview = () => api<TaxOverview>('/api/tax/overview');
export const fetchTaxSettings = () => api<TaxSettings | null>('/api/tax/settings');
export const fetchTaxTreatments = () => api<TreatmentsPayload>('/api/tax/treatments');

export const saveTaxSettings = (body: Partial<TaxSettings>) =>
  api<TaxSettings>('/api/tax/settings', { method: 'PUT', body: JSON.stringify(body) });

export const setTreatmentLiability = (body: {
  description: string; liability: Liability | null; note?: string | null;
}) => api<{ ok: true }>('/api/tax/treatments/liability', { method: 'PUT', body: JSON.stringify(body) });

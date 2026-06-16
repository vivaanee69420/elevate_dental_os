import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow } from '@/features/_shared/scope-context';

// P&L & Margin (GM Intelligence OS) — GET /api/analytics/pl-margin.
// Scope/period-aware group P&L statement + per-entity breakdown from REAL
// monthly_financials actuals (Xero/QuickBooks override manual). Money in PENCE.
// Honest CoA granularity: staff includes associate/clinician pay (Xero books
// them together → dentistStaffSeparable:false); `tax` is below the line, excluded.

export interface PLLine {
  revPence: number;
  labMaterialsPence: number;
  grossPence: number;
  staffPence: number;
  otherOpexPence: number;
  netPence: number;
  marginPct: number;
}

export interface PLEntity extends PLLine {
  id: string;
  name: string;
  // 'company' = a QuickBooks company (QBO posts per legal entity, not per
  // dental practice); 'practice'/'academy'/'lab' = a Dentally-tagged entity.
  kind: 'practice' | 'academy' | 'lab' | 'company';
  region: string;
  basis: 'month' | 'annual';
  periodsCovered: number;
}

// P&L filter options the QuickBooks-first P&L Margin tab sends down. All
// optional — absent keeps the legacy all-feeds, accrual view.
export interface PLMarginOpts {
  source?: 'combined' | 'quickbooks';
  accountId?: string | null; // one QuickBooks company (integration_account_id)
  accountingMethod?: 'accrual' | 'cash';
}

// One account-level line under a summary row (e.g. "Council Tax" under Other
// operating costs), as the accounting feed books it. Pence.
export interface PLBreakdownLine {
  name: string;
  amountPence: number;
}

// Account-level drill-down keyed by the summary line it rolls into. Each list is
// largest-first. Empty lists when no account detail exists for that line.
export interface PLBreakdown {
  revPence: PLBreakdownLine[];
  labMaterialsPence: PLBreakdownLine[];
  staffPence: PLBreakdownLine[];
  otherOpexPence: PLBreakdownLine[];
}

export interface PLMargin {
  applicable: boolean;
  scope: string;
  period: 'month' | 'day';
  monthKey: string;
  basis: 'none' | 'actuals-month' | 'actuals-annual' | 'actuals-mixed';
  source: 'combined' | 'quickbooks' | 'xero' | 'manual';
  accountingMethod: 'accrual' | 'cash';
  hasData: boolean;
  costsAvailable: boolean;
  periodsCovered: number;
  statement: PLLine;
  dentistStaffSeparable: boolean;
  perEntityAvailable: boolean;
  perEntityKind: 'company' | 'practice' | null;
  entityBasisMixed: boolean;
  entities: PLEntity[];
  breakdown: PLBreakdown;
  note?: string;
}

const EMPTY: PLMargin = {
  applicable: true, scope: 'all', period: 'month', monthKey: '', basis: 'none',
  source: 'combined', accountingMethod: 'accrual',
  hasData: false, costsAvailable: false, periodsCovered: 0,
  statement: { revPence: 0, labMaterialsPence: 0, grossPence: 0, staffPence: 0, otherOpexPence: 0, netPence: 0, marginPct: 0 },
  dentistStaffSeparable: false, perEntityAvailable: false, perEntityKind: null, entityBasisMixed: false, entities: [],
  breakdown: { revPence: [], labMaterialsPence: [], staffPence: [], otherOpexPence: [] },
};

export function fetchPLMargin(scope: string, win: ResolvedWindow, opts: PLMarginOpts = {}): Promise<PLMargin> {
  const qs = new URLSearchParams(windowParams(scope, win));
  // QuickBooks is company-scoped, not practice-scoped — only send source/company
  // when the QB feed is selected; accounting method always applies.
  if (opts.source === 'quickbooks') {
    qs.set('source', 'quickbooks');
    if (opts.accountId) qs.set('account_id', opts.accountId);
  }
  if (opts.accountingMethod) qs.set('accounting_method', opts.accountingMethod);
  return api<PLMargin>(`/api/analytics/pl-margin?${qs.toString()}`).then((r) => ({ ...EMPTY, ...r }));
}

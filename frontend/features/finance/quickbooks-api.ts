import { api } from '@/lib/api';

// Finance > QuickBooks dashboard data. All *_pence are integer pence (display
// with (pence/100).toLocaleString('en-GB')). accountId omitted = all companies
// summed; period (YYYY-MM) or from/to (YYYY-MM-DD) window the figures.

export interface QbBuckets {
  revenue: number; associates: number; staff: number; lab: number; materials: number;
  overhead: number; tax: number; other: number;
}

export interface QbTrendPoint {
  period: string;
  revenuePence: number;
  expensesPence: number;
  netProfitPence: number;
}

export interface QbCompany {
  accountId: string;
  companyName: string;
  revenuePence: number;
  expensesPence: number;
  netProfitPence: number;
  netMarginPct: number;
  cashAtBankPence: number;
  receivablesPence: number;
  receiptsPence: number;
}

export interface QbAccountOption {
  id: string;
  companyName: string;
  status: string;
}

export interface QbOverview {
  window: { fromPeriod: string; toPeriod: string; accountingMethod: QbMethod };
  summary: {
    revenuePence: number;
    expensesPence: number;
    netProfitPence: number;
    netMarginPct: number;
    cashAtBankPence: number;
    cashAsOf: string; // 'YYYY-MM' (month-end snapshot) or 'latest' (live fallback)
    receivablesPence: number;
    receiptsPence: number;
  };
  byBucket: QbBuckets;
  trend: QbTrendPoint[];
  companies: QbCompany[];
  accounts: QbAccountOption[];
}

// QuickBooks syncs its P&L under BOTH bases. The backend pins one per read —
// summing the two double-counts every figure — and defaults to accrual, the
// standard P&L basis. Callers that show the number must also show which basis
// it is on, or the same window legitimately reports two different profits.
export type QbMethod = 'accrual' | 'cash';

export interface QbQuery {
  accountId?: string | null;
  period?: string | null;
  from?: string | null;
  to?: string | null;
  method?: QbMethod | null;
}

export function getQuickBooksOverview(q: QbQuery = {}): Promise<QbOverview> {
  const params = new URLSearchParams();
  if (q.accountId) params.set('accountId', q.accountId);
  if (q.period) params.set('period', q.period);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.method) params.set('method', q.method);
  const qs = params.toString();
  return api<QbOverview>(`/api/finance/quickbooks${qs ? `?${qs}` : ''}`);
}

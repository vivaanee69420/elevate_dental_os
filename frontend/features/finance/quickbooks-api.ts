import { api } from '@/lib/api';

// Finance > QuickBooks dashboard data. All *_pence are integer pence (display
// with (pence/100).toLocaleString('en-GB')). accountId omitted = all companies
// summed; period (YYYY-MM) or from/to (YYYY-MM-DD) window the figures.

export interface QbBuckets {
  revenue: number; staff: number; lab: number; materials: number;
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
  window: { fromPeriod: string; toPeriod: string };
  summary: {
    revenuePence: number;
    expensesPence: number;
    netProfitPence: number;
    netMarginPct: number;
    cashAtBankPence: number;
    receivablesPence: number;
    receiptsPence: number;
  };
  byBucket: QbBuckets;
  trend: QbTrendPoint[];
  companies: QbCompany[];
  accounts: QbAccountOption[];
}

export interface QbQuery {
  accountId?: string | null;
  period?: string | null;
  from?: string | null;
  to?: string | null;
}

export function getQuickBooksOverview(q: QbQuery = {}): Promise<QbOverview> {
  const params = new URLSearchParams();
  if (q.accountId) params.set('accountId', q.accountId);
  if (q.period) params.set('period', q.period);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  const qs = params.toString();
  return api<QbOverview>(`/api/finance/quickbooks${qs ? `?${qs}` : ''}`);
}

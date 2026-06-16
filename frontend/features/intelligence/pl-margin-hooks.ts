'use client';

import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import { fetchPLMargin, type PLMarginOpts } from './pl-margin-api';

// P&L & Margin. Refetches on scope/period change AND on the QuickBooks filter
// (source / company / accrual-vs-cash) so the statement always matches the
// controls. Real monthly_financials actuals.
export function usePLMargin(opts: PLMarginOpts = {}) {
  const sp = useScopePeriod();
  return useQuery({
    queryKey: ['pl-margin', scopeKey(sp), opts.source ?? 'combined', opts.accountId ?? 'all', opts.accountingMethod ?? 'accrual'],
    queryFn: () => fetchPLMargin(sp.scope, sp.win, opts),
    staleTime: 60_000,
  });
}

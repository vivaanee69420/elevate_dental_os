import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFinanceSeries,
  getCashflow,
  getCashflowOutlook,
  getFinancial,
  getProfitBenchmark,
  getValuationBase,
  getPaymentSourceBreakdown,
  recordManualPayment,
  recordMonthlyFinancial,
  listMonthlyFinancials,
  deleteMonthlyFinancial,
  type ManualPaymentInput,
  type MonthlyFinancialInput,
  type DateRange,
} from './api';

export function useFinanceSeries(practiceId: string | null = null, range?: DateRange | null) {
  return useQuery({
    queryKey: ['finance-series', practiceId, range?.from ?? null, range?.to ?? null],
    queryFn: () => getFinanceSeries(practiceId, range),
  });
}

export function useCashflow(weeks = 13, practiceId: string | null = null, range?: DateRange | null) {
  return useQuery({
    queryKey: ['cashflow', weeks, practiceId, range?.from ?? null, range?.to ?? null],
    queryFn: () => getCashflow(weeks, practiceId, range),
  });
}

export function useCashflowOutlook(months = 4, forward = 2, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['cashflow-outlook', months, forward, practiceId],
    queryFn: () => getCashflowOutlook(months, forward, practiceId),
  });
}

export function useFinancial(dsoDays = 45, payableDays = 30, practiceId: string | null = null, range?: DateRange | null) {
  return useQuery({
    queryKey: ['financial', dsoDays, payableDays, practiceId, range?.from ?? null, range?.to ?? null],
    queryFn: () => getFinancial(dsoDays, payableDays, practiceId, range),
  });
}

export function useProfitBenchmark(practiceId: string | null = null) {
  return useQuery({
    queryKey: ['pl-benchmark', practiceId],
    queryFn: () => getProfitBenchmark(practiceId),
  });
}

export function useValuationBase() {
  return useQuery({
    queryKey: ['valuation-base'],
    queryFn: getValuationBase,
  });
}

export function usePaymentSourceBreakdown(days = 30) {
  return useQuery({
    queryKey: ['payment-source-breakdown', days],
    queryFn: () => getPaymentSourceBreakdown(days),
    staleTime: 30_000,
  });
}

export function useRecordManualPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualPaymentInput) => recordManualPayment(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance-series'] });
      qc.invalidateQueries({ queryKey: ['cashflow'] });
      qc.invalidateQueries({ queryKey: ['financial'] });
      qc.invalidateQueries({ queryKey: ['payment-source-breakdown'] });
    },
  });
}

// --- Manual P&L actuals -----------------------------------------------------
export function useMonthlyFinancials(params?: { from?: string; to?: string; practice_id?: string | null }) {
  return useQuery({
    queryKey: ['monthly-financials', params?.from ?? null, params?.to ?? null, params?.practice_id ?? null],
    queryFn: () => listMonthlyFinancials(params),
  });
}

// Invalidate every screen that reads monthly_financials actuals.
function invalidateFinancials(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['monthly-financials'] });
  qc.invalidateQueries({ queryKey: ['finance-series'] });
  qc.invalidateQueries({ queryKey: ['financial'] });
  qc.invalidateQueries({ queryKey: ['valuation-base'] });
}

export function useRecordMonthlyFinancial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MonthlyFinancialInput) => recordMonthlyFinancial(input),
    onSuccess: () => invalidateFinancials(qc),
  });
}

export function useDeleteMonthlyFinancial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMonthlyFinancial(id),
    onSuccess: () => invalidateFinancials(qc),
  });
}

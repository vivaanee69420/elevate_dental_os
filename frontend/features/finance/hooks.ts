import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFinanceSeries,
  getCashflow,
  getFinancial,
  getValuationBase,
  getPaymentSourceBreakdown,
  recordManualPayment,
  type ManualPaymentInput,
} from './api';

export function useFinanceSeries() {
  return useQuery({
    queryKey: ['finance-series'],
    queryFn: getFinanceSeries,
  });
}

export function useCashflow(weeks = 13) {
  return useQuery({
    queryKey: ['cashflow', weeks],
    queryFn: () => getCashflow(weeks),
  });
}

export function useFinancial(dsoDays = 45, payableDays = 30) {
  return useQuery({
    queryKey: ['financial', dsoDays, payableDays],
    queryFn: () => getFinancial(dsoDays, payableDays),
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

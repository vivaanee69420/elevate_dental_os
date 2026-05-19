import { useQuery } from '@tanstack/react-query';
import {
  getFinanceSeries,
  getCashflow,
  getFinancial,
  getValuationBase,
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

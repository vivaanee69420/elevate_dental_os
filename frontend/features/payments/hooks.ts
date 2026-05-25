import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listPayments, getPaymentSummary, createPaymentLink } from './api';

export function usePayments(page = 1, limit = 25, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['payments', page, limit, practiceId],
    queryFn: () => listPayments(page, limit, practiceId),
    placeholderData: keepPreviousData, // keep old page visible while next loads
  });
}

export function usePaymentSummary(practiceId: string | null = null) {
  return useQuery({
    queryKey: ['payment-summary', practiceId],
    queryFn: () => getPaymentSummary(practiceId),
  });
}

export function useCreatePaymentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPaymentLink,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-summary'] });
    },
  });
}

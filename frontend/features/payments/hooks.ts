import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listPayments, createPaymentLink } from './api';

export function usePayments() {
  return useQuery({ queryKey: ['payments'], queryFn: listPayments });
}

export function useCreatePaymentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPaymentLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payments'] }),
  });
}

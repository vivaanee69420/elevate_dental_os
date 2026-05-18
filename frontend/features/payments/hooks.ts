import { useQuery } from '@tanstack/react-query';
import { listPayments } from './api';

export function usePayments() {
  return useQuery({ queryKey: ['payments'], queryFn: listPayments });
}

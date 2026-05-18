import { useQuery } from '@tanstack/react-query';
import { listLeads } from './api';

export function useLeads() {
  return useQuery({ queryKey: ['leads'], queryFn: listLeads });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getHealth, updateHealth, getHealthProgress, getHealthInsights } from './api';

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: getHealth });
}

export function useHealthProgress() {
  return useQuery({ queryKey: ['progress'], queryFn: getHealthProgress });
}

export function useHealthInsights() {
  return useQuery({ queryKey: ['health-insights'], queryFn: getHealthInsights });
}

export function useUpdateHealth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateHealth,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['health'] }),
  });
}

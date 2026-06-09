import { useQuery } from '@tanstack/react-query';
import { getNetWorth, getFire } from './api';

export function useNetWorth() {
  return useQuery({
    queryKey: ['wealth-net'],
    queryFn: getNetWorth,
  });
}

export function useFire() {
  return useQuery({
    queryKey: ['wealth-fire'],
    queryFn: getFire,
  });
}

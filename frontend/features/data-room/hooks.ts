'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchDataRoomFreshness, fetchDataRoomPage, fetchDataRoomRegistry, type DataRoomParams, type DataRoomSourceKey } from './api';

export function useDataRoomRegistry() {
  return useQuery({ queryKey: ['data-room-registry'], queryFn: fetchDataRoomRegistry, staleTime: 10 * 60_000 });
}

export function useDataRoomFreshness() {
  return useQuery({ queryKey: ['data-room-freshness'], queryFn: fetchDataRoomFreshness, staleTime: 60_000 });
}

/**
 * One numbered page. The previous page's rows stay on screen while the next
 * one loads (placeholderData) so paging doesn't flash the skeleton.
 */
export function useDataRoomPage(
  source: DataRoomSourceKey,
  dataset: string | null,
  params: DataRoomParams,
  page: number,
  limit: number,
) {
  return useQuery({
    queryKey: [
      'data-room', source, dataset ?? '', params.scope, params.since ?? '', params.until ?? '',
      params.pii ? 1 : 0, page, limit,
    ],
    enabled: !!dataset,
    queryFn: () => fetchDataRoomPage(source, dataset as string, params, page, limit),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

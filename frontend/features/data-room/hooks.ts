'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchDataRoomPage, fetchDataRoomRegistry, type DataRoomParams, type DataRoomSourceKey } from './api';

const PAGE = 100;

export function useDataRoomRegistry() {
  return useQuery({ queryKey: ['data-room-registry'], queryFn: fetchDataRoomRegistry, staleTime: 10 * 60_000 });
}

export function useDataRoomPage(source: DataRoomSourceKey, dataset: string | null, params: DataRoomParams) {
  return useInfiniteQuery({
    queryKey: ['data-room', source, dataset ?? '', params.scope, params.since ?? '', params.until ?? '', params.pii ? 1 : 0],
    enabled: !!dataset,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchDataRoomPage(source, dataset as string, params, pageParam, PAGE),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 30_000,
  });
}

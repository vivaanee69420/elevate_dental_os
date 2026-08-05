'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addSheetSource,
  disconnectSheets,
  fetchCallReportingDashboard,
  fetchSheetPreview,
  fetchSheetsStatus,
  removeSheetSource,
  saveSheetMapping,
  syncSheetSource,
  type SheetMappingInput,
} from './api';

export function useCallReportingDashboard(date: string, sourceId?: string) {
  return useQuery({
    queryKey: ['call-reporting-dashboard', date || 'today', sourceId ?? 'all'],
    queryFn: () => fetchCallReportingDashboard(date, sourceId),
    staleTime: 30_000,
  });
}

export function useSheetsStatus() {
  return useQuery({
    queryKey: ['sheets-status'],
    queryFn: fetchSheetsStatus,
    staleTime: 15_000,
  });
}

export function useSheetPreview(sourceId: string | null, tab: string | null) {
  return useQuery({
    queryKey: ['sheets-preview', sourceId ?? '', tab ?? ''],
    queryFn: () => fetchSheetPreview(sourceId as string, tab as string),
    enabled: !!sourceId && !!tab,
    staleTime: 60_000,
  });
}

function useInvalidateSheets() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['sheets-status'] });
    qc.invalidateQueries({ queryKey: ['call-reporting-dashboard'] });
  };
}

export function useAddSheetSource() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: addSheetSource, onSuccess: invalidate });
}

export function useSaveSheetMapping() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: ({ sourceId, mapping }: { sourceId: string; mapping: SheetMappingInput }) =>
      saveSheetMapping(sourceId, mapping),
    onSuccess: invalidate,
  });
}

export function useSheetSourceSync() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: syncSheetSource, onSuccess: invalidate });
}

export function useRemoveSheetSource() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: removeSheetSource, onSuccess: invalidate });
}

export function useSheetsDisconnect() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: disconnectSheets, onSuccess: invalidate });
}

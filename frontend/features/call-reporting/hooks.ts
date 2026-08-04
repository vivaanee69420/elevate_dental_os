'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addSheetSource,
  disconnectSheets,
  fetchCallReportingDashboard,
  fetchSheetPracticeMap,
  fetchSheetPreview,
  fetchSheetsStatus,
  saveSheetMapping,
  setSheetPracticeMapping,
  syncSheetsNow,
  type SheetMappingInput,
} from './api';

export function useCallReportingDashboard(date: string, practiceId?: string) {
  return useQuery({
    queryKey: ['call-reporting-dashboard', date || 'today', practiceId ?? 'all'],
    queryFn: () => fetchCallReportingDashboard(date, practiceId),
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

export function useSheetPreview(tab: string | null) {
  return useQuery({
    queryKey: ['sheets-preview', tab ?? ''],
    queryFn: () => fetchSheetPreview(tab as string),
    enabled: !!tab,
    staleTime: 60_000,
  });
}

export function useSheetPracticeMap(enabled = true) {
  return useQuery({
    queryKey: ['sheets-practice-map'],
    queryFn: fetchSheetPracticeMap,
    enabled,
    staleTime: 30_000,
  });
}

function useInvalidateSheets() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['sheets-status'] });
    qc.invalidateQueries({ queryKey: ['sheets-practice-map'] });
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
    mutationFn: (mapping: SheetMappingInput) => saveSheetMapping(mapping),
    onSuccess: invalidate,
  });
}

export function useSetSheetPractice() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: ({ sheetValue, practiceId }: { sheetValue: string; practiceId: string | null }) =>
      setSheetPracticeMapping(sheetValue, practiceId),
    onSuccess: invalidate,
  });
}

export function useSheetsSync() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: syncSheetsNow, onSuccess: invalidate });
}

export function useSheetsDisconnect() {
  const invalidate = useInvalidateSheets();
  return useMutation({ mutationFn: disconnectSheets, onSuccess: invalidate });
}

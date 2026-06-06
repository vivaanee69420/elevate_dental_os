'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listPlSheets,
  getPlSheet,
  createPlSheet,
  updatePlSheet,
  deletePlSheet,
  type PlSheet,
  type PlSheetInput,
  type PlSheetSummary,
} from './pl-sheets-api';

// P&L scenario sheets (Phase 3 / T13). Mutations invalidate the list (and the
// open sheet) so the UI stays consistent.
export function usePlSheets() {
  return useQuery<PlSheetSummary[]>({ queryKey: ['pl-sheets'], queryFn: listPlSheets });
}

export function usePlSheet(id: string | null) {
  return useQuery<PlSheet>({
    queryKey: ['pl-sheet', id],
    queryFn: () => getPlSheet(id as string),
    enabled: !!id,
  });
}

export function useCreatePlSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlSheetInput) => createPlSheet(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pl-sheets'] }),
  });
}

export function useUpdatePlSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PlSheetInput> }) => updatePlSheet(id, input),
    onSuccess: (sheet) => {
      qc.invalidateQueries({ queryKey: ['pl-sheets'] });
      qc.invalidateQueries({ queryKey: ['pl-sheet', sheet.id] });
    },
  });
}

export function useDeletePlSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePlSheet(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pl-sheets'] }),
  });
}

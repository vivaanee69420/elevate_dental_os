// CSV manual-feed API client + React Query hooks. Owner / practice_manager only
// on the backend. Upload stages rows (pending); a DIFFERENT user approves before
// they hit live tables.

import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type Dataset = 'payments' | 'appointments' | 'patients';
export type BatchStatus = 'pending' | 'approved' | 'rejected';

export interface RejectedRow {
  row_number: number;
  error: string;
}

export interface ImportResult {
  batch_id: string;
  dataset: Dataset;
  status: BatchStatus;
  row_count: number;
  valid_count: number;
  rejected_count: number;
  rejected: RejectedRow[];
}

export interface ImportBatch {
  id: string;
  dataset: Dataset;
  filename: string | null;
  status: BatchStatus;
  uploaded_by: string | null;
  approved_by: string | null;
  row_count: number;
  valid_count: number;
  rejected_count: number;
  reject_reason: string | null;
  created_at: string;
  approved_at: string | null;
}

export function uploadCsv(input: { dataset: Dataset; filename: string; content: string }) {
  return api<ImportResult>('/api/imports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listBatches() {
  return api<{ batches: ImportBatch[] }>('/api/imports');
}

export function approveBatch(id: string) {
  return api<{ imported: number; dataset: Dataset }>(`/api/imports/${id}/approve`, { method: 'POST' });
}

export function rejectBatch(id: string, reason?: string) {
  return api<{ rejected: boolean }>(`/api/imports/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function useImportBatches() {
  return useQuery({ queryKey: ['import-batches'], queryFn: listBatches, staleTime: 10_000 });
}

export function useUploadCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadCsv,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-batches'] }),
  });
}

export function useApproveBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveBatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-batches'] }),
  });
}

export function useRejectBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectBatch(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-batches'] }),
  });
}

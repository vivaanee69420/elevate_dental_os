'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScopePeriod } from '@/features/_shared/scope-context';
import {
  generateBoardReport,
  emailBoardReport,
  fetchBoardSchedules,
  createBoardSchedule,
  updateBoardSchedule,
  deleteBoardSchedule,
  fetchTurnoverSource,
  updateTurnoverSource,
  type BoardReport,
  type EmailResult,
  type BoardSchedule,
  type TurnoverSource,
} from './board-report-api';

// Generate is a MUTATION (token cost) — fired by the Generate button against the
// active scope/period window, never on page load.
export function useGenerateBoardReport() {
  const sp = useScopePeriod();
  return useMutation<BoardReport, Error>({
    mutationFn: () => generateBoardReport(sp.win, sp.scope),
  });
}

export function useEmailBoardReport() {
  const sp = useScopePeriod();
  return useMutation<EmailResult, Error, string>({
    mutationFn: (recipientEmail: string) => emailBoardReport(sp.win, recipientEmail, sp.scope),
  });
}

const TURNOVER_SOURCE_KEY = ['turnover-source'];

export function useTurnoverSource() {
  return useQuery<{ turnoverSource: TurnoverSource }>({
    queryKey: TURNOVER_SOURCE_KEY,
    queryFn: fetchTurnoverSource,
    staleTime: 60_000,
  });
}

export function useSaveTurnoverSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (turnoverSource: TurnoverSource) => updateTurnoverSource(turnoverSource),
    onSuccess: () => qc.invalidateQueries({ queryKey: TURNOVER_SOURCE_KEY }),
  });
}

const SCHEDULES_KEY = ['board-schedules'];

export function useBoardSchedules() {
  return useQuery<BoardSchedule[]>({
    queryKey: SCHEDULES_KEY,
    queryFn: fetchBoardSchedules,
    staleTime: 60_000,
  });
}

export function useCreateBoardSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBoardSchedule,
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

export function useUpdateBoardSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Parameters<typeof updateBoardSchedule>[1] }) =>
      updateBoardSchedule(id, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

export function useDeleteBoardSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBoardSchedule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

import { api } from '@/lib/api';
import type { SlotKey } from './chair-util';

export type ChairRecord = {
  id: string;
  practice_id: string;
  chair_name: string;
  weekday: number;
  slot: SlotKey;
  booked_minutes: number;
  available_minutes: number;
  notes: string | null;
};

export type ChairCell = { bookedMin: number; availableMin: number; pct: number | null };

export type ChairGrid = {
  days: number[];
  slots: SlotKey[];
  grid: ChairCell[][]; // [slotIndex][dayIndex]
  kpis: {
    avgUtilPct: number | null;
    peakSlot: { weekday: number; slot: SlotKey; pct: number } | null;
    lowestSlot: { weekday: number; slot: SlotKey; pct: number } | null;
    idleChairHours: number;
  };
};

export type ChairInput = {
  practice_id: string;
  chair_name: string;
  weekday: number;
  slot: SlotKey;
  booked_minutes: number;
  available_minutes: number;
  notes?: string;
};

export function listChairRecords(practiceId: string) {
  return api<{ records: ChairRecord[] }>(`/api/chair-utilisation?practice_id=${practiceId}`);
}
export function getChairGrid(practiceId: string) {
  return api<ChairGrid>(`/api/chair-utilisation/grid?practice_id=${practiceId}`);
}
export function createChairRecord(input: ChairInput) {
  return api<ChairRecord>('/api/chair-utilisation', { method: 'POST', body: JSON.stringify(input) });
}
export function updateChairRecord(id: string, patch: Partial<Omit<ChairInput, 'practice_id'>>) {
  return api<ChairRecord>(`/api/chair-utilisation/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function deleteChairRecord(id: string) {
  return api<{ ok: boolean }>(`/api/chair-utilisation/${id}`, { method: 'DELETE' });
}

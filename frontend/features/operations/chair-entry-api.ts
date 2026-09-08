import { api } from '@/lib/api';

// The server owns the slot vocabulary and every cell's available minutes. This
// module deliberately defines NO slot windows and NO capacity arithmetic — a
// second copy of either would drift from the backend without anything failing.

export type SlotKey = string;

export type ChairCellState = {
  availableMinutes: number;
  /** null when nothing has been entered. An empty cell is unknown, not a
   *  booked zero, so it renders blank rather than as "0". */
  bookedMinutes: number | null;
  revenuePence: number | null;
  notes: string | null;
  /** More booked time than the practice is open for. Shown, not silently
   *  clamped: the owner has to see it to correct it. */
  overbooked: boolean;
};

export type ChairWeek = {
  chairs: { id: string; name: string; displayOrder: number }[];
  openingHours: {
    id: string;
    practice_id: string;
    weekday: number;
    open_minute: number | null;
    close_minute: number | null;
    source: 'dentally' | 'manual';
  }[];
  slots: SlotKey[];
  weekByChair: Record<string, Record<string, Record<string, ChairCellState>>>;
  coverage: { openCells: number; enteredCells: number; coveragePct: number | null };
};

export type OpeningHoursDay = {
  weekday: number;
  openMinute: number | null;
  closeMinute: number | null;
};

export type WeekCellInput = {
  weekday: number;
  slot: SlotKey;
  booked_minutes: number;
  revenue_pence: number;
  notes?: string;
};

export function getChairWeek(practiceId: string) {
  return api<ChairWeek>(`/api/chair-utilisation/week?practice_id=${practiceId}`);
}

export function saveChairWeek(input: {
  practice_id: string;
  chair_id: string;
  cells: WeekCellInput[];
}) {
  return api<{ saved: number }>('/api/chair-utilisation/week', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function createChair(input: { practice_id: string; name: string; display_order?: number }) {
  return api<{ id: string; name: string }>('/api/chair-utilisation/chairs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateChair(id: string, patch: { name?: string; active?: boolean; display_order?: number }) {
  return api<{ id: string; name: string }>(`/api/chair-utilisation/chairs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteChair(id: string) {
  return api<{ ok: boolean }>(`/api/chair-utilisation/chairs/${id}`, { method: 'DELETE' });
}

export function saveOpeningHours(input: { practice_id: string; days: OpeningHoursDay[] }) {
  return api<{ days: ChairWeek['openingHours'] }>('/api/chair-utilisation/opening-hours', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

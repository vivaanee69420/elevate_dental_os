import { formatTime12h } from '@/lib/format';

// Slot keys must match the backend enum (chair-utilisation.model.js SLOTS).
export const SLOT_KEYS = ['morning', 'midday', 'afternoon', 'evening'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

// Display windows (24h internal -> 12h label). Pure presentation.
const SLOT_WINDOWS: Record<SlotKey, [string, string]> = {
  morning: ['08:00', '11:00'],
  midday: ['11:00', '14:00'],
  afternoon: ['14:00', '17:00'],
  evening: ['17:00', '20:00'],
};

export const SLOT_LABEL: Record<SlotKey, string> = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

export function slotTimeLabel(slot: SlotKey): string {
  const [a, b] = SLOT_WINDOWS[slot];
  return `${formatTime12h(a)}–${formatTime12h(b)}`;
}

// ISO weekday 1..7 -> short label. Columns render Mon..Sun.
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

// Heatmap cell colour by utilisation %. null (no capacity) -> neutral grey.
export function chairUtilColour(pct: number | null): string {
  if (pct == null) return '#E5E7EB';
  if (pct >= 90) return '#10B981';
  if (pct >= 75) return '#0E7C7B';
  if (pct >= 60) return '#F59E0B';
  return '#EF4444';
}

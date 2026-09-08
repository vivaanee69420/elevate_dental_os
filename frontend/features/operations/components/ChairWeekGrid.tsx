'use client';
// One chair's whole week as a single editable grid.
//
// This replaces a seven-field form that saved ONE cell per submission. A
// chair's week is 28 cells and a two-chair practice is 56, which is why nine
// cells exist across the entire platform. Here the week is one screen and one
// save.
//
// Available minutes are DERIVED from the practice's opening hours and are not
// editable — they are a fact from Dentally, not a number to retype. Closed
// slots are disabled and labelled, so a practice that shuts at 17:00 is never
// asked how busy its evening was.

import { useEffect, useMemo, useState } from 'react';
import type { ChairWeek, WeekCellInput } from '../chair-entry-api';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};
// Presentation only. The server decides what a slot SPANS; this just titles it.
const SLOT_LABEL: Record<string, string> = {
  morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening',
};

type Draft = Record<string, { booked: string; revenue: string }>;
const key = (weekday: number, slot: string) => `${weekday}|${slot}`;

/** Minutes to a plain hours string for editing. Blank stays blank — an empty
 *  cell is unknown, and showing "0" would put a number in the owner's mouth. */
const toHours = (mins: number | null) => (mins == null ? '' : String(mins / 60));
const toPounds = (pence: number | null) => (pence == null ? '' : String(pence / 100));

export function ChairWeekGrid({
  week, chairId, saving, onSave,
}: {
  week: ChairWeek;
  chairId: string;
  saving: boolean;
  onSave: (cells: WeekCellInput[]) => void;
}) {
  const cells = week.weekByChair[chairId];
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the chair or the server data changes, so switching chairs
  // never carries one chair's numbers onto another.
  useEffect(() => {
    const next: Draft = {};
    for (const weekday of WEEKDAYS) {
      for (const slot of week.slots) {
        const cell = cells?.[weekday]?.[slot];
        next[key(weekday, slot)] = {
          booked: toHours(cell?.bookedMinutes ?? null),
          revenue: toPounds(cell?.revenuePence ?? null),
        };
      }
    }
    setDraft(next);
    setError(null);
  }, [week, chairId, cells]);

  const openSlots = useMemo(
    () => week.slots.filter((slot) =>
      WEEKDAYS.some((d) => (cells?.[d]?.[slot]?.availableMinutes ?? 0) > 0)),
    [week.slots, cells],
  );

  const set = (weekday: number, slot: string, field: 'booked' | 'revenue', value: string) =>
    setDraft((d) => ({ ...d, [key(weekday, slot)]: { ...d[key(weekday, slot)], [field]: value } }));

  /** Copy Monday down the rest of the week. The single biggest saving in a
   *  typical practice, whose week is the same shape five days running. */
  function applyMondayAcross() {
    setDraft((d) => {
      const next = { ...d };
      for (const weekday of WEEKDAYS) {
        if (weekday === 1) continue;
        for (const slot of week.slots) {
          // Only into slots this weekday is actually open for.
          if ((cells?.[weekday]?.[slot]?.availableMinutes ?? 0) <= 0) continue;
          next[key(weekday, slot)] = { ...d[key(1, slot)] };
        }
      }
      return next;
    });
  }

  function clearAll() {
    setDraft((d) => {
      const next = { ...d };
      for (const k of Object.keys(next)) next[k] = { booked: '', revenue: '' };
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const out: WeekCellInput[] = [];
    for (const weekday of WEEKDAYS) {
      for (const slot of week.slots) {
        const available = cells?.[weekday]?.[slot]?.availableMinutes ?? 0;
        if (available <= 0) continue; // never save into a closed slot
        const entry = draft[key(weekday, slot)];
        if (!entry || entry.booked.trim() === '') continue; // untouched stays unknown
        const bookedMinutes = Math.round(Number(entry.booked) * 60);
        if (!Number.isFinite(bookedMinutes) || bookedMinutes < 0) {
          setError(`${WEEKDAY_LABEL[weekday]} ${SLOT_LABEL[slot] ?? slot}: booked hours must be a number.`);
          return;
        }
        out.push({
          weekday,
          slot,
          booked_minutes: bookedMinutes,
          revenue_pence: Math.round(Number(entry.revenue || 0) * 100),
        });
      }
    }
    if (!out.length) {
      setError('Nothing to save yet — enter the booked hours for at least one slot.');
      return;
    }
    setError(null);
    onSave(out);
  }

  if (!cells) {
    return <p className="text-ink-muted" style={{ fontSize: 13 }}>Select a chair to enter its week.</p>;
  }

  if (openSlots.length === 0) {
    return (
      <p className="text-ink-muted" style={{ fontSize: 13 }}>
        This practice has no opening hours set, so there is nothing to fill in yet.
        Set the opening hours above and the week will appear.
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
        <div className="flex" style={{ gap: 8 }}>
          <button type="button" onClick={applyMondayAcross} className="btn-ghost"
            style={{ fontSize: 12, border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 8 }}>
            Copy Monday across the week
          </button>
          <button type="button" onClick={clearAll} className="btn-ghost"
            style={{ fontSize: 12, border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 8 }}>
            Clear
          </button>
        </div>
        <button type="submit" className="btn-primary" disabled={saving}
          style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8 }}>
          {saving ? 'Saving…' : 'Save week'}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780 }}>
          <thead>
            <tr className="text-ink-muted font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.05em', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px 8px 0', width: 110 }}>Slot</th>
              {WEEKDAYS.map((d) => (
                <th key={d} style={{ padding: '8px 6px', textAlign: 'center' }}>{WEEKDAY_LABEL[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {openSlots.map((slot) => (
              <tr key={slot} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="font-semibold" style={{ padding: '10px 12px 10px 0', whiteSpace: 'nowrap' }}>
                  {SLOT_LABEL[slot] ?? slot}
                </td>
                {WEEKDAYS.map((weekday) => {
                  const cell = cells[weekday]?.[slot];
                  const available = cell?.availableMinutes ?? 0;
                  if (available <= 0) {
                    return (
                      <td key={weekday} className="text-ink-muted text-center"
                        style={{ padding: '10px 6px', fontSize: 11, background: 'var(--surface-muted, #F6F6F5)' }}>
                        Closed
                      </td>
                    );
                  }
                  const entry = draft[key(weekday, slot)] ?? { booked: '', revenue: '' };
                  const overbooked = Number(entry.booked) * 60 > available;
                  return (
                    <td key={weekday} style={{ padding: '8px 6px', verticalAlign: 'top' }}>
                      <div className="text-ink-muted" style={{ fontSize: 10, marginBottom: 3 }}>
                        {available / 60}h open
                      </div>
                      <input
                        type="number" min="0" step="0.25" value={entry.booked}
                        onChange={(e) => set(weekday, slot, 'booked', e.target.value)}
                        placeholder="hrs"
                        aria-label={`Booked hours, ${WEEKDAY_LABEL[weekday]} ${SLOT_LABEL[slot] ?? slot}`}
                        style={{
                          width: '100%', fontSize: 12, padding: '5px 6px', borderRadius: 6,
                          border: `1px solid ${overbooked ? 'var(--danger)' : 'var(--border)'}`,
                        }}
                      />
                      <input
                        type="number" min="0" step="0.01" value={entry.revenue}
                        onChange={(e) => set(weekday, slot, 'revenue', e.target.value)}
                        placeholder="£"
                        aria-label={`Revenue, ${WEEKDAY_LABEL[weekday]} ${SLOT_LABEL[slot] ?? slot}`}
                        style={{
                          width: '100%', fontSize: 12, padding: '5px 6px', borderRadius: 6,
                          border: '1px solid var(--border)', marginTop: 4,
                        }}
                      />
                      {overbooked && (
                        <div style={{ color: 'var(--danger)', fontSize: 10, marginTop: 3 }}>
                          Over open hours
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </form>
  );
}

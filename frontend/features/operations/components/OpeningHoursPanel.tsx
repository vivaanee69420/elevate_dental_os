'use client';
// The practice's opening hours — the capacity behind every chair figure.
//
// Synced from Dentally where the practice has a site; hand-editable where it
// does not, and a hand edit is stamped 'manual' so no future sync undoes it.
// This is why entry only asks for BOOKED time: the open time is a fact we
// already hold.

import { useEffect, useState } from 'react';
import type { ChairWeek, OpeningHoursDay } from '../chair-entry-api';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
  5: 'Friday', 6: 'Saturday', 7: 'Sunday',
};

/** Minutes from local midnight <-> "HH:MM". These are wall-clock times, never
 *  instants — as instants they would shift an hour across the BST boundary. */
const toTime = (mins: number | null) =>
  mins == null ? '' : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const toMinutes = (time: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

type Row = { weekday: number; open: string; close: string; source: 'dentally' | 'manual' | null };

export function OpeningHoursPanel({
  week, practiceId, saving, onSave,
}: {
  week: ChairWeek;
  practiceId: string;
  saving: boolean;
  onSave: (days: OpeningHoursDay[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const byWeekday = new Map(week.openingHours.map((h) => [Number(h.weekday), h]));
    setRows(WEEKDAYS.map((weekday) => {
      const h = byWeekday.get(weekday);
      return {
        weekday,
        open: toTime(h?.open_minute ?? null),
        close: toTime(h?.close_minute ?? null),
        source: h?.source ?? null,
      };
    }));
    setError(null);
  }, [week]);

  const anyHours = week.openingHours.some((h) => h.open_minute != null);
  const fromDentally = week.openingHours.some((h) => h.source === 'dentally');
  const anyManual = week.openingHours.some((h) => h.source === 'manual');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const days: OpeningHoursDay[] = [];
    for (const r of rows) {
      const open = r.open.trim();
      const close = r.close.trim();
      // Both blank is a closed day, and that is a legitimate answer.
      if (!open && !close) {
        days.push({ weekday: r.weekday, openMinute: null, closeMinute: null });
        continue;
      }
      const openMinute = toMinutes(open);
      const closeMinute = toMinutes(close);
      if (openMinute == null || closeMinute == null) {
        setError(`${WEEKDAY_LABEL[r.weekday]}: use 24-hour times like 09:00, or leave both blank if closed.`);
        return;
      }
      if (closeMinute <= openMinute) {
        setError(`${WEEKDAY_LABEL[r.weekday]}: the closing time must be after the opening time.`);
        return;
      }
      days.push({ weekday: r.weekday, openMinute, closeMinute });
    }
    setError(null);
    onSave(days);
    setEditing(false);
  }

  return (
    <div className="card-padded" style={{ marginBottom: 16 }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
        <div>
          <h2 className="display font-bold" style={{ fontSize: 17 }}>Opening hours</h2>
          <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {anyHours
              ? 'Every chair figure is measured against these hours, so you only enter booked time.'
              : 'Set your opening hours to work out how much chair time this practice has.'}
          </p>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          {fromDentally && (
            <span className="text-ink-muted font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.05em', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px' }}>
              From Dentally
            </span>
          )}
          {anyManual && (
            <span className="text-ink-muted font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.05em', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px' }}>
              Edited here
            </span>
          )}
          <button type="button" onClick={() => setEditing((v) => !v)} className="btn-ghost"
            style={{ fontSize: 12, border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 8 }}>
            {editing ? 'Cancel' : anyHours ? 'Edit' : 'Set hours'}
          </button>
        </div>
      </div>

      {!editing && (
        <div className="flex flex-wrap" style={{ gap: 16 }}>
          {rows.map((r) => (
            <div key={r.weekday} style={{ minWidth: 92 }}>
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.05em' }}>
                {WEEKDAY_LABEL[r.weekday].slice(0, 3)}
              </div>
              <div style={{ fontSize: 13, marginTop: 2 }}>
                {r.open && r.close ? `${r.open}–${r.close}` : <span className="text-ink-muted">Closed</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <form onSubmit={submit}>
          <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Leave both boxes blank for a day you are closed. Hours you set here are kept —
            a future Dentally sync will not overwrite them.
          </p>
          <div className="grid" style={{ gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
            {rows.map((r, i) => (
              <label key={r.weekday} className="flex items-center" style={{ gap: 8 }}>
                <span className="text-ink-muted" style={{ fontSize: 12, width: 76 }}>
                  {WEEKDAY_LABEL[r.weekday]}
                </span>
                <input
                  value={r.open} placeholder="09:00"
                  aria-label={`${WEEKDAY_LABEL[r.weekday]} opening time`}
                  onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                  style={{ width: 66, fontSize: 12, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <input
                  value={r.close} placeholder="17:00"
                  aria-label={`${WEEKDAY_LABEL[r.weekday]} closing time`}
                  onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                  style={{ width: 66, fontSize: 12, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              </label>
            ))}
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</div>}
          <button type="submit" className="btn-primary" disabled={saving || !practiceId}
            style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, marginTop: 12 }}>
            {saving ? 'Saving…' : 'Save opening hours'}
          </button>
        </form>
      )}
    </div>
  );
}

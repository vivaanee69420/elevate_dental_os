'use client';
// Chair Utilisation — manual, owner-managed. Records (practice + chair +
// weekday + slot, booked vs available minutes) drive a weekday x slot heatmap.
// All data is entered here; nothing comes from Dentally.

import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { usePractices } from '@/features/integrations/hooks';
import { formatNumber } from '@/lib/format';
import {
  SLOT_KEYS, SLOT_LABEL, slotTimeLabel, WEEKDAYS, WEEKDAY_LABEL, chairUtilColour,
  type SlotKey,
} from '../chair-util';
import {
  useChairRecords, useChairGrid, useCreateChairRecord, useUpdateChairRecord, useDeleteChairRecord,
} from '../chair-hooks';
import type { ChairRecord } from '../chair-api';

type FormState = {
  id: string | null;
  chair_name: string;
  weekday: number;
  slot: SlotKey;
  booked_hours: string;     // entered in hours; converted to minutes on submit
  available_hours: string;
  revenue: string;          // typical-week revenue in £; converted to pence on submit
  notes: string;
};

const EMPTY_FORM: FormState = {
  id: null, chair_name: '', weekday: 1, slot: 'morning',
  booked_hours: '', available_hours: '', revenue: '', notes: '',
};

export default function ChairScreen() {
  const { data: practicesData } = usePractices();
  const practices = practicesData?.practices ?? [];
  const [practiceId, setPracticeId] = useState<string>('');
  const selected = practiceId || practices[0]?.id || '';

  const [asOf, setAsOf] = useState<string>('');  // '' = live; YYYY-MM-DD = historical replay
  const { data: grid, isError: gridError } = useChairGrid(selected || undefined, asOf || undefined);
  const { data: recordsData } = useChairRecords(selected || undefined);
  const records = recordsData?.records ?? [];
  const gridHasData = useMemo(
    () => !!grid?.grid?.some((row) => row.some((c) => c.pct != null)),
    [grid],
  );

  const create = useCreateChairRecord(selected || undefined);
  const update = useUpdateChairRecord(selected || undefined);
  const del = useDeleteChairRecord(selected || undefined);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const editing = form.id != null;

  const kpis = grid?.kpis;
  const slotKeyOf = (s: string) => s as SlotKey;

  const peakLabel = useMemo(() => {
    if (!kpis?.peakSlot) return '—';
    return `${WEEKDAY_LABEL[kpis.peakSlot.weekday]} ${SLOT_LABEL[slotKeyOf(kpis.peakSlot.slot)]}`;
  }, [kpis]);
  const lowestLabel = useMemo(() => {
    if (!kpis?.lowestSlot) return '—';
    return `${WEEKDAY_LABEL[kpis.lowestSlot.weekday]} ${SLOT_LABEL[slotKeyOf(kpis.lowestSlot.slot)]}`;
  }, [kpis]);

  function startEdit(r: ChairRecord) {
    setForm({
      id: r.id, chair_name: r.chair_name, weekday: r.weekday, slot: r.slot,
      booked_hours: String(r.booked_minutes / 60),
      available_hours: String(r.available_minutes / 60),
      revenue: r.revenue_pence ? String(r.revenue_pence / 100) : '',
      notes: r.notes ?? '',
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const booked_minutes = Math.round(Number(form.booked_hours || 0) * 60);
    const available_minutes = Math.round(Number(form.available_hours || 0) * 60);
    if (booked_minutes > available_minutes) {
      setError('Booked hours cannot exceed available hours.');
      return;
    }
    setError(null);
    const revenue_pence = Math.round(Number(form.revenue || 0) * 100);
    const base = {
      chair_name: form.chair_name.trim(), weekday: form.weekday, slot: form.slot,
      booked_minutes, available_minutes, revenue_pence, notes: form.notes.trim() || undefined,
    };
    if (editing && form.id) {
      update.mutate({ id: form.id, patch: base }, { onSuccess: () => setForm(EMPTY_FORM) });
    } else {
      create.mutate({ practice_id: selected, ...base }, { onSuccess: () => setForm(EMPTY_FORM) });
    }
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Chair Utilisation</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Manual booked vs available chair time · weekday × slot
          </p>
        </div>
        <select
          value={selected}
          onChange={(e) => setPracticeId(e.target.value)}
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
        >
          {practices.length === 0 && <option value="">No practices</option>}
          {practices.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Avg utilisation" value={kpis?.avgUtilPct != null ? `${kpis.avgUtilPct}%` : '—'} sub="UK avg: 72%" subColor="var(--success)" />
        <Kpi label="Peak slot" value={peakLabel} sub={kpis?.peakSlot ? `${kpis.peakSlot.pct}% utilised` : ''} subColor="var(--success)" />
        <Kpi label="Lowest slot" value={lowestLabel} sub={kpis?.lowestSlot ? `${kpis.lowestSlot.pct}% utilised` : ''} subColor="var(--danger)" />
        <Kpi label="Idle chair-hours" value={kpis ? formatNumber(kpis.idleChairHours) : '—'} sub="/week" subColor="var(--danger)" />
      </div>

      {/* Heatmap */}
      <div className="card-padded mb-4">
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h2 className="display font-bold" style={{ fontSize: 17 }}>Heatmap</h2>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span className="text-ink-muted font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.05em' }}>
              {asOf ? 'As of' : 'Live'}
            </span>
            <input type="date" value={asOf} max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setAsOf(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }} />
            {asOf && (
              <button type="button" className="btn-ghost" style={{ fontSize: 12, border: '1px solid var(--border)', padding: '6px 10px' }}
                onClick={() => setAsOf('')}>Live</button>
            )}
          </div>
        </div>
        {asOf && (
          <div className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Showing the grid as it stood on or before {asOf} (historical snapshot).
          </div>
        )}
        {!grid && gridError && <div className="text-ink-muted" style={{ fontSize: 13 }}>Could not load chair utilisation. Please try again.</div>}
        {!grid && !gridError && <Skeleton className="w-full" style={{ height: 200 }} />}
        {grid && !gridHasData && (
          <div className="text-ink-muted" style={{ fontSize: 13 }}>
            {asOf
              ? `No snapshot recorded on or before ${asOf}.`
              : 'No utilisation records yet. Add chairs and hours below to build the heatmap.'}
          </div>
        )}
        {grid && gridHasData && (
          <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${WEEKDAYS.length}, 1fr)`, gap: 6, maxWidth: 900 }}>
            <div />
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-ink-muted font-bold" style={{ fontSize: 12 }}>
                {WEEKDAY_LABEL[d]}
              </div>
            ))}
            {SLOT_KEYS.map((slot, slotIdx) => (
              <FragmentRow key={slot} slot={slot} slotIdx={slotIdx} grid={grid.grid} />
            ))}
          </div>
        )}
      </div>

      {/* Records management */}
      <div className="card-padded">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
          {editing ? 'Edit record' : 'Add record'}
        </h2>
        <form onSubmit={submit} className="grid gap-3" style={{ gridTemplateColumns: 'repeat(7, 1fr)', alignItems: 'end', marginBottom: 16 }}>
          <Field label="Chair">
            <input required value={form.chair_name} onChange={(e) => setForm({ ...form, chair_name: e.target.value })}
              placeholder="Surgery 1" style={inputStyle} />
          </Field>
          <Field label="Weekday">
            <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} style={inputStyle}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{WEEKDAY_LABEL[d]}</option>)}
            </select>
          </Field>
          <Field label="Slot">
            <select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value as SlotKey })} style={inputStyle}>
              {SLOT_KEYS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]} ({slotTimeLabel(s)})</option>)}
            </select>
          </Field>
          <Field label="Booked (hrs)">
            <input required type="number" min="0" step="0.25" value={form.booked_hours}
              onChange={(e) => setForm({ ...form, booked_hours: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Available (hrs)">
            <input required type="number" min="0" step="0.25" value={form.available_hours}
              onChange={(e) => setForm({ ...form, available_hours: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Revenue (£)">
            <input type="number" min="0" step="0.01" value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value })} placeholder="this slot/wk" style={inputStyle} />
          </Field>
          <div className="flex" style={{ gap: 8 }}>
            <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }} disabled={!selected || create.isPending || update.isPending}>
              {editing ? 'Save' : 'Add'}
            </button>
            {editing && (
              <button type="button" className="btn-ghost" style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--border)' }} onClick={() => setForm(EMPTY_FORM)}>
                Cancel
              </button>
            )}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Notes">
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes" style={inputStyle} />
            </Field>
          </div>
          {error && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--danger)', fontSize: 13 }}>{error}</div>
          )}
        </form>

        {records.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px 8px 0' }}>Chair</th>
                <th style={{ padding: '8px 12px' }}>Weekday</th>
                <th style={{ padding: '8px 12px' }}>Slot</th>
                <th style={{ padding: '8px 12px' }}>Booked</th>
                <th style={{ padding: '8px 12px' }}>Available</th>
                <th style={{ padding: '8px 12px' }}>Revenue/wk</th>
                <th style={{ padding: '8px 0 8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px 10px 0' }}>{r.chair_name}</td>
                  <td style={{ padding: '10px 12px' }}>{WEEKDAY_LABEL[r.weekday]}</td>
                  <td style={{ padding: '10px 12px' }}>{SLOT_LABEL[r.slot]}</td>
                  <td style={{ padding: '10px 12px' }}>{(r.booked_minutes / 60).toFixed(2)}h</td>
                  <td style={{ padding: '10px 12px' }}>{(r.available_minutes / 60).toFixed(2)}h</td>
                  <td style={{ padding: '10px 12px' }}>{`£${((r.revenue_pence ?? 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                  <td style={{ padding: '10px 0 10px 12px', whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn-ghost" style={{ fontSize: 12, marginRight: 8 }} onClick={() => startEdit(r)}>Edit</button>
                    <button type="button" className="btn-ghost" style={{ fontSize: 12, color: '#991B1B' }} onClick={() => del.mutate(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="text-ink-muted font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor: string }) {
  return (
    <div className="card-padded">
      <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>{label}</div>
      <div className="display font-bold" style={{ fontSize: 22, marginTop: 4 }}>{value}</div>
      {sub && <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: subColor }}>{sub}</div>}
    </div>
  );
}

function FragmentRow({ slot, slotIdx, grid }: { slot: SlotKey; slotIdx: number; grid: { pct: number | null }[][] }) {
  return (
    <>
      <div className="text-ink-muted text-right" style={{ fontSize: 11, paddingRight: 8, alignSelf: 'center' }}>
        {SLOT_LABEL[slot]}
      </div>
      {WEEKDAYS.map((_, dayIdx) => {
        const pct = grid[slotIdx]?.[dayIdx]?.pct ?? null;
        return (
          <div key={dayIdx} className="text-center text-white font-bold"
            style={{ background: chairUtilColour(pct), borderRadius: 6, padding: '14px 8px', fontSize: 13 }}>
            {pct == null ? '—' : `${pct}%`}
          </div>
        );
      })}
    </>
  );
}

'use client';

// Treatment Mix heat matrix (GM Intelligence OS, Phase 2). Treatment type (rows)
// x practice (columns) for the selected scope/period, in two modes:
//   - Volume  : appointment count (from appointments.appointment_type). No price.
//   - Revenue : real invoiced fee in £ (from Dentally invoice_items).
// Green heat tint via the shared HeatCell primitive (value is never colour-only
// — WCAG 1.4.1). Insight cards reflect the active mode. Lab/material COST is
// never in the Dentally feed (set it in the Workbench) — surfaced honestly.

import { useState } from 'react';
import { PageHeader, KpiTile, HeatCell, EmptyState, AlertRow } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { formatNumber, formatPence } from '@/lib/format';
import { useTreatmentMatrix, useTreatmentRevenue } from '../treatment-matrix-hooks';

type Mode = 'volume' | 'revenue';

export default function TreatmentMatrixScreen() {
  const [mode, setMode] = useState<Mode>('volume');
  const vol = useTreatmentMatrix(mode === 'volume');
  const rev = useTreatmentRevenue(mode === 'revenue');
  const q = mode === 'volume' ? vol : rev;
  const { data, isLoading, isError, error } = q;

  // Cell/total formatter per mode (£ pence vs plain count).
  const fmt = (n: number) => (mode === 'revenue' ? formatPence(n) : formatNumber(n));

  const th = 'text-[11px] uppercase tracking-wider text-ink-muted font-semibold p-2 align-bottom';
  const tab = (m: Mode, label: string) =>
    `px-3 py-1.5 text-[13px] rounded-lg border ${mode === m ? 'bg-brand text-white border-brand' : 'bg-card text-ink border-border'}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Treatment Mix"
        subtitle="Where clinical activity and revenue sit — by treatment across the group, with single-site and concentration risks called out."
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopePeriodBar />
        <div className="flex gap-1.5">
          <button className={tab('volume', 'Volume')} onClick={() => setMode('volume')}>Volume</button>
          <button className={tab('revenue', 'Revenue £')} onClick={() => setMode('revenue')}>Revenue £</button>
        </div>
      </div>

      {isLoading && <EmptyState message="Loading treatment mix…" />}

      {isError && (
        <AlertRow tone="bad" title="Couldn't load treatment mix" body={(error as Error)?.message} />
      )}

      {data && !data.applicable && (
        <AlertRow
          tone="info"
          title="Treatment mix applies to clinical practices"
          body={data.message || 'Switch scope to the whole group or a single practice.'}
        />
      )}

      {data && data.applicable && (
        <>
          <AlertRow
            tone="info"
            title={mode === 'revenue' ? 'Patient fees, not cost' : 'Volume, not revenue'}
            body={
              data.note ||
              (mode === 'revenue'
                ? 'Real invoiced fees from Dentally (the patient price). Lab/material cost is not in the feed — set it in the Workbench.'
                : 'Appointment volume only — Dentally provides no per-treatment price here, so this ranks clinical activity. Switch to Revenue for real fees.')
            }
          />

          {data.grandTotal === 0 ? (
            <EmptyState
              message={
                mode === 'revenue'
                  ? `No invoiced treatments in scope for ${data.window?.label ?? 'this period'}. Run a Dentally sync to pull invoices, or widen the period.`
                  : `No appointments in scope for ${data.window?.label ?? 'this period'}. Connect Dentally and run a sync, or widen the period.`
              }
            />
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <KpiTile
                  label={`${mode === 'revenue' ? 'Invoiced fees' : 'Appointments'} · ${data.window?.label ?? ''}`.trim()}
                  value={fmt(data.grandTotal)}
                />
                <KpiTile label="Treatment types" value={formatNumber(data.distinctTypes)} />
                <KpiTile
                  label={mode === 'revenue' ? 'Top earner' : 'Top treatment'}
                  value={data.types[0]?.type ?? '—'}
                  delta={data.types[0] ? `${data.types[0].sharePct}% of ${mode === 'revenue' ? 'fees' : 'volume'}` : undefined}
                />
                <KpiTile
                  label="Busiest practice"
                  value={data.practices[0]?.name ?? '—'}
                  delta={
                    data.practices[0] && data.grandTotal
                      ? `${Math.round((1000 * data.practices[0].total) / data.grandTotal) / 10}% of ${mode === 'revenue' ? 'fees' : 'appointments'}`
                      : undefined
                  }
                />
              </div>

              {data.insights.length > 0 && (
                <div>
                  {data.insights.map((ins, i) => (
                    <AlertRow key={i} tone={ins.tone} title={ins.title} body={ins.body} />
                  ))}
                </div>
              )}

              <div className="card overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={`${th} text-left`}>Treatment</th>
                      {data.practices.map((p) => (
                        <th key={p.id} className={`${th} text-right`}>{p.name}</th>
                      ))}
                      <th className={`${th} text-right`}>Total</th>
                      <th className={`${th} text-right`}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.types.map((row) => (
                      <tr key={`${row.type}-${row.isOther}`} className="border-b border-border last:border-0">
                        <td className="p-2 align-top">
                          <span className={row.isOther ? 'text-ink-muted italic' : 'font-semibold'}>{row.type}</span>
                        </td>
                        {row.cells.map((v, ci) => (
                          <HeatCell
                            key={data.practices[ci]?.id ?? ci}
                            value={v > 0 ? fmt(v) : ''}
                            intensity={data.maxCell ? v / data.maxCell : 0}
                          />
                        ))}
                        <td className="p-2 text-right font-semibold tabular-nums align-top">{fmt(row.total)}</td>
                        <td className="p-2 text-right text-ink-muted tabular-nums align-top">{row.sharePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td className="p-2 text-left text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Total</td>
                      {data.practices.map((p) => (
                        <td key={p.id} className="p-2 text-right font-semibold tabular-nums">{fmt(p.total)}</td>
                      ))}
                      <td className="p-2 text-right font-bold tabular-nums">{fmt(data.grandTotal)}</td>
                      <td className="p-2 text-right text-ink-muted">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

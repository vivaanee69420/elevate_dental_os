'use client';

// Data Room dictionary — a slide-in panel explaining every column of the
// active dataset. Content comes from the API registry (unit + description),
// so it is always in step with what the table shows. No dark mode.

import { useEffect } from 'react';
import type { DataRoomDataset } from '../api';

const UNIT_LABEL: Record<string, string> = {
  id: 'id', hash: 'hash', pence: 'pence (£ = ÷100)', count: 'count', number: 'number', percent: '%',
  minutes: 'minutes', flag: 'yes / no', date: 'date', timestamptz: 'timestamp', text: 'text',
};

const RULES: [string, string][] = [
  ['Patient appointment', 'A Dentally appointment with a patient attached. Diary blocks (lunch, admin) are excluded — matches Dentally\'s "With patients" view.'],
  ['Occurred / DNA', 'Patient appointment with status completed / no_show. DNA % = DNA ÷ (occurred + DNA).'],
  ['New patient', 'Dentally registration date falls in the period.'],
  ['Treatment activity', 'Items completed and not base-chart, dated on completed_at, attributed to the practitioner\'s home site.'],
  ['Billed / Settled', 'Invoice lines by invoiced_on (fee × quantity) / payments with status settled by processed_at.'],
  ['Leads won / lost', 'GoHighLevel opportunities by created date; won = treatment started or completed; lost = not proceeding or failed to attend.'],
  ['Accounting revenue / costs', 'Xero or QuickBooks accrual rows per month; manual rows count only where nothing was synced. Costs exclude tax.'],
];

export default function DictionaryDrawer({
  open, dataset, sourceLabel, onClose,
}: { open: boolean; dataset: DataRoomDataset | null; sourceLabel: string; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !dataset) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Column dictionary">
      <button type="button" aria-label="Close dictionary" onClick={onClose} className="absolute inset-0 bg-black/20" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-card border-l border-border shadow-panel overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">Dictionary · {sourceLabel} / {dataset.label}</div>
            <div className="text-[12px] text-ink-muted">
              {dataset.summary ? 'Summary dataset — one row per practice per period.' : dataset.roster ? 'Current list — not date-filtered.' : 'One row per source record.'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto text-[13px] text-ink-muted hover:text-ink">Close</button>
        </div>

        <div className="px-5 py-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">Column</th>
                <th className="py-1.5 pr-3 font-medium">Unit</th>
                <th className="py-1.5 pr-3 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {dataset.columns.map((c) => (
                <tr key={c.col} className="border-t border-border align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <code className="text-[12px]">{c.col}</code>
                    {c.derived && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-brand">derived</span>}
                    {c.pii && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-muted">PII</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-muted">{UNIT_LABEL[c.unit] ?? c.unit}</td>
                  <td className="py-2 pr-3 text-ink">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">How the numbers are defined</h3>
          <dl className="text-[13px]">
            {RULES.map(([k, v]) => (
              <div key={k} className="py-1.5 border-t border-border">
                <dt className="font-medium text-ink">{k}</dt>
                <dd className="text-ink-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}

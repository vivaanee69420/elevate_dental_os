'use client';
// §7 Revenue by line — invoiced fee per treatment, largest-first. Sourced from
// Dentally invoice_items via the treatment_revenue_matrix RPC.
//
// Live data only runs from 10 Jun 2026, so a window before that is legitimately
// empty. The empty state says so — rendering "£0" would read as "we invoiced
// nothing", which is not what an absent feed means.
import { Panel, PanelHead } from '@/features/intelligence/components/os-ui';
import { formatPence } from '@/lib/format';
import type { RevenueLine } from '../api';

export function RevenueByLine({ lines }: { lines: RevenueLine[] }) {
  if (lines.length === 0) {
    return (
      <Panel>
        <PanelHead title="Revenue by line" sub="Invoiced fee per treatment, from Dentally." />
        <p className="text-sm text-ink-muted">
          No invoiced treatment lines in this window. Dentally invoice data starts on 10 June 2026 &mdash; earlier
          windows have nothing to show rather than nothing invoiced.
        </p>
      </Panel>
    );
  }

  const max = lines[0].amountPence || 1;

  return (
    <Panel>
      <PanelHead title="Revenue by line" sub="Invoiced fee per treatment, from Dentally. Largest first." />
      <div className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <div key={l.name} className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate text-[12px] text-slate-700" title={l.name}>
              {l.name}
            </div>
            <div className="h-2.5 rounded-full bg-emerald-700" style={{ width: `${(l.amountPence / max) * 100}%` }} />
            <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-slate-900">
              {formatPence(l.amountPence)} &middot; {l.sharePct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

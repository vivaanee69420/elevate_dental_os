'use client';
// §7 Revenue by line — invoiced fee per treatment, largest-first. Sourced from
// Dentally invoice_items via the treatment_revenue_matrix RPC.
//
// An empty result can mean either "nothing invoiced in this window" or "no
// Dentally feed for this practice at all" — the empty state says so rather
// than rendering "£0", which would read as "we invoiced nothing" when the
// truth may be "we cannot say" (no earliest-coverage date is asserted here;
// that varies per org's Dentally connection, not a fixed platform date).
import { Panel, PanelHead } from '@/features/intelligence/components/os-ui';
import { formatPence } from '@/lib/format';
import type { RevenueLine } from '../api';

export function RevenueByLine({ lines }: { lines: RevenueLine[] }) {
  if (lines.length === 0) {
    return (
      <Panel>
        <PanelHead title="Revenue by line" sub="Invoiced fee per treatment, from Dentally." />
        <p className="text-sm text-ink-muted">
          No invoiced treatment lines for this practice and period. This may mean nothing was invoiced in this window,
          or that there is no Dentally feed for this practice.
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

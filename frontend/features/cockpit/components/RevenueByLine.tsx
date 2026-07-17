'use client';
// §7 Revenue by line — invoiced fee per treatment, largest-first. Sourced from
// Dentally invoice_items via the treatment_revenue_matrix RPC.
//
// An empty result can mean either "nothing invoiced in this window" or "no
// Dentally feed for this practice at all" — the empty state says so rather
// than rendering "£0", which would read as "we invoiced nothing" when the
// truth may be "we cannot say" (no earliest-coverage date is asserted here;
// that varies per org's Dentally connection, not a fixed platform date).
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead, cockpitStyles as s } from './cockpit-ui';
import type { RevenueLine } from '../api';

export function RevenueByLine({ lines }: { lines: RevenueLine[] }) {
  if (lines.length === 0) {
    return (
      <SectionCard>
        <SecHead
          n="✓"
          tone="ok"
          title="Revenue by line"
          desc="Invoiced fee per treatment, from Dentally."
          src={{ label: 'Already working — Dentally', ok: true }}
        />
        <p className={s.subtle} style={{ fontSize: 13 }}>
          No invoiced treatment lines for this practice and period. This may mean nothing was invoiced in this window,
          or that there is no Dentally feed for this practice.
        </p>
      </SectionCard>
    );
  }

  const max = lines[0].amountPence || 1;

  return (
    <SectionCard>
      <SecHead
        n="✓"
        tone="ok"
        title="Revenue by line"
        desc="Invoiced fee per treatment, from Dentally. Largest first."
        src={{ label: 'Already working — Dentally', ok: true }}
      />
      <div style={{ marginTop: 8 }}>
        {lines.map((l) => (
          <div key={l.name} className={s.barrow}>
            <div className={s.barLabel} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>
              {l.name}
            </div>
            <div className={s.bar} style={{ width: `${(l.amountPence / max) * 100}%` }} />
            <span className={s.money} style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
              {formatPence(l.amountPence)} &middot; {l.sharePct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

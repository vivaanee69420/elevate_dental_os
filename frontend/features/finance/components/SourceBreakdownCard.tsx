'use client';
// Source provenance widget for Finance screens. Shows which provider produced
// the rows feeding the P&L over the last 30 days. Drives owner trust ("am I
// looking at real Stripe data, or just numbers I typed?").

import { usePaymentSourceBreakdown } from '../hooks';

const PROVIDER_LABEL: Record<string, string> = {
  manual: 'Manual entry',
  stripe: 'Stripe',
  dentally: 'Dentally',
  soe: 'SOE Exact',
  xero: 'Xero',
  quickbooks: 'QuickBooks',
};

const PROVIDER_COLOUR: Record<string, string> = {
  manual: '#64748B',
  stripe: '#635BFF',
  dentally: '#0E7C7B',
  soe: '#0891B2',
  xero: '#13B5EA',
  quickbooks: '#2CA01C',
};

function formatPounds(pence: number): string {
  return '£' + Math.round(pence / 100).toLocaleString('en-GB');
}

export default function SourceBreakdownCard({ days = 30 }: { days?: number }) {
  const { data, isLoading } = usePaymentSourceBreakdown(days);
  if (isLoading) {
    return (
      <div className="card-padded">
        <div className="text-ink-muted" style={{ fontSize: 12 }}>Loading data sources…</div>
      </div>
    );
  }
  const entries = Object.entries(data ?? {});
  const totalPence = entries.reduce((s, [, v]) => s + v.pence, 0);
  return (
    <div className="card-padded">
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          Where this data came from · last {days} days
        </div>
        <div className="text-ink-muted" style={{ fontSize: 11 }}>
          Total payments {formatPounds(totalPence)} across {entries.length} sources
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 12 }}>
          No payments yet. Connect Stripe / Dentally or add manual entries.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries
            .sort((a, b) => b[1].pence - a[1].pence)
            .map(([source, v]) => {
              const pct = totalPence > 0 ? (v.pence / totalPence) * 100 : 0;
              return (
                <div key={source}>
                  <div className="flex" style={{ justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{PROVIDER_LABEL[source] ?? source}</span>
                    <span className="text-ink-muted">
                      {v.count} · {formatPounds(v.pence)} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: PROVIDER_COLOUR[source] ?? '#64748B',
                      }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

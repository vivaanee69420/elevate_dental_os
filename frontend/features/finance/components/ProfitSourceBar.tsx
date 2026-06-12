'use client';
// Data-source toggle for /profit. Picks which feed builds the P&L:
//   Combined   — Dentally revenue + all-source costs (Xero/manual/QuickBooks)
//   Dentally   — settled/billed revenue only; no cost data → costs/profit £0
//   QuickBooks — full P&L (revenue + costs) from connected QB companies, with an
//                optional per-company scope (a QB company is not practice-mapped).
import type { FinanceSource } from '../api';
import { useQboAccounts } from '../hooks';

const SOURCES: { key: FinanceSource; label: string }[] = [
  { key: 'combined', label: 'Combined' },
  { key: 'dentally', label: 'Dentally' },
  { key: 'quickbooks', label: 'QuickBooks' },
];

export default function ProfitSourceBar({
  source,
  onSourceChange,
  accountId,
  onAccountChange,
}: {
  source: FinanceSource;
  onSourceChange: (s: FinanceSource) => void;
  accountId: string | null;
  onAccountChange: (id: string | null) => void;
}) {
  const { data } = useQboAccounts();
  const accounts = (data?.accounts ?? []).filter((a) => a.status === 'active');

  const seg = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--border)',
    background: active ? 'var(--brand)' : 'white',
    color: active ? 'white' : 'var(--ink)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div className="text-xs text-ink-muted uppercase" style={{ marginBottom: 6, letterSpacing: 0.3 }}>
          Data source
        </div>
        <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden' }}>
          {SOURCES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSourceChange(s.key)}
              style={{
                ...seg(source === s.key),
                borderRadius: i === 0 ? '8px 0 0 8px' : i === SOURCES.length - 1 ? '0 8px 8px 0' : 0,
                borderLeft: i === 0 ? '1px solid var(--border)' : 'none',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {source === 'quickbooks' && (
        <div>
          <div className="text-xs text-ink-muted uppercase" style={{ marginBottom: 6, letterSpacing: 0.3 }}>
            Company
          </div>
          {accounts.length === 0 ? (
            <div className="text-sm text-ink-muted" style={{ padding: '7px 0' }}>
              No QuickBooks company connected
            </div>
          ) : (
            <select
              value={accountId ?? ''}
              onChange={(e) => onAccountChange(e.target.value || null)}
              style={{
                padding: '7px 12px',
                fontSize: 13,
                fontWeight: 600,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'white',
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
            >
              <option value="">All companies</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company_name || a.label || a.realm_id || 'Company'}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

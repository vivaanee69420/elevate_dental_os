'use client';
// Data Quality Engine panel (DentaCFO gap Phase 5). Org cleanliness score,
// connector health, per-practice breakdown, and a prioritised alert list — all
// from GET /api/analytics/data-quality (reads existing Dentally/Xero/GHL/CSV
// sync state, no new integration). Rendered on the Data Hub page.

import { Card, Chip, Skeleton } from '@/components/ui';
import type { ChipColour } from '@/components/ui/Chip';
import { formatNumber, formatPence } from '@/lib/format';
import { useDataQuality } from '../data-quality-hooks';
import type {
  Rag, Severity, ConnectorHealth, PracticeQuality, ConnectorState, QualityAlert,
} from '../data-quality-api';

const RAG_CHIP: Record<Rag, ChipColour> = { green: 'emerald', amber: 'amber', red: 'rose' };
const SEV_CHIP: Record<Severity, ChipColour> = { high: 'rose', medium: 'amber', low: 'slate' };
const HEALTH_CHIP: Record<ConnectorHealth, ChipColour> = {
  ok: 'emerald', stale: 'amber', never: 'slate', disconnected: 'rose', expired: 'rose', error: 'rose',
};
const HEALTH_LABEL: Record<ConnectorHealth, string> = {
  ok: 'Healthy', stale: 'Stale', never: 'Never synced', disconnected: 'Disconnected', expired: 'Expired', error: 'Error',
};

function scoreColour(rag: Rag): string {
  return rag === 'green' ? 'var(--brand)' : rag === 'amber' ? '#c6a253' : 'var(--danger)';
}

function lastSync(c: ConnectorState): string {
  if (c.ageHours == null) return 'never';
  if (c.ageHours < 1) return 'under 1h ago';
  if (c.ageHours < 48) return `${c.ageHours}h ago`;
  return `${Math.round(c.ageHours / 24)}d ago`;
}

export default function DataQualityPanel() {
  const { data, isLoading, error } = useDataQuality();

  if (isLoading) {
    return (
      <Card className="mb-4">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="mb-4">
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>
          Failed to load data quality: {(error as Error).message}
        </div>
      </Card>
    );
  }
  if (!data) return null;

  const { orgScore, rag, practices, connectors, alerts, totals } = data;
  const scoredPractices = practices.filter((p) => p.dims.length > 0);

  return (
    <>
      {/* Org score + alerts */}
      <Card className="mb-4">
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center', minWidth: 120 }}>
            <div className="display" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1, color: scoreColour(rag) }}>
              {orgScore}
            </div>
            <div className="text-ink-muted" style={{ fontSize: 12, marginTop: 4 }}>Data cleanliness / 100</div>
            <div style={{ marginTop: 8 }}><Chip colour={RAG_CHIP[rag]}>{rag.toUpperCase()}</Chip></div>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 10 }}>
              Action queue {alerts.length > 0 && <span className="text-ink-muted" style={{ fontWeight: 400, fontSize: 13 }}>({alerts.length})</span>}
            </h2>
            {alerts.length === 0 ? (
              <div className="text-ink-muted" style={{ fontSize: 13 }}>No data quality issues detected. All connectors healthy.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alerts.map((a: QualityAlert) => (
                  <li key={a.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                    <Chip colour={SEV_CHIP[a.severity]}>{a.severity}</Chip>
                    <span style={{ lineHeight: 1.5 }}>{a.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* Connector health */}
      <Card className="mb-4">
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>Connector health</h2>
        {connectors.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 13 }}>No integrations connected yet.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Source</th><th>Status</th><th>Last sync</th><th>Note</th></tr></thead>
            <tbody>
              {connectors.map((c) => (
                <tr key={c.provider}>
                  <td><b>{c.label}</b></td>
                  <td><Chip colour={HEALTH_CHIP[c.health]}>{HEALTH_LABEL[c.health]}</Chip></td>
                  <td className="text-ink-muted">{lastSync(c)}</td>
                  <td className="text-ink-muted" style={{ fontSize: 12 }}>
                    {c.lastError ? <span style={{ color: 'var(--danger)' }}>{c.lastError}</span>
                      : c.health === 'stale' ? `Expected within ${c.staleAfterHours}h` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Per-practice cleanliness */}
      <Card className="mb-4">
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 4 }}>Per-practice cleanliness</h2>
        <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Weighted blend of coded appointments, linked patients, matched invoices and collection rate.
          Clinician mapping is not scored — it is unset on every synced Dentally appointment
          ({formatNumber(totals.unassignedAppts)} of {formatNumber(totals.totalAppts)}).
        </p>
        {scoredPractices.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 13 }}>No appointment or invoice data yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Practice</th><th>Score</th><th>Coded</th><th>Linked</th><th>Invoices matched</th><th>Collection</th></tr>
            </thead>
            <tbody>
              {scoredPractices.map((p: PracticeQuality) => {
                const dim = (k: string) => p.dims.find((d) => d.key === k);
                const cell = (k: string) => {
                  const d = dim(k);
                  return d ? `${d.ratePct}%` : <span className="text-ink-muted">—</span>;
                };
                return (
                  <tr key={p.practiceId}>
                    <td><b>{p.name}</b></td>
                    <td><Chip colour={RAG_CHIP[p.rag]}>{p.score}</Chip></td>
                    <td>{cell('coded')}</td>
                    <td>{cell('linked')}</td>
                    <td>{cell('invoiceMatch')}</td>
                    <td>{cell('collection')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {totals.outstandingPence > 0 && (
          <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 10 }}>
            {formatPence(totals.outstandingPence)} outstanding across {formatNumber(totals.totalInvoices)} invoices.
          </p>
        )}
      </Card>
    </>
  );
}

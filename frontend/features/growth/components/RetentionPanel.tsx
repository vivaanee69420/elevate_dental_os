'use client';
// Attrition & Retention panel (DentaCFO gap Phase 6). Patient cohorts by
// last-visit recency (active / lapsed / dormant), the group retention rate, and
// the recoverable reactivation revenue pool — all from GET /api/analytics/
// retention (Dentally appointments + settled receipts, no new integration).
// Rendered on the Loyalty & Membership page, where lapsed-visit recall lives.

import { Card, Chip, KpiTile, Skeleton } from '@/components/ui';
import type { ChipColour } from '@/components/ui/Chip';
import { formatNumber, formatPence } from '@/lib/format';
import { useRetention } from '../retention-hooks';
import type { Rag, Tone, RetentionInsight, RetentionPractice } from '../retention-api';

const RAG_CHIP: Record<Rag, ChipColour> = { green: 'emerald', amber: 'amber', red: 'rose' };
const TONE_CHIP: Record<Tone, ChipColour> = { good: 'emerald', warn: 'amber', bad: 'rose', info: 'slate' };

export default function RetentionPanel() {
  const { data, isLoading, error } = useRetention('all');

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
          Failed to load retention: {(error as Error).message}
        </div>
      </Card>
    );
  }
  if (!data || data.applicable === false) return null;

  const { org, practices, insights, reactivationRate, hasData } = data;

  if (!hasData) {
    return (
      <Card className="mb-4">
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 6 }}>Attrition &amp; Retention</h2>
        <div className="text-ink-muted" style={{ fontSize: 13 }}>
          No patient visit history yet. Connect / sync Dentally to populate active, lapsed and dormant patient cohorts.
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Cohort KPI strip */}
      <div className="mb-2 flex justify-between items-end">
        <div>
          <h2 className="display font-semibold" style={{ fontSize: 18 }}>Attrition &amp; Retention</h2>
          <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 2 }}>
            Patients by last visit · reactivation pool at {Math.round(reactivationRate * 100)}% recall win-back
          </p>
        </div>
        <Chip colour={RAG_CHIP[org.rag]}>{org.retentionRatePct}% retained</Chip>
      </div>
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile
          label="Active patients"
          value={formatNumber(org.activePatients)}
          delta={`${org.retentionRatePct}% of base`}
          deltaTone="up"
        />
        <KpiTile
          label="Lapsed (12-24mo)"
          value={formatNumber(org.lapsedPatients)}
          delta="recall target"
          deltaTone="down"
        />
        <KpiTile
          label="Dormant (24mo+)"
          value={formatNumber(org.dormantPatients)}
          delta={`${org.attritionRatePct}% attrition`}
          deltaTone="down"
        />
        <KpiTile
          label="Reactivation value"
          value={formatPence(org.reactivationValuePence)}
          delta={`${formatNumber(org.reactivatablePatients)} patients/yr`}
          deltaTone="up"
        />
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <Card className="mb-4">
          <h3 className="display font-semibold" style={{ fontSize: 15, marginBottom: 10 }}>What this means</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {insights.map((i: RetentionInsight, idx: number) => (
              <li key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                <Chip colour={TONE_CHIP[i.tone]}>{i.value}</Chip>
                <span style={{ lineHeight: 1.5 }}><b>{i.title}.</b> {i.body}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Per-practice cohorts */}
      <Card className="mb-4">
        <h3 className="display font-semibold" style={{ fontSize: 15, marginBottom: 4 }}>By practice</h3>
        <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Sorted by recoverable reactivation revenue. Avg patient value = trailing-12mo settled receipts per active patient.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Practice</th><th>Active</th><th>Lapsed</th><th>Dormant</th>
              <th>Retention</th><th>Avg value</th><th>Reactivation £/yr</th>
            </tr>
          </thead>
          <tbody>
            {practices.map((p: RetentionPractice) => (
              <tr key={p.practiceId}>
                <td><b>{p.name}</b></td>
                <td>{formatNumber(p.activePatients)}</td>
                <td>{formatNumber(p.lapsedPatients)}</td>
                <td>{formatNumber(p.dormantPatients)}</td>
                <td><Chip colour={RAG_CHIP[p.rag]}>{p.retentionRatePct}%</Chip></td>
                <td className="text-ink-muted">{formatPence(p.avgPatientValuePence)}</td>
                <td><b>{formatPence(p.reactivationValuePence)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        {org.unlinkedAppts > 0 && (
          <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 10 }}>
            {formatNumber(org.unlinkedAppts)} appointments carry no patient identity (neither CRM contact nor Dentally id),
            so those patients can&apos;t be placed in a cohort or recalled — a Dentally re-sync recovers the link.
          </p>
        )}
      </Card>
    </>
  );
}

'use client';
// Practices & Patients — one card per practice with a 4-up metric strip over
// the selected window (default last 30 days). Dentally-backed: new patients
// (contacts), appointments, completed, and settled revenue per practice come
// from GET /api/growth/practice-performance. Consults / lead-conversion are
// intentionally dropped here — CRM/lead concepts, not PMS data.
//
// Clicking a practice name expands its full patient roster (paginated, from
// GET /api/growth/practice-patients). Scope + period come from the global
// ScopePeriod context (ScopePeriodBar), same as the Business Hub / analytics
// views — a specific practice narrows to one card; the period sets the window.
//
// Data flow:
//   useScopePeriod() ──> scope (practiceId) + win ──> {from,to} day window
//   usePracticePerformance(practiceId, range) ──> one card per practice ──> 4-up grid
//   usePracticePatients(practiceId, page)      ──> expandable patient table

import { useState } from 'react';
import { Card, Chip, Skeleton, SkeletonKpiRow } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod, type ResolvedWindow } from '@/features/_shared/scope-context';
import { usePracticePerformance, usePracticePatients } from '../hooks';
import PatientDetailModal from './PatientDetailModal';

// The growth endpoint takes from/to as inclusive YYYY-MM-DD days; the global
// window is [since, until) ISO instants. until is exclusive (start of next day),
// so the inclusive last day = until - 1 day.
function winToRange(win: ResolvedWindow): { from: string; to: string } {
  const from = win.since.slice(0, 10);
  const to = new Date(Date.parse(win.until) - 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

const PATIENTS_PER_PAGE = 10;

/** One labelled metric inside a practice card's 4-up grid. */
function Metric({ label, value, brand }: { label: string; value: string; brand?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div
        className="display font-semibold mt-1"
        style={{ fontSize: 22, color: brand ? 'var(--brand)' : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

/** Expandable patient roster for one practice. Mounted with key=practiceId, so
 * its page state resets when a different practice is opened. */
function PracticePatients({ practiceId }: { practiceId: string }) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = usePracticePatients(practiceId, page, PATIENTS_PER_PAGE);
  const patients = data?.patients ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PATIENTS_PER_PAGE));

  return (
    <div className="mt-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-ink-muted uppercase font-bold">Patients</span>
        <span className="text-ink-muted" style={{ fontSize: 12 }}>
          {total.toLocaleString('en-GB')} total
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-bg border-b border-border">
          <tr>
            <th className="text-left p-2 font-semibold">Name</th>
            <th className="text-left p-2 font-semibold">Email</th>
            <th className="text-left p-2 font-semibold">Phone</th>
            <th className="text-left p-2 font-semibold">Added</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && patients.length === 0 &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk-${i}`}>
                <td className="p-2" colSpan={4}><Skeleton className="h-4 w-full" /></td>
              </tr>
            ))}
          {!isLoading && patients.length === 0 && (
            <tr><td className="p-2 text-ink-muted" colSpan={4}>No patients for this practice.</td></tr>
          )}
          {patients.map((pt) => (
            <tr
              key={pt.id}
              className="border-b border-border hover:bg-bg"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedId(pt.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId(pt.id);
                }
              }}
            >
              <td className="p-2 font-semibold">
                {pt.name ?? <span className="text-ink-muted">Unknown</span>}
              </td>
              <td className="p-2 text-ink-muted">{pt.email ?? '—'}</td>
              <td className="p-2 text-ink-muted">{pt.phone ?? '—'}</td>
              <td className="p-2 text-ink-muted">
                {new Date(pt.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > 0 && (
        <div className="flex justify-between items-center mt-3">
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            Page {page} of {totalPages}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page <= 1}
              onClick={() => setPage((x) => Math.max(1, x - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
            >
              Next
            </button>
          </span>
        </div>
      )}

      <PatientDetailModal patientId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/** Practices & Patients screen: a stack of per-practice performance cards. */
export default function PatientsScreen() {
  const { scope, win } = useScopePeriod();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 'all'/'practices' => every practice (null filter); otherwise scope is a practiceId.
  const practiceId = scope === 'all' || scope === 'practices' ? null : scope;
  const range = winToRange(win);
  const { data, isLoading, error } = usePracticePerformance(practiceId, range);
  const practices = data?.practices ?? [];
  const windowLabel = win.label;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Practices &amp; Patients</h1>
        <p className="text-sm text-ink-muted mt-1">
          Performance across all practices · {windowLabel}
        </p>
      </div>

      <ScopePeriodBar />

      {isLoading && <SkeletonKpiRow count={4} className="mb-4" />}
      {error && (
        <Card className="mb-4 text-rose-600">Could not load practice performance.</Card>
      )}
      {!isLoading && !error && practices.length === 0 && (
        <Card className="mb-4 text-ink-muted">
          No practice data yet. Connect Dentally to populate this.
        </Card>
      )}

      {practices.map((p) => {
        const expanded = expandedId === p.practice_id;
        return (
          <Card key={p.practice_id} className="mb-4">
            {/* Whole header + metrics toggles the patient list; the expanded
                table (with its own pager buttons) sits outside this region. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedId(expanded ? null : p.practice_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedId(expanded ? null : p.practice_id);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="display font-semibold" style={{ fontSize: 18 }}>
                    {p.name}
                  </h2>
                  <p className="text-xs text-ink-muted mt-0.5">{windowLabel}</p>
                </div>
                <Chip colour="brand">Active</Chip>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <Metric label="New patients" value={String(p.new_patients_30d)} />
                <Metric label="Appointments" value={String(p.appts_30d)} />
                <Metric label="Completed" value={String(p.completed_30d)} />
                <Metric label="Revenue" value={formatPence(p.revenue_pence_30d)} brand />
              </div>
            </div>
            {expanded && <PracticePatients key={p.practice_id} practiceId={p.practice_id} />}
          </Card>
        );
      })}
    </div>
  );
}

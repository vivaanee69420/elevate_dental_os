'use client';
// Associates — real roster from the backend (Dentally-linked). Appointment
// volume / treatments / completion / no-show come from synced appointments;
// production (real invoiced fees), UDAs (completed NHS units) and conversion
// (treatment plans completed/started) come from invoice_items + treatment_plans
// (migration 000080). Role / GDC / colour are practitioner-endpoint metadata.

import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { formatNumber, formatPence } from '@/lib/format';
import { usePractices } from '@/features/integrations/hooks';
import { useAssociates, type AssociateRow } from '../associates-api';

// Map status to chip CSS class + label (matches existing chip utilities).
function statusChip(status: AssociateRow['status']) {
  const chip = { top: 'chip-emerald', good: 'chip-brand', review: 'chip-rose' }[status];
  const label = { top: 'Top performer', good: 'On target', review: 'Review' }[status];
  return { chip, label };
}

/** Associates roster screen — sourced from /api/associates. */
export default function AssociatesScreen() {
  const [practiceId, setPracticeId] = useState('');
  const [query, setQuery] = useState('');
  const { data, isLoading, isError, error } = useAssociates(practiceId || undefined);
  const { data: practiceData } = usePractices();
  const practices = practiceData?.practices ?? [];
  const associates = useMemo(() => data?.associates ?? [], [data]);

  // Client-side search over name / role / practice (the roster is already loaded).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return associates;
    return associates.filter((a) =>
      [a.full_name, a.role, a.practice, ...(a.practices ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [associates, query]);

  const totals = useMemo(() => {
    const count = associates.length;
    const treatments = associates.reduce((s, a) => s + a.treatments, 0);
    const completionVals = associates
      .map((a) => a.completion_pct)
      .filter((v): v is number => v != null);
    const avgCompletion = completionVals.length
      ? Math.round(completionVals.reduce((s, v) => s + v, 0) / completionVals.length)
      : null;
    const needReview = associates.filter((a) => a.status === 'review').length;
    return { count, treatments, avgCompletion, needReview };
  }, [associates]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-end gap-4">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Associates
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              {totals.count} clinicians · {formatNumber(totals.treatments)} treatments (last 52 weeks) · live from Dentally
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search associates…"
              style={{ padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#FFFFFF', minWidth: 200 }}
            />
            <select
              value={practiceId}
              onChange={(e) => setPracticeId(e.target.value)}
              style={{ padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#FFFFFF', minWidth: 180 }}
            >
              <option value="">All practices</option>
              {practices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="btn-primary" style={{ fontSize: 13 }}>
              + Add associate
            </button>
          </div>
        </div>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Total associates
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatNumber(totals.count)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Treatments (TTM)
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatNumber(totals.treatments)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Avg completion
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {totals.avgCompletion != null ? `${totals.avgCompletion}%` : '—'}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Need review
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatNumber(totals.needReview)}
          </div>
        </div>
      </div>

      {/* Roster table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        )}
        {isError && (
          <div style={{ fontSize: 13, padding: '24px 0', textAlign: 'center', color: '#991B1B' }}>
            Could not load associates{error instanceof Error ? `: ${error.message}` : ''}.
          </div>
        )}
        {!isLoading && !isError && associates.length === 0 && (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            No associates yet. They appear here once a Dentally sync has pulled practitioners.
          </div>
        )}
        {!isLoading && !isError && associates.length > 0 && visible.length === 0 && (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            No associates match &ldquo;{query}&rdquo;.
          </div>
        )}
        {!isLoading && !isError && visible.length > 0 && (
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead className="bg-bg" style={{ borderBottom: '1px solid var(--border)' }}>
              <tr>
                {['Associate', 'Practice', 'Pay %', 'Production', 'UDAs', 'Conv.', 'Treatments', 'Appts', 'Completion', 'No-show', 'Status'].map((h, i) => (
                  <th
                    key={h}
                    className={i >= 2 && i <= 9 ? 'text-right' : 'text-left'}
                    style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', fontWeight: 600 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const { chip, label } = statusChip(a.status);
                const joined = a.joined_date
                  ? new Date(a.joined_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                  : null;
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div className="flex items-center gap-2">
                        {a.colour && (
                          <span
                            aria-hidden
                            style={{ width: 8, height: 8, borderRadius: 9999, background: a.colour, flexShrink: 0 }}
                          />
                        )}
                        <strong>{a.full_name}</strong>
                      </div>
                      <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {[a.role, a.gdc_number ? `GDC ${a.gdc_number}` : null, joined ? `Joined ${joined}` : null]
                          .filter(Boolean)
                          .join(' · ') || null}
                      </div>
                    </td>
                    <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }} title={a.practices.length > 1 ? a.practices.join(', ') : undefined}>
                      {a.practice ?? '—'}
                      {a.practice_count > 1 && (
                        <span className="text-ink-muted" style={{ fontSize: 11 }}> +{a.practice_count - 1} more</span>
                      )}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }}>
                      {a.pay_pct != null ? `${a.pay_pct}%` : '—'}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px', fontWeight: 600 }} title="Invoiced fees attributed to this clinician (last 52 weeks)">
                      {a.ttm_production != null ? formatPence(a.ttm_production) : '—'}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }} title={a.uda_target != null ? `NHS UDAs completed vs contract target (${formatNumber(a.uda_target)})` : 'NHS UDAs completed (last 52 weeks)'}>
                      {a.ttm_uda != null
                        ? `${formatNumber(a.ttm_uda)}${a.uda_target != null ? ` / ${formatNumber(a.uda_target)}` : ''}`
                        : a.uda_target != null
                          ? `0 / ${formatNumber(a.uda_target)}`
                          : '—'}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }} title="Treatment plans completed / started (last 52 weeks)">
                      {a.conversion != null ? `${a.conversion}%` : '—'}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }}>
                      {formatNumber(a.treatments)}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }}>
                      {formatNumber(a.appointments_total)}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }}>
                      {a.completion_pct != null ? `${a.completion_pct}%` : '—'}
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }}>
                      {a.no_show_pct != null ? `${a.no_show_pct}% (${formatNumber(a.no_shows)})` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span className={`chip ${chip}`}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

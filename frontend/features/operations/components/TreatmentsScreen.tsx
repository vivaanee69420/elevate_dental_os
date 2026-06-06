'use client';
// Treatment Mix — appointment VOLUME by type, live from the backend.
// Dentally appointments carry no price (documented data wall), so this is a
// volume/share view, not revenue/margin. Source: /api/treatments aggregates
// appointments.appointment_type per practice/window.

import { formatNumber } from '@/lib/format';
import { SkeletonTable } from '@/components/ui';
import { useTreatmentMix } from '../treatments-api';

/** Treatment Mix screen — sourced from /api/treatments. */
export default function TreatmentsScreen() {
  const { data, isLoading, isError, error } = useTreatmentMix();
  const treatments = data?.treatments ?? [];

  const th: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--ink-muted)',
    fontWeight: 600,
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Treatment Mix
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Appointment volume by type · last 52 weeks · live from Dentally
        </p>
      </div>

      {isLoading && <SkeletonTable rows={8} cols={3} />}

      {isError && (
        <div className="card-padded" style={{ fontSize: 13, color: 'var(--danger)' }}>
          Could not load treatment mix: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* 4 KPIs */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Total appointments
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {formatNumber(data?.total_volume ?? 0)}
              </div>
            </div>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Treatment types
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {data?.distinct_types ?? 0}
              </div>
            </div>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Top treatment
              </div>
              <div className="display font-bold" style={{ fontSize: 16, marginTop: 4 }}>
                {data?.top_treatment ?? '—'}
              </div>
            </div>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Top share
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {treatments[0] ? `${treatments[0].share_pct.toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>

          {/* Performance table */}
          <div className="card-padded">
            <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
              Treatment performance
            </h2>
            {treatments.length === 0 ? (
              <p className="text-ink-muted" style={{ fontSize: 13 }}>
                No appointments synced yet. Connect Dentally and run a sync to populate this.
              </p>
            ) : (
              <table className="w-full" style={{ fontSize: 13, margin: -16, width: 'calc(100% + 32px)' }}>
                <thead className="bg-bg" style={{ borderBottom: '1px solid var(--border)' }}>
                  <tr>
                    <th className="text-left" style={th}>
                      Treatment
                    </th>
                    <th className="text-right" style={th}>
                      Volume
                    </th>
                    <th className="text-left" style={th}>
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {treatments.map((t) => (
                    <tr key={t.type} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <strong>{t.type}</strong>
                      </td>
                      <td className="text-right" style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {formatNumber(t.volume)}
                      </td>
                      <td style={{ padding: '12px 16px', width: 260 }}>
                        <div style={{ height: 8, background: '#F9FAFB', borderRadius: 4 }}>
                          <div
                            style={{
                              height: '100%',
                              background: 'var(--brand)',
                              width: `${t.share_pct}%`,
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {t.share_pct.toFixed(1)}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

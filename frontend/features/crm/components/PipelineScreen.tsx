'use client';
// Pipeline — wired to GET /api/leads.
//
// Server returns flat leads scoped to req.user.organisation_id. This screen
// groups them client-side into kanban columns by `status`. UI styling matches
// the prototype; the data source moved from mock LEADS to the real endpoint.

import { useMemo } from 'react';
import { useLeads } from '@/features/leads/hooks';
import type { Lead, LeadStatus } from '@/features/leads/api';
import { formatPence } from '@/lib/format';
import { CRM_TEAL, agoLabel } from '../data';

// Kanban columns — verbatim stages/colours from the prototype.
const PIPELINE_STAGES: { key: LeadStatus; label: string; colour: string }[] = [
  { key: 'new', label: 'New', colour: '#3B82F6' },
  { key: 'contact_attempted', label: 'Contact attempt', colour: '#F59E0B' },
  { key: 'contact_made', label: 'Contact made', colour: '#8B5CF6' },
  { key: 'consultation_booked', label: 'Consult booked', colour: '#06B6D4' },
  { key: 'consultation_attended', label: 'Consult attended', colour: '#0891B2' },
  { key: 'treatment_started', label: 'In treatment', colour: '#10B981' },
];

const CLOSED_STATUSES: LeadStatus[] = ['not_proceeding', 'treatment_completed'];

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

function displayName(l: Lead): string {
  const first = l.contact?.first_name ?? '';
  const last = l.contact?.last_name ?? '';
  const joined = `${first} ${last}`.trim();
  return joined || `Lead ${l.id.slice(0, 8)}`;
}

/** Pipeline kanban screen. */
export default function PipelineScreen() {
  const { data, isLoading, error } = useLeads();
  const leads: Lead[] = data?.leads ?? [];

  // Active pipeline value excludes closed-out statuses.
  const totalValue = useMemo(
    () =>
      leads
        .filter((l) => !CLOSED_STATUSES.includes(l.status))
        .reduce((s, l) => s + l.estimated_value_pence, 0),
    [leads],
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1500 }}>
      {/* Header */}
      <div
        className="mb-6 flex"
        style={{
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>
            Pipeline
          </h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {isLoading
              ? 'Loading pipeline…'
              : `${leads.length} leads · ${formatPence(totalValue)} active pipeline`}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 12,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            fontSize: 12,
          }}
        >
          Failed to load leads: {(error as Error).message}
        </div>
      )}

      {/* Kanban */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, 1fr)`,
          gap: 10,
          overflowX: 'auto',
        }}
      >
        {PIPELINE_STAGES.map((stage) => {
          const stageLeads = leads.filter((l) => l.status === stage.key);
          const stageValue = stageLeads.reduce(
            (s, l) => s + l.estimated_value_pence,
            0,
          );
          return (
            <div
              key={stage.key}
              style={{
                background: 'var(--bg)',
                borderRadius: 10,
                minHeight: 480,
                borderTop: `4px solid ${stage.colour}`,
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg)',
                  zIndex: 1,
                }}
              >
                <div
                  className="flex"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong style={{ fontSize: 13, color: stage.colour }}>
                    {stage.label}
                  </strong>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 8px',
                      background: 'white',
                      borderRadius: 10,
                      fontWeight: 700,
                    }}
                  >
                    {stageLeads.length}
                  </span>
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 10, marginTop: 2 }}
                >
                  {formatPence(stageValue)}
                </div>
              </div>
              <div
                style={{
                  padding: 8,
                  display: 'grid',
                  gap: 6,
                }}
              >
                {isLoading ? (
                  <div
                    className="text-ink-muted text-center"
                    style={{ padding: 12, fontSize: 11 }}
                  >
                    …
                  </div>
                ) : stageLeads.length === 0 ? (
                  <div
                    className="text-ink-muted text-center"
                    style={{ padding: 12, fontSize: 11 }}
                  >
                    —
                  </div>
                ) : (
                  stageLeads.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        background: 'white',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <div
                        className="flex"
                        style={{
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          marginBottom: 4,
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>
                          {displayName(l)}
                        </strong>
                        <span
                          className="text-ink-muted"
                          style={{ fontSize: 9 }}
                        >
                          {agoLabel(minutesSince(l.created_at))}
                        </span>
                      </div>
                      <div
                        className="text-ink-muted"
                        style={{ fontSize: 11, marginBottom: 4 }}
                      >
                        {l.treatment}
                      </div>
                      <div
                        className="flex"
                        style={{
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: CRM_TEAL,
                          }}
                        >
                          {formatPence(l.estimated_value_pence)}
                        </span>
                        {l.source && (
                          <span
                            className="text-ink-muted"
                            style={{
                              fontSize: 9,
                              padding: '1px 5px',
                              background: 'var(--bg)',
                              borderRadius: 3,
                            }}
                          >
                            {l.source}
                          </span>
                        )}
                      </div>
                      {l.sync_status === 'synced' ? (
                        <span
                          style={{
                            display: 'inline-block',
                            marginTop: 4,
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 6px',
                            color: '#047857',
                            background: '#ecfdf5',
                            border: '1px solid #a7f3d0',
                            borderRadius: 3,
                          }}
                        >
                          GHL Synced
                        </span>
                      ) : (
                        <span
                          className="text-ink-muted"
                          style={{
                            display: 'inline-block',
                            marginTop: 4,
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 6px',
                            background: 'var(--bg)',
                            borderRadius: 3,
                          }}
                        >
                          Manual Entry
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';
// Pipeline — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES.pipeline at ~line 8103). A six-column kanban of leads by
// journey stage, each column showing its lead count and summed value.
//
// Data flow:
//   LEADS -> group by status into PIPELINE_STAGES columns
//   active pipeline value = sum of leads not in not_proceeding/treatment_completed

import { useMemo } from 'react';
import { LEADS, CRM_TEAL, formatCurrency, agoLabel, TASK_NOW } from '../data';

// Kanban columns — verbatim stages/colours from the prototype.
const PIPELINE_STAGES = [
  { key: 'new', label: 'New', colour: '#3B82F6' },
  { key: 'contact_attempted', label: 'Contact attempt', colour: '#F59E0B' },
  { key: 'contact_made', label: 'Contact made', colour: '#8B5CF6' },
  { key: 'consultation_booked', label: 'Consult booked', colour: '#06B6D4' },
  { key: 'consultation_attended', label: 'Consult attended', colour: '#0891B2' },
  { key: 'treatment_started', label: 'In treatment', colour: '#10B981' },
] as const;

/** Minutes between a lead's capture date and the fixed "now". */
function minutesSince(iso: string): number {
  return Math.max(
    0,
    Math.round((TASK_NOW.getTime() - new Date(iso).getTime()) / 60000),
  );
}

/** Pipeline kanban screen. */
export default function PipelineScreen() {
  // Total active pipeline value (excludes closed-out statuses).
  const totalValue = useMemo(
    () =>
      LEADS.filter(
        (l) => !['not_proceeding', 'treatment_completed'].includes(l.status),
      ).reduce((s, l) => s + l.value, 0),
    [],
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
            {LEADS.length} leads · {formatCurrency(totalValue)} active pipeline
          </p>
        </div>
      </div>

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
          const stageLeads = LEADS.filter((l) => l.status === stage.key);
          const stageValue = stageLeads.reduce((s, l) => s + l.value, 0);
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
                  {formatCurrency(stageValue)}
                </div>
              </div>
              <div
                style={{
                  padding: 8,
                  display: 'grid',
                  gap: 6,
                }}
              >
                {stageLeads.length === 0 ? (
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
                          {l.first_name} {l.last_name}
                        </strong>
                        <span
                          className="text-ink-muted"
                          style={{ fontSize: 9 }}
                        >
                          {agoLabel(minutesSince(l.created))}
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
                          {formatCurrency(l.value)}
                        </span>
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
                      </div>
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

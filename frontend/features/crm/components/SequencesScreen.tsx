'use client';
// Nurturing Sequences — pixel-faithful port of
// preview/elevate-dental-os-v2.html (effective PAGES['crm-sequences'] at
// ~line 14871). A card grid of drip sequences, each with a status toggle,
// step/enrolled/completed counters and the first three steps previewed.
//
// Data flow:
//   SEQUENCES -> per-card render; local toggle state flips isActive
//   header totals = active count / sum enrolled / sum completed

import { useMemo, useState } from 'react';
import {
  SEQUENCES,
  CHANNELS,
  journeyStyle,
  type Sequence,
  type SequenceStep,
} from '../data';

/** Human delay label for a step (prototype arithmetic). */
function delayLabel(mins: number): string {
  if (mins === 0) return 'Immediately';
  if (mins < 0) return `${Math.round(Math.abs(mins) / 60)}h before`;
  if (mins < 60) return `${mins}m later`;
  if (mins < 1440) return `${Math.round(mins / 60)}h later`;
  return `${Math.round(mins / 1440)}d later`;
}

/** First-line preview text for a step. */
function stepHeadline(s: SequenceStep): string {
  const ch = CHANNELS[s.channel] || CHANNELS.note;
  const text = s.subject || s.body.slice(0, 48);
  return `${ch.label}: ${text}`;
}

/** Nurturing Sequences screen. */
export default function SequencesScreen() {
  // Local active-state overrides (mock — no API).
  const [activeOverride, setActiveOverride] = useState<
    Record<string, boolean>
  >({});

  const isActive = (s: Sequence) =>
    activeOverride[s.id] ?? s.isActive;

  const totals = useMemo(() => {
    const activeCount = SEQUENCES.filter((s) => isActive(s)).length;
    return {
      activeCount,
      enrolled: SEQUENCES.reduce((a, s) => a + s.enrolled, 0),
      completed: SEQUENCES.reduce((a, s) => a + s.completed, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOverride]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Nurturing Sequences
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {totals.activeCount} active · {totals.enrolled} currently enrolled ·{' '}
          {totals.completed} all-time
        </p>
      </div>

      {/* Card grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: 14,
        }}
      >
        {SEQUENCES.map((seq) => {
          const active = isActive(seq);
          const trigger = journeyStyle(seq.triggerStatus).label;
          return (
            <div key={seq.id} className="card-padded">
              {/* Title row + toggle */}
              <div
                className="flex"
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 10,
                }}
              >
                <div>
                  <div
                    className="flex items-center"
                    style={{ gap: 8 }}
                  >
                    <h3
                      className="display font-bold"
                      style={{ fontSize: 16 }}
                    >
                      {seq.name}
                    </h3>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        background: active ? '#D1FAE5' : '#F3F4F6',
                        color: active ? '#059669' : 'var(--ink-muted)',
                        borderRadius: 4,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 11, marginTop: 3 }}
                  >
                    Trigger: <strong>{trigger}</strong>
                  </div>
                </div>
                <button
                  onClick={() =>
                    setActiveOverride((o) => ({ ...o, [seq.id]: !active }))
                  }
                  aria-label={active ? 'Pause sequence' : 'Activate sequence'}
                  style={{
                    position: 'relative',
                    width: 38,
                    height: 22,
                    borderRadius: 22,
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? 'var(--success)' : '#cbd5e0',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      height: 16,
                      width: 16,
                      left: active ? 19 : 3,
                      bottom: 3,
                      background: 'white',
                      borderRadius: '50%',
                      transition: '0.2s',
                    }}
                  />
                </button>
              </div>

              {/* Step / enrolled / completed counters */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {[
                  { v: seq.steps.length, l: 'Steps', c: 'var(--brand)' },
                  { v: seq.enrolled, l: 'Active', c: '#3B82F6' },
                  { v: seq.completed, l: 'Completed', c: 'var(--success)' },
                ].map((x) => (
                  <div
                    key={x.l}
                    style={{
                      textAlign: 'center',
                      padding: 8,
                      background: 'var(--bg)',
                      borderRadius: 6,
                    }}
                  >
                    <div
                      className="display font-bold"
                      style={{ fontSize: 18, color: x.c }}
                    >
                      {x.v}
                    </div>
                    <div
                      className="text-ink-muted"
                      style={{ fontSize: 10, textTransform: 'uppercase' }}
                    >
                      {x.l}
                    </div>
                  </div>
                ))}
              </div>

              {/* First 3 steps */}
              <div style={{ fontSize: 11 }}>
                <div
                  className="text-ink-muted font-bold"
                  style={{
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 6,
                  }}
                >
                  Steps
                </div>
                {seq.steps.slice(0, 3).map((s) => {
                  const ch = CHANNELS[s.channel] || CHANNELS.note;
                  return (
                    <div
                      key={s.order}
                      className="flex items-center"
                      style={{
                        gap: 8,
                        padding: '5px 0',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 6px',
                          background: `${ch.colour}20`,
                          color: ch.colour,
                          borderRadius: 3,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        {ch.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 11,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {stepHeadline(s)}
                        </div>
                        <div
                          className="text-ink-muted"
                          style={{ fontSize: 10 }}
                        >
                          {delayLabel(s.delayMinutes)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {seq.steps.length > 3 && (
                  <div
                    className="text-ink-muted text-center"
                    style={{ fontSize: 11, padding: 6 }}
                  >
                    + {seq.steps.length - 3} more steps
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

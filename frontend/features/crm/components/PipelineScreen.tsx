'use client';
// Pipeline — wired to GET /api/leads + GET /api/leads/pipelines.
//
// When GoHighLevel pipelines are synced, this renders the SELECTED pipeline's
// real GHL stages as the kanban columns (dynamic), grouping leads by their raw
// ghl_pipeline_stage_id — a pipeline selector switches between them and only
// that pipeline's leads show. With no GHL pipelines (manual-only org) it falls
// back to the fixed Elevate-status columns.

import { useMemo, useState } from 'react';
import { useLeads, usePipelines } from '@/features/leads/hooks';
import type { Lead, LeadStatus } from '@/features/leads/api';
import { formatPence } from '@/lib/format';
import { CRM_TEAL, agoLabel } from '../data';

// Fallback columns (no GHL pipeline) — verbatim from the prototype.
const FALLBACK_STAGES: { key: string; label: string; colour: string; byStatus: LeadStatus }[] = [
  { key: 'new', label: 'New', colour: '#3B82F6', byStatus: 'new' },
  { key: 'contact_attempted', label: 'Contact attempt', colour: '#F59E0B', byStatus: 'contact_attempted' },
  { key: 'contact_made', label: 'Contact made', colour: '#8B5CF6', byStatus: 'contact_made' },
  { key: 'consultation_booked', label: 'Consult booked', colour: '#06B6D4', byStatus: 'consultation_booked' },
  { key: 'consultation_attended', label: 'Consult attended', colour: '#0891B2', byStatus: 'consultation_attended' },
  { key: 'treatment_started', label: 'In treatment', colour: '#10B981', byStatus: 'treatment_started' },
];

// Colour palette cycled across dynamic GHL stages.
const STAGE_COLOURS = ['#3B82F6', '#F59E0B', '#8B5CF6', '#06B6D4', '#0891B2', '#10B981', '#64748B', '#DC2626', '#7C3AED', '#EA580C'];

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

function displayName(l: Lead): string {
  const joined = `${l.contact?.first_name ?? ''} ${l.contact?.last_name ?? ''}`.trim();
  return joined || `Lead ${l.id.slice(0, 8)}`;
}

/** Pipeline kanban screen. */
export default function PipelineScreen() {
  const { data: pData } = usePipelines();
  const pipelines = pData?.pipelines ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = picked ?? pipelines[0]?.id ?? null;
  // Fetch the selected pipeline's leads server-side (a pipeline can have 300+
  // leads, so client-side slicing of a 100-row page would drop most).
  const { data, isLoading, error } = useLeads(
    selectedId ? { ghl_pipeline_id: selectedId, limit: 500 } : { limit: 500 },
  );
  const leads: Lead[] = data?.leads ?? [];
  const selectedPipeline = pipelines.find((p) => p.id === selectedId) ?? null;
  const dynamic = !!selectedPipeline;

  // Columns: dynamic GHL stages, or the fixed fallback.
  const columns = dynamic
    ? selectedPipeline!.stages.map((s, i) => ({ key: s.id, label: s.name, colour: STAGE_COLOURS[i % STAGE_COLOURS.length] }))
    : FALLBACK_STAGES.map((s) => ({ key: s.key, label: s.label, colour: s.colour }));

  // Leads scoped to the selected pipeline (dynamic), else all.
  const scopedLeads = dynamic ? leads.filter((l) => l.ghl_pipeline_id === selectedId) : leads;

  function leadsInColumn(colKey: string): Lead[] {
    if (dynamic) return scopedLeads.filter((l) => l.ghl_pipeline_stage_id === colKey);
    const fb = FALLBACK_STAGES.find((s) => s.key === colKey);
    return leads.filter((l) => l.status === fb?.byStatus);
  }

  const totalValue = useMemo(
    () => scopedLeads.reduce((s, l) => s + l.estimated_value_pence, 0),
    [scopedLeads],
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6 flex" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Pipeline</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {isLoading ? 'Loading pipeline…' : `${scopedLeads.length} leads · ${formatPence(totalValue)} active pipeline`}
          </p>
        </div>
        {pipelines.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="text-ink-muted" style={{ fontSize: 12, fontWeight: 600 }}>Pipeline</label>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setPicked(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'white' }}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Failed to load leads: {(error as Error).message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(180px, 1fr))`, gap: 10, overflowX: 'auto' }}>
        {columns.map((stage) => {
          const stageLeads = leadsInColumn(stage.key);
          const stageValue = stageLeads.reduce((s, l) => s + l.estimated_value_pence, 0);
          return (
            <div key={stage.key} style={{ background: 'var(--bg)', borderRadius: 10, minHeight: 480, borderTop: `4px solid ${stage.colour}` }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, color: stage.colour }}>{stage.label}</strong>
                  <span style={{ fontSize: 11, padding: '1px 8px', background: 'white', borderRadius: 10, fontWeight: 700 }}>{stageLeads.length}</span>
                </div>
                <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 2 }}>{formatPence(stageValue)}</div>
              </div>
              <div style={{ padding: 8, display: 'grid', gap: 6 }}>
                {isLoading ? (
                  <div className="text-ink-muted text-center" style={{ padding: 12, fontSize: 11 }}>…</div>
                ) : stageLeads.length === 0 ? (
                  <div className="text-ink-muted text-center" style={{ padding: 12, fontSize: 11 }}>—</div>
                ) : (
                  stageLeads.map((l) => (
                    <div key={l.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <strong style={{ fontSize: 12 }}>{displayName(l)}</strong>
                        <span className="text-ink-muted" style={{ fontSize: 9 }}>{agoLabel(minutesSince(l.created_at))}</span>
                      </div>
                      <div className="text-ink-muted" style={{ fontSize: 11, marginBottom: 4 }}>{l.treatment}</div>
                      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: CRM_TEAL }}>{formatPence(l.estimated_value_pence)}</span>
                        {l.source && (
                          <span className="text-ink-muted" style={{ fontSize: 9, padding: '1px 5px', background: 'var(--bg)', borderRadius: 3 }}>{l.source}</span>
                        )}
                      </div>
                      {l.sync_status === 'synced' ? (
                        <span style={{ display: 'inline-block', marginTop: 4, fontSize: 9, fontWeight: 600, padding: '1px 6px', color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 3 }}>GHL Synced</span>
                      ) : (
                        <span className="text-ink-muted" style={{ display: 'inline-block', marginTop: 4, fontSize: 9, fontWeight: 600, padding: '1px 6px', background: 'var(--bg)', borderRadius: 3 }}>Manual Entry</span>
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

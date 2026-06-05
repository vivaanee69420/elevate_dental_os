'use client';
// GoHighLevel management panel. Shown on the Integrations screen once GHL is
// connected. Two jobs:
//   1. Pull full history — the on-connect bootstrap pulls contacts +
//      opportunities; this re-pulls everything on demand.
//   2. Pipeline stage mapping — map each GHL pipeline stage to an Elevate lead
//      status. Until set, the sync falls back to a name heuristic (backend
//      mapStage). Owner-only on the backend.

import { useState } from 'react';
import {
  usePipelines,
  useSetStageMappings,
  useSyncIntegration,
  useFinishSync,
  useSubmitBrokerKey,
} from '../hooks';
import SyncOverlay from './SyncOverlay';

// Elevate lead statuses + friendly labels (mirrors backend ELEVATE_STATUSES).
const ELEVATE_STATUSES: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contact_attempted', label: 'Contact attempted' },
  { value: 'contact_made', label: 'Contact made' },
  { value: 'consultation_booked', label: 'Consultation booked' },
  { value: 'consultation_attended', label: 'Consultation attended' },
  { value: 'treatment_started', label: 'Treatment started' },
  { value: 'treatment_completed', label: 'Treatment completed' },
  { value: 'not_proceeding', label: 'Not proceeding' },
  { value: 'failed_to_attend', label: 'Failed to attend' },
];

export default function GoHighLevelPanel({
  initialMappings = {},
  locationId = null,
}: {
  initialMappings?: Record<string, string>;
  locationId?: string | null;
}) {
  const { data, isLoading, error } = usePipelines('gohighlevel');
  const saveMappings = useSetStageMappings('gohighlevel');
  const sync = useSyncIntegration();
  const finishSync = useFinishSync();
  const submitKey = useSubmitBrokerKey();

  const [syncing, setSyncing] = useState(false);
  // Working copy of stage -> status, seeded from the saved config.
  const [mappings, setMappings] = useState<Record<string, string>>(initialMappings);
  const [saved, setSaved] = useState(false);

  // Reconnect / replace-credentials form (API keys are write-only — never
  // returned by the API — so we show the Location ID + a masked indicator and
  // let the owner paste a fresh token + location to re-link).
  const [showReconnect, setShowReconnect] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [locInput, setLocInput] = useState(locationId ?? '');

  const pipelines = data?.pipelines ?? [];

  // Replace the stored API key + Location ID, then bootstrap-pull.
  async function reconnect() {
    if (!keyInput.trim() || !locInput.trim()) return;
    await submitKey.mutateAsync({ provider: 'gohighlevel', apiKey: keyInput.trim(), locationId: locInput.trim() });
    setKeyInput('');
    setShowReconnect(false);
    setSyncing(true); // overlay polls the bootstrap the backend kicks off
  }

  // Incremental: pull new/changed contacts + opportunities since last sync.
  async function syncNew() {
    setSyncing(true);
    await sync.mutateAsync({ provider: 'gohighlevel', full: false });
  }

  async function pullFullHistory() {
    setSyncing(true);
    await sync.mutateAsync({ provider: 'gohighlevel', full: true });
  }

  function setStage(stageId: string, status: string) {
    setMappings((m) => {
      const next = { ...m };
      if (status) next[stageId] = status;
      else delete next[stageId];
      return next;
    });
    setSaved(false);
  }

  async function save() {
    await saveMappings.mutateAsync(mappings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card-padded" style={{ marginBottom: 20 }}>
      {syncing && (
        <SyncOverlay
          provider="gohighlevel"
          onDone={() => { finishSync(); setSyncing(false); }}
        />
      )}
      <h2 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        GoHighLevel
      </h2>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Your contacts and opportunities were pulled automatically on connect and
        refresh hourly. Map each pipeline stage to an Elevate lead status so
        synced opportunities land in the right column — unmapped stages fall back
        to a best-guess from the stage name.
      </p>

      {/* Connection — view current Location ID + replace credentials. */}
      <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#F8FAFC' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12 }}>
            <div><span className="text-ink-muted">API key:</span> <span style={{ fontFamily: 'monospace' }}>•••••••• set</span></div>
            <div><span className="text-ink-muted">Location ID:</span>{' '}
              <span style={{ fontFamily: 'monospace' }}>{locationId || '—'}</span>
            </div>
          </div>
          <button
            onClick={() => { setShowReconnect((v) => !v); setLocInput(locationId ?? ''); }}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
              border: '1px solid var(--border)', background: 'white', cursor: 'pointer',
            }}
          >
            {showReconnect ? 'Cancel' : 'Reconnect / replace key'}
          </button>
        </div>
        {showReconnect && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="New Private Integration Token (pit-…)"
              style={{ padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <input
              type="text"
              value={locInput}
              onChange={(e) => setLocInput(e.target.value)}
              placeholder="Location ID"
              style={{ padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <div>
              <button
                onClick={reconnect}
                disabled={!keyInput.trim() || !locInput.trim() || submitKey.isPending}
                style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', color: 'white',
                  background: keyInput.trim() && locInput.trim() ? 'var(--brand)' : '#9CA3AF',
                  cursor: keyInput.trim() && locInput.trim() && !submitKey.isPending ? 'pointer' : 'default',
                }}
              >
                {submitKey.isPending ? 'Saving…' : 'Save & re-sync'}
              </button>
              <span className="text-ink-muted" style={{ fontSize: 10, marginLeft: 10 }}>
                The token must be created inside the same GHL sub-account as the Location ID.
              </span>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={syncNew}
          disabled={syncing}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
            border: 'none', background: 'var(--brand)', color: 'white',
            cursor: syncing ? 'default' : 'pointer',
          }}
        >
          {syncing ? 'Syncing…' : 'Sync new data'}
        </button>
        <button
          onClick={pullFullHistory}
          disabled={syncing}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
            border: '1px solid var(--border)', background: 'white', color: 'var(--ink)',
            cursor: syncing ? 'default' : 'pointer',
          }}
        >
          Pull full history
        </button>
        <span className="text-ink-muted" style={{ fontSize: 11 }}>
          Sync pulls new/changed records; full history re-pulls everything (slower).
        </span>
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Pipeline stage mapping</h3>
      {isLoading ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading pipelines…</div>
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>
          Couldn&apos;t load pipelines: {(error as Error).message}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>
          No pipelines found on this GoHighLevel location.
        </div>
      ) : (
        <>
          {pipelines.map((p) => (
            <div key={p.id} style={{ marginBottom: 14 }}>
              <div className="text-ink-muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                {p.name}
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: '4px' }}>GHL stage</th>
                    <th style={{ padding: '4px' }}>Elevate status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.stages.map((s) => (
                    <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 4px', fontSize: 13 }}>{s.name}</td>
                      <td style={{ padding: '8px 4px', width: 240 }}>
                        <select
                          value={mappings[s.id] ?? ''}
                          onChange={(e) => setStage(s.id, e.target.value)}
                          style={{
                            width: '100%', padding: '6px 8px', fontSize: 12,
                            border: '1px solid var(--border)', borderRadius: 6, background: 'white',
                          }}
                        >
                          <option value="">Auto (from stage name)</option>
                          {ELEVATE_STATUSES.map((st) => (
                            <option key={st.value} value={st.value}>{st.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button
              onClick={save}
              disabled={saveMappings.isPending}
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none', color: 'white', background: 'var(--brand)',
                cursor: saveMappings.isPending ? 'default' : 'pointer',
              }}
            >
              {saveMappings.isPending ? 'Saving…' : 'Save mapping'}
            </button>
            {saved && (
              <span style={{ fontSize: 11, color: 'var(--success, #047857)' }}>Saved</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

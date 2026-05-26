'use client';
// System → Integrations — wired to /api/integrations.
//
// Lists available providers from backend registry + current connected rows.
// Connect flow:
//   OAuth  : POST /api/integrations/connect → { redirectUrl } → window.location
//   Broker : POST /api/integrations/connect → { requiresKeyPaste } → modal
//            → POST /api/integrations/:provider/callback { apiKey }

import { useState } from 'react';
import { Chip } from '@/components/ui';
import {
  useIntegrations,
  useStartConnect,
  useSubmitBrokerKey,
  useRevoke,
  useSyncIntegration,
  useFinishSync,
} from '@/features/integrations/hooks';

// Providers with a real on-demand pull (Refresh button + first-connect sync).
const SYNCABLE = new Set(['dentally', 'xero', 'gohighlevel']);
import type {
  IntegrationRow,
  ProviderMeta,
} from '@/features/integrations/api';
import DentallyPracticeMapping from '@/features/integrations/components/DentallyPracticeMapping';
import DentallyWebhookPanel from '@/features/integrations/components/DentallyWebhookPanel';
import SyncOverlay from '@/features/integrations/components/SyncOverlay';

function statusOf(provider: string, rows: IntegrationRow[]): IntegrationRow['status'] | null {
  return rows.find((r) => r.provider === provider)?.status ?? null;
}

function rowOf(provider: string, rows: IntegrationRow[]): IntegrationRow | undefined {
  return rows.find((r) => r.provider === provider);
}

// "2 minutes ago" style relative time for last-sync display.
function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function IntegrationsScreen() {
  const { data, isLoading, error } = useIntegrations();
  const startConnect = useStartConnect();
  const submitKey = useSubmitBrokerKey();
  const revoke = useRevoke();
  const sync = useSyncIntegration();
  const finishSync = useFinishSync();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [brokerModal, setBrokerModal] = useState<{
    provider: string;
    hint: string;
  } | null>(null);
  const [keyInput, setKeyInput] = useState('');

  const integrations = data?.integrations ?? [];
  const providers = data?.available ?? [];
  const connectedCount = integrations.filter((i) => i.status === 'active').length;
  const dentallyConnected = statusOf('dentally', integrations) === 'active';

  // Group providers by category, preserving registration order.
  const groups: { category: string; items: ProviderMeta[] }[] = [];
  for (const p of providers) {
    let g = groups.find((x) => x.category === p.category);
    if (!g) { g = { category: p.category, items: [] }; groups.push(g); }
    g.items.push(p);
  }

  async function handleConnect(p: ProviderMeta) {
    const res = await startConnect.mutateAsync({ provider: p.id });
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl;
    } else if (res.requiresKeyPaste) {
      setBrokerModal({ provider: p.id, hint: res.pasteHint ?? 'Paste your API key.' });
    }
  }

  async function handleBrokerSubmit() {
    if (!brokerModal) return;
    const provider = brokerModal.provider;
    // submitBrokerKey persists the token; the backend then runs the first pull
    // automatically (Dentally: detect sites → auto-create+map practices → pull
    // the last 24 months). Show the progress overlay so the user sees it land —
    // connecting + pasting the key is the only manual step.
    await submitKey.mutateAsync({ provider, apiKey: keyInput });
    setBrokerModal(null);
    setKeyInput('');
    if (SYNCABLE.has(provider)) setSyncing(provider);
  }

  async function handleRefresh(provider: string) {
    setSyncing(provider);
    // Fire-and-forget on the server (returns immediately); the overlay polls
    // progress and clears itself via onDone. Incremental pull (latest changes
    // since the last sync) — full history is the separate button on the
    // Dentally mapping panel.
    await sync.mutateAsync({ provider, full: false });
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {syncing && (
        <SyncOverlay
          provider={syncing}
          onDone={() => { finishSync(); setSyncing(null); }}
        />
      )}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>Integrations</h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {isLoading ? 'Loading…' : `${connectedCount} of ${providers.length} connected`}
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Failed to load integrations: {(error as Error).message}
        </div>
      )}

      {dentallyConnected && <DentallyPracticeMapping />}
      {dentallyConnected && <DentallyWebhookPanel />}

      {groups.map((g) => (
        <div key={g.category} style={{ marginBottom: 20 }}>
          <h2 className="display text-ink-muted" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, textTransform: 'capitalize' }}>
            {g.category}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {g.items.map((p) => {
              const status = statusOf(p.id, integrations);
              const connected = status === 'active';
              const row = rowOf(p.id, integrations);
              return (
                <div key={p.id} className="card-padded" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                    <div className="text-ink-muted" style={{ fontSize: 11 }}>
                      {p.authStyle === 'oauth' ? 'OAuth' : 'API key'} · {p.category}
                    </div>
                    {connected && (
                      <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        Synced {relTime(row?.last_sync_at ?? null)}
                      </div>
                    )}
                    {row?.last_error && (
                      <div style={{ fontSize: 11, marginTop: 2, color: 'var(--danger)' }}>
                        {row.last_error.slice(0, 80)}
                      </div>
                    )}
                  </div>
                  {connected ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {SYNCABLE.has(p.id) && (
                        <button
                          onClick={() => handleRefresh(p.id)}
                          disabled={syncing === p.id}
                          style={{
                            background: 'none', border: '1px solid var(--border)',
                            borderRadius: 6, padding: '4px 8px', fontSize: 11,
                            cursor: syncing === p.id ? 'default' : 'pointer',
                          }}
                          title="Pull latest data now"
                        >
                          {syncing === p.id ? 'Refreshing…' : 'Refresh data'}
                        </button>
                      )}
                      <button
                        onClick={() => revoke.mutate(p.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        title="Disconnect"
                      >
                        <Chip colour="emerald">Connected</Chip>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnect(p)}
                      disabled={startConnect.isPending}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <Chip colour="amber">{startConnect.isPending ? '…' : 'Connect'}</Chip>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {brokerModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setBrokerModal(null)}
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 480, width: '90%' }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Connect {brokerModal.provider}
            </h3>
            <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {brokerModal.hint}
            </p>
            <input
              type="password"
              autoFocus
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="API key"
              style={{
                width: '100%', padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 6,
                fontSize: 13, marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setBrokerModal(null)}
                style={{
                  padding: '8px 14px', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleBrokerSubmit}
                disabled={!keyInput || submitKey.isPending}
                style={{
                  padding: '8px 14px', background: 'var(--brand)',
                  color: 'white', border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {submitKey.isPending ? 'Saving…' : 'Save key'}
              </button>
            </div>
            <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 10 }}>
              Stored encrypted at rest. Never displayed again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

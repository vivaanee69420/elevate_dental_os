'use client';
// System → Integrations — wired to /api/integrations.
//
// Lists available providers from backend registry + current connected rows.
// Connect flow:
//   OAuth  : POST /api/integrations/connect → { redirectUrl } → window.location
//   Broker : POST /api/integrations/connect → { requiresKeyPaste } → modal
//            → POST /api/integrations/:provider/callback { apiKey }

import { useEffect, useState } from 'react';
import { Chip } from '@/components/ui';
import {
  useIntegrations,
  useStartConnect,
  useSubmitBrokerKey,
  useRevoke,
  useSyncIntegration,
} from '@/features/integrations/hooks';

// Providers with a real on-demand pull (Refresh button + first-connect sync).
const SYNCABLE = new Set(['dentally', 'xero', 'gohighlevel', 'quickbooks', 'google_ads', 'meta_ads']);
import type {
  IntegrationRow,
  ProviderMeta,
} from '@/features/integrations/api';
import DentallyPracticeMapping from '@/features/integrations/components/DentallyPracticeMapping';
import DentallyWebhookPanel from '@/features/integrations/components/DentallyWebhookPanel';
import GoHighLevelPanel from '@/features/integrations/components/GoHighLevelPanel';
import QuickBooksPanel from '@/features/integrations/components/QuickBooksPanel';
import EmergentPanel from '@/features/integrations/components/EmergentPanel';
import EmergentPracticeMapping from '@/features/integrations/components/EmergentPracticeMapping';
import AdAccountSelector from '@/features/integrations/components/AdAccountSelector';
import { useSyncToast } from '@/features/integrations/sync-toast';

// Map an OAuth callback error code to a human title + message. Known codes get
// specific guidance; anything else falls back to the raw message.
function explainOauthError(code: string, provider: string): { title: string; message: string } {
  const name = provider || 'the provider';
  if (code === 'NO_AD_ACCOUNT') {
    return {
      title: 'No Google Ads account on that email',
      message:
        'You signed in with a Google account that has no Google Ads account. ' +
        'Disconnect and reconnect, choosing the Google email that has access to ' +
        'your Google Ads account. If you do not have one yet, create it at ads.google.com.',
    };
  }
  return { title: `Could not connect ${name}`, message: code };
}

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
  // Global sync toast — survives navigation; per-provider button state via active.
  const { start: startSyncToast, active } = useSyncToast();
  const [brokerModal, setBrokerModal] = useState<{
    provider: string;
    hint: string;
    requiresLocationId?: boolean;
  } | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [locInput, setLocInput] = useState('');
  // Provider awaiting disconnect confirmation (disconnect hides its data).
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'success';
    title: string;
    message: string;
  } | null>(null);

  // OAuth providers redirect back to /integrations with ?connected=<provider> on
  // success or ?error=<code>&provider=<provider> on failure. Surface that as a
  // dialog, then strip the params so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('error');
    const provider = params.get('provider') ?? connected ?? '';
    if (connected) {
      setNotice({ kind: 'success', title: 'Connected', message: `${connected} is now connected.` });
    } else if (err) {
      setNotice({ kind: 'error', ...explainOauthError(err, provider) });
    }
    if (connected || err) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const integrations = data?.integrations ?? [];
  const providers = data?.available ?? [];
  const connectedCount = integrations.filter((i) => i.status === 'active').length;
  const dentallyConnected = statusOf('dentally', integrations) === 'active';
  // For GHL we show the panel as long as the integration row exists (any status except
  // 'revoked'), because the multi-subaccount model stores secrets in integration_accounts,
  // not the main integrations row, so 'failed' on the main row should not hide the panel.
  const ghlRow = integrations.find((i) => i.provider === 'gohighlevel');
  const ghlConnected = statusOf('gohighlevel', integrations) === 'active';
  const ghlPanelVisible = !!ghlRow && ghlRow.status !== 'revoked';
  const googleAdsConnected = statusOf('google_ads', integrations) === 'active';
  const metaAdsConnected = statusOf('meta_ads', integrations) === 'active';

  // Group providers by category, preserving registration order.
  const groups: { category: string; items: ProviderMeta[] }[] = [];
  for (const p of providers) {
    let g = groups.find((x) => x.category === p.category);
    if (!g) { g = { category: p.category, items: [] }; groups.push(g); }
    g.items.push(p);
  }

  async function handleConnect(p: ProviderMeta) {
    console.log(`[IntegrationsScreen] handleConnect: initiating connection for provider=${p.id}`);
    const res = await startConnect.mutateAsync({ provider: p.id });
    if (res.redirectUrl) {
      console.log(`[IntegrationsScreen] handleConnect: redirecting to ${res.redirectUrl}`);
      window.location.href = res.redirectUrl;
    } else if (res.requiresKeyPaste) {
      console.log(`[IntegrationsScreen] handleConnect: requiring key paste for provider=${p.id}`);
      setBrokerModal({
        provider: p.id,
        hint: res.pasteHint ?? 'Paste your API key.',
        requiresLocationId: res.requiresLocationId,
      });
    }
  }

  async function handleConnectWithKey(p: ProviderMeta) {
    try {
      const res = await startConnect.mutateAsync({ provider: p.id, method: 'key' });
      if (res.requiresKeyPaste) {
        setBrokerModal({
          provider: p.id,
          hint: res.pasteHint ?? 'Paste your API key.',
          requiresLocationId: res.requiresLocationId,
        });
      }
    } catch (err) {
      setNotice({ kind: 'error', title: `Could not connect ${p.label}`, message: (err as Error).message });
    }
  }

  async function handleBrokerSubmit() {
    if (!brokerModal) return;
    const provider = brokerModal.provider;
    console.log(`[IntegrationsScreen] handleBrokerSubmit: submitting key for provider=${provider}`);
    // submitBrokerKey persists the key; the backend then runs the first pull
    // automatically (Dentally: detect sites → map practices → pull; GHL: pull
    // contacts + opportunities). Show the progress overlay so the user sees it
    // land — pasting the key (+ Location ID for GHL) is the only manual step.
    await submitKey.mutateAsync({
      provider,
      apiKey: keyInput,
      locationId: brokerModal.requiresLocationId ? locInput : undefined,
    });
    console.log(`[IntegrationsScreen] handleBrokerSubmit: key submitted successfully for provider=${provider}`);
    setBrokerModal(null);
    setKeyInput('');
    setLocInput('');
    if (SYNCABLE.has(provider)) startSyncToast(provider);
  }

  async function handleRefresh(provider: string) {
    console.log(`[IntegrationsScreen] handleRefresh: refreshing data for provider=${provider}`);
    startSyncToast(provider);
    // Fire-and-forget on the server (returns immediately); the overlay polls
    // progress and clears itself via onDone. Incremental pull (latest changes
    // since the last sync) — full history is the separate button on the
    // Dentally mapping panel.
    await sync.mutateAsync({ provider, full: false });
    console.log(`[IntegrationsScreen] handleRefresh: refresh initiated for provider=${provider}`);
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
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
      {ghlPanelVisible && <GoHighLevelPanel />}
      <QuickBooksPanel />
      <EmergentPracticeMapping />
      <EmergentPanel />
      {googleAdsConnected && <AdAccountSelector provider="google_ads" label="Google Ads" />}
      {metaAdsConnected && <AdAccountSelector provider="meta_ads" label="Meta Ads" />}

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
                      {p.authStyle === 'oauth' ? 'OAuth' : p.authStyle === 'oauth_or_key' ? 'OAuth / API key' : 'API key'} · {p.category}
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
                          disabled={active.has(p.id)}
                          style={{
                            background: 'none', border: '1px solid var(--border)',
                            borderRadius: 6, padding: '4px 8px', fontSize: 11,
                            cursor: active.has(p.id) ? 'default' : 'pointer',
                          }}
                          title="Pull latest data now"
                        >
                          {active.has(p.id) ? 'Refreshing…' : 'Refresh data'}
                        </button>
                      )}
                      <Chip colour="emerald">Connected</Chip>
                      <button
                        onClick={() => setConfirmDisconnect(p.id)}
                        disabled={revoke.isPending}
                        style={{
                          background: 'none', border: '1px solid var(--border)',
                          borderRadius: 6, padding: '4px 8px', fontSize: 11,
                          color: 'var(--danger, #b91c1c)',
                          cursor: revoke.isPending ? 'default' : 'pointer',
                        }}
                        title="Disconnect and hide this integration's data"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : p.authStyle === 'oauth_or_key' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => handleConnect(p)}
                        disabled={startConnect.isPending}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: startConnect.isPending ? 'default' : 'pointer' }}
                        title={`Connect securely via ${p.label} OAuth`}
                      >
                        <Chip colour="amber">{startConnect.isPending ? '…' : 'Connect with OAuth'}</Chip>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConnectWithKey(p)}
                        disabled={startConnect.isPending}
                        style={{
                          background: 'none', border: '1px solid var(--border)',
                          borderRadius: 6, padding: '4px 8px', fontSize: 11,
                          color: 'var(--ink-muted, #64748b)',
                          cursor: startConnect.isPending ? 'default' : 'pointer',
                        }}
                        title={`Connect with a ${p.label} API key instead`}
                      >
                        API key
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

      {notice && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setNotice(null)}
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 460, width: '90%' }}
          >
            <h3
              style={{
                fontSize: 16, fontWeight: 700, marginBottom: 8,
                color: notice.kind === 'error' ? 'var(--danger, #b91c1c)' : 'var(--ink, #111)',
              }}
            >
              {notice.title}
            </h3>
            <p className="text-ink-muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              {notice.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setNotice(null)}
                style={{
                  padding: '8px 14px', background: 'var(--brand)', color: 'white',
                  border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDisconnect && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setConfirmDisconnect(null)}
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 440, width: '90%' }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Disconnect {confirmDisconnect}?
            </h3>
            <p className="text-ink-muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              This stops syncing and hides all data from this integration across the app.
              Your synced records are kept — reconnecting restores them. Manually-entered data
              is not affected.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDisconnect(null)}
                style={{
                  padding: '8px 14px', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const provider = confirmDisconnect;
                  console.log(`[IntegrationsScreen] Disconnecting provider=${provider}`);
                  setConfirmDisconnect(null);
                  revoke.mutate(provider);
                }}
                disabled={revoke.isPending}
                style={{
                  padding: '8px 14px', background: 'var(--danger, #b91c1c)',
                  color: 'white', border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {revoke.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
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
            {brokerModal.requiresLocationId && (
              <input
                type="text"
                value={locInput}
                onChange={(e) => setLocInput(e.target.value)}
                placeholder="Location ID"
                style={{
                  width: '100%', padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 6,
                  fontSize: 13, marginBottom: 12,
                }}
              />
            )}
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
                disabled={!keyInput || (brokerModal.requiresLocationId && !locInput) || submitKey.isPending}
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

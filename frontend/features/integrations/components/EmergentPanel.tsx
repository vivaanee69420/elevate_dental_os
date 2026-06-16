'use client';

// Emergent (Treatments Accepted) connect panel — store-only.
// Saves the Emergent base URL + API key (encrypted server-side) and shows the
// per-org webhook URL to paste into Emergent. Data ingest (pull/webhook ->
// treatment_accepted) is still pending Emergent's API contract, so connecting
// stores credentials but does not yet validate or pull — the Business Hub
// "Treatments Accepted" card stays a placeholder until ingest is wired.

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Chip } from '@/components/ui';
import CollapsibleCard from './CollapsibleCard';
import { useSetWebhookSecret } from '../hooks';

interface EmergentStatus {
  connected: boolean;
  status: string | null;
  baseUrl: string | null;
  keyHint: string | null;
  webhookUrl: string | null;
  webhookSecretSet: boolean;
  lastSyncAt: string | null;
}

export default function EmergentPanel() {
  const [data, setData] = useState<EmergentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  
  const saveWebhook = useSetWebhookSecret('emergent');
  const [secret, setSecret] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api<EmergentStatus>('/api/integrations/emergent');
      setData(res);
      if (res.baseUrl) setBaseUrl(res.baseUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function connect() {
    setErr(null);
    setBusy(true);
    try {
      const res = await api<EmergentStatus>('/api/integrations/emergent', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      });
      setData(res);
      setApiKey('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/integrations/emergent', { method: 'DELETE' });
      await load();
      setApiKey('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runSync(full: boolean) {
    setSyncing(true);
    setSyncMsg(null);
    setErr(null);
    try {
      const res = await api<{ synced: number }>('/api/integrations/emergent/sync', {
        method: 'POST',
        body: JSON.stringify({ full }),
      });
      setSyncMsg(`Synced ${res.synced} accepted treatment${res.synced === 1 ? '' : 's'}.`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  function copyWebhook() {
    if (!data?.webhookUrl) return;
    navigator.clipboard?.writeText(data.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function saveSecret() {
    if (secret.trim().length < 8) return;
    setErr(null);
    try {
      await saveWebhook.mutateAsync(secret.trim());
      setSecret('');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (loading) return null;

  const connected = data?.connected;

  return (
    <CollapsibleCard
      title="Emergent — Treatments Accepted"
      style={{ marginBottom: 12 }}
      actions={connected ? <Chip colour="emerald">Connected</Chip> : <Chip colour="amber">Not connected</Chip>}
    >
      <div className="text-ink-muted" style={{ fontSize: 11, marginBottom: 4 }}>
        Pulls treatment-acceptance records staff log in the Emergent ops app into the Business Hub.
      </div>

      <div
        style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 11,
          background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
        }}
      >
        Credentials are stored encrypted. Accepted treatments pull from the Emergent public API on
        connect, nightly, and on demand (Sync now) into the Business Hub Treatments Accepted card.
      </div>

      {err && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--danger, #b91c1c)' }}>{err}</div>
      )}

      {!connected ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 }}>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Emergent base URL (https://…)"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
          />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key (dops_live_…)"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
          />
          <div>
            <button
              onClick={connect}
              disabled={busy || !baseUrl.trim() || apiKey.trim().length < 8}
              style={{
                padding: '8px 14px', background: 'var(--brand)', color: 'white', border: 'none',
                borderRadius: 6, fontSize: 12, fontWeight: 700,
                cursor: busy || !baseUrl.trim() || apiKey.trim().length < 8 ? 'default' : 'pointer',
                opacity: busy || !baseUrl.trim() || apiKey.trim().length < 8 ? 0.6 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Connect Emergent'}
            </button>
          </div>
          <div className="text-ink-muted" style={{ fontSize: 10 }}>Stored encrypted at rest. Never displayed again.</div>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12 }}>
            <span className="text-ink-muted">Base URL:</span> {data?.baseUrl}
            {data?.keyHint && <span className="text-ink-muted"> · key ••••{data.keyHint}</span>}
          </div>
          <div className="text-ink-muted" style={{ fontSize: 11 }}>
            Last sync: {data?.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('en-GB') : 'never'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => runSync(false)}
              disabled={syncing}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none', background: 'var(--brand)', color: 'white',
                cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              onClick={() => runSync(true)}
              disabled={syncing}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: '1px solid var(--border)', background: 'white',
                cursor: syncing ? 'default' : 'pointer',
              }}
            >
              Full refresh
            </button>
            {syncMsg && <span style={{ fontSize: 11, color: '#047857' }}>{syncMsg}</span>}
          </div>

          {data?.webhookUrl && (
            <div>
              <div className="text-ink-muted" style={{ fontSize: 11, marginBottom: 4 }}>
                Real-time webhook — paste into Emergent. Data also pulls
                nightly and on demand (Sync now), so this is not required.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <code
                  style={{
                    flex: 1, fontSize: 11, background: '#F3F4F6', padding: '6px 8px',
                    border: '1px solid var(--border)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap',
                  }}
                >
                  {data.webhookUrl}
                </code>
                <button
                  onClick={copyWebhook}
                  style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'white', cursor: 'pointer' }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Signing secret {data.webhookSecretSet && '(set — enter again to replace)'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={data.webhookSecretSet ? '••••••••' : 'Min 8 characters'}
                  style={{
                    flex: 1, padding: '8px 10px', fontSize: 12,
                    border: '1px solid var(--border)', borderRadius: 6,
                  }}
                />
                <button
                  onClick={saveSecret}
                  disabled={secret.trim().length < 8 || saveWebhook.isPending}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                    border: 'none', color: 'white',
                    background: secret.trim().length >= 8 ? 'var(--brand)' : '#9CA3AF',
                    cursor: secret.trim().length >= 8 && !saveWebhook.isPending ? 'pointer' : 'default',
                  }}
                >
                  {saveWebhook.isPending ? 'Saving…' : 'Save secret'}
                </button>
              </div>
            </div>
          )}
          <div>
            <button
              onClick={disconnect}
              disabled={busy}
              style={{
                padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11,
                color: 'var(--danger, #b91c1c)', background: 'white', cursor: busy ? 'default' : 'pointer',
              }}
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}

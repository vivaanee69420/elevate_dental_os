'use client';

// Emergent (Treatments Accepted) connect panel — store-only.
// Saves the Emergent base URL + API key (encrypted server-side) and shows the
// per-org webhook URL to paste into Emergent. Data ingest (pull/webhook ->
// treatment_accepted) is still pending Emergent's API contract, so connecting
// stores credentials but does not yet validate or pull — the Business Hub
// "Treatments Accepted" card stays a placeholder until ingest is wired.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Chip } from '@/components/ui';
import PanelCard from './PanelCard';
import {
  useSetWebhookSecret, useEmergentStatus,
  useConnectEmergent, useDisconnectEmergent, useSyncEmergent,
} from '../hooks';

// The status read and every mutation go through the SHARED ['emergent-status']
// query the Integrations tile also reads. This panel used to fetch and mutate
// that endpoint privately, so connecting in here left the tile behind the
// dialog still showing "Not connected" from its own cache.

export default function EmergentPanel() {
  const { data, isPending } = useEmergentStatus();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const qc = useQueryClient();
  const saveWebhook = useSetWebhookSecret('emergent');
  const connectM = useConnectEmergent();
  const disconnectM = useDisconnectEmergent();
  const syncM = useSyncEmergent();
  const [secret, setSecret] = useState('');

  const busy = connectM.isPending || disconnectM.isPending;
  const syncing = syncM.isPending;

  // Seeding a FORM FIELD from server data, which is a legitimate effect — it is
  // not data fetching. Only seeds while the field is untouched, so it cannot
  // overwrite what the owner is typing when the query refetches.
  useEffect(() => {
    if (data?.baseUrl) setBaseUrl((current) => (current === '' ? data.baseUrl! : current));
  }, [data?.baseUrl]);

  async function connect() {
    setErr(null);
    try {
      await connectM.mutateAsync({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setApiKey('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function disconnect() {
    setErr(null);
    try {
      await disconnectM.mutateAsync();
      setApiKey('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function runSync(full: boolean) {
    setSyncMsg(null);
    setErr(null);
    try {
      const res = await syncM.mutateAsync(full);
      setSyncMsg(`Synced ${res.synced} accepted treatment${res.synced === 1 ? '' : 's'}.`);
    } catch (e) {
      setErr((e as Error).message);
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
      // useSetWebhookSecret is provider-generic and only invalidates
      // ['webhook-info']. The "secret is set" label on THIS panel comes from
      // the emergent status query, so it needs refreshing too — without this
      // the label stays stale until something else refetches.
      qc.invalidateQueries({ queryKey: ['emergent-status'] });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (isPending) return null;

  const connected = data?.connected;

  return (
    <PanelCard
      title="Emergent — Treatments Accepted"
      style={{ marginBottom: 12 }}
      badge={connected ? <Chip colour="emerald">Connected</Chip> : <Chip colour="amber">Not connected</Chip>}
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
    </PanelCard>
  );
}

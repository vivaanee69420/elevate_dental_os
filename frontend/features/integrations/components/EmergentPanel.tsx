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

interface EmergentStatus {
  connected: boolean;
  status: string | null;
  baseUrl: string | null;
  keyHint: string | null;
  webhookUrl: string | null;
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

  function copyWebhook() {
    if (!data?.webhookUrl) return;
    navigator.clipboard?.writeText(data.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) return null;

  const connected = data?.connected;

  return (
    <div className="card-padded" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Emergent — Treatments Accepted</div>
          <div className="text-ink-muted" style={{ fontSize: 11 }}>
            Pulls treatment-acceptance records staff log in the Emergent ops app into the Business Hub.
          </div>
        </div>
        {connected ? <Chip colour="emerald">Connected</Chip> : <Chip colour="amber">Not connected</Chip>}
      </div>

      <div
        style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 11,
          background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
        }}
      >
        Credentials are stored encrypted. Live sync of accepted treatments turns on once Emergent
        provides their API contract (field names + webhook signing secret) — until then the
        Treatments Accepted card shows a placeholder.
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
          {data?.webhookUrl && (
            <div>
              <div className="text-ink-muted" style={{ fontSize: 11, marginBottom: 4 }}>
                Webhook URL — paste this into Emergent so it pushes accepted treatments here:
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code
                  style={{
                    flex: 1, fontSize: 11, background: '#F3F4F6', padding: '6px 8px',
                    borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap',
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
    </div>
  );
}

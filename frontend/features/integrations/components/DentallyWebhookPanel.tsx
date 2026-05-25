'use client';
// Real-time Dentally webhook setup. Shows the per-org webhook URL to paste into
// Dentally, and lets the owner set the shared signing secret we verify each
// event with. Real-time updates arrive via this webhook; a daily poll
// reconciles anything a webhook misses.

import { useState } from 'react';
import { useWebhookInfo, useSetWebhookSecret } from '../hooks';

export default function DentallyWebhookPanel() {
  const { data, isLoading } = useWebhookInfo('dentally');
  const save = useSetWebhookSecret('dentally');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    if (!data?.url) return;
    await navigator.clipboard.writeText(data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function saveSecret() {
    if (secret.trim().length < 8) return;
    await save.mutateAsync(secret.trim());
    setSecret('');
  }

  return (
    <div className="card-padded" style={{ marginBottom: 20 }}>
      <h2 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Real-time webhook
        {data?.configured && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--success, #047857)' }}>
            • active
          </span>
        )}
      </h2>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Dentally pushes changes here instantly (a daily sync reconciles anything
        missed). In Dentally → Settings → Webhooks: add this URL for patient,
        appointment and payment events, set a signing secret, then enter the same
        secret below.
      </p>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Webhook URL</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          readOnly
          value={isLoading ? 'Loading…' : data?.url ?? ''}
          style={{
            flex: 1, padding: '8px 10px', fontSize: 12, fontFamily: 'monospace',
            border: '1px solid var(--border)', borderRadius: 6, background: '#F8FAFC',
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          onClick={copyUrl}
          disabled={!data?.url}
          style={{
            padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: '1px solid var(--border)', background: 'white', cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
        Signing secret {data?.configured && '(set — enter again to replace)'}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={data?.configured ? '••••••••' : 'Min 8 characters'}
          style={{
            flex: 1, padding: '8px 10px', fontSize: 12,
            border: '1px solid var(--border)', borderRadius: 6,
          }}
        />
        <button
          onClick={saveSecret}
          disabled={secret.trim().length < 8 || save.isPending}
          style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6,
            border: 'none', color: 'white',
            background: secret.trim().length >= 8 ? '#0E7C7B' : '#9CA3AF',
            cursor: secret.trim().length >= 8 && !save.isPending ? 'pointer' : 'default',
          }}
        >
          {save.isPending ? 'Saving…' : 'Save secret'}
        </button>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 10 }}>
        Stored server-side; used only to verify the HMAC signature on inbound events.
      </p>
    </div>
  );
}

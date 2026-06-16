'use client';
// Real-time Dentally webhook setup. Shows the per-org webhook URL to paste into
// Dentally, and lets the owner set the shared signing secret we verify each
// event with. Real-time updates arrive via this webhook; a daily poll
// reconciles anything a webhook misses.

import { useState } from 'react';
import { useWebhookInfo, useSetWebhookSecret } from '../hooks';
import CollapsibleCard from './CollapsibleCard';

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

  // Live state of the hook on Dentally's side. A stored secret alone does NOT
  // mean events flow — the hook may be disabled or every delivery failing.
  const live = data?.live;
  const badge = (() => {
    if (!live || live.available === false) {
      return data?.configured
        ? { dot: '#9CA3AF', text: 'secret set', tip: null }
        : { dot: '#9CA3AF', text: 'not set up', tip: null };
    }
    switch (live.status) {
      case 'delivering':
        return { dot: '#047857', text: 'live', tip: `Delivering. ${live.successfulDeliveries} successful.` };
      case 'disabled':
        return { dot: '#DC2626', text: 'disabled on Dentally', tip: `Dentally disabled this hook after ${live.failedDeliveries} failed deliveries. Re-enable it in Dentally → Settings → Webhooks.` };
      case 'failing':
        return { dot: '#DC2626', text: 'every delivery failing', tip: `Active but ${live.failedDeliveries} deliveries failed and none succeeded — the signing secret below must exactly match the one set on the Dentally webhook.` };
      case 'idle':
        return { dot: '#D97706', text: 'enabled, awaiting events', tip: 'Registered and enabled; no events delivered yet.' };
      default:
        return { dot: '#DC2626', text: 'not registered on Dentally', tip: 'Add the URL below as a webhook in Dentally → Settings → Webhooks.' };
    }
  })();

  return (
    <CollapsibleCard
      title="Real-time webhook"
      badge={<span style={{ fontSize: 11, color: badge.dot }}>• {badge.text}</span>}
    >
      {badge.tip && (
        <p style={{ fontSize: 11, color: badge.dot, marginBottom: 8 }}>{badge.tip}</p>
      )}
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
            background: secret.trim().length >= 8 ? 'var(--brand)' : '#9CA3AF',
            cursor: secret.trim().length >= 8 && !save.isPending ? 'pointer' : 'default',
          }}
        >
          {save.isPending ? 'Saving…' : 'Save secret'}
        </button>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 10 }}>
        Stored server-side; used only to verify the HMAC signature on inbound events.
      </p>
    </CollapsibleCard>
  );
}

'use client';
// Real-time Dentally webhook setup. Shows the per-org webhook URL to paste into
// Dentally, and lets the owner set the shared signing secret we verify each
// event with. Real-time updates arrive via this webhook; a daily poll
// reconciles anything a webhook misses.

import { useState } from 'react';
import { useWebhookInfo, useSetWebhookSecret } from '../hooks';
import CollapsibleCard from './CollapsibleCard';

// Compact British relative time ("12s ago", "4m ago", "2h ago", "3d ago").
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'just now';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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
  const last = data?.lastResult;

  // Outcome of the MOST RECENT inbound delivery (from our own endpoint, not
  // Dentally's cumulative counters). This is the leading indicator: it flips the
  // instant a corrected secret verifies, before Dentally's success count moves.
  // We use it to replace the old blanket "the secret must match" message — which
  // was wrong whenever the real cause was a wiped secret or stale failure count.
  const lastLine = (() => {
    if (!last) return null;
    const when = relTime(last.at);
    switch (last.outcome) {
      case 'verified':
        return { dot: '#047857', text: `Last delivery ${when}: signature verified.` };
      case 'no_secret':
        return { dot: '#DC2626', text: `A delivery arrived ${when} but no signing secret was set here — enter the secret below.` };
      case 'bad_signature':
        return last.lenMatch === false
          ? { dot: '#DC2626', text: `Signature rejected ${when}: unexpected signature format from Dentally (not HMAC-SHA256 hex). Check the webhook on Dentally, not the secret.` }
          : { dot: '#DC2626', text: `Signature rejected ${when}: the secret here does not match the one on the Dentally webhook. Re-enter the exact same secret in both places.` };
    }
  })();

  const badge = (() => {
    // Prefer the last-delivery verdict for the headline when it disagrees with
    // the cumulative counter (e.g. failures predate a now-corrected secret).
    if (last?.outcome === 'verified' && live?.status !== 'delivering') {
      return { dot: '#047857', text: 'secret verified', tip: null };
    }
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
        // Don't assert WHY here — the precise reason comes from lastLine below.
        // If the last delivery actually verified, these are stale pre-fix
        // failures that clear on Dentally's next event.
        return last?.outcome === 'verified'
          ? { dot: '#D97706', text: 'recovering', tip: `The ${live.failedDeliveries} earlier failures predate the corrected secret; status clears when Dentally sends the next event.` }
          : { dot: '#DC2626', text: 'deliveries failing', tip: last ? null : `Active but ${live.failedDeliveries} deliveries failed and none have succeeded yet.` };
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
      {lastLine && (
        <p style={{ fontSize: 11, color: lastLine.dot, marginBottom: 8, fontWeight: 600 }}>{lastLine.text}</p>
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

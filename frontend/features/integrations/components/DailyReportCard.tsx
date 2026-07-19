'use client';
// Daily WhatsApp report — owner pastes the GoHighLevel inbound-webhook URL,
// enables the daily send, previews the exact line that would be sent, and can
// trigger a manual send. The raw webhook URL is never returned by the API
// (only a masked version) so it must be re-pasted whenever it changes.

import { useEffect, useState } from 'react';
import {
  useDailyReportSettings,
  useSaveDailyReportSettings,
  usePreviewDailyReport,
  useSendDailyReport,
} from '../hooks';

export default function DailyReportCard() {
  const { data, isLoading } = useDailyReportSettings();
  const save = useSaveDailyReportSettings();
  const preview = usePreviewDailyReport();
  const send = useSendDailyReport();

  const settings = data?.settings ?? null;
  const configured = settings?.configured ?? false;

  const [url, setUrl] = useState('');
  const [enabledDraft, setEnabledDraft] = useState(false);

  // Seed the draft toggle from the loaded settings. Depend on the primitive
  // `enabled` value, not the `settings` object: React Query hands back a new
  // object reference on every refetch (including refetchOnWindowFocus) even
  // when nothing changed, so depending on `settings` would re-run this and
  // silently discard a toggle the owner has flipped but not yet saved.
  const loadedEnabled = settings?.enabled;
  useEffect(() => {
    if (loadedEnabled !== undefined) setEnabledDraft(loadedEnabled);
  }, [loadedEnabled]);

  // A save is valid either as a full (re)configure — a fresh URL pasted in —
  // or, once a webhook is already stored, as a toggle-only pause/resume that
  // leaves the stored URL untouched. Only block saving when there is neither
  // a URL to send nor an existing row to flip `enabled` on.
  const hasUrlInput = url.trim().length > 0;
  const canSave = (hasUrlInput || configured) && !save.isPending;

  function onSave() {
    if (!canSave) return;
    save.mutate(
      hasUrlInput ? { webhookUrl: url.trim(), enabled: enabledDraft } : { enabled: enabledDraft },
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Daily WhatsApp report</h3>
      <p className="text-ink-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        Sends the previous day&apos;s ad performance to the practice group&apos;s owner over
        WhatsApp, via a GoHighLevel inbound webhook workflow.
      </p>

      {isLoading ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            Inbound webhook URL
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4, maxWidth: 520 }}>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={settings?.webhookUrlMasked ?? 'https://services.leadconnectorhq.com/hooks/...'}
              style={{ flex: 1, padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}
            />
          </div>
          <p className="text-ink-muted" style={{ fontSize: 10, margin: '0 0 10px' }}>
            {configured
              ? `Currently configured: ${settings?.webhookUrlMasked}. It is never sent back to the browser — leave this blank and use the toggle below to pause or resume without re-pasting it, or paste a new URL to replace it.`
              : "Paste the URL from your GoHighLevel workflow's Inbound Webhook trigger."}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={enabledDraft}
                disabled={(!hasUrlInput && !configured) || save.isPending}
                onChange={(e) => setEnabledDraft(e.target.checked)}
              />
              Send daily
            </label>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
                background: 'var(--brand)', color: 'white', cursor: canSave ? 'pointer' : 'not-allowed',
                opacity: canSave ? 1 : 0.5,
              }}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>

          {save.isError && (
            <p style={{ fontSize: 12, color: 'var(--danger)', margin: '0 0 12px' }}>
              {save.error instanceof Error ? save.error.message : 'Could not save. Check the URL uses https.'}
            </p>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Preview</span>
              <button
                type="button"
                onClick={() => preview.mutate()}
                disabled={preview.isPending}
                style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}
              >
                {preview.isPending ? 'Building…' : 'Refresh preview'}
              </button>
            </div>
            <div style={{ background: '#F8FAFC', borderRadius: 6, padding: 10, fontSize: 12, minHeight: 40, wordBreak: 'break-word', border: '1px solid var(--border)' }}>
              {preview.data?.line ?? 'Refresh to see the exact line that would be sent.'}
            </div>
            {preview.data && (
              <p className="text-ink-muted" style={{ fontSize: 10, margin: '4px 0 0' }}>
                {preview.data.length} characters
              </p>
            )}
            {preview.isError && (
              <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>
                {preview.error instanceof Error ? preview.error.message : 'Could not build the preview.'}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-ink-muted" style={{ fontSize: 12 }}>
              {settings?.lastSentAt
                ? `Last sent ${new Date(settings.lastSentAt).toLocaleString('en-GB')} — ${settings.lastStatus === 'ok' ? 'delivered' : (settings.lastError ?? settings.lastStatus ?? 'failed')}`
                : 'Not sent yet.'}
            </span>
            <button
              type="button"
              onClick={() => send.mutate()}
              disabled={!configured || send.isPending}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)',
                background: 'white', cursor: (!configured || send.isPending) ? 'not-allowed' : 'pointer',
                opacity: (!configured || send.isPending) ? 0.5 : 1,
              }}
            >
              {send.isPending ? 'Sending…' : 'Send now'}
            </button>
          </div>

          {send.isError && (
            <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0' }}>
              {send.error instanceof Error ? send.error.message : 'Could not send the report.'}
            </p>
          )}
          {send.data && !send.data.sent && (
            <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0' }}>
              Not sent: {send.data.reason ?? send.data.status}
            </p>
          )}
        </>
      )}
    </div>
  );
}

'use client';
// Message Templates — pixel-faithful port of
// preview/elevate-dental-os-v2.html (effective PAGES['crm-templates'] at
// ~line 14951). Two card grids: SMS templates (green accent, with char/SMS
// count) and Email templates (blue accent, with subject line).
//
// Data flow: useTemplates() -> split by channel -> two grids.

import { useMemo } from 'react';
import { useTemplates } from '../useTemplates';

/** Message Templates screen. */
export default function TemplatesScreen() {
  const { data, isLoading } = useTemplates();
  const templates = data?.templates ?? [];
  const { sms, email } = useMemo(
    () => ({
      sms: templates.filter((t) => t.channel === 'sms'),
      email: templates.filter((t) => t.channel === 'email'),
    }),
    [templates],
  );

  if (isLoading) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>Loading templates…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Message Templates
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {templates.length} templates · used in sequences and one-off messages
          · variables: {'{{first_name}}'}, {'{{treatment}}'}, {'{{practice}}'},{' '}
          {'{{appointment_date}}'}
        </p>
      </div>

      {/* SMS */}
      <h2
        className="display font-bold"
        style={{ fontSize: 16, margin: '16px 0 10px' }}
      >
        SMS ({sms.length})
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 10,
          marginBottom: 20,
        }}
      >
        {sms.map((t) => (
          <div
            key={t.id}
            className="card-padded"
            style={{ borderLeft: '3px solid var(--success)' }}
          >
            <div
              className="display font-bold"
              style={{ fontSize: 14, marginBottom: 6 }}
            >
              {t.name}
            </div>
            <div
              className="text-ink-muted"
              style={{
                fontSize: 12,
                lineHeight: 1.4,
                padding: 8,
                background: 'var(--bg)',
                borderRadius: 4,
              }}
            >
              {t.body}
            </div>
            <div
              className="text-ink-muted"
              style={{ fontSize: 10, marginTop: 6 }}
            >
              {t.body.length} chars · {Math.ceil(t.body.length / 160)} SMS
            </div>
          </div>
        ))}
      </div>

      {/* Email */}
      <h2
        className="display font-bold"
        style={{ fontSize: 16, margin: '16px 0 10px' }}
      >
        Email ({email.length})
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 10,
        }}
      >
        {email.map((t) => (
          <div
            key={t.id}
            className="card-padded"
            style={{ borderLeft: '3px solid #3B82F6' }}
          >
            <div
              className="display font-bold"
              style={{ fontSize: 14, marginBottom: 4 }}
            >
              {t.name}
            </div>
            <div
              className="text-ink-muted"
              style={{ fontSize: 11, marginBottom: 6 }}
            >
              <strong>Subject:</strong> {t.subject || '(no subject)'}
            </div>
            <div
              className="text-ink-muted"
              style={{
                fontSize: 12,
                lineHeight: 1.4,
                padding: 8,
                background: 'var(--bg)',
                borderRadius: 4,
              }}
            >
              {t.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

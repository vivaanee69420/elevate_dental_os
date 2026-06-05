'use client';
// CRM Settings — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES['crm-settings'] at ~line 15147). A responsive card grid:
// treatments, lead sources, payment plans, templates/sequences shortcuts,
// GDPR defaults, integrations and team-and-roles.
//
// Static configuration view — no API. Counts derive from the CRM data module.

import {
  TREATMENTS,
  TREATMENT_VALUES,
  SOURCES,
  PAYMENT_PLANS,
  TEMPLATES,
  SEQUENCES,
} from '../data';

// Connected-channels list — verbatim from the prototype.
const INTEGRATIONS = [
  { n: 'Twilio SMS', connected: true },
  { n: 'Postmark Email', connected: true },
  { n: 'Meta Lead Ads', connected: true },
  { n: 'Google Ads API', connected: true },
  { n: 'Stripe', connected: true },
  { n: 'Calendly', connected: false },
];

const activeSequences = SEQUENCES.filter((s) => s.isActive).length;

/** CRM Settings screen. */
export default function SettingsScreen() {
  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          CRM Settings
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Treatments · Sources · Payment plans · Templates · Automation · GDPR
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 14,
        }}
      >
        {/* Treatments */}
        <SettingsCard
          title={`Treatments (${TREATMENTS.length})`}
          blurb="Treatment types offered. Each can have a default value and payment plan."
        >
          {TREATMENTS.map((t) => (
            <Row key={t}>
              <span>{t}</span>
              <span
                className="text-ink-muted"
                style={{ fontWeight: 600 }}
              >
                £{(TREATMENT_VALUES[t] || 0).toLocaleString('en-GB')}
              </span>
            </Row>
          ))}
        </SettingsCard>

        {/* Lead sources */}
        <SettingsCard
          title={`Lead sources (${SOURCES.length})`}
          blurb="Where leads come from. Used for source ROI reporting."
        >
          {SOURCES.map((s) => (
            <Row key={s}>
              <span>{s}</span>
            </Row>
          ))}
        </SettingsCard>

        {/* Payment plans */}
        <SettingsCard
          title="Payment plans"
          blurb="Patient finance options."
        >
          {PAYMENT_PLANS.map((p) => (
            <Row key={p}>
              <span>{p}</span>
            </Row>
          ))}
        </SettingsCard>

        {/* Templates shortcut */}
        <SettingsCard
          title={`Message templates (${TEMPLATES.length})`}
          blurb="Reusable SMS and email templates."
        >
          <Pill text="Open templates in the Templates screen" />
        </SettingsCard>

        {/* Sequences shortcut */}
        <SettingsCard
          title={`Nurturing sequences (${SEQUENCES.length})`}
          blurb={`${activeSequences} active · automated drip campaigns.`}
        >
          <Pill text="Open sequences in the Nurturing screen" />
        </SettingsCard>

        {/* GDPR */}
        <SettingsCard
          title="GDPR and Compliance"
          blurb="Lawful basis defaults, consent capture, data retention."
        >
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <div>
              <strong>Default basis:</strong> Legitimate interest
            </div>
            <div>
              <strong>Consent timeout:</strong> 12 months
            </div>
            <div>
              <strong>Data retention:</strong> 7 years (clinical), 2 years
              (marketing)
            </div>
            <div>
              <strong>Right-to-be-forgotten:</strong> Auto-anonymise on request
            </div>
          </div>
        </SettingsCard>

        {/* Integrations */}
        <SettingsCard
          title="Integrations"
          blurb="Connected channels and providers."
        >
          {INTEGRATIONS.map((i) => (
            <Row key={i.n}>
              <span>{i.n}</span>
              <span
                style={{
                  color: i.connected ? 'var(--success)' : 'var(--ink-muted)',
                  fontWeight: 600,
                }}
              >
                {i.connected ? 'Connected' : 'Not connected'}
              </span>
            </Row>
          ))}
        </SettingsCard>

        {/* Team & roles */}
        <SettingsCard
          title="Team and roles"
          blurb="Users and what they can see in the CRM."
        >
          <Pill text="Open team permissions in Settings" />
        </SettingsCard>
      </div>
    </div>
  );
}

/** A titled settings panel with a blurb and arbitrary body content. */
function SettingsCard({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-padded">
      <h3
        className="display font-bold"
        style={{ fontSize: 15, marginBottom: 10 }}
      >
        {title}
      </h3>
      <p
        className="text-ink-muted"
        style={{ fontSize: 12, marginBottom: 10 }}
      >
        {blurb}
      </p>
      {children}
    </div>
  );
}

/** A list row inside a settings card. */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex"
      style={{
        justifyContent: 'space-between',
        padding: '6px 8px',
        background: 'var(--bg)',
        borderRadius: 4,
        marginBottom: 4,
        fontSize: 12,
      }}
    >
      {children}
    </div>
  );
}

/** A teal info pill replacing the prototype's navigation button (mock). */
function Pill({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 8,
        background: 'var(--brand)',
        color: 'white',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        textAlign: 'center',
      }}
    >
      {text}
    </div>
  );
}

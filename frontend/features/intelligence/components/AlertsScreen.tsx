'use client';
// Alerts — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.alerts). Configure when Plan4Growth AI nudges you: editable
// thresholds, notification channels, digest frequency. The prototype
// persisted to localStorage; here state is held in React (mock only, no
// backend persistence). See ../data.ts.

import { useState } from 'react';
import { Card } from '@/components/ui';
import { formatPounds } from '@/features/_mock';
import {
  ALERT_THRESHOLDS,
  ALERT_CHANNELS,
  DIGEST_OPTIONS,
  type DigestFrequency,
} from '../data';

/** Format a threshold's default for the "Default:" hint line. */
function defaultHint(value: number, unit: string): string {
  return unit === '£' ? formatPounds(value) : `${value}${unit}`;
}

/** Alerts page. */
export default function AlertsScreen() {
  // Per-threshold numeric values, seeded from each threshold's default.
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(ALERT_THRESHOLDS.map((a) => [a.id, a.defaultValue]))
  );
  // Notification channel toggles (email + in-app on by default, matching proto).
  const [channels, setChannels] = useState<Record<string, boolean>>({
    email: true,
    sms: false,
    slack: false,
    in_app: true,
  });
  // Digest cadence; "daily" is the recommended default.
  const [digest, setDigest] = useState<DigestFrequency>('daily');

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Alerts</h1>
        <p className="text-sm text-ink-muted mt-1">
          Tell Plan4Growth AI when to nudge you
        </p>
      </div>

      <Card className="mb-4">
        <h2
          className="display font-semibold"
          style={{ fontSize: 17, marginBottom: 16 }}
        >
          Alert thresholds
        </h2>
        {ALERT_THRESHOLDS.map((a) => (
          <div
            key={a.id}
            className="flex justify-between items-center"
            style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
              <div className="text-ink-muted" style={{ fontSize: 11 }}>
                Default: {defaultHint(a.defaultValue, a.unit)}
              </div>
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <input
                type="number"
                className="input"
                style={{ width: 100 }}
                value={values[a.id]}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [a.id]: parseFloat(e.target.value),
                  }))
                }
              />
              <span className="text-ink-muted" style={{ fontSize: 12 }}>
                {a.unit}
              </span>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <h2
            className="display font-semibold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            Notification channels
          </h2>
          {ALERT_CHANNELS.map((c) => (
            <label
              key={c.key}
              className="flex items-center"
              style={{ gap: 10, padding: '8px 0', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={!!channels[c.key]}
                onChange={(e) =>
                  setChannels((ch) => ({ ...ch, [c.key]: e.target.checked }))
                }
              />
              <span style={{ fontSize: 13 }}>{c.label}</span>
            </label>
          ))}
        </Card>
        <Card>
          <h2
            className="display font-semibold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            Digest frequency
          </h2>
          {DIGEST_OPTIONS.map((freq) => (
            <label
              key={freq}
              className="flex items-center"
              style={{ gap: 10, padding: '8px 0', cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="digest"
                checked={digest === freq}
                onChange={() => setDigest(freq)}
              />
              <span style={{ fontSize: 13, textTransform: 'capitalize' }}>
                {freq}
                {freq === 'daily' ? ' (recommended)' : ''}
              </span>
            </label>
          ))}
        </Card>
      </div>
    </div>
  );
}

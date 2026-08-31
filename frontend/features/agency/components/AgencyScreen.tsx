'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import {
  useSubaccounts,
  createSubaccount,
  setSubaccountFeature,
  switchInto,
  type Subaccount,
} from '../api';

const FEATURE_LABELS: Record<string, string> = {
  data_room: 'Data Room',
  emergent: 'Emergent',
  call_reporting: 'Call Reporting',
  sheet_export: 'Sheet Export',
};

function labelFor(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function FeatureToggles({ sub }: { sub: Subaccount }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.keys(sub.features).map((k) => (
        <button
          key={k}
          type="button"
          disabled={busy === k}
          title={sub.features[k] ? 'Enabled — click to disable' : 'Disabled — click to enable'}
          onClick={async () => {
            setBusy(k);
            try {
              await setSubaccountFeature(sub.id, k, !sub.features[k]);
              await qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] });
            } finally {
              setBusy(null);
            }
          }}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
            sub.features[k]
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-border bg-bg text-ink-muted'
          } ${busy === k ? 'opacity-50' : ''}`}
        >
          {labelFor(k)}
        </button>
      ))}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ organisation_name: '', owner_email: '', owner_name: '' });
  const [result, setResult] = useState<{ owner_email: string; temp_password: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (result) {
    return (
      <div className="card-padded">
        <h3 className="font-display text-base font-semibold text-ink">Sub-account created</h3>
        <p className="mt-2 text-sm text-ink">
          One-time login for <strong>{result.owner_email}</strong> — copy it now, it is not stored:
        </p>
        <code className="mt-2 block w-fit rounded-lg bg-bg px-3 py-2 text-sm text-ink">
          {result.temp_password}
        </code>
        <button type="button" className="btn-primary mt-3" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      className="card-padded flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
          setResult(await createSubaccount(form));
        } catch (err) {
          // Surface the backend's own message (e.g. "An account with this
          // email already exists") — a generic string here hides the cause.
          setError((err as Error).message || 'Could not create the sub-account.');
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3 className="font-display text-base font-semibold text-ink">New sub-account</h3>
      <input
        className="input"
        placeholder="Organisation name"
        required
        minLength={2}
        value={form.organisation_name}
        onChange={(e) => setForm({ ...form, organisation_name: e.target.value })}
      />
      <input
        className="input"
        placeholder="Owner name"
        required
        value={form.owner_name}
        onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
      />
      <input
        className="input"
        type="email"
        placeholder="Owner email"
        required
        value={form.owner_email}
        onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={saving} className="btn-primary self-start">
        {saving ? 'Creating…' : 'Create sub-account'}
      </button>
    </form>
  );
}

export function AgencyScreen() {
  const { data: me, isLoading } = useMe();
  const actor = isAgencyActor(me);
  const { data, error, refetch } = useSubaccounts(actor);
  const [creating, setCreating] = useState(false);

  if (isLoading) return null;
  if (!actor) {
    return (
      <div className="card-padded" style={{ margin: 24 }}>
        <h2 className="font-display text-lg font-semibold text-ink">Not available</h2>
        <p className="text-sm text-ink-muted">Agency tools are only available to agency owners.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Agency</h1>
          <p className="text-sm text-ink-muted">
            Manage sub-accounts: create organisations, toggle their modules, switch into them.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'New sub-account'}
        </button>
      </div>

      {creating && (
        <CreateForm
          onDone={() => {
            setCreating(false);
            refetch();
          }}
        />
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="px-4 py-2.5 font-semibold">Organisation</th>
              <th className="px-4 py-2.5 font-semibold">Integrations</th>
              <th className="px-4 py-2.5 font-semibold">Features</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(data?.subaccounts ?? []).map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-3 text-ink-muted">
                  {s.integrations.length ? s.integrations.map((i) => i.provider).join(', ') : '—'}
                </td>
                <td className="px-4 py-3">
                  <FeatureToggles sub={s} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-brand hover:underline"
                    onClick={() => switchInto(s.id)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {error && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-red-600">
                  Could not load sub-accounts: {(error as Error).message}
                </td>
              </tr>
            )}
            {!error && data && data.subaccounts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  No sub-accounts yet — create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

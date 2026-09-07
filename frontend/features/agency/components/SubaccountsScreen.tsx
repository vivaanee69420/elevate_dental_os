'use client';
// Settings -> Sub-accounts. Everything an agency does TO a sub-account: which
// tabs it may open, who its users are, and deleting it.
//
// Switching INTO one is not here — that is the sidebar switcher, and it is the
// action people take many times a day. These are the ones taken once. Keeping
// them apart is the whole point of the split: the old dialog answered "let me
// change account" with a delete button and a grid of feature toggles.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import {
  useSubaccounts,
  useSubaccountUsers,
  switchInto,
  createSubaccount,
  addSubaccountUser,
  setSubaccountFeature,
  deleteSubaccount,
  type Subaccount,
} from '../api';

const FEATURE_LABELS: Record<string, string> = {
  finance: 'Finance',
  business_health: 'Business Health',
  operations: 'Operations',
  growth: 'Growth',
  marketing: 'Marketing',
  crm: 'Elevate CRM',
  wealth: 'Wealth',
  training: 'Training',
  // Keys are backend module names; the labels name what the sub-account's
  // owner actually sees in their sidebar, so 'system' reads as Settings.
  system: 'Settings',
  data_room: 'Data Room',
  emergent: 'Emergent',
  call_reporting: 'Call Reporting',
  sheet_export: 'Sheet Export',
};

function labelFor(key: string) {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, ' ');
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** Tab access for one sub-account. Each chip is a module the org may open. */
function FeatureToggles({ sub }: { sub: Subaccount }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const keys = Object.keys(sub.features).sort(
    (a, b) => (FEATURE_LABELS[a] ?? a).localeCompare(FEATURE_LABELS[b] ?? b),
  );
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy === k}
            title={
              sub.features[k]
                ? 'Enabled — click to remove access'
                : 'Disabled — click to grant access'
            }
            onClick={async () => {
              setBusy(k);
              setErr('');
              try {
                await setSubaccountFeature(sub.id, k, !sub.features[k]);
                await qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] });
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition ${
              sub.features[k]
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-border bg-bg text-ink-muted hover:text-ink'
            } ${busy === k ? 'opacity-50' : ''}`}
          >
            {labelFor(k)}
          </button>
        ))}
      </div>
      {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** Users belonging to one sub-account. They exist only in that organisation. */
function UsersPanel({ sub }: { sub: Subaccount }) {
  const qc = useQueryClient();
  const { data } = useSubaccountUsers(sub.id);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'owner' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Users
        </span>
        <button
          type="button"
          className="text-xs font-medium text-brand hover:underline"
          onClick={() => {
            setAdding((v) => !v);
            setErr('');
          }}
        >
          {adding ? 'Cancel' : 'Add user'}
        </button>
      </div>

      <ul className="mt-2 space-y-1">
        {(data?.users ?? []).map((u) => (
          <li key={u.id} className="flex items-center justify-between text-[13px] text-ink">
            <span className="truncate">{u.full_name || u.email}</span>
            <span className="ml-2 shrink-0 capitalize text-ink-muted">
              {u.role.replace('_', ' ')}
            </span>
          </li>
        ))}
        {data && data.users.length === 0 && (
          <li className="text-[13px] text-ink-muted">No users yet — add the first one.</li>
        )}
      </ul>

      {adding && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setErr('');
            try {
              await addSubaccountUser(sub.id, form);
              setForm({ email: '', full_name: '', password: '', role: 'owner' });
              setAdding(false);
              await qc.invalidateQueries({ queryKey: ['agency', 'subaccount-users', sub.id] });
            } catch (e2) {
              setErr((e2 as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            className="input"
            placeholder="Full name"
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className="input"
            type="email"
            placeholder="Email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className="input"
            type="text"
            placeholder="Password (min 8 characters)"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="owner">Owner</option>
            <option value="practice_manager">Practice Manager</option>
            <option value="reception">Reception</option>
          </select>
          <p className="text-[11.5px] text-ink-muted">
            This password is permanent — give it to the user directly. They can only ever see{' '}
            {sub.name}.
          </p>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="submit" disabled={saving} className="btn-primary self-start">
            {saving ? 'Adding…' : 'Add user'}
          </button>
        </form>
      )}
    </div>
  );
}

function DeleteControl({ sub, onDeleted }: { sub: Subaccount; onDeleted: () => void }) {
  const [arming, setArming] = useState(false);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === sub.name.trim().toLowerCase();

  if (!arming) {
    return (
      <button
        type="button"
        className="text-xs font-medium text-red-600 hover:underline"
        onClick={() => {
          setArming(true);
          setErr('');
        }}
      >
        Delete this sub-account
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-xs text-red-900">
        This permanently deletes <strong>{sub.name}</strong> and all of its data — patients,
        appointments, payments and users. It cannot be undone. Type the name to confirm.
      </p>
      <input
        className="input mt-2"
        placeholder={sub.name}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!matches || busy}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold text-white ${
            matches && !busy ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300'
          }`}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await deleteSubaccount(sub.id, typed);
              onDeleted();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button
          type="button"
          className="text-xs text-ink-muted hover:text-ink"
          onClick={() => {
            setArming(false);
            setTyped('');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubaccountRow({ sub, defaultOpen }: { sub: Subaccount; defaultOpen: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const keys = Object.keys(sub.features);
  const enabled = keys.filter((k) => sub.features[k]).length;

  return (
    <li style={{ borderTop: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3" style={{ padding: '12px 14px' }}>
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--brand-600)',
            background: 'var(--brand-50)',
            border: '1px solid var(--brand-100)',
          }}
        >
          {initial(sub.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-ink" style={{ fontSize: 14, fontWeight: 600 }}>
            {sub.name}
          </div>
          <div className="text-ink-muted" style={{ fontSize: 12 }}>
            {enabled} of {keys.length} tabs enabled
          </div>
        </div>
        <button
          type="button"
          onClick={() => switchInto(sub.id)}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-bg"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
            open ? 'border-brand bg-brand-50 text-brand' : 'border-border text-ink hover:bg-bg'
          }`}
        >
          {open ? 'Done' : 'Manage'}
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div className="rounded-xl bg-bg" style={{ padding: 14 }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Tab access
            </span>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              Click a tab to grant or remove it. Green means this account can open it.
            </p>
            <div className="mt-2.5">
              <FeatureToggles sub={sub} />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0', paddingTop: 14 }}>
              <UsersPanel sub={sub} />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <DeleteControl
                sub={sub}
                onDeleted={() => qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] })}
              />
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default function SubaccountsScreen() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const actor = isAgencyActor(me);
  const { data, isLoading, error } = useSubaccounts(actor);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Fails closed, matching every other agency control: an absent grant is not
  // an empty list, it is no business being on this page.
  if (!actor) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <h1 className="display font-bold" style={{ fontSize: 24, letterSpacing: '-0.01em' }}>
          Sub-accounts
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 6 }}>
          Only an agency administrator can manage sub-accounts.
        </p>
      </div>
    );
  }

  const subs = (data?.subaccounts ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1180 }}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="display font-bold" style={{ fontSize: 24, letterSpacing: '-0.01em' }}>
            Sub-accounts
          </h1>
          <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 2 }}>
            The accounts {me?.agency?.home_org?.name || me?.organisation_name || 'your agency'}{' '}
            manages. Switch into one from the account menu in the sidebar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating((v) => !v);
            setErr('');
          }}
          className="btn-primary shrink-0"
          style={{ height: 38, display: 'inline-flex', alignItems: 'center', padding: '0 16px' }}
        >
          {creating ? 'Cancel' : 'New sub-account'}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ padding: 12, borderBottom: subs.length ? undefined : '1px solid var(--border)' }}
        >
          <div style={{ position: 'relative', width: 260 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sub-accounts"
              aria-label="Search sub-accounts"
              className="input w-full"
              style={{ height: 38, paddingLeft: 32 }}
            />
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)',
              }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
          <span className="text-ink-muted" style={{ fontSize: 12.5 }}>
            {data ? `${data.subaccounts.length} in total` : ''}
          </span>
        </div>

        {creating && (
          <form
            className="flex items-start gap-2"
            style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              setErr('');
              try {
                await createSubaccount(newName);
                setNewName('');
                setCreating(false);
                await qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] });
              } catch (e2) {
                setErr((e2 as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <input
              className="input"
              style={{ height: 38, width: 320 }}
              placeholder="Organisation name"
              required
              minLength={2}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              type="submit"
              disabled={saving}
              className="btn-primary shrink-0"
              style={{
                height: 38,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 16px',
              }}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </form>
        )}
        {err && (
          <p className="text-xs text-red-600" style={{ padding: '8px 14px' }}>
            {err}
          </p>
        )}

        <ul>
          {subs.map((s) => (
            // One sub-account: open it, or the tab-access controls read as
            // absent rather than one click away.
            <SubaccountRow key={s.id} sub={s} defaultOpen={subs.length === 1} />
          ))}
        </ul>

        {isLoading && (
          <p className="text-ink-muted" style={{ fontSize: 13, padding: 14 }}>
            Loading sub-accounts…
          </p>
        )}
        {error && (
          <p className="text-red-600" style={{ fontSize: 13, padding: 14 }}>
            Could not load sub-accounts: {(error as Error).message}
          </p>
        )}
        {!isLoading && !error && subs.length === 0 && (
          <p className="text-ink-muted" style={{ fontSize: 13, padding: 14 }}>
            {search
              ? 'No sub-account matches that search.'
              : 'No sub-accounts yet — create the first one.'}
          </p>
        )}
      </div>
    </div>
  );
}

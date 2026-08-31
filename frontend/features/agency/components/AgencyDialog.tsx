'use client';
// GHL-style account switcher: a button pinned top-left in the sidebar that
// opens ONE dialog for everything an agency does with its sub-accounts —
// switch into them, decide which tabs each may use, add isolated users, and
// delete. Deliberately not a page: this is chrome you reach from anywhere.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import {
  useSubaccounts, useSubaccountUsers, switchInto, exitSwitch, createSubaccount,
  addSubaccountUser, setSubaccountFeature, deleteSubaccount, type Subaccount,
} from '../api';

const FEATURE_LABELS: Record<string, string> = {
  finance: 'Finance',
  business_health: 'Business Health',
  operations: 'Operations',
  growth: 'Growth',
  crm: 'Elevate CRM',
  wealth: 'Wealth',
  training: 'Training',
  system: 'System',
  data_room: 'Data Room',
  emergent: 'Emergent',
  call_reporting: 'Call Reporting',
  sheet_export: 'Sheet Export',
};

function labelFor(key: string) {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, ' ');
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
            title={sub.features[k] ? 'Enabled — click to remove access' : 'Disabled — click to grant access'}
            onClick={async () => {
              setBusy(k); setErr('');
              try {
                await setSubaccountFeature(sub.id, k, !sub.features[k]);
                await qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] });
              } catch (e) {
                setErr((e as Error).message);
              } finally { setBusy(null); }
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
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Users
        </span>
        <button
          type="button"
          className="text-xs font-medium text-brand hover:underline"
          onClick={() => { setAdding((v) => !v); setErr(''); }}
        >
          {adding ? 'Cancel' : 'Add user'}
        </button>
      </div>

      <ul className="mt-1.5 space-y-1">
        {(data?.users ?? []).map((u) => (
          <li key={u.id} className="flex items-center justify-between text-xs text-ink">
            <span className="truncate">{u.full_name || u.email}</span>
            <span className="ml-2 shrink-0 text-ink-muted capitalize">{u.role.replace('_', ' ')}</span>
          </li>
        ))}
        {data && data.users.length === 0 && (
          <li className="text-xs text-ink-muted">No users yet — add the first one.</li>
        )}
      </ul>

      {adding && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true); setErr('');
            try {
              await addSubaccountUser(sub.id, form);
              setForm({ email: '', full_name: '', password: '', role: 'owner' });
              setAdding(false);
              await qc.invalidateQueries({ queryKey: ['agency', 'subaccount-users', sub.id] });
            } catch (e2) {
              setErr((e2 as Error).message);
            } finally { setSaving(false); }
          }}
        >
          <input className="input" placeholder="Full name" required
            value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input className="input" type="email" placeholder="Email" required
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" type="text" placeholder="Password (min 8 characters)" required minLength={8}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="input" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="owner">Owner</option>
            <option value="practice_manager">Practice Manager</option>
            <option value="reception">Reception</option>
          </select>
          <p className="text-[11px] text-ink-muted">
            This password is permanent — give it to the user directly. They can only ever see {sub.name}.
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
      <button type="button" className="text-xs font-medium text-red-600 hover:underline"
        onClick={() => { setArming(true); setErr(''); }}>
        Delete
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
      <p className="text-xs text-red-900">
        This permanently deletes <strong>{sub.name}</strong> and all of its data — patients,
        appointments, payments and users. It cannot be undone. Type the name to confirm.
      </p>
      <input className="input mt-2" placeholder={sub.name} value={typed}
        onChange={(e) => setTyped(e.target.value)} />
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!matches || busy}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold text-white ${
            matches && !busy ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300'
          }`}
          onClick={async () => {
            setBusy(true); setErr('');
            try {
              await deleteSubaccount(sub.id, typed);
              onDeleted();
            } catch (e) {
              setErr((e as Error).message);
            } finally { setBusy(false); }
          }}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button type="button" className="text-xs text-ink-muted hover:text-ink"
          onClick={() => { setArming(false); setTyped(''); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubaccountRow({ sub }: { sub: Subaccount }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border last:border-0 py-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left text-sm font-medium text-ink hover:text-brand">
          {open ? '▾' : '▸'} {sub.name}
        </button>
        <button type="button" onClick={() => switchInto(sub.id)}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-bg">
          Open
        </button>
      </div>
      {open && (
        <div className="mt-2 pl-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Tab access
          </span>
          <div className="mt-1.5"><FeatureToggles sub={sub} /></div>
          <UsersPanel sub={sub} />
          <div className="mt-3">
            <DeleteControl
              sub={sub}
              onDeleted={() => qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] })}
            />
          </div>
        </div>
      )}
    </li>
  );
}

export function AgencyDialog() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const actor = isAgencyActor(me);
  const switched = me?.agency?.switched === true;
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const { data, error } = useSubaccounts(actor && open);

  if (!actor) return null;

  const subs = (data?.subaccounts ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Switch or manage sub-accounts"
        className="mx-3 mt-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-left transition hover:border-brand-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-ink-muted" aria-hidden="true">
          <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {me?.organisation_name ?? 'Account'}
          </span>
          <span className="block text-[10px] uppercase tracking-wider text-ink-muted">
            {switched ? 'Sub-account · switch' : 'Agency · switch'}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-ink-muted" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            zIndex: 1000, padding: 24, overflowY: 'auto',
          }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Sub-accounts"
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 560, width: '100%', marginTop: 40 }}
          >
            <div className="flex items-start justify-between" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>Sub-accounts</h3>
                <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Open an account, choose which tabs it can use, add its users, or delete it.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink" aria-label="Close">✕</button>
            </div>

            {switched && (
              <button type="button" onClick={() => exitSwitch()}
                className="mb-3 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-900">
                ← Back to {me?.agency?.home_org?.name ?? 'the agency'}
              </button>
            )}

            <div className="flex items-center gap-2">
              <input className="input flex-1" placeholder="Search sub-accounts"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <button type="button" className="btn-primary shrink-0"
                onClick={() => { setCreating((v) => !v); setErr(''); }}>
                {creating ? 'Cancel' : 'New'}
              </button>
            </div>

            {creating && (
              <form
                className="mt-2 flex items-start gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaving(true); setErr('');
                  try {
                    await createSubaccount(newName);
                    setNewName('');
                    setCreating(false);
                    await qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] });
                  } catch (e2) {
                    setErr((e2 as Error).message);
                  } finally { setSaving(false); }
                }}
              >
                <input className="input flex-1" placeholder="Organisation name" required minLength={2}
                  value={newName} onChange={(e) => setNewName(e.target.value)} />
                <button type="submit" disabled={saving} className="btn-primary shrink-0">
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </form>
            )}
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

            <ul className="mt-3">
              {subs.map((s) => <SubaccountRow key={s.id} sub={s} />)}
            </ul>

            {error && (
              <p className="mt-3 text-xs text-red-600">
                Could not load sub-accounts: {(error as Error).message}
              </p>
            )}
            {!error && data && subs.length === 0 && (
              <p className="mt-3 text-xs text-ink-muted">
                {search ? 'No sub-account matches that search.' : 'No sub-accounts yet — create the first one.'}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

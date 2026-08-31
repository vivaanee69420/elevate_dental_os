'use client';
// Account picker for a login that belongs to more than one organisation.
//
// Distinct from the agency switcher above it: this lists accounts the person
// is a MEMBER of (their own access), whereas the agency dialog lists
// sub-accounts they administer. Someone can have both; most people have
// neither, in which case this renders nothing at all.

import { useState } from 'react';
import { useMe } from '@/hooks/useMe';

async function switchAccount(orgId: string) {
  const res = await fetch('/api/active-org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Switch failed' }));
    throw new Error(body.error || 'Switch failed');
  }
  // Hard navigation: every cached query belongs to the previous account.
  window.location.assign('/business-hub');
}

export function AccountPicker() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const accounts = me?.accounts ?? [];

  // One account (or an older backend) — nothing to choose between.
  if (accounts.length < 2) return null;
  const activeId = me?.active_organisation_id;

  return (
    <div className="mx-3 mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-left transition hover:border-brand-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-ink-muted" aria-hidden="true">
          <path d="M3 7h18M3 12h18M3 17h18" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {accounts.find((a) => a.id === activeId)?.name ?? me?.organisation_name ?? 'Account'}
          </span>
          <span className="block text-[10px] uppercase tracking-wider text-ink-muted">
            {accounts.length} accounts
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-1 rounded-xl border border-border bg-card p-1 shadow-panel-sm">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={a.id === activeId}
              onClick={async () => {
                setErr('');
                try { await switchAccount(a.id); } catch (e) { setErr((e as Error).message); }
              }}
              className={`block w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                a.id === activeId
                  ? 'bg-brand-50 font-semibold text-brand'
                  : 'text-ink hover:bg-bg'
              }`}
            >
              <span className="block truncate">{a.name}</span>
              <span className="block text-[10px] capitalize text-ink-muted">
                {a.role?.replace('_', ' ')}
              </span>
            </button>
          ))}
          {err && <p className="px-2.5 py-1.5 text-[11px] text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}

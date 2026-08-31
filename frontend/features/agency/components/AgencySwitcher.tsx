'use client';
import { useState } from 'react';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import { useSubaccounts, switchInto, exitSwitch } from '../api';

/** Topbar account switcher — rendered only for agency actors. */
export function AgencySwitcher() {
  const { data: me } = useMe();
  const actor = isAgencyActor(me);
  const switched = me?.agency?.switched === true;
  const [open, setOpen] = useState(false);
  const { data } = useSubaccounts(actor && open);
  if (!actor) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-bg transition"
      >
        Switch account
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 rounded-xl border border-border bg-card p-1 shadow-panel-sm">
          {switched && (
            <button
              type="button"
              onClick={() => exitSwitch()}
              className="block w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-ink hover:bg-bg"
            >
              Exit — back to {me?.agency?.home_org?.name || 'agency'}
            </button>
          )}
          {(data?.subaccounts ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => switchInto(s.id)}
              className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-ink hover:bg-bg"
            >
              {s.name}
            </button>
          ))}
          {data && data.subaccounts.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-ink-muted">No sub-accounts yet</div>
          )}
        </div>
      )}
    </div>
  );
}

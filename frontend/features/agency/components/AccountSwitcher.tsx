'use client';
// Account switcher — the one control for moving between the agency and its
// sub-accounts.
//
// Switching is the frequent act; configuring a sub-account is the rare one.
// They used to share a dialog, which put tab-access toggles, user creation and
// a Delete button in front of someone who only wanted to change account.
// Management now lives at Settings -> Sub-accounts, and this does one thing.
//
// The panel is position:fixed, measured off the trigger, rather than absolutely
// positioned inside it. The sidebar is `overflow-hidden` because it animates
// its own width, so an in-flow popover wider than the rail is clipped to
// nothing — a switcher that renders and is invisible.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import { useSubaccounts, switchInto, exitSwitch } from '../api';

// Both lists are this browser's opinion, not the account's: they say which
// accounts THIS person reaches for, so they belong beside the person, not in a
// table every agency admin would share.
const PINNED_KEY = 'elevate.switcher.pinned';
const RECENT_KEY = 'elevate.switcher.recent';
const RECENT_MAX = 3;
const PANEL_W = 340;

function readIds(key: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // A private window, cleared site data, or a value some earlier version
    // wrote in another shape. An empty list is a correct switcher.
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage full or blocked — the switcher still works, it just forgets */
  }
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

interface Row {
  id: string;
  name: string;
  subtitle: string;
  /** The agency's own account. Reached by clearing the switch, not by making one. */
  home: boolean;
  current: boolean;
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 600,
        color: 'var(--brand-600)',
        background: 'var(--brand-50)',
        border: '1px solid var(--brand-100)',
      }}
    >
      {initial(name)}
    </span>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

function AccountRow({
  row,
  pinned,
  onPick,
  onTogglePin,
}: {
  row: Row;
  pinned: boolean;
  onPick: (row: Row) => void;
  onTogglePin: (id: string) => void;
}) {
  return (
    <div
      className="group flex items-center gap-2.5 rounded-lg transition-colors"
      style={{
        padding: '7px 8px',
        background: row.current ? 'var(--brand-50)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => onPick(row)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <Avatar name={row.name} size={30} />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-ink"
            style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}
          >
            {row.name}
          </span>
          <span className="block truncate text-ink-muted" style={{ fontSize: 11.5 }}>
            {row.subtitle}
          </span>
        </span>
      </button>

      {row.current ? (
        <span
          className="shrink-0"
          title="You are here"
          style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand-600)' }}
        >
          Current
        </span>
      ) : (
        // Hidden until hover unless it is pinned, so the pin column reads as
        // an affordance rather than a row of identical grey icons.
        <button
          type="button"
          onClick={() => onTogglePin(row.id)}
          aria-label={pinned ? `Unpin ${row.name}` : `Pin ${row.name} to the top`}
          title={pinned ? 'Unpin' : 'Pin to the top'}
          className={`shrink-0 rounded p-1 transition ${
            pinned
              ? 'text-brand'
              : 'text-ink-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink'
          }`}
        >
          <PinIcon filled={pinned} />
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-ink-muted"
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        padding: '10px 8px 4px',
      }}
    >
      {children}
    </p>
  );
}

export function AccountSwitcher() {
  const { data: me } = useMe();
  const actor = isAgencyActor(me);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, error } = useSubaccounts(actor && open);

  // localStorage is read after mount only: it does not exist during the server
  // render, and seeding state from it directly would make the first client
  // render disagree with the server's.
  useEffect(() => {
    setPinned(readIds(PINNED_KEY));
    setRecent(readIds(RECENT_KEY));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const show = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left });
    setSearch('');
    setErr('');
    setOpen(true);
    // The panel mounts this tick; focus it on the next.
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const switched = me?.agency?.switched === true;
  // Where "back" goes. While switched the backend tells us the caller's own
  // org; at home it is simply the org they are already acting in.
  const homeId = me?.agency?.home_org?.id ?? me?.organisation_id ?? '';
  const homeName = me?.agency?.home_org?.name || me?.organisation_name || 'Agency';
  const activeId = switched ? me?.organisation_id : homeId;

  const rows = useMemo<Row[]>(() => {
    const subs = (data?.subaccounts ?? []).map((s) => {
      const keys = Object.keys(s.features);
      const on = keys.filter((k) => s.features[k]).length;
      return {
        id: s.id,
        name: s.name,
        subtitle: keys.length ? `${on} of ${keys.length} tabs enabled` : 'Sub-account',
        home: false,
        current: s.id === activeId,
      };
    });
    subs.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
    return [
      { id: homeId, name: homeName, subtitle: 'Agency account', home: true, current: !switched },
      ...subs,
    ];
  }, [data, homeId, homeName, activeId, switched]);

  const query = search.trim().toLowerCase();
  const matching = query ? rows.filter((r) => r.name.toLowerCase().includes(query)) : rows;

  // Pinned to the top, then the rest in the order built above. Applied only to
  // the full list: a search result reordered by pins hides what you typed.
  const listed = query
    ? matching
    : [...matching].sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));

  const recentRows = query
    ? []
    : recent.map((id) => rows.find((r) => r.id === id)).filter((r): r is Row => Boolean(r));

  function noteVisit(id: string) {
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
    setRecent(next);
    writeIds(RECENT_KEY, next);
  }

  function togglePin(id: string) {
    const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
    setPinned(next);
    writeIds(PINNED_KEY, next);
  }

  async function pick(row: Row) {
    if (row.current) {
      setOpen(false);
      return;
    }
    setErr('');
    // Recorded before the call: both paths end in a hard navigation, so
    // anything written after it never runs. The agency is left out — it is
    // already pinned to the top of the list, so a Recent entry for it would
    // show the same account twice for no gain.
    if (!row.home) noteVisit(row.id);
    try {
      if (row.home) await exitSwitch();
      else await switchInto(row.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!actor) return null;

  const currentName = switched ? me?.organisation_name || 'Sub-account' : homeName;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Switch account"
        className="mx-3 mt-3 flex w-[calc(100%-1.5rem)] items-center gap-2.5 rounded-xl border border-border bg-bg px-2.5 py-2 text-left transition hover:border-brand-200"
      >
        <Avatar name={currentName} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{currentName}</span>
          <span className="block text-[10px] uppercase tracking-wider text-ink-muted">
            {switched ? 'Sub-account' : 'Agency'}
          </span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-ink-muted"
          aria-hidden="true"
        >
          <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
        </svg>
      </button>

      {open && rect && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 900 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Switch account"
            className="card"
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: PANEL_W,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'min(70vh, 520px)',
              zIndex: 901,
              display: 'flex',
              flexDirection: 'column',
              padding: 8,
              boxShadow: '0 18px 44px rgba(15, 23, 32, 0.18)',
            }}
          >
            <div style={{ position: 'relative' }}>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for a sub-account"
                aria-label="Search for a sub-account"
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

            <div style={{ overflowY: 'auto', margin: '0 -2px', padding: '0 2px' }}>
              {recentRows.length > 0 && (
                <>
                  <SectionLabel>Recent</SectionLabel>
                  {recentRows.map((r) => (
                    <AccountRow
                      key={`recent-${r.id}`}
                      row={r}
                      pinned={pinned.includes(r.id)}
                      onPick={pick}
                      onTogglePin={togglePin}
                    />
                  ))}
                </>
              )}

              <SectionLabel>{query ? 'Results' : 'All accounts'}</SectionLabel>
              {listed.map((r) => (
                <AccountRow
                  key={r.id}
                  row={r}
                  pinned={pinned.includes(r.id)}
                  onPick={pick}
                  onTogglePin={togglePin}
                />
              ))}

              {isLoading && (
                <p className="text-ink-muted" style={{ fontSize: 12, padding: '6px 8px' }}>
                  Loading accounts…
                </p>
              )}
              {!isLoading && !error && listed.length === 0 && (
                <p className="text-ink-muted" style={{ fontSize: 12, padding: '6px 8px' }}>
                  No account matches that search.
                </p>
              )}
              {/* Named, never silent: without this the panel would show the
                  agency row alone and read as "you have no sub-accounts". */}
              {error && (
                <p style={{ fontSize: 12, padding: '6px 8px', color: 'var(--danger, #b91c1c)' }}>
                  Could not load sub-accounts: {(error as Error).message}
                </p>
              )}
              {err && (
                <p style={{ fontSize: 12, padding: '6px 8px', color: 'var(--danger, #b91c1c)' }}>
                  {err}
                </p>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
              <Link
                href="/settings/sub-accounts"
                onClick={() => setOpen(false)}
                className="block rounded-lg text-ink-muted transition-colors hover:bg-bg hover:text-ink"
                style={{ fontSize: 12.5, padding: '7px 8px' }}
              >
                Manage sub-accounts
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}

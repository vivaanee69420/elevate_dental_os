'use client';

// Data Room "universal" date filter. The ScopePeriod state lives in the URL
// (see features/_shared/scope-context.tsx) and sidebar / section-tab links
// drop the query string, so each Data Room page would otherwise reset to
// "This month". This hook remembers the last scope + period params for the
// browser tab (sessionStorage) and restores them when a Data Room page mounts
// with none in its URL. Scoped to the Data Room only — no other page reads it.

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export const STORAGE_KEY = 'data-room:scope-period';

const KEYS = ['scope', 'mode', 'mk', 'yk', 'cs', 'cu'] as const;
type Key = (typeof KEYS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID: Record<Key, (v: string) => boolean> = {
  scope: (v) => v === 'all' || UUID_RE.test(v),
  mode: (v) => v === 'month' || v === 'year' || v === 'custom',
  mk: (v) => /^\d{4}-\d{2}$/.test(v),
  yk: (v) => /^\d{4}$/.test(v),
  cs: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  cu: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
};

/** Only well-formed values survive the round trip through storage. */
export function sanitize(raw: unknown): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v && VALID[k](v)) out[k] = v;
  }
  return out;
}

function load(): Partial<Record<Key, string>> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function save(v: Partial<Record<Key, string>>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode, quota) — the URL still works */
  }
}

export function usePersistedScopePeriod() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Stable string of the tracked params so the effect re-runs only when one of
  // them actually changes (the searchParams object identity changes on every
  // navigation).
  const present = KEYS.map((k) => `${k}=${params.get(k) ?? ''}`).join('&');
  const hasAny = KEYS.some((k) => params.has(k));

  useEffect(() => {
    if (hasAny) {
      const current: Partial<Record<Key, string>> = {};
      for (const k of KEYS) {
        const v = params.get(k);
        if (v) current[k] = v;
      }
      save(sanitize(current));
      return;
    }
    const saved = load();
    if (Object.keys(saved).length === 0) return;
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(saved)) if (v) sp.set(k, v);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // `present` stands in for the individual param values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAny, present, pathname, router]);
}

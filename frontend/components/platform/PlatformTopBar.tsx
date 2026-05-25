'use client';
import { usePlatformMe } from '@/hooks/usePlatformMe';

// PlatformTopBar — platform shell header. Mirrors the tenant app's TopBar
// (white surface, initials avatar, sign-out lives in the sidebar) with one
// safety addition: a thin danger accent strip across the top, plus the
// cross-tenant + audit reminder inline. The strip is the alarm cue so the
// copy itself can stay calm.

/** Build initials from a name or email, e.g. "Ruhith Pasha" -> "RP". */
function initials(name?: string): string {
  const src = (name || '').trim();
  if (!src) return '?';
  return src
    .split(/[\s@.]+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function PlatformTopBar() {
  const { data: me } = usePlatformMe();

  return (
    <header className="sticky top-0 z-10">
      <div className="h-1 bg-danger" />
      <div className="h-14 bg-card border-b border-border px-6 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">
          Platform <span className="text-ink-muted font-normal">· all tenants · audit-logged</span>
        </span>
        {me && (
          <div className="w-7 h-7 rounded-full bg-brand-50 text-brand flex items-center justify-center text-[11px] font-semibold">
            {initials(me.full_name || me.email)}
          </div>
        )}
      </div>
    </header>
  );
}

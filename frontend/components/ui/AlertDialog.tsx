'use client';
// The app's one notice / confirm dialog.
//
// It exists because three separate hand-rolled overlays had grown inside
// IntegrationsScreen alone — success notice, disconnect confirmation, API-key
// paste — each with its own copy of the backdrop, the white box and the button
// styles, and none of them with Escape, a focus trap or focus restore. Three
// copies is three chances to drift, and they had: the same dialog was a
// different width, a different radius and a different button in each.
//
// Chrome only. The caller owns the words and the actions; this owns the
// backdrop, the medallion, the layout and the keyboard behaviour.

import { ReactNode, useEffect, useId, useRef } from 'react';

export type DialogTone = 'success' | 'danger' | 'neutral';

// The icon carries the tone, so the title does not have to. A red heading over
// a red icon over a red button reads as a catastrophe whether or not one has
// happened; one tinted medallion says the same thing calmly.
const TONES: Record<DialogTone, { bg: string; ring: string; fg: string; icon: ReactNode }> = {
  success: {
    bg: 'var(--brand-50)',
    ring: 'rgba(29, 110, 95, 0.10)',
    fg: 'var(--brand)',
    icon: <polyline points="20 6 9 17 4 12" />,
  },
  danger: {
    bg: '#FBEAE6',
    ring: 'rgba(194, 95, 77, 0.12)',
    fg: 'var(--danger)',
    icon: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
  },
  neutral: {
    bg: 'var(--bg)',
    ring: 'rgba(86, 107, 98, 0.10)',
    fg: 'var(--ink-muted)',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </>
    ),
  },
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, a[href]';

export function AlertDialog({
  tone = 'neutral',
  title,
  description,
  badge,
  children,
  actions,
  onClose,
  width = 420,
}: {
  tone?: DialogTone;
  title: ReactNode;
  description?: ReactNode;
  /** Replaces the tone medallion — a provider's own mark, say. */
  badge?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const backdropDown = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const t = TONES[tone];

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the LAST action (the primary sits rightmost), so Enter confirms and
    // Escape dismisses without the pointer ever being used.
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables?.[0];
    const input = cardRef.current?.querySelector<HTMLElement>('input, textarea');
    (input ?? focusables?.[focusables.length - 1] ?? first)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      // Trap in BOTH directions — a Shift+Tab off the first control otherwise
      // lands on the page behind, which is still there and still clickable.
      const items = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items || items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restoreTo?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? bodyId : undefined}
      className="dialog-backdrop"
      // Close on a click that BEGAN on the backdrop. Without the mousedown
      // check, selecting text in the body and releasing outside the card shuts
      // the dialog mid-sentence.
      onMouseDown={(e) => { backdropDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropDown.current && e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, padding: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(16, 34, 28, 0.42)', backdropFilter: 'blur(3px)',
      }}
    >
      <div
        ref={cardRef}
        className="dialog-card"
        style={{
          background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)',
          width: '100%', maxWidth: width, maxHeight: '86vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 28px 70px rgba(20, 60, 46, 0.24)',
        }}
      >
        <div style={{ padding: '26px 26px 20px', overflowY: 'auto' }}>
          {badge ?? (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, borderRadius: 999, marginBottom: 16,
                background: t.bg, color: t.fg, boxShadow: `0 0 0 6px ${t.ring}`,
              }}
            >
              <svg
                width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
              >
                {t.icon}
              </svg>
            </span>
          )}

          <h2
            id={titleId}
            className="display"
            style={{ margin: 0, fontSize: 17.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}
          >
            {title}
          </h2>

          {description && (
            <p
              id={bodyId}
              className="text-ink-muted"
              style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6 }}
            >
              {description}
            </p>
          )}

          {children && <div style={{ marginTop: 18 }}>{children}</div>}
        </div>

        {actions && (
          <div
            style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8,
              padding: '14px 26px', borderTop: '1px solid var(--line-2)', background: '#FAFCFB',
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export function DialogButton({
  variant = 'secondary',
  disabled,
  onClick,
  children,
  type = 'button',
}: {
  variant?: 'primary' | 'danger' | 'secondary';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  type?: 'button' | 'submit';
}) {
  const base = {
    height: 36, padding: '0 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
    transition: 'background 120ms ease, border-color 120ms ease',
  } as const;
  const skin = variant === 'primary'
    ? { background: 'var(--brand)', color: '#FFFFFF', border: '1px solid var(--brand)' }
    : variant === 'danger'
      ? { background: 'var(--danger)', color: '#FFFFFF', border: '1px solid var(--danger)' }
      : { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' };

  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...skin }}>
      {children}
    </button>
  );
}

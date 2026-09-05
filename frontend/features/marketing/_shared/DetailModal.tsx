'use client';
// ============================================================================
// Detail in a dialog, not in the page.
//
// The row detail used to expand in place. Two things were wrong with that, and
// the second is the serious one:
//
//   1. Opening a row pushed everything below it down, so on a long table the
//      thing you opened could be off-screen by the time it rendered — and a
//      highlight card that "opened" a row forty rows down looked like a card
//      that did nothing at all.
//
//   2. THERE WAS NO WAY BACK. An expanded row has no close affordance beyond
//      clicking the same row again, which is not discoverable, and no Escape
//      key, and nothing to return focus to. You could get in and not out.
//
// A dialog fixes both: it appears where you are looking, it has an obvious
// close, Escape works, and the page underneath does not move.
//
// This deliberately does NOT become the app's modal primitive. CLAUDE.md
// records click-to-expand as the house idiom (the Business Hub's Treatments
// Accepted card, "not a modal"), so this lives in the marketing report's own
// _shared and is scoped to it rather than being promoted to components/ui and
// quietly changing the convention everywhere.
//
// ============================================================================
// WHAT A DIALOG HAS TO DO TO BE ONE, all of it below and none of it optional:
//
//   * Escape closes it, and the listener is removed when it unmounts.
//   * The backdrop closes it; the panel itself does not (a click that started
//     on the panel and drifted onto the backdrop must NOT close — hence the
//     check on the event target rather than a bare onClick).
//   * Focus moves INTO the dialog on open and returns to whatever opened it on
//     close. Without the second half, closing drops the reader at the top of
//     the document.
//   * Focus is trapped: Tab from the last element wraps to the first. A dialog
//     that lets Tab wander into the page behind it is a dialog only visually.
//   * The page behind does not scroll.
//   * role="dialog" + aria-modal + aria-labelledby, so it is announced as one.
// ============================================================================
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function DetailModal({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus when the dialog opened — the row or the card the reader
  // clicked. Focus goes back there on close so they resume where they were.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    // Wrap in both directions. Without the shift-Tab half, focus escapes
    // backwards out of the top of the dialog on the very first keystroke.
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKey, true);
    // Focus the panel itself rather than its first control: the first control
    // is frequently the close button, and landing on "close" reads as though
    // the dialog is asking to be dismissed.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.body.style.overflow = overflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 sm:p-8"
      // Only a click that BEGAN on the backdrop closes. A drag that starts
      // inside the panel — selecting a phone number to copy, say — must not
      // dismiss the thing being read when the pointer lifts outside it.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-title"
        tabIndex={-1}
        className="w-full max-w-4xl rounded-panel border border-border bg-surface shadow-panel outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="detail-modal-title" className="font-display text-[18px] leading-tight text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-[12px] text-ink-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-full px-2 py-1 text-[18px] leading-none text-ink-muted transition-colors hover:bg-bg hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * A row of labelled figures — the standard furniture inside these dialogs.
 *
 * `value` is pre-formatted, exactly as StatRail's is: the em-dash contract for
 * an unknown lives in ./format.ts and is applied by the caller, so this never
 * has to decide what a null means.
 */
export function Facts({
  items,
}: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            {it.label}
          </p>
          <p className="mt-0.5 text-[13px] tabular-nums text-ink">{it.value}</p>
          {it.note && <p className="text-[11px] text-ink-muted">{it.note}</p>}
        </div>
      ))}
    </div>
  );
}

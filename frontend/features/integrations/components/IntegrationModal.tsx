'use client';
// The Manage dialog opened from an integration tile. Owns the chrome only —
// header, Escape, background scroll lock, click-outside — so the panels it
// renders stay plain sections that know nothing about being in a dialog.

import { ReactNode, useEffect } from 'react';

export default function IntegrationModal({
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes; while open the page behind must not scroll under the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 12, width: '100%', maxWidth: 920,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {icon}
            <div style={{ minWidth: 0 }}>
              <h2 className="display" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
                {title}
              </h2>
              {subtitle && (
                <div className="text-ink-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
              background: 'white', cursor: 'pointer', color: 'var(--ink-muted, #64748b)',
              flexShrink: 0,
            }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

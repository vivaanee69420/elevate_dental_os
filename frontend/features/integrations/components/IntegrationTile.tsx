'use client';
// One card in the Integrations grid: brand mark, name, status line, a one-line
// description, and a single primary action. Secondary actions (Refresh data,
// Disconnect, Connect with an API key) live behind the overflow menu so the
// tile has exactly one obvious thing to click.

import { useEffect, useRef, useState } from 'react';
import ProviderIcon from './ProviderIcon';

export interface TileMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export default function IntegrationTile({
  id,
  label,
  description,
  status,
  tone,
  error,
  primaryLabel,
  primaryDisabled,
  onPrimary,
  menu = [],
}: {
  id: string;
  label: string;
  description: string;
  status: string;
  tone: 'connected' | 'attention' | 'idle';
  error?: string | null;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  menu?: TileMenuItem[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A menu left open behind a dialog or after scrolling away is a stuck
  // overlay, so close on any outside click and on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const statusColour =
    tone === 'connected' ? '#047857' : tone === 'attention' ? '#B45309' : 'var(--ink-muted, #64748b)';

  return (
    <div
      className="card-padded"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 168 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <ProviderIcon id={id} label={label} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="display"
            style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}
          >
            {label}
          </div>
          <div style={{ fontSize: 11, marginTop: 2, color: statusColour, fontWeight: 600 }}>
            {status}
          </div>
        </div>

        {menu.length > 0 && (
          <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              aria-label={`More options for ${label}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: 6, border: 'none',
                background: 'transparent', cursor: 'pointer',
                color: 'var(--ink-muted, #64748b)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="12" cy="19" r="1.7" />
              </svg>
            </button>
            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute', top: 28, right: 0, zIndex: 20, minWidth: 176,
                  background: 'white', border: '1px solid var(--border)', borderRadius: 8,
                  boxShadow: '0 10px 24px rgba(0,0,0,0.12)', padding: 4,
                }}
              >
                {menu.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => { setMenuOpen(false); item.onSelect(); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 10px', fontSize: 12, borderRadius: 6,
                      border: 'none', background: 'transparent',
                      cursor: item.disabled ? 'default' : 'pointer',
                      opacity: item.disabled ? 0.5 : 1,
                      color: item.danger ? 'var(--danger, #b91c1c)' : 'var(--ink, #111)',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-ink-muted" style={{ fontSize: 12, lineHeight: 1.45, margin: 0, flex: 1 }}>
        {description}
      </p>

      {error && (
        <p style={{ fontSize: 11, margin: 0, color: 'var(--danger, #b91c1c)' }}>{error}</p>
      )}

      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        style={{
          width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 700,
          borderRadius: 8, cursor: primaryDisabled ? 'default' : 'pointer',
          border: `1px solid ${tone === 'connected' ? '#A7F3D0' : 'var(--border)'}`,
          background: tone === 'connected' ? '#ECFDF5' : 'white',
          color: tone === 'connected' ? '#047857' : 'var(--brand, #2563eb)',
          opacity: primaryDisabled ? 0.6 : 1,
        }}
      >
        {primaryLabel}
      </button>
    </div>
  );
}

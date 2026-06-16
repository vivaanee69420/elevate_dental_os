'use client';
// Shared collapsible card shell for the Integrations screen panels. Clickable
// header row with a chevron that rotates when closed; body hides when collapsed.
// `actions` render to the right of the header, OUTSIDE the toggle button, so
// action buttons (Add / Connect) don't nest inside the toggle.

import { ReactNode, useState } from 'react';

export default function CollapsibleCard({
  title,
  badge,
  actions,
  defaultOpen = true,
  style,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-padded" style={{ marginBottom: 20, ...style }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: open ? 4 : 0,
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <h2 className="display" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            {title}
          </h2>
          {badge}
        </button>
        {actions}
      </div>
      {open && children}
    </div>
  );
}

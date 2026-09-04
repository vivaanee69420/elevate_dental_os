'use client';
// Shared shell for an integration's configuration panel.
//
// A panel is a SECTION inside its integration's Manage dialog, not a card on
// the Integrations page. The page is a grid of provider tiles; opening a tile
// renders that provider's panels stacked here, so one provider with several
// panels (Dentally: practice mapping + webhook) reads as one dialog rather
// than several loose cards competing for the same screen.
//
// `badge` is section-level status. `actions` are controls that drive this
// section's body (Add subaccount, Connect a company …) and sit beside the
// title. The dialog chrome — open state, Escape, scroll lock — belongs to
// IntegrationModal; this component renders inline and owns none of it.

import { ReactNode } from 'react';

export default function PanelCard({
  title,
  badge,
  actions,
  style,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 16,
        marginBottom: 12,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <h3 className="display" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
            {title}
          </h3>
          {badge}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

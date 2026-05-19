'use client';
// System — Integrations. Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES.integrations.
//
// Pipeline: INTEGRATIONS -> group by category (first-seen order)
//   -> one section per category, each a 3-up grid of connection tiles.
//
// Connection state is shown with the shared Chip primitive (emerald =
// connected, amber = connect). Prototype emoji glyphs dropped per
// project rule 7.
import { useMemo } from 'react';
import { Chip } from '@/components/ui';
import { INTEGRATIONS } from '../data';

/** Integrations screen. */
export default function IntegrationsScreen() {
  // Group integrations by category, preserving first-seen order.
  const groups = useMemo(() => {
    const out: { category: string; items: typeof INTEGRATIONS }[] = [];
    INTEGRATIONS.forEach((i) => {
      let g = out.find((x) => x.category === i.category);
      if (!g) {
        g = { category: i.category, items: [] };
        out.push(g);
      }
      g.items.push(i);
    });
    return out;
  }, []);

  const connectedCount = INTEGRATIONS.filter(
    (i) => i.status === 'connected',
  ).length;

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Integrations
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {connectedCount} of {INTEGRATIONS.length} connected · Auto-syncs
          every 15 min
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.category} style={{ marginBottom: 20 }}>
          <h2
            className="display text-ink-muted"
            style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}
          >
            {g.category}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            {g.items.map((i) => (
              <div
                key={i.name}
                className="card-padded"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {i.name}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 11 }}
                  >
                    {i.desc}
                  </div>
                </div>
                <Chip colour={i.status === 'connected' ? 'emerald' : 'amber'}>
                  {i.status === 'connected' ? 'Connected' : 'Connect'}
                </Chip>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

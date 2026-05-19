'use client';
// Landing Pages — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.pages at ~line 4150). Three summary KPIs over a two-column card grid
// of landing pages with views/leads/conversion stats.
//
// Data flow: LANDING_PAGES -> KPI aggregates + per-page cards.

import { useMemo } from 'react';
import { KpiTile, Chip } from '@/components/ui';
import { LANDING_PAGES } from '../data';

/** Landing Pages screen. */
export default function PagesScreen() {
  // Header aggregates over the landing-page set.
  const { totalViews, totalLeads, avgConv } = useMemo(() => {
    const v = LANDING_PAGES.reduce((s, p) => s + p.views, 0);
    const l = LANDING_PAGES.reduce((s, p) => s + p.leads, 0);
    const c =
      LANDING_PAGES.reduce((s, p) => s + p.conversion, 0) /
      LANDING_PAGES.length;
    return { totalViews: v, totalLeads: l, avgConv: c };
  }, []);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Landing Pages
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {LANDING_PAGES.length} pages ·{' '}
          {totalLeads.toLocaleString('en-GB')} leads TTM
        </p>
      </div>

      {/* 3 KPIs */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
      >
        <KpiTile
          label="Total visitors (TTM)"
          value={totalViews.toLocaleString('en-GB')}
        />
        <KpiTile
          label="Total leads"
          value={totalLeads.toLocaleString('en-GB')}
          delta="From landing pages"
          deltaTone="up"
        />
        <KpiTile
          label="Avg conversion"
          value={`${avgConv.toFixed(1)}%`}
          delta="UK avg: 2.4%"
          deltaTone="up"
        />
      </div>

      {/* Page cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 16,
        }}
      >
        {LANDING_PAGES.map((p) => (
          <div key={p.url} className="card-padded">
            <div
              className="flex"
              style={{
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 10,
              }}
            >
              <div>
                <h3
                  className="display font-bold"
                  style={{ fontSize: 15 }}
                >
                  {p.name}
                </h3>
                <span
                  style={{ fontSize: 11, color: 'var(--brand)' }}
                >
                  {p.url}
                </span>
              </div>
              <Chip colour="brand">{p.template}</Chip>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 10,
                paddingTop: 10,
                borderTop: '1px solid var(--border)',
              }}
            >
              <Stat label="Views" value={p.views.toLocaleString('en-GB')} />
              <Stat
                label="Leads"
                value={String(p.leads)}
                colour="var(--brand)"
              />
              <Stat
                label="Conv."
                value={`${p.conversion}%`}
                colour="var(--success)"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One mini stat block inside a landing-page card. */
function Stat({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour?: string;
}) {
  return (
    <div>
      <div
        className="text-ink-muted"
        style={{ fontSize: 10, textTransform: 'uppercase' }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: colour }}>
        {value}
      </div>
    </div>
  );
}

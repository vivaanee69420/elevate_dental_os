'use client';
// Marketing — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.marketing). Source performance + ROI for the last 30 days: a
// 3-up KPI strip, a source-breakdown table with volume bars, and a
// treatment-mix table. Fed by the growth mock-data layer; swap to a real
// marketing-analytics endpoint when one exists server-side.
//
// Data flow:
//   SOURCE_SUMMARY ──┬─► KPI strip (total leads / pipeline / avg conv)
//                     ├─► sorted-by-leads table + volume bar (leads/maxLeads)
//   TREATMENT_SUMMARY ──► sorted-by-value table + volume bar (value/maxValue)

import { useMemo } from 'react';
import { Card, KpiTile, Chip, type ChipColour } from '@/components/ui';
import { formatPoundsCompact } from '@/features/_mock';
import { SOURCE_SUMMARY, TREATMENT_SUMMARY } from '../data';

/** Conversion-rate -> chip colour, matching the prototype thresholds. */
function convChip(rate: number): ChipColour {
  return rate >= 12 ? 'emerald' : rate >= 8 ? 'amber' : 'rose';
}

/** A thin horizontal volume bar (fill width = pct of the table max). */
function VolumeBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="h-2 bg-bg rounded overflow-hidden">
      <div className="h-full rounded" style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}

/** Marketing screen: source performance and treatment mix. */
export default function MarketingScreen() {
  const view = useMemo(() => {
    const sources = [...SOURCE_SUMMARY].sort((a, b) => b.leads - a.leads);
    const maxLeads = Math.max(...sources.map((s) => s.leads));
    const totalLeads = sources.reduce((s, x) => s + x.leads, 0);
    const totalPipeline = sources.reduce((s, x) => s + x.pipeline_value, 0);
    const avgConv = sources.reduce((s, x) => s + x.conversion_rate, 0) / sources.length;

    const treatments = [...TREATMENT_SUMMARY].sort(
      (a, b) => b.pipeline_value - a.pipeline_value
    );
    const maxTV = Math.max(...treatments.map((t) => t.pipeline_value));

    return { sources, maxLeads, totalLeads, totalPipeline, avgConv, treatments, maxTV };
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Marketing</h1>
        <p className="text-sm text-ink-muted mt-1">
          Source performance and ROI · last 30 days
        </p>
      </div>

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile label="Total leads (30d)" value={String(view.totalLeads)} />
        <KpiTile
          label="Total pipeline value"
          value={formatPoundsCompact(view.totalPipeline)}
        />
        <KpiTile label="Avg conversion" value={`${view.avgConv.toFixed(1)}%`} />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold mb-5" style={{ fontSize: 18 }}>
          Source breakdown
        </h2>
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left pb-2 font-semibold">Source</th>
              <th className="text-right pb-2 font-semibold">Leads</th>
              <th className="text-right pb-2 font-semibold">Converted</th>
              <th className="text-right pb-2 font-semibold">Conv %</th>
              <th className="text-right pb-2 font-semibold">Pipeline value</th>
              <th className="text-left pb-2 font-semibold" style={{ width: 200 }}>
                Volume
              </th>
            </tr>
          </thead>
          <tbody>
            {view.sources.map((s) => (
              <tr key={s.name} className="border-b border-border">
                <td className="py-2.5 font-semibold">{s.name}</td>
                <td className="py-2.5 text-right">{s.leads}</td>
                <td className="py-2.5 text-right">{s.converted}</td>
                <td className="py-2.5 text-right">
                  <Chip colour={convChip(s.conversion_rate)}>{s.conversion_rate}%</Chip>
                </td>
                <td className="py-2.5 text-right font-semibold">
                  {formatPoundsCompact(s.pipeline_value)}
                </td>
                <td className="py-2.5">
                  <VolumeBar
                    pct={(s.leads / view.maxLeads) * 100}
                    colour="var(--brand)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="display font-semibold mb-4" style={{ fontSize: 18 }}>
          Treatment mix (30d pipeline)
        </h2>
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left pb-2 font-semibold">Treatment</th>
              <th className="text-right pb-2 font-semibold">Leads</th>
              <th className="text-right pb-2 font-semibold">Pipeline value</th>
              <th className="text-left pb-2 font-semibold" style={{ width: 240 }}>
                Volume
              </th>
            </tr>
          </thead>
          <tbody>
            {view.treatments.map((t) => (
              <tr key={t.name} className="border-b border-border">
                <td className="py-2.5 font-semibold">{t.name}</td>
                <td className="py-2.5 text-right">{t.leads}</td>
                <td className="py-2.5 text-right font-semibold">
                  {formatPoundsCompact(t.pipeline_value)}
                </td>
                <td className="py-2.5">
                  <VolumeBar
                    pct={(t.pipeline_value / view.maxTV) * 100}
                    colour="var(--accent)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

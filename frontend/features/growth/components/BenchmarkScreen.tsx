'use client';
// Benchmark — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.benchmark). GM Dental vs UK 2024-25 industry averages: a 3-up
// KPI strip, a metric-by-metric comparison table with variance + status
// chips, and a top-opportunities list. Fed by the growth mock-data layer;
// swap to a real benchmarking dataset when one exists server-side.
//
// Data flow:
//   BENCHMARK_METRICS ──► per-row variance (you - avg), direction-aware
//                          "Better"/"Below" chip + coloured delta
//   BENCHMARK_OPPORTUNITIES ──► uplift list

import { Card, KpiTile, Chip } from '@/components/ui';
import { formatPoundsCompact } from '@/features/_mock';
import {
  BENCHMARK_METRICS,
  BENCHMARK_OPPORTUNITIES,
  type BenchmarkMetric,
} from '../data';

/** Format a benchmark figure according to its unit (£ compact / % / int). */
function fmt(n: number, unit: BenchmarkMetric['unit']): string {
  if (unit === '£') return formatPoundsCompact(n);
  if (unit === '%') return `${n.toFixed(1)}%`;
  return n.toFixed(0);
}

/** One comparison row: UK avg, you, signed variance, status chip. */
function Row({ m }: { m: BenchmarkMetric }) {
  const variance = m.you - m.avg;
  const isBetter = m.positiveBetter ? variance > 0 : variance < 0;
  const colour = isBetter ? 'var(--success)' : 'var(--danger)';
  const varText =
    (variance > 0 ? '+' : '') +
    (m.unit === '£' ? formatPoundsCompact(variance) : variance.toFixed(1)) +
    (m.unit === '%' ? 'pp' : '');
  return (
    <tr className="border-b border-border">
      <td className="py-2.5 font-semibold">{m.label}</td>
      <td className="py-2.5 text-right">{fmt(m.avg, m.unit)}</td>
      <td className="py-2.5 text-right font-semibold">{fmt(m.you, m.unit)}</td>
      <td className="py-2.5 text-right">
        <span style={{ color: colour, fontWeight: 600 }}>{varText}</span>
      </td>
      <td className="py-2.5">
        <Chip colour={isBetter ? 'emerald' : 'rose'}>
          {isBetter ? 'Better' : 'Below'}
        </Chip>
      </td>
    </tr>
  );
}

/** Benchmark screen: GM Dental vs UK industry averages. */
export default function BenchmarkScreen() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Benchmark</h1>
        <p className="text-sm text-ink-muted mt-1">
          GM Dental vs UK industry averages (2024-25)
        </p>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile
          label="Overall ranking"
          value="Top 35%"
          delta="Above median"
          deltaTone="up"
        />
        <KpiTile
          label="Better than avg"
          value="5 / 8"
          delta="metrics"
          deltaTone="up"
        />
        <KpiTile
          label="Top quartile uplift"
          value={formatPoundsCompact(720000)}
          delta="Potential"
          deltaTone="up"
        />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold mb-4" style={{ fontSize: 17 }}>
          Performance vs UK industry
        </h2>
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left pb-2 font-semibold">Metric</th>
              <th className="text-right pb-2 font-semibold">UK avg</th>
              <th className="text-right pb-2 font-semibold">You</th>
              <th className="text-right pb-2 font-semibold">Variance</th>
              <th className="text-left pb-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {BENCHMARK_METRICS.map((m) => (
              <Row key={m.label} m={m} />
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
          Top improvement opportunities
        </h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {BENCHMARK_OPPORTUNITIES.map((o, i) => (
            <li
              key={o.title}
              className="flex justify-between"
              style={{
                padding: '12px 0',
                borderBottom:
                  i < BENCHMARK_OPPORTUNITIES.length - 1
                    ? '1px solid var(--border)'
                    : 'none',
              }}
            >
              <div>
                <strong>{o.title}</strong>
                <div className="text-ink-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {o.detail}
                </div>
              </div>
              <div
                className="display font-semibold"
                style={{ fontSize: 18, color: 'var(--success)' }}
              >
                +{formatPoundsCompact(o.uplift)}/yr
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

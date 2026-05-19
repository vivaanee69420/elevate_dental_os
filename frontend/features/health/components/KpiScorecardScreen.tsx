'use client';
// KPI Scorecard — 23-metric traffic-lighted performance dashboard.
// Pixel-faithful port of preview/elevate-dental-os-v2.html PAGES.kpiscorecard.
//
// Data flow:
//   KPIS (static targets/actuals)
//     -> statusOf()  : green | amber | red per metric
//     -> summary KPI strip (counts by status)
//     -> grouped by category -> metric cards (value, target, progress bar)
//
// Mock-only, no API. British English, no emojis (rule 7), £ via formatPounds.

import { formatPounds } from '@/features/_mock';

type Better = 'higher' | 'lower';
type Unit = '%' | '£' | 'min' | '';

interface Kpi {
  cat: string;
  name: string;
  actual: number;
  target: number;
  unit: Unit;
  better: Better;
}

// The 23 tracked KPIs across four categories (prototype values verbatim).
const KPIS: Kpi[] = [
  { cat: 'Financial', name: 'Net profit margin', actual: 10.0, target: 18, unit: '%', better: 'higher' },
  { cat: 'Financial', name: 'EBITDA margin', actual: 14.0, target: 22, unit: '%', better: 'higher' },
  { cat: 'Financial', name: 'Revenue per chair (monthly)', actual: 20400, target: 25000, unit: '£', better: 'higher' },
  { cat: 'Financial', name: 'Collections rate', actual: 96.8, target: 98, unit: '%', better: 'higher' },
  { cat: 'Financial', name: 'Aged debtors >90 days', actual: 0.3, target: 0.5, unit: '%', better: 'lower' },
  { cat: 'Financial', name: 'Lab cost % revenue', actual: 16.0, target: 15, unit: '%', better: 'lower' },
  { cat: 'Financial', name: 'Staff cost % revenue', actual: 17.0, target: 16, unit: '%', better: 'lower' },
  { cat: 'Patient', name: 'New patients per month', actual: 187, target: 220, unit: '', better: 'higher' },
  { cat: 'Patient', name: 'Active patient base', actual: 14820, target: 16000, unit: '', better: 'higher' },
  { cat: 'Patient', name: 'Patient retention (12mo)', actual: 94, target: 92, unit: '%', better: 'higher' },
  { cat: 'Patient', name: 'Lifetime value (private)', actual: 1850, target: 2200, unit: '£', better: 'higher' },
  { cat: 'Patient', name: 'Recall compliance', actual: 82, target: 90, unit: '%', better: 'higher' },
  { cat: 'Patient', name: 'Net Promoter Score', actual: 64, target: 60, unit: '', better: 'higher' },
  { cat: 'Conversion', name: 'Lead-to-consult rate', actual: 38, target: 50, unit: '%', better: 'higher' },
  { cat: 'Conversion', name: 'Consult-to-treatment rate', actual: 64, target: 75, unit: '%', better: 'higher' },
  { cat: 'Conversion', name: 'Overall lead-to-treatment', actual: 11.5, target: 18, unit: '%', better: 'higher' },
  { cat: 'Conversion', name: 'Average case value', actual: 2850, target: 3200, unit: '£', better: 'higher' },
  { cat: 'Operational', name: 'Chair utilisation', actual: 78, target: 88, unit: '%', better: 'higher' },
  { cat: 'Operational', name: 'FTA / no-show rate', actual: 4.2, target: 5, unit: '%', better: 'lower' },
  { cat: 'Operational', name: 'Same-day appointment fill', actual: 65, target: 80, unit: '%', better: 'higher' },
  { cat: 'Operational', name: 'Lead response time (min)', actual: 22, target: 5, unit: 'min', better: 'lower' },
  { cat: 'Operational', name: 'UDA delivery vs contract', actual: 96, target: 100, unit: '%', better: 'higher' },
  { cat: 'Operational', name: 'Production per associate / mo', actual: 35200, target: 42000, unit: '£', better: 'higher' },
];

type Status = 'green' | 'amber' | 'red';

const STATUS_COLOUR: Record<Status, string> = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
};

const CATEGORIES = ['Financial', 'Patient', 'Conversion', 'Operational'] as const;

/**
 * Traffic-light a KPI: green on/above target, amber within 10%, red beyond.
 * Direction-aware via `better` (some metrics are better when lower).
 */
function statusOf(k: Kpi): Status {
  if (k.better === 'higher') {
    if (k.actual >= k.target) return 'green';
    if (k.actual >= k.target * 0.9) return 'amber';
    return 'red';
  }
  if (k.actual <= k.target) return 'green';
  if (k.actual <= k.target * 1.1) return 'amber';
  return 'red';
}

/** Format a metric value per its unit (£ grouped, %, minutes, or plain). */
function fmt(n: number, unit: Unit): string {
  if (unit === '£') return formatPounds(n);
  if (unit === '%') return n + '%';
  if (unit === 'min') return n + 'm';
  return n.toLocaleString('en-GB');
}

/** Progress toward target as a 0-100% bar width (direction-aware). */
function progressPct(k: Kpi): number {
  const raw =
    k.better === 'higher'
      ? (k.actual / k.target) * 100
      : (k.target / k.actual) * 100;
  return Math.min(100, raw);
}

/** One metric card: name, actual vs target, status-coloured progress bar. */
function MetricCard({ k }: { k: Kpi }) {
  const st = statusOf(k);
  return (
    <div
      className="bg-bg"
      style={{
        borderLeft: `4px solid ${STATUS_COLOUR[st]}`,
        padding: '10px 12px',
        borderRadius: '0 6px 6px 0',
      }}
    >
      <div className="text-[11px] text-ink-muted mb-0.5">{k.name}</div>
      <div className="flex justify-between items-baseline">
        <div className="display text-xl font-bold">{fmt(k.actual, k.unit)}</div>
        <div className="text-[11px] text-ink-muted">
          Target: {fmt(k.target, k.unit)}
        </div>
      </div>
      <div
        className="mt-1.5 overflow-hidden"
        style={{ height: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 2 }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPct(k)}%`,
            background: STATUS_COLOUR[st],
          }}
        />
      </div>
    </div>
  );
}

/** Summary tile in the top status strip. */
function SummaryTile({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1" style={colour ? { color: colour } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** KPI Scorecard screen: summary strip + four category panels. */
export default function KpiScorecardScreen() {
  const green = KPIS.filter((k) => statusOf(k) === 'green').length;
  const amber = KPIS.filter((k) => statusOf(k) === 'amber').length;
  const red = KPIS.filter((k) => statusOf(k) === 'red').length;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="display text-3xl font-bold">KPI Scorecard</h1>
        <p className="text-sm text-ink-muted">
          Stage 4 of the Mastery roadmap — performance management · 23 KPIs traffic-lighted
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryTile label="Total KPIs tracked" value={KPIS.length} />
        <SummaryTile label="On / above target" value={green} colour="var(--success)" />
        <SummaryTile label="Watching" value={amber} colour="var(--accent)" />
        <SummaryTile label="Below target" value={red} colour="var(--danger)" />
      </div>

      {CATEGORIES.map((cat) => {
        const items = KPIS.filter((k) => k.cat === cat);
        return (
          <div key={cat} className="card card-padded mb-3.5">
            <h2 className="display text-[17px] font-semibold mb-3.5">{cat} KPIs</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {items.map((k) => (
                <MetricCard key={k.name} k={k} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

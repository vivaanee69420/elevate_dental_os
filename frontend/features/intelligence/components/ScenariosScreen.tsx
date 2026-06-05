'use client';
// Scenario Planner — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.scenarios). Model decisions before you make them: a grid of what-if
// cards each showing revenue/profit/cash/valuation impact and a recommendation
// chip. Static mock data (no backend); see ../data.ts.

import { Card } from '@/components/ui';
import { SCENARIOS, formatPoundsCompact, type Scenario } from '../data';

const POS = 'var(--success)';
const NEG = 'var(--danger)';

// Status -> chip colour + label, mirroring the prototype's chip mapping.
const STATUS_CHIP: Record<Scenario['status'], { colour: string; label: string }> = {
  positive: { colour: 'chip-emerald', label: 'Recommended' },
  negative: { colour: 'chip-rose', label: 'Risk model' },
  neutral: { colour: 'chip-amber', label: 'Consider' },
};

/** One signed-impact metric cell (revenue/profit/cash/valuation). */
function ImpactMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-ink-muted uppercase" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div
        className="display font-semibold"
        style={{ fontSize: 17, color: value >= 0 ? POS : NEG }}
      >
        {value >= 0 ? '+' : ''}
        {formatPoundsCompact(value)}
      </div>
    </div>
  );
}

/** One scenario card: title, recommendation chip, four impacts, summary. */
function ScenarioCard({ s }: { s: Scenario }) {
  const chip = STATUS_CHIP[s.status];
  return (
    <Card className="cursor-pointer">
      <div className="flex justify-between items-start" style={{ marginBottom: 12 }}>
        <h3 className="display font-semibold" style={{ fontSize: 15 }}>
          {s.title}
        </h3>
        <span className={`chip ${chip.colour}`}>{chip.label}</span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}
      >
        <ImpactMetric label="Revenue impact" value={s.revenue} />
        <ImpactMetric label="Profit impact" value={s.profit} />
        <ImpactMetric label="Cash impact" value={s.cash} />
        <ImpactMetric label="Valuation impact" value={s.valuation} />
      </div>
      <p className="text-ink-muted" style={{ fontSize: 12 }}>
        {s.summary}
      </p>
    </Card>
  );
}

/** Scenario Planner page. */
export default function ScenariosScreen() {
  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="display text-3xl font-bold">Scenario Planner</h1>
            <p className="text-sm text-ink-muted mt-1">
              Model decisions before you make them
            </p>
          </div>
          <button className="btn btn-primary">+ New scenario</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {SCENARIOS.map((s) => (
          <ScenarioCard key={s.title} s={s} />
        ))}
      </div>
    </div>
  );
}

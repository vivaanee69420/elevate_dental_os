import { NavButtons } from './NavButtons';

export function Costs({ baseline, update, onBack, onNext }: any) {
  const cats = [
    { id: 'cost_associates', label: 'Associate pay', bench: 42, target: 40 },
    { id: 'cost_lab', label: 'Lab fees', bench: 10, target: 9 },
    { id: 'cost_materials', label: 'Materials & consumables', bench: 6, target: 5 },
    { id: 'cost_staff', label: 'Staff costs (excl. clinicians)', bench: 17, target: 15 },
    { id: 'cost_property', label: 'Property & facilities', bench: 7, target: 6 },
    { id: 'cost_marketing', label: 'Marketing', bench: 4, target: 5 },
    { id: 'cost_other', label: 'Other operating costs', bench: 6, target: 5 },
  ];
  const totalPct = cats.reduce((s, c) => s + (parseFloat(baseline[c.id]) || 0), 0);
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Cost Structure</h2>
        <p className="text-sm text-ink-muted mb-5">Enter as % of revenue. Skip if unsure.</p>
        {cats.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[2fr,1fr,1fr,1fr] gap-3 items-center py-3 border-b border-border"
          >
            <div className="text-sm font-semibold">{c.label}</div>
            <input
              type="number"
              step="0.1"
              value={baseline[c.id] ?? ''}
              onChange={(e) => update(c.id, parseFloat(e.target.value) || 0)}
              className="input"
              placeholder="0"
            />
            <div className="text-xs text-ink-muted text-right">UK avg: {c.bench}%</div>
            <div className="text-xs text-ink-muted text-right">Top: {c.target}%</div>
          </div>
        ))}
        <div className="mt-4 p-3 bg-bg rounded-lg text-center">
          <span className="text-sm text-ink-muted">Total costs:</span>
          <span className="display text-2xl font-bold text-brand ml-2">
            {totalPct.toFixed(1)}%
          </span>
          <span className="text-sm text-ink-muted ml-6">Implied margin:</span>
          <span className="display text-2xl font-bold text-success ml-2">
            {(100 - totalPct).toFixed(1)}%
          </span>
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

import { NavButtons } from './NavButtons';

export function Targets({ baseline, targets, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Where Do You Want To Be?</h2>
        <p className="text-sm text-ink-muted mb-5">Set the target. We&apos;ll model the path.</p>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="text-xs font-semibold">Time horizon *</label>
            <select
              value={targets.years || ''}
              onChange={(e) => update('years', parseInt(e.target.value))}
              className="input w-full mt-1.5"
            >
              <option value="">Choose...</option>
              <option value={1}>1 year (fast turnaround)</option>
              <option value={3}>3 years (typical)</option>
              <option value={5}>5 years (longer build)</option>
              <option value={7}>7 years (full exit prep)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold">Profit growth target *</label>
            <select
              value={targets.profit_multiple || ''}
              onChange={(e) => update('profit_multiple', parseFloat(e.target.value))}
              className="input w-full mt-1.5"
            >
              <option value="">Choose...</option>
              <option value={1.5}>1.5× current profit</option>
              <option value={2.0}>2.0× current profit</option>
              <option value={2.5}>2.5× current profit</option>
              <option value={3.0}>3.0× current profit</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold mb-2 block">
            Top priorities to focus on
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { id: 'priority_profit', label: 'Profitability', icon: '💰' },
              { id: 'priority_growth', label: 'Revenue growth', icon: '📈' },
              { id: 'priority_team', label: 'Team & culture', icon: '👥' },
              { id: 'priority_systems', label: 'Systems & process', icon: '⚙️' },
              { id: 'priority_owner', label: 'Less owner-dependency', icon: '🎯' },
              { id: 'priority_exit', label: 'Exit readiness', icon: '🚪' },
            ].map((p) => (
              <label
                key={p.id}
                className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer ${
                  targets[p.id] ? 'border-brand bg-brand-50' : 'border-border'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!targets[p.id]}
                  onChange={(e) => update(p.id, e.target.checked)}
                />
                <span className="text-lg">{p.icon}</span>
                <span className="text-sm font-semibold">{p.label}</span>
              </label>
            ))}
          </div>
        </div>
        {baseline.profit && targets.years && targets.profit_multiple && (
          <div className="mt-5 p-3.5 bg-brand-50 rounded-lg">
            <div className="text-xs text-brand uppercase font-semibold">✨ Path analysis</div>
            <div className="text-sm mt-1">
              From <strong>£{baseline.profit.toLocaleString()}</strong> to{' '}
              <strong>£{(baseline.profit * targets.profit_multiple).toLocaleString()}</strong> in{' '}
              {targets.years} years requires{' '}
              <strong>
                {((Math.pow(targets.profit_multiple, 1 / targets.years) - 1) * 100).toFixed(1)}%
                CAGR
              </strong>
              .
            </div>
          </div>
        )}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

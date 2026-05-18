import { useHealthInsights } from '../../hooks';

export function Review({ baseline, targets, onBack, onComplete }: any) {
  const { data: insights } = useHealthInsights();
  const targetProfit = (baseline.profit || 0) * (targets.profit_multiple || 1);
  const cagr =
    targets.profit_multiple && targets.years
      ? ((Math.pow(targets.profit_multiple, 1 / targets.years) - 1) * 100).toFixed(1)
      : '—';
  return (
    <>
      <div
        className="card-padded text-white mb-4"
        style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}
      >
        <h2 className="display text-3xl font-bold mb-2">✓ Your business health is captured</h2>
        <p className="opacity-90 mb-5">
          Every dashboard now reflects your data. Plan4Growth AI has analysed it.
        </p>
        <div className="grid grid-cols-4 gap-3.5">
          <div className="bg-white/10 p-3.5 rounded-lg">
            <div className="text-xs opacity-70 uppercase">Revenue today</div>
            <div className="display text-xl font-bold mt-1">
              £{(baseline.revenue || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-white/10 p-3.5 rounded-lg">
            <div className="text-xs opacity-70 uppercase">Profit today</div>
            <div className="display text-xl font-bold mt-1">
              £{(baseline.profit || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-white/10 p-3.5 rounded-lg border border-accent">
            <div className="text-xs opacity-70 uppercase">
              Target profit in {targets.years}y
            </div>
            <div className="display text-xl font-bold mt-1 text-accent">
              £{targetProfit.toLocaleString()}
            </div>
          </div>
          <div className="bg-white/10 p-3.5 rounded-lg">
            <div className="text-xs opacity-70 uppercase">Required CAGR</div>
            <div className="display text-xl font-bold mt-1">{cagr}%</div>
          </div>
        </div>
      </div>

      <div className="card-padded mb-4">
        <h3 className="display text-lg font-semibold mb-3">
          🤖 Plan4Growth AI&apos;s first read
        </h3>
        {!insights?.insights && (
          <p className="text-sm text-ink-muted">Loading AI analysis…</p>
        )}
        {insights?.insights?.map((ins: any, i: number) => {
          const colour =
            ins.severity === 'positive'
              ? 'border-success bg-green-50'
              : ins.severity === 'warning'
                ? 'border-warning bg-orange-50'
                : 'border-danger bg-red-50';
          return (
            <div key={i} className={`p-3 mb-2 rounded-lg border-l-4 ${colour}`}>
              <div className="font-semibold text-sm">{ins.title}</div>
              <div className="text-xs mt-1">{ins.finding}</div>
              <div className="text-xs mt-1">
                <strong>Impact:</strong> {ins.impact}
              </div>
              <div className="text-xs mt-1">
                <strong>Action:</strong> {ins.action}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={onBack} className="btn-ghost">← Back</button>
        <button onClick={onComplete} className="btn-primary text-base">
          ✓ Complete & open Progress Tracker
        </button>
      </div>
    </>
  );
}

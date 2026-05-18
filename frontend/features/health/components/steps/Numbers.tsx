import { NumberInput } from './NumberInput';
import { NavButtons } from './NavButtons';

export function Numbers({ baseline, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">The Numbers</h2>
        <p className="text-sm text-ink-muted mb-5">Pull these from your last set of accounts.</p>
        <div className="grid grid-cols-2 gap-4">
          <NumberInput required label="Annual revenue (TTM)" helper="Total income last 12 months" prefix="£" value={baseline.revenue} onChange={(v: number) => update('revenue', v)} placeholder="4,590,000" />
          <NumberInput required label="Net profit (TTM)" helper="After costs, before owner pay" prefix="£" value={baseline.profit} onChange={(v: number) => update('profit', v)} placeholder="459,000" />
          <NumberInput required label="Cash at bank (today)" prefix="£" value={baseline.cash} onChange={(v: number) => update('cash', v)} placeholder="287,000" />
          <NumberInput required label="Total business debt" helper="Bank loans + finance only" prefix="£" value={baseline.debt} onChange={(v: number) => update('debt', v)} placeholder="180,000" />
          <NumberInput label="Revenue 1 year ago" helper="For growth tracking" prefix="£" value={baseline.revenue_prior} onChange={(v: number) => update('revenue_prior', v)} placeholder="4,180,000" />
          <NumberInput label="Profit 1 year ago" prefix="£" value={baseline.profit_prior} onChange={(v: number) => update('profit_prior', v)} placeholder="438,000" />
        </div>
        {baseline.revenue && baseline.profit && (
          <div className="mt-5 p-3.5 bg-brand-50 rounded-lg">
            <div className="text-xs text-brand uppercase font-semibold">✨ Instant insight</div>
            <div className="text-sm mt-1">
              Your net profit margin is{' '}
              <strong>{((baseline.profit / baseline.revenue) * 100).toFixed(1)}%</strong>. UK
              dental average is 15%. Top quartile is 20%+.
            </div>
          </div>
        )}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

import { NavButtons } from './NavButtons';

export function ExitStrategy({ targets, update, onBack, onNext }: any) {
  const options = [
    { id: 'sell_dso', title: 'Sell to a DSO / corporate', desc: 'Maximise valuation, clean exit. 8-10× EBITDA.' },
    { id: 'sell_principal', title: 'Sell to a principal-led buyer', desc: 'Another dentist takes over. 3-4× ANP. Faster.' },
    { id: 'hire_ceo', title: 'Hire CEO and retain ownership', desc: 'Take dividend without daily ops. Long-term value.' },
    { id: 'semi_retire', title: 'Semi-retire (2-3 clinical days)', desc: 'Reduce hours, oversee strategy.' },
    { id: 'family', title: 'Pass to family', desc: 'Transition over 5-10 years. Tax planning critical.' },
    { id: 'unsure', title: 'Not sure yet', desc: 'Keep options open. We optimise for flexibility.' },
  ];
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">The Endgame</h2>
        <p className="text-sm text-ink-muted mb-5">
          Knowing the exit shapes every decision today.
        </p>
        {options.map((o) => (
          <label
            key={o.id}
            className={`block p-4 border-2 rounded-xl mb-2.5 cursor-pointer ${
              targets.exit_strategy === o.id ? 'border-brand bg-brand-50' : 'border-border'
            }`}
          >
            <input
              type="radio"
              name="exit"
              checked={targets.exit_strategy === o.id}
              onChange={() => update('exit_strategy', o.id)}
              className="mr-2.5"
            />
            <strong>{o.title}</strong>
            <div className="text-xs text-ink-muted mt-1 ml-6">{o.desc}</div>
          </label>
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div
        className="card-padded text-white mb-4"
        style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}
      >
        <h2 className="display text-3xl font-bold mb-3">Welcome to Business Health</h2>
        <p className="opacity-95 mb-5">
          In the next 10 minutes you&apos;ll capture exactly where your business is today.
          Then Elevate will:
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: '📊', title: 'Auto-populate every dashboard', desc: 'Your numbers flow into P&L, KPIs, valuation, scorecard.' },
            { icon: '📈', title: 'Track every change monthly', desc: "Snapshots show what's improving and what's not." },
            { icon: '🎯', title: 'Set 3-year targets', desc: 'Double profit. Sell at 8× EBITDA. Whatever your goal.' },
            { icon: '🤖', title: 'Plan4Growth AI becomes your coach', desc: 'Specific actions based on your data, every week.' },
          ].map((b) => (
            <div key={b.title} className="bg-white/10 p-4 rounded-lg">
              <div className="text-2xl mb-1">{b.icon}</div>
              <div className="font-semibold">{b.title}</div>
              <div className="text-xs opacity-85 mt-1">{b.desc}</div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onNext} className="btn-primary text-base px-6 py-3">
        Let&apos;s start →
      </button>
    </>
  );
}

'use client';
import Link from 'next/link';
import { KpiTile, ProgressBar } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { useHealth, useHealthProgress } from '@/features/health/hooks';

export default function DashboardScreen() {
  const { data: health } = useHealth();
  const { data: progress } = useHealthProgress();

  const isComplete = health?.setup_completed;
  const baseline = health?.baseline || {};

  return (
    <div className="max-w-7xl mx-auto">
      {!isComplete ? (
        <div
          className="p-6 rounded-xl mb-5 flex items-center gap-5 text-white"
          style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}
        >
          <div className="w-15 h-15 bg-white/15 rounded-full flex items-center justify-center text-3xl">
            🎯
          </div>
          <div className="flex-1">
            <div className="display font-bold text-lg">
              Set up your Business Health baseline
            </div>
            <div className="text-sm opacity-90">
              10-minute setup. Capture where you are today so we can track every
              improvement.
            </div>
          </div>
          <Link
            href="/health-setup"
            className="bg-white text-brand px-6 py-3 rounded-lg font-semibold hover:bg-bg whitespace-nowrap"
          >
            Start setup →
          </Link>
        </div>
      ) : (
        <Link
          href="/progress"
          className="block p-4 rounded-xl mb-5 flex items-center gap-3 bg-brand-50 text-brand hover:bg-brand-100"
        >
          <div className="text-2xl">✓</div>
          <div className="flex-1 text-sm">
            <strong>Business Health baseline captured.</strong> Target: £
            {(
              (baseline.profit || 0) * (health?.targets?.profit_multiple || 2)
            ).toLocaleString()}{' '}
            profit in {health?.targets?.years || 3} years.
          </div>
          <div className="text-xs">View Progress →</div>
        </Link>
      )}

      <h1 className="display text-3xl font-bold mb-1">Command Centre</h1>
      <p className="text-sm text-ink-muted mb-6">Your business at a glance</p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiTile label="Annual revenue" value={`£${formatNumber(baseline.revenue)}`} />
        <KpiTile label="Net profit" value={`£${formatNumber(baseline.profit)}`} />
        <KpiTile label="Active patients" value={formatNumber(baseline.active_patients)} />
        <KpiTile label="New per month" value={formatNumber(baseline.new_per_month)} />
      </div>

      {progress?.completed && (
        <div className="card-padded mb-6">
          <h2 className="display text-lg font-semibold mb-3">Progress vs target</h2>
          {progress.metrics.slice(0, 4).map((m: any) => (
            <div key={m.key} className="py-3 border-b border-border last:border-0">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold">{m.label}</span>
                <span className="text-sm">{m.progressPct}% to target</span>
              </div>
              <ProgressBar pct={m.progressPct} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

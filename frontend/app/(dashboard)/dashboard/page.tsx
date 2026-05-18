'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api('/api/health') });
  const { data: progress } = useQuery({ queryKey: ['progress'], queryFn: () => api('/api/health/progress') });

  const isComplete = health?.setup_completed;
  const baseline = health?.baseline || {};

  return (
    <div className="max-w-7xl mx-auto">
      {/* Setup banner */}
      {!isComplete ? (
        <div className="p-6 rounded-xl mb-5 flex items-center gap-5 text-white" style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}>
          <div className="w-15 h-15 bg-white/15 rounded-full flex items-center justify-center text-3xl">🎯</div>
          <div className="flex-1">
            <div className="display font-bold text-lg">Set up your Business Health baseline</div>
            <div className="text-sm opacity-90">10-minute setup. Capture where you are today so we can track every improvement.</div>
          </div>
          <Link href="/health-setup" className="bg-white text-brand px-6 py-3 rounded-lg font-semibold hover:bg-bg whitespace-nowrap">Start setup →</Link>
        </div>
      ) : (
        <Link href="/progress" className="block p-4 rounded-xl mb-5 flex items-center gap-3 bg-brand-50 text-brand hover:bg-brand-100">
          <div className="text-2xl">✓</div>
          <div className="flex-1 text-sm">
            <strong>Business Health baseline captured.</strong> Target: £{((baseline.profit || 0) * (health?.targets?.profit_multiple || 2)).toLocaleString()} profit in {health?.targets?.years || 3} years.
          </div>
          <div className="text-xs">View Progress →</div>
        </Link>
      )}

      <h1 className="display text-3xl font-bold mb-1">Command Centre</h1>
      <p className="text-sm text-ink-muted mb-6">Your business at a glance</p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Annual revenue', value: baseline.revenue, prefix: '£' },
          { label: 'Net profit', value: baseline.profit, prefix: '£' },
          { label: 'Active patients', value: baseline.active_patients },
          { label: 'New per month', value: baseline.new_per_month },
        ].map((k) => (
          <div key={k.label} className="card-padded">
            <div className="text-xs text-ink-muted uppercase">{k.label}</div>
            <div className="display text-2xl font-bold mt-1">{k.prefix}{(k.value || 0).toLocaleString()}</div>
          </div>
        ))}
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
              <div className="h-2 bg-bg rounded-full overflow-hidden">
                <div className="h-full bg-brand" style={{ width: `${m.progressPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

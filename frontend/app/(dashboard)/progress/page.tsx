'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function ProgressPage() {
  const { data } = useQuery({ queryKey: ['progress'], queryFn: () => api('/api/health/progress') });

  if (!data) return <div>Loading…</div>;

  if (!data.completed) {
    return (
      <div className="card-padded text-center py-16">
        <div className="text-5xl mb-4">🎯</div>
        <h2 className="display text-2xl font-semibold mb-2">Complete Business Health setup first</h2>
        <p className="text-sm text-ink-muted mb-6">We need your starting numbers before we can track progress.</p>
        <Link href="/health-setup" className="btn-primary inline-block">Start setup →</Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="display text-3xl font-bold">Progress Tracker</h1>
      <p className="text-sm text-ink-muted mb-5">Baseline → current → target</p>

      <div className="card-padded text-white mb-5" style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs opacity-80 uppercase">Where you started</div>
            <div className="display text-3xl font-bold mt-1">£{(data.metrics.find((m: any) => m.key === 'profit')?.baseline || 0).toLocaleString()}</div>
            <div className="text-xs opacity-70 mt-1">{new Date(data.setup_completed_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
          </div>
          <div className="border-x border-white/15 px-4 text-center">
            <div className="text-xs opacity-80 uppercase">Where you are now</div>
            <div className="display text-3xl font-bold mt-1">£{(data.metrics.find((m: any) => m.key === 'profit')?.current || 0).toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-xs opacity-80 uppercase">Target by {data.target_year}</div>
            <div className="display text-3xl font-bold mt-1 text-accent">£{(data.target_profit || 0).toLocaleString()}</div>
            <div className="text-xs opacity-70 mt-1">{data.required_cagr_pct.toFixed(1)}% CAGR required</div>
          </div>
        </div>
      </div>

      <div className="card-padded">
        <h2 className="display text-lg font-semibold mb-4">Metric-by-metric tracking</h2>
        {data.metrics.map((m: any) => {
          const colour = m.progressPct >= 70 ? 'bg-success' : m.progressPct >= 35 ? 'bg-warning' : 'bg-danger';
          return (
            <div key={m.key} className="py-3 border-b border-border last:border-0">
              <div className="grid grid-cols-[2fr,1fr,1fr,1fr,80px,200px] gap-3 items-center">
                <strong className="text-sm">{m.label}</strong>
                <div className="text-center">
                  <div className="text-[10px] text-ink-muted uppercase">Baseline</div>
                  <div className="font-semibold">{m.baseline?.toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-ink-muted uppercase">Now</div>
                  <div className="font-bold">{m.current?.toLocaleString()}</div>
                  <div className={`text-xs ${m.deltaFromBaselinePct >= 0 ? 'text-success' : 'text-danger'}`}>
                    {m.deltaFromBaselinePct >= 0 ? '+' : ''}{m.deltaFromBaselinePct}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-ink-muted uppercase">Target</div>
                  <div className="font-semibold text-brand">{m.target?.toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="display text-xl font-bold">{m.progressPct}%</div>
                </div>
                <div className="h-2 bg-bg rounded-full overflow-hidden">
                  <div className={`h-full ${colour}`} style={{ width: `${m.progressPct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

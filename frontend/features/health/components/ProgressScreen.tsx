'use client';
import Link from 'next/link';
import { Card, ProgressBar, progressTone } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { useHealthProgress } from '../hooks';

export default function ProgressScreen() {
  const { data } = useHealthProgress();

  if (!data) return <div>Loading…</div>;

  if (!data.completed) {
    return (
      <Card>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🎯</div>
          <h2 className="display text-2xl font-semibold mb-2">
            Complete Business Health setup first
          </h2>
          <p className="text-sm text-ink-muted mb-6">
            We need your starting numbers before we can track progress.
          </p>
          <Link href="/health-setup" className="btn-primary inline-block">
            Start setup →
          </Link>
        </div>
      </Card>
    );
  }

  const profit = data.metrics.find((m: any) => m.key === 'profit');

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="display text-3xl font-bold">Progress Tracker</h1>
      <p className="text-sm text-ink-muted mb-5">Baseline → current → target</p>

      <div
        className="card-padded text-white mb-5"
        style={{ background: 'linear-gradient(135deg, #0E7C7B, #085857)' }}
      >
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs opacity-80 uppercase">Where you started</div>
            <div className="display text-3xl font-bold mt-1">
              £{formatNumber(profit?.baseline)}
            </div>
            <div className="text-xs opacity-70 mt-1">
              {new Date(data.setup_completed_at).toLocaleDateString('en-GB', {
                month: 'long',
                year: 'numeric',
              })}
            </div>
          </div>
          <div className="border-x border-white/15 px-4 text-center">
            <div className="text-xs opacity-80 uppercase">Where you are now</div>
            <div className="display text-3xl font-bold mt-1">
              £{formatNumber(profit?.current)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs opacity-80 uppercase">Target by {data.target_year}</div>
            <div className="display text-3xl font-bold mt-1 text-accent">
              £{formatNumber(data.target_profit)}
            </div>
            <div className="text-xs opacity-70 mt-1">
              {data.required_cagr_pct.toFixed(1)}% CAGR required
            </div>
          </div>
        </div>
      </div>

      <Card>
        <h2 className="display text-lg font-semibold mb-4">Metric-by-metric tracking</h2>
        {data.metrics.map((m: any) => (
          <div key={m.key} className="py-3 border-b border-border last:border-0">
            <div className="grid grid-cols-[2fr,1fr,1fr,1fr,80px,200px] gap-3 items-center">
              <strong className="text-sm">{m.label}</strong>
              <div className="text-center">
                <div className="text-[10px] text-ink-muted uppercase">Baseline</div>
                <div className="font-semibold">{formatNumber(m.baseline)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-ink-muted uppercase">Now</div>
                <div className="font-bold">{formatNumber(m.current)}</div>
                <div
                  className={`text-xs ${m.deltaFromBaselinePct >= 0 ? 'text-success' : 'text-danger'}`}
                >
                  {m.deltaFromBaselinePct >= 0 ? '+' : ''}
                  {m.deltaFromBaselinePct}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-ink-muted uppercase">Target</div>
                <div className="font-semibold text-brand">{formatNumber(m.target)}</div>
              </div>
              <div className="text-center">
                <div className="display text-xl font-bold">{m.progressPct}%</div>
              </div>
              <ProgressBar pct={m.progressPct} tone={progressTone(m.progressPct)} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

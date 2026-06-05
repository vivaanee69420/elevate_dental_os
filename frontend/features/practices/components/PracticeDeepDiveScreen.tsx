'use client';

// Practice Deep Dive (GM Intelligence OS). Everything about one site, driven by
// the global Scope switcher. Composes REAL endpoints (no new backend):
//   business-hub  -> turnover, demand, conversion, chairs
//   chair         -> capacity, occupancy, cost of empty chairs, recovery
//   treatments    -> treatment mix by appointment volume (no per-treatment price)
//   revenue-series-> 12-month turnover trend (practice-scoped)
// Channel ROI still needs the practice x channel source (next backend slice).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { PageHeader, KpiTile, EmptyState, AlertRow } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { formatPence } from '@/lib/format';
import { api } from '@/lib/api';
import { useBusinessHub, type HubPractice } from '@/features/overview/business-hub-api';
import { useChairAnalytics } from '@/features/operations/chair-analytics-hooks';
import { useTreatmentMix } from '@/features/operations/treatments-api';

interface RevMonth { month: string; revenue: number }

// 12-month turnover trend for one practice (revenue-series accepts practice_id).
function usePracticeRevenueSeries(practiceId: string | null) {
  return useQuery({
    queryKey: ['practice-revseries', practiceId],
    enabled: !!practiceId,
    queryFn: async () => {
      const r = await api<{ months?: RevMonth[]; error?: string }>(
        `/api/analytics/revenue-series?months=12&practice_id=${practiceId}`,
      );
      return r?.error ? [] : r.months ?? [];
    },
  });
}

interface ChannelProvider { provider: string; spend_pence: number; leads: number; conversions: number; cpl_pence: number; cpa_pence: number }
interface MarketingRoi {
  connected: boolean;
  spend_pence: number; revenue_pence: number; roas: number; cac_pence: number;
  leads_from_ads: number; total_leads: number; new_patients: number;
  by_provider: ChannelProvider[];
}

// Per-practice channel ROI (marketing/roi accepts practice_id).
function usePracticeMarketingRoi(practiceId: string | null) {
  return useQuery({
    queryKey: ['practice-marketing-roi', practiceId],
    enabled: !!practiceId,
    queryFn: () => api<MarketingRoi>(`/api/growth/marketing/roi?practice_id=${practiceId}`),
  });
}

const PROVIDER_LABEL: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Facebook / Meta' };
const providerLabel = (p: string) => PROVIDER_LABEL[p] || p;

const monthLabel = (k: string) => {
  const [y, m] = k.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
};

// Compact pounds tick from pence, e.g. 6_887_164 -> "£69k".
const poundsK = (pence: number) => {
  const p = (pence || 0) / 100;
  return Math.abs(p) >= 1000 ? `£${(p / 1000).toFixed(p >= 100_000 ? 0 : 1)}k` : `£${Math.round(p)}`;
};
// Treatment-mix bar palette (green/gold system).
const MIX_COLORS = ['#1D6E5F', '#2E9E6A', '#C6A253', '#2B7A8C', '#0F5132', '#BF8A22', '#5F7268', '#9FCBBC'];

export function PracticeDeepDiveScreen() {
  const { scope } = useScopePeriod();
  const isSinglePractice = scope !== 'all' && scope !== 'practices' && scope !== 'academy' && scope !== 'lab';
  const pid = isSinglePractice ? scope : null;

  const hub = useBusinessHub();
  const chair = useChairAnalytics(10);
  const mix = useTreatmentMix(pid || undefined);
  const series = usePracticeRevenueSeries(pid);

  const hubRow: HubPractice | undefined = useMemo(
    () => hub.data?.practices.find((p) => p.practiceId === scope),
    [hub.data, scope],
  );
  const chairRow = useMemo(
    () => (chair.data?.applicable ? chair.data.practices?.find((p) => p.id === scope) : undefined),
    [chair.data, scope],
  );

  const roi = usePracticeMarketingRoi(pid);
  const mixData = (mix.data?.treatments ?? []).slice(0, 8);
  const trendData = (series.data ?? []).map((m) => ({ label: monthLabel(m.month), pence: m.revenue }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Practice Deep Dive"
        subtitle="Everything about one site — pick a practice in the scope selector to drill into its turnover, demand, conversion and chair economics."
      />
      <ScopePeriodBar />

      {(scope === 'academy' || scope === 'lab') && (
        <AlertRow tone="info" title="Deep Dive covers clinical practices"
          body="Academy and Lab are summarised on Overview, P&L and Valuation. Pick a practice here." />
      )}
      {!isSinglePractice && scope !== 'academy' && scope !== 'lab' && (
        <AlertRow tone="info" title="Select a practice"
          body="Use the Scope selector above to choose a single practice — the deep dive is per-site." />
      )}
      {isSinglePractice && (hub.isLoading || chair.isLoading) && <EmptyState message="Loading practice…" />}
      {isSinglePractice && !hub.isLoading && !hubRow && <AlertRow tone="warn" title="No data for this practice in the window" />}

      {isSinglePractice && hubRow && (
        <>
          <div className="card-padded" style={{ background: 'linear-gradient(135deg,#fff,var(--brand-50))' }}>
            <div className="text-[11px] uppercase tracking-wider text-brand font-semibold">Practice</div>
            <div className="display text-2xl mt-1">{hubRow.name}</div>
            <div className="flex flex-wrap gap-x-10 gap-y-3 mt-4">
              <Stat label="Turnover" value={formatPence(hubRow.revenuePence)} />
              <Stat label="Chairs" value={String(hubRow.chairs)} />
              <Stat label="Appointments" value={hubRow.appointments.toLocaleString('en-GB')} />
              <Stat label="Completed" value={hubRow.completed.toLocaleString('en-GB')} />
              <Stat label="No-show" value={`${hubRow.noShowRate}%`} />
              <Stat label="Leads" value={hubRow.leads.toLocaleString('en-GB')} />
              <Stat label="Conversion" value={`${hubRow.conversionRate}%`} />
              {chairRow && <Stat label="Chair occupancy" value={`${chairRow.occupancyPct}%`} />}
            </div>
          </div>

          {/* Chair economics — full */}
          {chairRow && (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="display text-lg">Chair economics</h3>
                <span className={`text-[11px] font-semibold ${chairRow.occupancySource === 'manual' ? 'text-ink-soft' : 'text-warning'}`}>
                  {chairRow.occupancySource === 'manual'
                    ? `occupancy ${chairRow.occupancyPct}% · chair-utilisation grid`
                    : `occupancy assumed (${chairRow.occupancyPct}%) — fill the chair-utilisation grid`}
                </span>
              </div>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <KpiTile label="Cost of empty chairs" value={formatPence(chairRow.lostPotentialYrPence)} delta={`${chairRow.emptyHrsYr.toLocaleString('en-GB')} empty hrs/yr`} deltaTone="down" />
                <KpiTile label="Recoverable to benchmark" value={formatPence(chairRow.recoverRevYrPence)} delta={`${chairRow.recoverableToBenchHrsYr.toLocaleString('en-GB')} hrs at own yield`} deltaTone="up" />
                <KpiTile label="Revenue / booked chair-hr" value={formatPence(chairRow.revPerBookedHrPence)} delta={chairRow.occupancySource === 'manual' ? 'occupancy from grid' : 'occupancy assumed'} />
                <KpiTile label="Occupancy vs benchmark" value={`${chairRow.occVariancePct > 0 ? '+' : ''}${chairRow.occVariancePct}pts`} delta="vs 88% target" deltaTone={chairRow.occVariancePct >= 0 ? 'up' : 'down'} />
                <KpiTile label="Capacity" value={`${chairRow.capHrsYr.toLocaleString('en-GB')}h`} delta="chair-hours / yr" />
                <KpiTile label="Booked" value={`${chairRow.bookedHrsYr.toLocaleString('en-GB')}h`} delta="billing chair-hours / yr" />
                <KpiTile label="Surgery-days" value={chairRow.surgeryDaysYr.toLocaleString('en-GB')} delta="chairs x working days" />
                <KpiTile label="Ceiling potential" value={formatPence(chairRow.revPotentialYrPence)} delta="at £300/chair-hr" />
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 items-start">
            {/* Treatment mix (volume) — horizontal bar chart */}
            <div className="card-padded">
              <div className="flex items-baseline justify-between">
                <h3 className="display text-lg">Treatment mix</h3>
                <span className="text-[11px] text-ink-soft">by appointment volume</span>
              </div>
              {mix.isLoading && <p className="text-sm text-ink-muted mt-3">Loading…</p>}
              {mix.data && mixData.length === 0 && <p className="text-sm text-ink-muted mt-3">No treatment data in the window.</p>}
              {mixData.length > 0 && (
                <ResponsiveContainer width="100%" height={Math.max(180, mixData.length * 34)}>
                  <BarChart data={mixData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="type" width={110} tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: number, _n, p: any) => [`${v.toLocaleString('en-GB')} appts · ${p?.payload?.share_pct}%`, 'Volume']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="volume" radius={[0, 6, 6, 0]}>
                      {mixData.map((_, i) => <Cell key={i} fill={MIX_COLORS[i % MIX_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              {mix.data?.top_treatment && <p className="text-[11px] text-ink-soft mt-2">Top: {mix.data.top_treatment} · {mix.data.distinct_types} types · Dentally carries no per-treatment price, so this is volume not revenue.</p>}
            </div>

            {/* 12-month turnover trend — area chart */}
            <div className="card-padded">
              <h3 className="display text-lg">Turnover — last 12 months</h3>
              {series.isLoading && <p className="text-sm text-ink-muted mt-3">Loading…</p>}
              {trendData.length > 0 && trendData.every((m) => !m.pence) && <p className="text-sm text-ink-muted mt-3">No settled revenue in the window.</p>}
              {trendData.length > 0 && (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
                    <defs>
                      <linearGradient id="ddRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => poundsK(v)} />
                    <Tooltip formatter={(v: number) => [formatPence(v), 'Turnover']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Area type="monotone" dataKey="pence" stroke="var(--brand)" strokeWidth={2} fill="url(#ddRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Channel ROI — real, per-practice */}
          <div className="card-padded">
            <div className="flex items-baseline justify-between">
              <h3 className="display text-lg">Channel ROI</h3>
              <span className="text-[11px] text-ink-soft">paid acquisition · this practice</span>
            </div>
            {roi.isLoading && <p className="text-sm text-ink-muted mt-3">Loading…</p>}
            {roi.data && !roi.data.connected && (
              <p className="text-sm text-ink-muted mt-3">
                No ad-spend data connected for this practice. Connect Google Ads / Meta in Integrations to see channel return here.
              </p>
            )}
            {roi.data && roi.data.connected && (
              <>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mt-3">
                  <KpiTile label="Ad spend" value={formatPence(roi.data.spend_pence)} delta={`${roi.data.leads_from_ads} leads from ads`} />
                  <KpiTile label="Attributed revenue" value={formatPence(roi.data.revenue_pence)} delta="settled in window" deltaTone="up" />
                  <KpiTile label="ROAS" value={`${roi.data.roas.toFixed(2)}x`} delta="revenue / spend" deltaTone={roi.data.roas >= 3.5 ? 'up' : roi.data.roas < 2.5 ? 'down' : 'muted'} />
                  <KpiTile label="Cost / new patient" value={formatPence(roi.data.cac_pence)} delta={`${roi.data.new_patients} new patients`} />
                </div>
                {roi.data.by_provider.length > 0 && (
                  <ResponsiveContainer width="100%" height={Math.max(140, roi.data.by_provider.length * 56)}>
                    <BarChart data={roi.data.by_provider.map((p) => ({ ...p, name: providerLabel(p.provider) }))} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => poundsK(v)} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number, _n, p: any) => [`${formatPence(v)} · ${p?.payload?.leads} leads · CPA ${formatPence(p?.payload?.cpa_pence)}`, 'Spend']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="spend_pence" radius={[0, 6, 6, 0]}>
                        {roi.data.by_provider.map((p, i) => <Cell key={i} fill={p.provider === 'meta_ads' ? '#4267B2' : '#3B7DDD'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <p className="text-[11px] text-ink-soft mt-2">ROAS/CAC are practice-level (revenue &amp; new patients aren&apos;t split per channel); spend, leads and CPA are per channel.</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="display text-xl mt-0.5">{value}</div>
    </div>
  );
}

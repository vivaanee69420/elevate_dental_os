'use client';
// CockpitCharts — the two interactive recharts additions to the Daily
// Command Cockpit (Task 4 of "Daily Command Cockpit v2"). Light theme only
// (rule 1). Both charts sit on top of the existing drill-down tables, which
// remain the "table view" accessibility relief per the dataviz skill.
//
//   • LeadPerformanceChart — grouped bar, Leads vs Conversions per channel.
//     Two series by METRIC (not by channel entity), so the validated
//     palette is applied per-metric: Leads #2563eb, Conversions #10b981.
//     Single (count) y-axis, legend, direct value labels, tooltip.
//   • RevenueTrendChart — single-series area of daily cash taken. No legend
//     (the card title names the series); tooltip formats money via
//     formatPence; y-axis ticks show £k for compactness.
import {
  Bar,
  BarChart,
  Legend,
  CartesianGrid,
  Area,
  AreaChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPence, formatNumber } from '@/lib/format';
import type { CockpitDailyRevenue, LeadRoiChannelRow, LeadChannel } from '../api';

// Validated palette (light) — channel identity colours, fixed order, never
// cycled. Used for axis labels here; the lead-performance chart itself uses
// the metric-pair colours called out in the brief (Leads/Conversions).
const CHANNEL_LABEL: Record<LeadChannel, string> = {
  google: 'Google',
  facebook: 'Facebook',
  website: 'Website',
  instagram: 'Instagram',
  other: 'Other',
};
const CHANNEL_ORDER: LeadChannel[] = ['google', 'facebook', 'website', 'instagram', 'other'];

const LEADS_COLOUR = '#2563eb';
const CONVERSIONS_COLOUR = '#10b981';
const GRID_COLOUR = '#e2e8f0';
const AXIS_TEXT = { fill: '#94a3b8', fontSize: 12 };

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {sub ? <p className="mt-0.5 text-xs text-slate-400">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

function LeadTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] shadow-sm">
      <div className="mb-1 font-medium text-slate-900">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium tabular-nums text-slate-900">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function LeadPerformanceChart({ channels }: { channels: LeadRoiChannelRow[] }) {
  const totals = new Map<LeadChannel, { leads: number; conversions: number }>();
  for (const c of channels) {
    const cur = totals.get(c.channel) ?? { leads: 0, conversions: 0 };
    cur.leads += c.leads;
    cur.conversions += c.conversions;
    totals.set(c.channel, cur);
  }
  const data = CHANNEL_ORDER.filter((ch) => totals.has(ch)).map((ch) => ({
    channel: CHANNEL_LABEL[ch],
    Leads: totals.get(ch)!.leads,
    Conversions: totals.get(ch)!.conversions,
  }));

  if (data.length === 0) {
    return (
      <ChartCard title="Lead performance by channel" sub="Leads vs conversions, all channels this window.">
        <p className="text-sm text-slate-400">No lead data in this window.</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Lead performance by channel" sub="Leads vs conversions, all channels this window.">
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOUR} vertical={false} />
            <XAxis dataKey="channel" tick={AXIS_TEXT} axisLine={{ stroke: GRID_COLOUR }} tickLine={false} />
            <YAxis allowDecimals={false} tick={AXIS_TEXT} axisLine={{ stroke: GRID_COLOUR }} tickLine={false} width={36} />
            <Tooltip content={<LeadTooltip />} cursor={{ fill: '#f8fafc' }} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#64748b' }}
              iconType="circle"
              iconSize={8}
            />
            <Bar dataKey="Leads" name="Leads" fill={LEADS_COLOUR} radius={[4, 4, 0, 0]} maxBarSize={40}>
              <LabelList dataKey="Leads" position="top" style={{ fill: '#334155', fontSize: 11 }} formatter={(v: number) => formatNumber(v)} />
            </Bar>
            <Bar dataKey="Conversions" name="Conversions" fill={CONVERSIONS_COLOUR} radius={[4, 4, 0, 0]} maxBarSize={40}>
              <LabelList dataKey="Conversions" position="top" style={{ fill: '#334155', fontSize: 11 }} formatter={(v: number) => formatNumber(v)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function fmtDayShort(date: string): string {
  const t = Date.parse(date);
  return Number.isNaN(t) ? date : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function RevenueTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { date: string; cashPence: number } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] shadow-sm">
      <div className="mb-1 font-medium text-slate-900">{fmtDayShort(row.date)}</div>
      <div className="text-slate-600">
        Cash taken: <span className="font-medium tabular-nums text-slate-900">{formatPence(row.cashPence)}</span>
      </div>
    </div>
  );
}

export function RevenueTrendChart({ dailySeries }: { dailySeries: CockpitDailyRevenue[] }) {
  const data = [...dailySeries]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({ date: d.date, cashPence: d.cashPence }));

  if (data.length === 0) {
    return (
      <ChartCard title="Cash taken trend" sub="Daily cash taken (Emergent) over this window.">
        <p className="text-sm text-slate-400">No daily cash-up rows in this window.</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Cash taken trend" sub="Daily cash taken (Emergent) over this window.">
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cockpitRevenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LEADS_COLOUR} stopOpacity={0.18} />
                <stop offset="100%" stopColor={LEADS_COLOUR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOUR} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDayShort} tick={AXIS_TEXT} axisLine={{ stroke: GRID_COLOUR }} tickLine={false} minTickGap={24} />
            <YAxis
              tick={AXIS_TEXT}
              axisLine={{ stroke: GRID_COLOUR }}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => `£${(v / 100 / 1000).toFixed(0)}k`}
            />
            <Tooltip content={<RevenueTooltip />} cursor={{ stroke: GRID_COLOUR }} />
            <Area
              type="monotone"
              dataKey="cashPence"
              name="Cash taken"
              stroke={LEADS_COLOUR}
              strokeWidth={2}
              fill="url(#cockpitRevenueFill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

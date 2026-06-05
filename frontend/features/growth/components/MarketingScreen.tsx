'use client';
// Marketing — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.marketing). Source performance + ROI for the last 30 days: a
// 3-up KPI strip, a source-breakdown table with volume bars, and a
// treatment-mix table. Fed by the growth mock-data layer; swap to a real
// marketing-analytics endpoint when one exists server-side.
//
// Data flow:
//   SOURCE_SUMMARY ──┬─► KPI strip (total leads / pipeline / avg conv)
//                     ├─► sorted-by-leads table + volume bar (leads/maxLeads)
//   TREATMENT_SUMMARY ──► sorted-by-value table + volume bar (value/maxValue)

import { useMemo } from 'react';
import { Card, KpiTile, Chip, EmptyState, type ChipColour } from '@/components/ui';
import { formatPoundsCompact } from '@/features/_mock';
import { SOURCE_SUMMARY, TREATMENT_SUMMARY } from '../data';
import { useAdSpend } from '../hooks';

/** Conversion-rate -> chip colour, matching the prototype thresholds. */
function convChip(rate: number): ChipColour {
  return rate >= 12 ? 'emerald' : rate >= 8 ? 'amber' : 'rose';
}

/** Pence -> "£x,xxx.xx" for per-unit costs (CPC/CPL/CPA) where pennies matter. */
function gbp(pence: number): string {
  return '£' + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PROVIDER_LABEL: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Meta Ads' };

/** Live ad spend & performance from connected providers (Google Ads / Meta). */
function LiveAdSpend() {
  const { data, isLoading, isError } = useAdSpend();

  if (isLoading) {
    return (
      <Card className="mb-4">
        <h2 className="display font-semibold mb-1" style={{ fontSize: 18 }}>Ad spend (live)</h2>
        <p className="text-sm text-ink-muted">Loading…</p>
      </Card>
    );
  }
  if (isError || !data || !data.connected) {
    return (
      <Card className="mb-4">
        <h2 className="display font-semibold mb-4" style={{ fontSize: 18 }}>Ad spend (live)</h2>
        <EmptyState
          message={
            isError
              ? 'Could not load ad spend.'
              : 'No ad data yet. Connect Google Ads in Settings → Integrations, then run a sync.'
          }
        />
      </Card>
    );
  }

  const t = data.totals;
  return (
    <>
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Ad spend (30d)" value={formatPoundsCompact(t.spend_pence / 100)} />
        <KpiTile label="Clicks" value={t.clicks.toLocaleString('en-GB')} />
        <KpiTile label="Conversions" value={t.conversions.toLocaleString('en-GB')} />
        <KpiTile label="Cost / conversion" value={t.cpa_pence ? gbp(t.cpa_pence) : '—'} />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold mb-5" style={{ fontSize: 18 }}>
          Campaigns (live)
        </h2>
        {data.campaigns.length === 0 ? (
          <EmptyState message="No campaigns with spend in this window." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left pb-2 font-semibold">Campaign</th>
                <th className="text-left pb-2 font-semibold">Channel</th>
                <th className="text-right pb-2 font-semibold">Spend</th>
                <th className="text-right pb-2 font-semibold">Impr.</th>
                <th className="text-right pb-2 font-semibold">Clicks</th>
                <th className="text-right pb-2 font-semibold">CTR</th>
                <th className="text-right pb-2 font-semibold">CPC</th>
                <th className="text-right pb-2 font-semibold">Conv.</th>
                <th className="text-right pb-2 font-semibold">Cost / conv.</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={`${c.provider}-${c.campaign_id}`} className="border-b border-border">
                  <td className="py-2.5 font-semibold">{c.campaign_name ?? c.campaign_id ?? '(unnamed)'}</td>
                  <td className="py-2.5">{PROVIDER_LABEL[c.provider] ?? c.provider}</td>
                  <td className="py-2.5 text-right font-semibold">{formatPoundsCompact(c.spend_pence / 100)}</td>
                  <td className="py-2.5 text-right">{c.impressions.toLocaleString('en-GB')}</td>
                  <td className="py-2.5 text-right">{c.clicks.toLocaleString('en-GB')}</td>
                  <td className="py-2.5 text-right">{c.ctr}%</td>
                  <td className="py-2.5 text-right">{c.cpc_pence ? gbp(c.cpc_pence) : '—'}</td>
                  <td className="py-2.5 text-right">{c.conversions.toLocaleString('en-GB')}</td>
                  <td className="py-2.5 text-right">{c.cpa_pence ? gbp(c.cpa_pence) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/** A thin horizontal volume bar (fill width = pct of the table max). */
function VolumeBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="h-2 bg-bg rounded overflow-hidden">
      <div className="h-full rounded" style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}

/** Marketing screen: source performance and treatment mix. */
export default function MarketingScreen() {
  const view = useMemo(() => {
    const sources = [...SOURCE_SUMMARY].sort((a, b) => b.leads - a.leads);
    const maxLeads = Math.max(...sources.map((s) => s.leads));
    const totalLeads = sources.reduce((s, x) => s + x.leads, 0);
    const totalPipeline = sources.reduce((s, x) => s + x.pipeline_value, 0);
    const avgConv = sources.reduce((s, x) => s + x.conversion_rate, 0) / sources.length;

    const treatments = [...TREATMENT_SUMMARY].sort(
      (a, b) => b.pipeline_value - a.pipeline_value
    );
    const maxTV = Math.max(...treatments.map((t) => t.pipeline_value));

    return { sources, maxLeads, totalLeads, totalPipeline, avgConv, treatments, maxTV };
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Marketing</h1>
        <p className="text-sm text-ink-muted mt-1">
          Source performance and ROI · last 30 days
        </p>
      </div>

      <LiveAdSpend />

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile label="Total leads (30d)" value={String(view.totalLeads)} />
        <KpiTile
          label="Total pipeline value"
          value={formatPoundsCompact(view.totalPipeline)}
        />
        <KpiTile label="Avg conversion" value={`${view.avgConv.toFixed(1)}%`} />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold mb-5" style={{ fontSize: 18 }}>
          Source breakdown
        </h2>
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left pb-2 font-semibold">Source</th>
              <th className="text-right pb-2 font-semibold">Leads</th>
              <th className="text-right pb-2 font-semibold">Converted</th>
              <th className="text-right pb-2 font-semibold">Conv %</th>
              <th className="text-right pb-2 font-semibold">Pipeline value</th>
              <th className="text-left pb-2 font-semibold" style={{ width: 200 }}>
                Volume
              </th>
            </tr>
          </thead>
          <tbody>
            {view.sources.map((s) => (
              <tr key={s.name} className="border-b border-border">
                <td className="py-2.5 font-semibold">{s.name}</td>
                <td className="py-2.5 text-right">{s.leads}</td>
                <td className="py-2.5 text-right">{s.converted}</td>
                <td className="py-2.5 text-right">
                  <Chip colour={convChip(s.conversion_rate)}>{s.conversion_rate}%</Chip>
                </td>
                <td className="py-2.5 text-right font-semibold">
                  {formatPoundsCompact(s.pipeline_value)}
                </td>
                <td className="py-2.5">
                  <VolumeBar
                    pct={(s.leads / view.maxLeads) * 100}
                    colour="var(--brand)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="display font-semibold mb-4" style={{ fontSize: 18 }}>
          Treatment mix (30d pipeline)
        </h2>
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left pb-2 font-semibold">Treatment</th>
              <th className="text-right pb-2 font-semibold">Leads</th>
              <th className="text-right pb-2 font-semibold">Pipeline value</th>
              <th className="text-left pb-2 font-semibold" style={{ width: 240 }}>
                Volume
              </th>
            </tr>
          </thead>
          <tbody>
            {view.treatments.map((t) => (
              <tr key={t.name} className="border-b border-border">
                <td className="py-2.5 font-semibold">{t.name}</td>
                <td className="py-2.5 text-right">{t.leads}</td>
                <td className="py-2.5 text-right font-semibold">
                  {formatPoundsCompact(t.pipeline_value)}
                </td>
                <td className="py-2.5">
                  <VolumeBar
                    pct={(t.pipeline_value / view.maxTV) * 100}
                    colour="var(--accent)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

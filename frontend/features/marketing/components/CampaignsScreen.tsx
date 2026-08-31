'use client';
// Campaigns — one row per campaign, highest spend first, with the cost of a
// lead and of a real patient beside it.
//
// Platform conversions and patients are DIFFERENT NUMBERS and are shown in
// separate columns on purpose: Google and Facebook count a form submission,
// "Patients" counts someone matched to a Dentally record.
import { useState } from 'react';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingPerformance } from '../hooks';
import { TierBadge } from './TierBadge';
import type { CampaignRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const CHANNEL: Record<string, string> = { google_ads: 'Google', meta_ads: 'Facebook' };

export default function CampaignsScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const [provider, setProvider] = useState<string | null>(null);
  const rows: CampaignRow[] = (data?.rows ?? []).filter((r) => !provider || r.provider === provider);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campaigns"
        subtitle="Every campaign with spend in this window, ordered by spend."
      />
      <ScopePeriodBar />

      <div className="flex gap-2">
        {[null, 'google_ads', 'meta_ads'].map((p) => (
          <button
            key={p ?? 'all'}
            type="button"
            onClick={() => setProvider(p)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] ${
              provider === p ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-ink-muted hover:bg-bg'
            }`}
          >
            {p === null ? 'All channels' : CHANNEL[p]}
          </button>
        ))}
      </div>

      {isError ? (
        <EmptyState message={`Couldn't load campaigns: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading ? (
        <SkeletonTable rows={8} cols={8} />
      ) : rows.length === 0 ? (
        <EmptyState message="No campaign spend in this window. Connect Google Ads or Meta Ads in Integrations to see campaigns here." />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-border bg-surface">
          <table className="w-full text-[13.5px]">
            <thead className="bg-bg">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Campaign</th>
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Spend</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Clicks</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Leads</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per lead</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Patients</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per patient</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.provider}-${r.campaignId}`} className="border-t border-border hover:bg-bg">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{r.campaignName ?? r.campaignId}</div>
                    <div className="mt-1"><TierBadge tier={r.tier} /></div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{CHANNEL[r.provider] ?? r.provider}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.spendPence)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.clicks.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.leads.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerLeadPence)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.patients.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerPatientPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

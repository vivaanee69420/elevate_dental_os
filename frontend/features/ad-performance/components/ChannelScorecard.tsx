'use client';
// Google vs Facebook vs Unassigned, side by side, plus the deduped group total.
//
// A null metric renders as "Not reporting", never as £0 or 0%. Zero would read
// as a real measurement — free leads, or a channel that converts nothing —
// when the truth is that no spend feed maps to it. formatPence() on its own
// coerces null to £0.00, so every money value here MUST go through the local
// `money()` guard rather than formatPence directly.
import { formatPence } from '@/lib/format';
import { Card } from '@/components/ui';
import type { AdTotals, ChannelStats, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  unassigned: 'Unassigned',
};

// Load-bearing null guard — formatPence() must never be called directly on a
// nullable pence value anywhere in this file.
const money = (p: number | null) => (p === null ? 'Not reporting' : formatPence(p));
const pct = (r: number | null) => (r === null ? 'Not reporting' : `${(r * 100).toFixed(1)}%`);

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="py-1">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[15px] font-semibold text-slate-900">{value}</div>
      {hint ? <div className="text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function ChannelScorecard({
  channels,
  totals,
  onDrill,
}: {
  channels: ChannelStats[];
  totals: AdTotals;
  onDrill: (channel: PerfChannel) => void;
}) {
  return (
    <div className="space-y-3">
      <Card className="border-2 border-slate-300">
        <h2 className="mb-1 text-[15px] font-semibold text-slate-900">Total (deduped)</h2>
        <p className="mb-2 text-[11px] text-slate-500">
          One person counts once here even if they appear in more than one channel below — the
          three channel columns are not additive, this is the true group figure.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Metric label="Leads" value={totals.leads.toLocaleString('en-GB')} />
          <Metric
            label="Paid leads"
            value={totals.paidLeads.toLocaleString('en-GB')}
            hint="Google + Facebook only, deduped — the denominator for the cost metrics below"
          />
          <Metric label="Spend" value={money(totals.spendPence)} />
          <Metric label="Cost per lead" value={money(totals.costPerLeadPence)} hint="Spend ÷ paid leads" />
          <Metric label="Conversions" value={totals.conversions.toLocaleString('en-GB')} />
          <Metric label="Paid conversions" value={totals.paidConversions.toLocaleString('en-GB')} />
          <Metric label="Conversion rate" value={pct(totals.conversionRate)} />
          <Metric label="Cost per acquisition" value={money(totals.costPerAcquisitionPence)} hint="Spend ÷ paid conversions" />
          <Metric label="Accepted value" value={formatPence(totals.acceptedValuePence)} />
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {channels.map((c) => (
          <Card key={c.channel}>
            <h2 className="mb-2 text-[15px] font-semibold text-slate-900">{LABEL[c.channel]}</h2>
            <button
              type="button"
              onClick={() => onDrill(c.channel)}
              className="mb-2 text-left text-[24px] font-semibold text-slate-900 hover:underline"
            >
              {c.leads.toLocaleString('en-GB')}
              <span className="ml-1 text-[13px] font-normal text-slate-500">leads</span>
            </button>
            <Metric label="Spend" value={money(c.spendPence)} />
            <Metric label="Cost per lead" value={money(c.costPerLeadPence)} />
            <Metric
              label="Conversions"
              value={c.conversions.toLocaleString('en-GB')}
              hint="Matched to an accepted treatment in Emergent"
            />
            <Metric label="Conversion rate" value={pct(c.conversionRate)} />
            <Metric label="Cost per acquisition" value={money(c.costPerAcquisitionPence)} />
            <Metric label="Accepted value" value={formatPence(c.acceptedValuePence)} />
            {c.channel === 'unassigned' ? (
              <p className="mt-2 text-[11px] text-slate-400">
                These pipelines have no channel set, so no spend can be attributed to them.
              </p>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

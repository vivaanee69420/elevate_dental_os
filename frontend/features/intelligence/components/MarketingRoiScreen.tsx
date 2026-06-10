'use client';

// Marketing & ROI (GM Intelligence OS). Channel acquisition economics, Google-vs-
// Meta head-to-head, channel-efficiency table and acquisition-by-practice.
//
// WIRED: reads GET /api/analytics/marketing-roi (scope/period reactive). Real
// ad_metrics spend + CRM lead attribution. HONEST: revenue is NOT attributable
// per channel — the screen leads on spend → leads → CPL → patients → CPA, and
// shows only a business-level blended paid ROAS. Money is integer PENCE.

import { useState } from 'react';
import { PageHeader, KpiTile, BarRow, AlertRow, EmptyState, SkeletonKpiRow, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { AdAccountFilter } from '../AdAccountFilter';
import { Panel, PanelHead, NoteFoot, Pill, th, td } from './os-ui';
import { useMarketingRoi } from '../marketing-roi-hooks';
import type { MarketingRoi, MktChannel } from '../marketing-roi-api';

const gbp = (p: number) => formatPence(p);

export default function MarketingRoiScreen() {
  // Inline view-level ad-account filter, independent per provider. null = all
  // (honours the Integrations selection); a customer_id narrows that provider's
  // figures to that account. Setting both compares one Facebook + one Google
  // account side by side; setting one shows it alone.
  const [metaId, setMetaId] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);
  const accountIds = [metaId, googleId].filter(Boolean) as string[];
  const { data, isLoading, isError, error } = useMarketingRoi(accountIds.length ? accountIds : undefined);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Marketing & ROI"
        subtitle="Facebook vs Google vs organic — spend, leads, cost per patient and conversion, per channel and per practice. Real ad spend + CRM lead attribution."
      />
      <ScopePeriodBar />
      <AdAccountFilter metaId={metaId} googleId={googleId} onSelectMeta={setMetaId} onSelectGoogle={setGoogleId} />

      {isError ? (
        <Panel><EmptyState message={`Couldn't load marketing data: ${(error as Error)?.message ?? 'unknown error'}`} /></Panel>
      ) : isLoading ? (
        <>
          <SkeletonKpiRow count={4} />
          <SkeletonTable rows={6} cols={4} />
        </>
      ) : !data?.hasLeads && !data?.connected ? (
        <Panel>
          <PanelHead title="Marketing & ROI" sub="Real ad spend + CRM leads." />
          <EmptyState message="No ad spend or leads for this scope/period. Connect Google/Meta Ads (Integrations) and capture leads in the CRM to populate channels." />
        </Panel>
      ) : (
        <MarketingBody data={data!} />
      )}
    </div>
  );
}

function MarketingBody({ data }: { data: MarketingRoi }) {
  const { channels, google: g, meta: f } = data;
  const gfTot = (g?.spendPence ?? 0) + (f?.spendPence ?? 0) || 1;
  // Paid channels source their funnel from the ad platforms (Meta/Google
  // conversions), NOT the CRM — CRM lead attribution to a paid channel is
  // unreliable. Organic channels stay CRM (the platforms have no view of them).
  const effLeads = (c: MktChannel) => (c.paid ? c.adConversions : c.leads);
  const totalEffLeads = channels.reduce((s, c) => s + effLeads(c), 0);
  const paidAdConv = channels.filter((c) => c.paid).reduce((s, c) => s + c.adConversions, 0);
  const maxLeads = Math.max(...channels.map(effLeads), 1);
  const maxPLeads = Math.max(...data.byPractice.map((p) => p.leads), 1);

  return (
    <>
      {/* KPI strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Paid spend" value={data.connected ? gbp(data.paidSpendPence) : 'Not connected'} delta={data.connected ? 'Google + Meta' : 'Connect ad accounts'} />
        <KpiTile label="Total leads" value={totalEffLeads.toLocaleString('en-GB')} delta={`${paidAdConv.toLocaleString('en-GB')} from paid ads (Meta + Google)`} />
        <KpiTile
          label="Blended paid ROAS"
          value={data.blendedRoas != null ? `${data.blendedRoas.toFixed(2)}×` : '—'}
          delta="Business-level (not per channel)"
          deltaTone={data.blendedRoas != null ? (data.blendedRoas >= 3.5 ? 'up' : data.blendedRoas < 2.5 ? 'down' : 'muted') : 'muted'}
        />
        <KpiTile label="Settled revenue" value={gbp(data.settledRevenuePence)} delta="All channels, in window" />
      </div>

      {/* Decision Lens */}
      {data.insights.length > 0 && (
        <Panel>
          <PanelHead title="Decision Lens" sub="Where the acquisition budget is working — and where it isn't." />
          {data.insights.map((a, i) => (
            <AlertRow key={i} tone={a.tone} title={a.title} body={a.body} tag={a.value ? <Pill tone={a.tone}>{a.value}</Pill> : undefined} />
          ))}
        </Panel>
      )}

      {/* channel cards */}
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {channels.map((c) => (
          <Panel key={c.key}>
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                {c.label}
                {!c.paid && <span className="ml-1"><Pill tone="info">organic</Pill></span>}
              </div>
              <div className="display text-lg font-bold">{c.paid ? `${c.ctrPct.toFixed(1)}%` : `${c.leadSharePct.toFixed(0)}%`}</div>
            </div>
            {c.paid ? (
              // Paid: real platform performance (ad_metrics). Conversions = Meta
              // lead/pixel actions + Google conversions. CTR shown top-right.
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 mt-3 text-[11px] text-ink-muted">
                <Stat label="Spend" value={gbp(c.spendPence)} />
                <Stat label="Conversions" value={c.adConversions.toLocaleString('en-GB')} />
                <Stat label="Clicks" value={c.clicks.toLocaleString('en-GB')} />
                <Stat label="Cost / conv" value={c.costPerAdConvPence ? gbp(c.costPerAdConvPence) : '—'} />
                <Stat label="Conv rate" value={`${c.adConvRatePct.toFixed(1)}%`} />
                {/* Meta reports unique reach; Google has no reach metric at campaign
                    grain, so fall back to impressions (a real Google field). */}
                {c.reach
                  ? <Stat label={c.reachIsApprox ? 'Reach (approx)' : 'Reach'} value={`${c.reachIsApprox ? '~' : ''}${c.reach.toLocaleString('en-GB')}`} />
                  : <Stat label="Impressions" value={c.impressions.toLocaleString('en-GB')} />}
              </div>
            ) : (
              // Organic: CRM funnel (no platform spend/metrics).
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 mt-3 text-[11px] text-ink-muted">
                <Stat label="Spend" value="—" />
                <Stat label="Leads" value={String(c.leads)} />
                <Stat label="Patients" value={String(c.conversions)} />
                <Stat label="Cost / lead" value="—" />
                <Stat label="Cost / patient" value="—" />
                <Stat label="Conv %" value={`${c.convRatePct.toFixed(0)}%`} />
              </div>
            )}
          </Panel>
        ))}
      </div>

      {/* head to head */}
      {(g || f) && (
        <Panel>
          <PanelHead title="Google Ads vs Facebook / Meta" sub="The two budgets you control most directly — spend, platform conversions and cost per conversion." />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <HeadToHead c={g} color="#2f6fb0" />
            <div className="display text-ink-soft">vs</div>
            <HeadToHead c={f} color="#3b5998" />
          </div>
          <div className="flex h-3 rounded-lg overflow-hidden mt-4 bg-border">
            <span style={{ width: `${((g?.spendPence ?? 0) / gfTot) * 100}%`, background: '#2f6fb0' }} />
            <span style={{ width: `${((f?.spendPence ?? 0) / gfTot) * 100}%`, background: '#3b5998' }} />
          </div>
          <NoteFoot>
            Conversions, clicks and reach are reported by the ad platforms themselves (Meta lead/pixel actions + Google conversions) — not the same as CRM patients, which can&apos;t be split per channel without per-touch attribution. So this compares spend, platform conversions and cost per conversion — the levers you act on. Blended paid ROAS sits at {data.blendedRoas != null ? `${data.blendedRoas.toFixed(2)}×` : 'n/a'} across all paid channels.
          </NoteFoot>
        </Panel>
      )}

      {/* channel efficiency table */}
      <Panel>
        <PanelHead title="Channel Efficiency" sub="Spend → leads → CPL → conversion. Paid rows are platform-reported (Meta/Google); organic is CRM. Patients are CRM-only and can't be split per paid channel." right={<Pill tone="info">{data.window?.label}</Pill>} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 720 }}>
            <thead>
              <tr className="border-b border-border">
                {['Channel', 'Spend', 'Leads', 'CPL', 'Patients', 'CPA', 'Lead share', 'Conv %'].map((h, i) => (
                  <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => {
                const lShare = totalEffLeads ? (effLeads(c) / totalEffLeads) * 100 : 0;
                return (
                  <tr key={c.key} className="border-b border-border last:border-0">
                    <td className={td}><span aria-hidden className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: c.color }} />{c.label}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.paid ? (c.spendPence ? gbp(c.spendPence) : '—') : '—'}</td>
                    {/* Leads: paid = platform conversions (Meta/Google), organic = CRM */}
                    <td className={`${td} text-right tabular-nums`}>{c.paid ? c.adConversions.toLocaleString('en-GB') : c.leads}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.paid ? (c.costPerAdConvPence ? gbp(c.costPerAdConvPence) : '—') : '—'}</td>
                    {/* Patients (treatment) are CRM-only — never attributable to a paid channel */}
                    <td className={`${td} text-right tabular-nums`}>{c.paid ? '—' : c.conversions}</td>
                    <td className={`${td} text-right tabular-nums`}>—</td>
                    <td className={`${td} text-right tabular-nums`}>{lShare.toFixed(0)}%</td>
                    {/* Conv %: paid = conversions/clicks, organic = patients/leads */}
                    <td className={`${td} text-right tabular-nums`}>{c.paid ? `${c.adConvRatePct.toFixed(1)}%` : `${c.convRatePct.toFixed(0)}%`}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border font-semibold">
                <td className={td}>All channels</td>
                <td className={`${td} text-right tabular-nums`}>{gbp(data.paidSpendPence)}</td>
                <td className={`${td} text-right tabular-nums`}>{totalEffLeads.toLocaleString('en-GB')}</td>
                <td className={`${td} text-right tabular-nums`}>{paidAdConv ? gbp(Math.round(data.paidSpendPence / paidAdConv)) : '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{data.totalConversions}</td>
                <td className={`${td} text-right tabular-nums`}>—</td>
                <td className={`${td} text-right tabular-nums`}>100%</td>
                <td className={`${td} text-right tabular-nums`}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <NoteFoot>Spend and leads on paid rows are reported by Meta and Google (conversions = lead/pixel actions + Google conversions). Organic leads come from the CRM. Patients (treatment-started/completed) are CRM-only and aren&apos;t split per paid channel.</NoteFoot>
      </Panel>

      {/* per ad account */}
      {data.byAccount.length > 0 && (
        <Panel>
          <PanelHead
            title="Spend by Ad Account"
            sub="Each connected ad account in your selection. Manage which accounts are included in Integrations."
            right={<Pill tone="info">{data.byAccount.length} {data.byAccount.length === 1 ? 'account' : 'accounts'}</Pill>}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 720 }}>
              <thead>
                <tr className="border-b border-border">
                  {['Account', 'Provider', 'Spend', 'Impressions', 'Clicks', 'Reach', 'Patients', 'CPA'].map((h, i) => (
                    <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.byAccount.map((a) => (
                  <tr key={`${a.provider}-${a.customerId}`} className="border-b border-border last:border-0">
                    <td className={td}>{a.name || a.customerId}{a.currency ? <span className="text-ink-muted"> · {a.currency}</span> : null}</td>
                    <td className={`${td} text-right capitalize`}>{a.provider.replace('_', ' ')}</td>
                    <td className={`${td} text-right tabular-nums`}>{gbp(a.spendPence)}</td>
                    <td className={`${td} text-right tabular-nums`}>{a.impressions.toLocaleString('en-GB')}</td>
                    <td className={`${td} text-right tabular-nums`}>{a.clicks.toLocaleString('en-GB')}</td>
                    <td className={`${td} text-right tabular-nums`}>{a.reach ? `${a.reachIsApprox ? '~' : ''}${a.reach.toLocaleString('en-GB')}` : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{a.conversions}</td>
                    <td className={`${td} text-right tabular-nums`}>{a.cpaPence ? gbp(a.cpaPence) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NoteFoot>Spend, impressions, clicks and reach are real per account. Patients (CRM conversions) and revenue aren&apos;t attributed per account, so CPA uses business-level conversions.</NoteFoot>
        </Panel>
      )}

      {/* leads by channel */}
      <Panel>
        <PanelHead title="Leads by Channel" sub="Paid = conversions reported by Meta/Google; organic = CRM-attributed enquiries." />
        {channels.map((c) => (
          <BarRow
            key={c.key}
            name={c.label}
            sub={c.paid ? `${c.clicks.toLocaleString('en-GB')} clicks · ${c.adConvRatePct.toFixed(1)}% conv` : `${c.conversions} patients · ${c.convRatePct.toFixed(0)}% conv`}
            pct={(effLeads(c) / maxLeads) * 100}
            value={c.paid ? `${c.adConversions.toLocaleString('en-GB')} conversions` : `${c.leads} leads`}
            tone={c.paid ? 'bg-brand' : 'bg-success'}
          />
        ))}
      </Panel>

      {/* acquisition by practice */}
      <Panel>
        <PanelHead title="Acquisition by Practice" sub="Each site's own Meta/Google account — spend, conversions and the revenue that follows." />
        {data.byPracticeAvailable ? (
          <>
            {data.byPractice.map((x) => (
              <BarRow
                key={x.id}
                name={x.name}
                sub={`${gbp(x.spendPence)} spend · ${x.conversions} patients${x.roas != null ? ` · ${x.roas.toFixed(2)}× ROAS` : ''}`}
                pct={(x.leads / maxPLeads) * 100}
                value={`${x.leads.toLocaleString('en-GB')} leads`}
                valueSub={gbp(x.revenuePence)}
                tone={x.roas != null ? (x.roas >= 3.5 ? 'bg-success' : x.roas < 2 ? 'bg-danger' : 'bg-brand') : 'bg-brand'}
              />
            ))}
            <NoteFoot>
              Leads and spend are reported per practice by that site&apos;s Meta/Google ad account; patients (treatment) and revenue come from the CRM and settled invoices, so per-site ROAS is real. Accounts not yet mapped to a practice stay in the group totals only.
            </NoteFoot>
          </>
        ) : (
          <EmptyState message="No ad account is mapped to a practice in this window. Map each practice's Google/Meta account to unlock per-site acquisition." />
        )}
      </Panel>
    </>
  );
}

function HeadToHead({ c, color }: { c: MktChannel | null; color: string }) {
  if (!c) return <div className="text-ink-soft text-sm">No data</div>;
  return (
    <div className={color === '#2f6fb0' ? 'text-right' : ''}>
      <div className="display text-2xl font-bold" style={{ color }}>{gbp(c.spendPence)}</div>
      <div className="text-xs text-ink-muted">{c.adConversions.toLocaleString('en-GB')} conversions · {c.clicks.toLocaleString('en-GB')} clicks</div>
      <div className="text-xs text-ink-muted">{c.costPerAdConvPence ? `${gbp(c.costPerAdConvPence)}/conv` : '—'} · {c.adConvRatePct.toFixed(1)}% conv rate</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div>{label}</div>
      <b className="block text-ink text-[13px]">{value}</b>
    </div>
  );
}

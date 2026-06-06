'use client';

// Marketing & ROI (GM Intelligence OS). Channel acquisition economics, Google-vs-
// Meta head-to-head, channel-efficiency table and acquisition-by-practice.
//
// WIRED: reads GET /api/analytics/marketing-roi (scope/period reactive). Real
// ad_metrics spend + CRM lead attribution. HONEST: revenue is NOT attributable
// per channel — the screen leads on spend → leads → CPL → patients → CPA, and
// shows only a business-level blended paid ROAS. Money is integer PENCE.

import { PageHeader, KpiTile, BarRow, AlertRow, EmptyState, SkeletonKpiRow, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill, th, td } from './os-ui';
import { useMarketingRoi } from '../marketing-roi-hooks';
import type { MarketingRoi, MktChannel } from '../marketing-roi-api';

const gbp = (p: number) => formatPence(p);

export default function MarketingRoiScreen() {
  const { data, isLoading, isError, error } = useMarketingRoi();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Marketing & ROI"
        subtitle="Facebook vs Google vs organic — spend, leads, cost per patient and conversion, per channel and per practice. Real ad spend + CRM lead attribution."
      />
      <ScopePeriodBar />

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
  const maxLeads = Math.max(...channels.map((c) => c.leads), 1);
  const maxPLeads = Math.max(...data.byPractice.map((p) => p.leads), 1);

  return (
    <>
      {/* KPI strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Paid spend" value={data.connected ? gbp(data.paidSpendPence) : 'Not connected'} delta={data.connected ? 'Google + Meta' : 'Connect ad accounts'} />
        <KpiTile label="Total leads" value={data.totalLeads.toString()} delta={`${data.totalConversions} reached treatment`} />
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
              <div className="display text-lg font-bold">{c.leadSharePct.toFixed(0)}%</div>
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 mt-3 text-[11px] text-ink-muted">
              <Stat label="Spend" value={c.paid ? gbp(c.spendPence) : '—'} />
              <Stat label="Leads" value={String(c.leads)} />
              <Stat label="Patients" value={String(c.conversions)} />
              <Stat label="Cost / lead" value={c.cplPence ? gbp(c.cplPence) : '—'} />
              <Stat label="Cost / patient" value={c.cpaPence ? gbp(c.cpaPence) : '—'} />
              <Stat label="Conv %" value={`${c.convRatePct.toFixed(0)}%`} />
            </div>
          </Panel>
        ))}
      </div>

      {/* head to head */}
      {(g || f) && (
        <Panel>
          <PanelHead title="Google Ads vs Facebook / Meta" sub="The two budgets you control most directly — spend, leads and cost per patient." />
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
            Revenue can&apos;t be split between these two without per-touch attribution, so this compares spend, lead volume and cost per patient — the levers you act on. Blended paid ROAS sits at {data.blendedRoas != null ? `${data.blendedRoas.toFixed(2)}×` : 'n/a'} across all paid channels.
          </NoteFoot>
        </Panel>
      )}

      {/* channel efficiency table */}
      <Panel>
        <PanelHead title="Channel Efficiency" sub="Spend → leads → CPL → patients → CPA → conversion. Real per channel; revenue stays business-level." right={<Pill tone="info">{data.window?.label}</Pill>} />
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
              {channels.map((c) => (
                <tr key={c.key} className="border-b border-border last:border-0">
                  <td className={td}><span aria-hidden className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: c.color }} />{c.label}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.paid ? (c.spendPence ? gbp(c.spendPence) : '—') : '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.leads}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.cplPence ? gbp(c.cplPence) : '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.conversions}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.cpaPence ? gbp(c.cpaPence) : '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.leadSharePct.toFixed(0)}%</td>
                  <td className={`${td} text-right tabular-nums`}>{c.convRatePct.toFixed(0)}%</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border font-semibold">
                <td className={td}>All channels</td>
                <td className={`${td} text-right tabular-nums`}>{gbp(data.paidSpendPence)}</td>
                <td className={`${td} text-right tabular-nums`}>{data.totalLeads}</td>
                <td className={`${td} text-right tabular-nums`}>{gbp(data.totalLeads ? Math.round(data.paidSpendPence / data.totalLeads) : 0)}</td>
                <td className={`${td} text-right tabular-nums`}>{data.totalConversions}</td>
                <td className={`${td} text-right tabular-nums`}>{gbp(data.totalConversions ? Math.round(data.paidSpendPence / data.totalConversions) : 0)}</td>
                <td className={`${td} text-right tabular-nums`}>100%</td>
                <td className={`${td} text-right tabular-nums`}>{data.totalLeads ? Math.round((data.totalConversions / data.totalLeads) * 100) : 0}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <NoteFoot>{data.note}</NoteFoot>
      </Panel>

      {/* leads by channel */}
      <Panel>
        <PanelHead title="Leads by Channel" sub="Where enquiries actually come from (CRM-attributed, real)." />
        {channels.map((c) => (
          <BarRow
            key={c.key}
            name={c.label}
            sub={`${c.conversions} patients · ${c.convRatePct.toFixed(0)}% conv`}
            pct={(c.leads / maxLeads) * 100}
            value={`${c.leads} leads`}
            tone={c.paid ? 'bg-brand' : 'bg-success'}
          />
        ))}
      </Panel>

      {/* acquisition by practice */}
      <Panel>
        <PanelHead title="Acquisition by Practice" sub="Which sites turn enquiries into patients — and the revenue that follows." />
        {data.byPracticeAvailable ? (
          <>
            {data.byPractice.map((x) => (
              <BarRow
                key={x.id}
                name={x.name}
                sub={`${x.conversions} patients · ${x.convRatePct.toFixed(0)}% conv${x.roas != null ? ` · ${x.roas.toFixed(2)}× ROAS` : ''}`}
                pct={(x.leads / maxPLeads) * 100}
                value={`${x.leads} leads`}
                valueSub={gbp(x.revenuePence)}
                tone={x.convRatePct >= 30 ? 'bg-success' : x.convRatePct < 15 ? 'bg-danger' : 'bg-brand'}
              />
            ))}
            <NoteFoot>
              {data.adSpendPerPracticeAvailable
                ? 'Ad spend is tagged per practice, so ROAS is shown per site.'
                : 'Ad spend runs at group level (no practice tag), so per-site ROAS is unavailable — sites rank on leads → patients → revenue, all real.'}
            </NoteFoot>
          </>
        ) : (
          <EmptyState message="No practice-tagged leads in this window. Capture practice on each lead to unlock per-site acquisition." />
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
      <div className="text-xs text-ink-muted">{c.leads} leads · {c.conversions} patients</div>
      <div className="text-xs text-ink-muted">{c.cpaPence ? `${gbp(c.cpaPence)}/patient` : '—'}</div>
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

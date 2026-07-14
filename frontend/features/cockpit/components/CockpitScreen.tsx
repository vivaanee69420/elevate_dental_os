'use client';
// Daily Command Cockpit — one page pulling together yesterday's numbers:
// cash taken, treatment accepted/closed, Google vs Facebook lead performance,
// till reconciliation, and the latest monthly P&L Emergent has sent. Mirrors
// the GM_Dental_Daily_Cockpit reference layout but renders light (rule 1).
//
// v2: practice filter (ScopePeriodBar's scope row) + click-to-expand
// drill-downs on the headline metrics, sourced either from the in-payload
// dailySeries/costLines/opexLines (no extra fetch) or the lazy
// leads/treatments/cashup-days detail endpoints (fetched only on open).
import { Fragment, useState } from 'react';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { KpiTile } from '@/components/ui/KpiTile';
import { Panel, PanelHead, th, td } from '@/features/intelligence/components/os-ui';
import { formatPence, formatNumber, formatDate } from '@/lib/format';
import { useCockpit, useCockpitTreatments, useCockpitCashupDays } from '../hooks';
import { LeadComparison } from './LeadComparison';
import type { CockpitResponse, PLLine, PLLineNote } from '../api';

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

function SectionHeading({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-slate-900">
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">
          {n}
        </span>
        {title}
      </h2>
      {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}

function periodMonthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fmtDay(date: string): string {
  const t = Date.parse(date);
  return Number.isNaN(t) ? date : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Which section's headline metric is expanded into an inline breakdown below
// its tile grid. One open at a time (copies the CliniciansScreen `drill`
// pattern) — clicking the active tile again closes it.
type Drill = 'revenue' | 'treatment' | 'cashup' | null;

function RevenueSection({
  data,
  drill,
  onToggle,
}: {
  data: CockpitResponse;
  drill: Drill;
  onToggle: () => void;
}) {
  const rows = data.revenue.byPractice;
  const active = drill === 'revenue';
  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <SectionHeading n={1} title="Revenue — cash taken (Emergent)" />
        <KpiTile
          label="Cash taken (Emergent) in period"
          value={formatPence(data.revenue.collectedPence)}
          onClick={onToggle}
          active={active}
        />
        {rows.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Practice</th>
                  <th className="py-2 pr-3 text-right font-medium">Cash taken £</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.practiceId ?? r.name ?? 'unmapped'} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-900">{r.name ?? 'Unmapped practice'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(r.collectedPence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {active && (
        <Panel>
          <PanelHead title="Cash taken by day" sub="Every day with Emergent cash-up in this window, most recent first." />
          {data.revenue.dailySeries.length === 0 ? (
            <p className="text-sm text-ink-muted">No daily cash-up rows in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: 360 }}>
                <thead>
                  <tr className="border-b border-border">
                    <th className={`${th} text-left`}>Date</th>
                    <th className={`${th} text-right`}>Cash taken £</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.revenue.dailySeries]
                    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                    .map((d) => (
                      <tr key={d.date} className="border-b border-border last:border-0">
                        <td className={td}>{fmtDay(d.date)}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatPence(d.cashPence)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

function TreatmentSection({
  data,
  practiceId,
  win,
  drill,
  onToggle,
}: {
  data: CockpitResponse;
  practiceId?: string;
  win: { since: string; until: string };
  drill: Drill;
  onToggle: () => void;
}) {
  const t = data.treatment;
  const active = drill === 'treatment';
  const { data: detail, isLoading, isError } = useCockpitTreatments(active, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 100,
  });

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <SectionHeading n={2} title="Treatment &amp; close" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Accepted" value={formatNumber(t.acceptedCount)} delta={formatPence(t.acceptedValuePence)} onClick={onToggle} active={active} />
          <Card label="Tx plans given" value={formatNumber(t.txPlansGiven)} sub={formatPence(t.txPlanValuePence)} />
          <Card label="New leads" value={formatNumber(t.newLeads)} />
          <Card label="Attended" value={formatNumber(t.attended)} />
        </div>
        {t.byPractice.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Practice</th>
                  <th className="py-2 pr-3 text-right font-medium">Accepted</th>
                  <th className="py-2 pr-3 text-right font-medium">Accepted value £</th>
                  <th className="py-2 pr-3 text-right font-medium">Tx plans given</th>
                  <th className="py-2 pr-3 text-right font-medium">Tx plan value £</th>
                  <th className="py-2 pr-3 text-right font-medium">New leads</th>
                  <th className="py-2 pr-3 text-right font-medium">Attended</th>
                </tr>
              </thead>
              <tbody>
                {t.byPractice.map((p) => (
                  <tr key={p.practiceId ?? p.name ?? 'unmapped'} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-900">{p.name ?? 'Unmapped practice'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(p.acceptedCount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(p.acceptedValuePence)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(p.txPlansGiven)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(p.txPlanValuePence)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(p.newLeads)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(p.attended)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {active && (
        <Panel>
          <PanelHead title="Accepted treatments" sub="Every treatment accepted (Emergent) in this window." />
          {isLoading && <p className="text-sm text-ink-muted">Loading accepted treatments…</p>}
          {isError && <p className="text-sm text-danger">Couldn&rsquo;t load accepted treatments.</p>}
          {!isLoading && !isError && (detail?.lines.length ?? 0) === 0 && (
            <p className="text-sm text-ink-muted">No accepted treatments in this window.</p>
          )}
          {(detail?.lines.length ?? 0) > 0 && (
            <div className="overflow-x-auto" style={{ maxHeight: 480 }}>
              <table className="w-full border-collapse" style={{ minWidth: 720 }}>
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Patient', 'Treatment', 'Practice', 'Source', 'Value'].map((h, i) => (
                      <th key={h} className={`${th} ${i === 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail!.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className={`${td} whitespace-nowrap`}>{fmtDay(l.acceptedDate)}</td>
                      <td className={td}>{l.patientName ?? '—'}</td>
                      <td className={td}>{l.treatmentName ?? '—'}</td>
                      <td className={td}>{l.practiceName ?? '—'}</td>
                      <td className={td}>{l.source ?? '—'}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatPence(l.valuePence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(detail?.lines.length ?? 0) === (detail?.limit ?? 0) && (
            <p className="mt-2 text-xs text-ink-muted">Showing the first {detail?.limit} — narrow the period or practice to see fewer at once.</p>
          )}
        </Panel>
      )}
    </>
  );
}

function CashUpSection({
  data,
  practiceId,
  win,
  drill,
  onToggle,
}: {
  data: CockpitResponse;
  practiceId?: string;
  win: { since: string; until: string };
  drill: Drill;
  onToggle: () => void;
}) {
  const c = data.cashUp;
  const active = drill === 'cashup';
  const { data: detail, isLoading, isError } = useCockpitCashupDays(active, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 200,
  });

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <SectionHeading n={4} title="Cash up — till reconciliation" note="Flags where the till/terminal total differs from system revenue." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card label="Cash taken £" value={formatPence(c.collectedPence)} />
          <Card label="Till detail £" value={formatPence(c.detailPence)} />
          <KpiTile
            label="Variance £"
            value={formatPence(c.variancePence)}
            delta={Math.abs(c.variancePence) > 5000 ? 'Over £50 — check today' : 'Within tolerance'}
            deltaTone={Math.abs(c.variancePence) > 5000 ? 'down' : 'muted'}
            onClick={onToggle}
            active={active}
          />
        </div>
        {c.byPractice.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Practice</th>
                  <th className="py-2 pr-3 text-right font-medium">Cash taken £</th>
                  <th className="py-2 pr-3 text-right font-medium">Till detail £</th>
                  <th className="py-2 pr-3 text-right font-medium">Variance £</th>
                  <th className="py-2 pr-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {c.byPractice.map((p) => {
                  const flagged = Math.abs(p.variancePence) > 5000;
                  return (
                    <tr key={p.practiceId ?? p.name ?? 'unmapped'} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-900">{p.name ?? 'Unmapped practice'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPence(p.collectedPence)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPence(p.detailPence)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPence(p.variancePence)}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-[12px] font-medium ' +
                            (flagged ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')
                          }
                        >
                          {flagged ? 'Check' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {active && (
        <Panel>
          <PanelHead title="Cash-up days" sub="Every day's till reconciliation in this window, most recent first — flags where the variance is over £50." />
          {isLoading && <p className="text-sm text-ink-muted">Loading cash-up days…</p>}
          {isError && <p className="text-sm text-danger">Couldn&rsquo;t load cash-up days.</p>}
          {!isLoading && !isError && (detail?.lines.length ?? 0) === 0 && (
            <p className="text-sm text-ink-muted">No cash-up rows in this window.</p>
          )}
          {(detail?.lines.length ?? 0) > 0 && (
            <div className="overflow-x-auto" style={{ maxHeight: 480 }}>
              <table className="w-full border-collapse" style={{ minWidth: 680 }}>
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Practice', 'Cash taken £', 'Till detail £', 'Variance £', 'Refunds'].map((h, i) => (
                      <th key={h} className={`${th} ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...detail!.lines]
                    .sort((a, b) => (a.cashupDate < b.cashupDate ? 1 : a.cashupDate > b.cashupDate ? -1 : 0))
                    .map((l, i) => {
                      const flagged = Math.abs(l.variancePence) > 5000;
                      return (
                        <tr key={`${l.cashupDate}-${l.practiceName ?? i}`} className="border-b border-border last:border-0">
                          <td className={`${td} whitespace-nowrap`}>{fmtDay(l.cashupDate)}</td>
                          <td className={td}>{l.practiceName ?? '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>{formatPence(l.cashTakenPence)}</td>
                          <td className={`${td} text-right tabular-nums`}>{formatPence(l.detailPence)}</td>
                          <td className={`${td} text-right tabular-nums ${flagged ? 'text-danger' : ''}`}>{formatPence(l.variancePence)}</td>
                          <td className={`${td} text-right tabular-nums`}>{l.refunds?.length ?? 0}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

// Sums a [{name,amountPence}] group's total (used for the parent-row figure
// in the expandable P&L line-items panel below).
function groupTotal(lines: PLLine[]): number {
  return lines.reduce((s, l) => s + l.amountPence, 0);
}

function MonthlyLineItemsPanel({ data }: { data: CockpitResponse }) {
  const m = data.monthly;
  const groups: Array<{ key: string; label: string; lines: PLLine[] }> = [
    { key: 'cost', label: 'Cost of sales', lines: m.costLines },
    { key: 'opex', label: 'Operating expenses', lines: m.opexLines },
    ...(m.customLines.length > 0 ? [{ key: 'custom', label: 'Other lines', lines: m.customLines }] : []),
  ].filter((g) => g.lines.length > 0);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const noteByName = new Map<string, string>((m.lineNotes as PLLineNote[]).map((n) => [n.name, n.note]));

  if (groups.length === 0) {
    return <p className="mt-3 text-xs text-slate-400">No itemised P&amp;L lines from Emergent for this month.</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 420 }}>
        <tbody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <Fragment key={g.key}>
                <tr className="border-b border-border cursor-pointer hover:bg-surface-muted" onClick={() => toggleRow(g.key)}>
                  <td className={`${td} font-semibold`}>
                    <span className="inline-block w-3 mr-1 text-[10px] text-ink-muted" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                    {g.label}
                    <span className="ml-1 text-[11px] text-ink-muted">({g.lines.length})</span>
                  </td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{formatPence(groupTotal(g.lines))}</td>
                </tr>
                {isOpen &&
                  g.lines.map((l) => (
                    <tr key={`${g.key}:${l.name}`} className="border-b border-border last:border-0 bg-surface-muted/40">
                      <td className={`${td} pl-7 text-ink-muted`} title={noteByName.get(l.name)}>
                        {l.name}
                        {noteByName.has(l.name) ? <span className="ml-1 text-[10px] text-ink-muted">note</span> : null}
                      </td>
                      <td className={`${td} text-right tabular-nums text-ink-muted`}>{formatPence(l.amountPence)}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthlySection({ data }: { data: CockpitResponse }) {
  const m = data.monthly;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <SectionHeading n={5} title={`Monthly revenue — ${periodMonthLabel(m.periodMonth)}`} note="Latest calendar month Emergent has sent P&L for." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <Card label="Revenue" value={formatPence(m.revenuePence)} />
        <Card label="Net profit" value={formatPence(m.netProfitPence)} />
      </div>
      {m.byBusiness.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3 font-medium">Business</th>
                <th className="py-2 pr-3 text-right font-medium">Revenue £</th>
                <th className="py-2 pr-3 text-right font-medium">Net profit £</th>
              </tr>
            </thead>
            <tbody>
              {m.byBusiness.map((b) => (
                <tr key={b.practiceId ?? b.name ?? 'unmapped'} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-900">{b.name ?? 'Unmapped practice'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(b.revenuePence)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(b.netProfitPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">No monthly P&amp;L data from Emergent yet for this org.</p>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line items</h3>
        <MonthlyLineItemsPanel data={data} />
      </div>
    </section>
  );
}

export default function CockpitScreen() {
  const { scope, win } = useScopePeriod();
  const practiceId = scope !== 'all' ? scope : undefined;
  const { data, isLoading, isError } = useCockpit({ since: win.since, until: win.until, scope });
  const [drill, setDrill] = useState<Drill>(null);
  const toggle = (m: Exclude<Drill, null>) => setDrill((cur) => (cur === m ? null : m));

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Daily Command Cockpit</h1>
        <p className="text-[13px] text-slate-500">
          One-page daily snapshot: cash taken, treatment closed, lead performance, and till reconciliation.
        </p>
      </div>

      <ScopePeriodBar />

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading…</div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700">
          Could not load the cockpit data. Retry shortly.
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">No data for this window.</div>
      ) : (
        <div className="space-y-4">
          <RevenueSection data={data} drill={drill} onToggle={() => toggle('revenue')} />
          <TreatmentSection data={data} practiceId={practiceId} win={win} drill={drill} onToggle={() => toggle('treatment')} />
          <LeadComparison data={data.leadRoi} practiceId={practiceId} win={win} />
          <CashUpSection data={data} practiceId={practiceId} win={win} drill={drill} onToggle={() => toggle('cashup')} />
          <MonthlySection data={data} />
          <p className="text-right text-[11px] text-slate-400">Last updated {formatDate(data.updatedAt)}</p>
        </div>
      )}
    </div>
  );
}

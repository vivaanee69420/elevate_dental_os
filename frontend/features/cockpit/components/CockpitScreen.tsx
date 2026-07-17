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
import { useCockpit, useCockpitTreatments, useCockpitCashupDays, useCockpitLeads } from '../hooks';
import { LeadComparison } from './LeadComparison';
import { PipelineTag } from './PipelineTag';
import { LeadsTable, dedupeByPerson, CHANNEL_ORDER } from './LeadsTable';
import { LeadPerformanceChart, RevenueTrendChart } from './CockpitCharts';
import type { CockpitResponse, PLLine, PLLineNote, LeadChannel } from '../api';

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
type Drill = 'revenue' | 'treatment' | 'txPlans' | 'newLeads' | 'attended' | 'cashup' | null;

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
        <SectionHeading n={1} title="Revenue — cash taken (Emergent)" note="Till cash taken, keyed into Emergent each day." />
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

      <RevenueTrendChart dailySeries={data.revenue.dailySeries} />

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

// "close rate 8/15 = 53%" — accepted as a share of the plans presented.
// Returns null when no plans were keyed in: a close rate out of zero plans is
// undefined, not 0%.
function closeRate(acceptedCount: number, txPlansGiven: number): string | null {
  if (txPlansGiven <= 0) return null;
  const rounded = Math.round((acceptedCount / txPlansGiven) * 100);
  return `close rate ${acceptedCount}/${txPlansGiven} = ${rounded}%`;
}

// Day-by-day breakdown behind a manager-keyed Emergent metric (Tx plans given,
// New leads, Attended).
//
// This is as deep as these numbers go, by construction: the Emergent cash-up
// sends a COUNT PER DAY, with no per-plan or per-lead records behind it. The
// old drill-down re-printed the same single total as a one-row "by practice"
// table, which looked broken — a day list is the real detail that exists.
function EmergentDailyBreakdown({
  metric,
  title,
  sub,
  practiceId,
  win,
  byPractice,
  footer,
}: {
  metric: 'txPlansGiven' | 'newLeads' | 'attended';
  title: string;
  sub: string;
  practiceId?: string;
  win: { since: string; until: string };
  byPractice: CockpitResponse['treatment']['byPractice'];
  footer?: React.ReactNode;
}) {
  const { data, isLoading, isError } = useCockpitCashupDays(true, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 500,
  });

  const showValue = metric === 'txPlansGiven';
  // Only days that actually carry the metric — a day the manager keyed no
  // plans on is noise in a "where did the 42 come from" list.
  const days = (data?.lines ?? []).filter((l) => l[metric] > 0).sort((a, b) => (a.cashupDate < b.cashupDate ? 1 : -1));

  return (
    <Panel>
      <PanelHead title={title} sub={sub} />

      {byPractice.length > 1 && (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 360 }}>
            <thead>
              <tr className="border-b border-border">
                <th className={`${th} text-left`}>Practice</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {byPractice.map((p) => (
                <tr key={p.practiceId ?? p.name ?? 'unmapped'} className="border-b border-border last:border-0">
                  <td className={td}>{p.name ?? 'Unmapped practice'}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatNumber(p[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isLoading && <p className="text-sm text-ink-muted">Loading days…</p>}
      {isError && <p className="text-sm text-danger">Couldn&rsquo;t load the daily breakdown.</p>}
      {!isLoading && !isError && days.length === 0 && (
        <p className="text-sm text-ink-muted">No day in this window has a figure keyed in for this metric.</p>
      )}

      {days.length > 0 && (
        <div className="overflow-x-auto" style={{ maxHeight: 420 }}>
          <table className="w-full border-collapse" style={{ minWidth: 480 }}>
            <thead>
              <tr className="border-b border-border">
                <th className={`${th} text-left`}>Date</th>
                <th className={`${th} text-left`}>Practice</th>
                <th className={`${th} text-right`}>{title}</th>
                {showValue && <th className={`${th} text-right`}>Value £</th>}
              </tr>
            </thead>
            <tbody>
              {days.map((l, i) => (
                <tr key={`${l.cashupDate}-${l.practiceName ?? i}`} className="border-b border-border last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{fmtDay(l.cashupDate)}</td>
                  <td className={td}>{l.practiceName ?? '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatNumber(l[metric])}</td>
                  {showValue && (
                    <td className={`${td} text-right tabular-nums`}>
                      {l.txPlanValuePence > 0 ? formatPence(l.txPlanValuePence) : <span className="text-ink-muted">not sent</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer}
    </Panel>
  );
}

// "New leads" is a number the practice manager types into the Emergent cash-up —
// it has no records of its own. But the people behind it usually DO exist, in
// the GoHighLevel pipelines, over the same window. So rather than showing a bare
// count, look them up and show each one tagged with the pipeline it came in on.
//
// The two counts measure different things (Emergent's tally includes phone calls,
// walk-ins and referrals; GoHighLevel only sees what came through a pipeline), so
// they are reconciled openly rather than forced to agree.
function PipelineLeadsForWindow({
  keyedIn,
  practiceId,
  win,
}: {
  keyedIn: number;
  practiceId?: string;
  win: { since: string; until: string };
}) {
  const { data, isLoading, isError } = useCockpitLeads(true, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 500,
  });

  const rows = dedupeByPerson(data?.lines ?? [], false); // one row per person, across all channels
  const byChannel = new Map<LeadChannel, number>();
  for (const r of rows) byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + 1);
  // The gap runs both ways, and both directions are worth saying out loud.
  const untracked = Math.max(0, keyedIn - rows.length);
  const unkeyed = Math.max(0, rows.length - keyedIn);

  return (
    <Panel>
      <PanelHead
        title="The same leads, found in GoHighLevel"
        sub="Every person who came in through a GoHighLevel pipeline over this window, tagged with the pipeline they arrived on. This is where the leads behind the keyed-in number actually live."
      />

      {isLoading && <p className="text-sm text-ink-muted">Looking these leads up in GoHighLevel…</p>}
      {isError && <p className="text-sm text-danger">Couldn&rsquo;t load the pipeline leads.</p>}

      {!isLoading && !isError && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-muted/50 p-3 text-[13px]">
            <span>
              <span className="text-ink-muted">Keyed into Emergent: </span>
              <strong className="tabular-nums text-ink">{formatNumber(keyedIn)}</strong>
            </span>
            <span>
              <span className="text-ink-muted">Found in GoHighLevel pipelines: </span>
              <strong className="tabular-nums text-ink">{formatNumber(rows.length)}</strong>
            </span>
            {untracked > 0 ? (
              <span className="text-ink-muted">
                {formatNumber(untracked)} of the keyed-in leads have no pipeline record — phone calls, walk-ins and
                referrals never reach GoHighLevel.
              </span>
            ) : null}
            {unkeyed > 0 ? (
              <span className="text-ink-muted">
                GoHighLevel has {formatNumber(unkeyed)} more than were keyed in — the daily tally is under-recording
                what the pipelines actually brought in.
              </span>
            ) : null}
          </div>

          {rows.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {CHANNEL_ORDER.filter((ch) => byChannel.has(ch)).map((ch) => (
                <span key={ch} className="flex items-center gap-1">
                  <PipelineTag channel={ch} />
                  <span className="text-xs text-ink-muted">{formatNumber(byChannel.get(ch)!)}</span>
                </span>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No GoHighLevel pipeline leads at all in this window for this practice — so every one of the{' '}
              {formatNumber(keyedIn)} keyed-in leads came in some other way, or the practice&rsquo;s GoHighLevel
              subaccount isn&rsquo;t linked under System &gt; Integrations.
            </p>
          ) : (
            <LeadsTable rows={rows} />
          )}
        </>
      )}
    </Panel>
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
  onToggle: (m: Exclude<Drill, null>) => void;
}) {
  const t = data.treatment;
  const active = drill === 'treatment';
  const { data: detail, isLoading, isError } = useCockpitTreatments(active, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 100,
  });

  // Emergent sends a plan COUNT every day but only sometimes a plan value —
  // for some practices it never does. Rendering that as "£0.00" reads as "we
  // proposed 42 plans worth nothing"; it means "Emergent didn't tell us".
  const txValueMissing = t.txPlansGiven > 0 && t.txPlanValuePence === 0;

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <SectionHeading
          n={2}
          title="Treatment &amp; close"
          note="What the practice proposed and what patients accepted. Keyed into Emergent by the practice each day, except Accepted, which comes from Emergent's treatment feed."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            label="Accepted"
            value={formatNumber(t.acceptedCount)}
            delta={formatPence(t.acceptedValuePence)}
            info="Treatments a patient said yes to, from Emergent's treatment feed — one record per treatment, so this is the one number here that can be opened patient by patient. Click to see them, including which ad pipeline each patient first came in on."
            onClick={() => onToggle('treatment')}
            active={active}
          />
          <KpiTile
            label="Tx plans given"
            value={formatNumber(t.txPlansGiven)}
            delta={txValueMissing ? 'Value not sent by Emergent' : formatPence(t.txPlanValuePence)}
            info="Treatment plans presented to patients — the number the practice manager keys into the Emergent cash-up at the end of each day. Emergent sends a count per day and no per-plan records, so the deepest this can go is day by day. Some practices never key the plan value, which is why the value can be blank while the count is not."
            onClick={() => onToggle('txPlans')}
            active={drill === 'txPlans'}
          />
          <KpiTile
            label="New leads"
            value={formatNumber(t.newLeads)}
            delta="Keyed in — click to see who they are"
            info="The practice manager's own daily tally of new enquiries, typed into the Emergent cash-up. The number itself has no records behind it, but the people usually do — click through and we look them up in the GoHighLevel pipelines for the same window and show each one tagged with the pipeline it came in on. Emergent's tally also counts phone calls, walk-ins and referrals, which never reach GoHighLevel, so the two counts are reconciled rather than forced to match."
            onClick={() => onToggle('newLeads')}
            active={drill === 'newLeads'}
          />
          <KpiTile
            label="Attended"
            value={formatNumber(t.attended)}
            delta={t.attended === 0 ? 'Not being keyed in' : (closeRate(t.acceptedCount, t.txPlansGiven) ?? undefined)}
            info="Patients who attended their appointment, keyed into the Emergent cash-up each day. It reads zero because no practice is filling this field in — it is a data-entry gap in Emergent, not a day with no patients."
            onClick={() => onToggle('attended')}
            active={drill === 'attended'}
          />
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
          <PanelHead
            title="Accepted treatments"
            sub="Every treatment accepted in this window. 'Came in on' is the GoHighLevel pipeline the patient first arrived through — that is the link between an ad and the treatment it paid for."
          />
          {isLoading && <p className="text-sm text-ink-muted">Loading accepted treatments…</p>}
          {isError && <p className="text-sm text-danger">Couldn&rsquo;t load accepted treatments.</p>}
          {!isLoading && !isError && (detail?.lines.length ?? 0) === 0 && (
            <p className="text-sm text-ink-muted">No accepted treatments in this window.</p>
          )}
          {(detail?.lines.length ?? 0) > 0 && (
            <div className="overflow-x-auto" style={{ maxHeight: 480 }}>
              <table className="w-full border-collapse" style={{ minWidth: 860 }}>
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Patient', 'Treatment', 'Practice', 'Came in on', 'Value'].map((h, i) => (
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
                      <td className={td}>
                        {l.leadChannel ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <PipelineTag channel={l.leadChannel} pipelineName={l.leadPipelineName} />
                            <span className="text-[12px] text-ink-muted">{l.leadPipelineName ?? '—'}</span>
                          </span>
                        ) : (
                          <span className="text-ink-muted" title="No GoHighLevel lead matched this patient by phone, email or name — a walk-in, a referral, or a lead we can't tie back.">
                            Not from a tracked pipeline
                          </span>
                        )}
                      </td>
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

      {drill === 'txPlans' && (
        <EmergentDailyBreakdown
          metric="txPlansGiven"
          title="Tx plans given"
          sub="Day by day, as keyed into the Emergent cash-up. This is the full detail — Emergent sends a count per day, never the individual plans."
          practiceId={practiceId}
          win={win}
          byPractice={t.byPractice}
          footer={
            txValueMissing ? (
              <p className="mt-3 text-xs text-ink-muted">
                Plan value shows as &ldquo;not sent&rdquo; because Emergent isn&rsquo;t sending a value with these plans —
                the count is real, the £0 was not. Ask the practice to key the plan value into the cash-up and it will
                appear here.
              </p>
            ) : undefined
          }
        />
      )}

      {drill === 'newLeads' && (
        <PipelineLeadsForWindow keyedIn={t.newLeads} practiceId={practiceId} win={win} />
      )}

      {drill === 'attended' && (
        <EmergentDailyBreakdown
          metric="attended"
          title="Attended"
          sub="Day by day, as keyed into the Emergent cash-up."
          practiceId={practiceId}
          win={win}
          byPractice={t.byPractice}
          footer={
            t.attended === 0 ? (
              <p className="mt-3 text-xs text-ink-muted">
                No practice is keying this field into Emergent, so it reads zero everywhere. Nothing is broken here —
                there is simply nothing being entered.
              </p>
            ) : undefined
          }
        />
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
        <SectionHeading n={4} title="Cash up — till reconciliation" note="System revenue vs the till/terminal total — flags same-day gaps." />
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
      <SectionHeading n={5} title={`Monthly revenue — ${periodMonthLabel(m.periodMonth)}`} note="The latest month Emergent has sent a P&amp;L for." />
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

  // The scope bar only carries the practice id; the payload is where the name
  // lives. Either feed can name it — a practice may have Emergent cash-up but
  // no GoHighLevel subaccount, or the other way round.
  const practiceName = practiceId
    ? data?.treatment.byPractice.find((p) => p.practiceId === practiceId)?.name ??
      data?.leadRoi.channels.find((c) => c.practiceId === practiceId)?.practiceName ??
      null
    : null;

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
          <TreatmentSection data={data} practiceId={practiceId} win={win} drill={drill} onToggle={toggle} />
          <LeadPerformanceChart channels={data.leadRoi.channels} />
          <LeadComparison data={data.leadRoi} practiceId={practiceId} practiceName={practiceName} win={win} />
          <CashUpSection data={data} practiceId={practiceId} win={win} drill={drill} onToggle={() => toggle('cashup')} />
          <MonthlySection data={data} />
          <p className="text-right text-[11px] text-slate-400">Last updated {formatDate(data.updatedAt)}</p>
        </div>
      )}
    </div>
  );
}

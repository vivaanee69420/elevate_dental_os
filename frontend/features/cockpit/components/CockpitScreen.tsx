'use client';
// Daily Command Cockpit — one page pulling together the day's numbers: cash
// taken, treatment accepted/closed, Google vs Facebook lead performance, till
// reconciliation, monthly P&L, profit vs breakeven, and revenue by line.
//
// Skinned to match the `elevate-cockpit-mockup_1.html` reference: Georgia-green
// headings, mint KPI tiles, green pill filter (via cockpit.module.css /
// cockpit-ui). Light only (rule 1). The mockup's blue developer callouts, "NEW
// MODULE" badges and dev-summary card are notes to the developer and are not
// reproduced. Data wiring, drill-downs and honest empty states are unchanged.
import { Fragment, useState } from 'react';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { formatPence, formatNumber, formatDate } from '@/lib/format';
import { useCockpit, useCockpitTreatments, useCockpitCashupDays, useCockpitLeads, useCostModel, useSaveCostModel } from '../hooks';
import { LeadComparison } from './LeadComparison';
import { PipelineTag } from './PipelineTag';
import { LeadsTable, dedupeByPerson, CHANNEL_ORDER } from './LeadsTable';
import { LeadPerformanceChart, RevenueTrendChart } from './CockpitCharts';
import { RevenueByLine } from './RevenueByLine';
import { BreakevenSection } from './BreakevenSection';
import { SecHead, SectionCard, Kpi, DetailPanel, cx, cockpitStyles as s } from './cockpit-ui';
import type { CockpitResponse, PLLine, PLLineNote, LeadChannel } from '../api';

function periodMonthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthLabelShort(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}

function fmtDay(date: string): string {
  const t = Date.parse(date);
  return Number.isNaN(t) ? date : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Which section's headline metric is expanded into an inline breakdown below
// its tile grid. One open at a time — clicking the active tile again closes it.
type Drill = 'revenue' | 'treatment' | 'txPlans' | 'newLeads' | 'attended' | 'cashup' | null;

// The daily target is typed straight into the card. Stored per practice
// (revenue_target_pence_month on practice_cost_model); the group figure is the
// SUM of the practices, so the group can never disagree with its parts — which
// is why it is only editable when a single practice is in scope.
function DailyTargetCard({
  month,
  practiceId,
}: {
  month: CockpitResponse['revenue']['month'];
  practiceId?: string;
}) {
  const { data: cm, isPending: cmPending, isError: cmError } = useCostModel();
  const save = useSaveCostModel();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const row = practiceId ? cm?.rows.find((r) => r.practiceId === practiceId) : undefined;
  const workingDays = row?.workingDaysPerMonth ?? 20;
  // Trust `workingDays` only once the cost model has resolved — otherwise a
  // fallback of 20 against a practice whose real figure differs would silently
  // store the wrong monthly target. So the editor is gated on it having loaded.
  const costModelReady = practiceId ? !cmPending && !cmError : false;

  const submit = () => {
    if (!practiceId || !costModelReady) return;
    const dailyPounds = Number(draft);
    if (!Number.isFinite(dailyPounds) || dailyPounds < 0) return;
    // The card edits a DAILY figure; the model stores a MONTHLY target.
    save.mutate(
      { practiceId, input: { revenueTargetPenceMonth: Math.round(dailyPounds * 100) * workingDays } },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <div className={s.kpi}>
      <div className={s.lbl}>
        <span>Daily target — {monthLabelShort(month.periodMonth)}</span>
      </div>
      {editing && practiceId ? (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            autoFocus
            type="number"
            className={s.field}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" className={s.btn} onClick={submit} disabled={save.isPending || !costModelReady}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={s.btnLink} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className={cx(s.val, month.dailyTargetPence === null && s.valMuted)}>
          {month.dailyTargetPence === null ? 'Not set' : formatPence(month.dailyTargetPence)}
        </div>
      )}

      {!editing ? (
        <div className={s.note}>
          {practiceId ? (
            costModelReady ? (
              <button
                type="button"
                className={s.btnLink}
                onClick={() => {
                  setDraft(month.dailyTargetPence !== null ? String(month.dailyTargetPence / 100) : '');
                  setEditing(true);
                }}
              >
                {month.dailyTargetPence === null ? 'Set a target' : 'Edit'}
              </button>
            ) : (
              <span>{cmError ? "Couldn't load cost model" : 'Loading cost model…'}</span>
            )
          ) : (
            <>Sum of each practice&rsquo;s target. Pick a practice above to set one.</>
          )}
        </div>
      ) : (
        <div className={s.note}>Daily figure, in £. Stored as {workingDays} working days a month.</div>
      )}
      {save.isError ? <div className={cx(s.note, s.danger)}>Couldn&rsquo;t save your changes.</div> : null}
    </div>
  );
}

function RevenueSection({
  data,
  practiceId,
  drill,
  onToggle,
}: {
  data: CockpitResponse;
  practiceId?: string;
  drill: Drill;
  onToggle: () => void;
}) {
  const rows = data.revenue.byPractice;
  const m = data.revenue.month;
  const active = drill === 'revenue';
  return (
    <>
      <SectionCard>
        <SecHead
          n={1}
          title="Revenue — cash taken (Emergent)"
          desc="Till cash taken, keyed into Emergent each day."
          src={{ label: 'Emergent daily push' }}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label={`Cash taken today — ${monthLabelShort(m.periodMonth)}`}
            value={m.todayPence === null ? '—' : formatPence(m.todayPence)}
            valueMuted={m.todayPence === null}
            note={m.todayDate ? fmtDay(m.todayDate) : `No cash-up yet in ${monthLabelShort(m.periodMonth)}`}
            info="The latest day Emergent has sent a cash-up for in this month. This card and the next three are anchored to the calendar month, not to the period you've selected — a month-to-date figure against an arbitrary window would be meaningless."
          />
          <Kpi
            label={`Cash ${monthLabelShort(m.periodMonth)} to date`}
            value={m.mtdPence === null ? '—' : formatPence(m.mtdPence)}
            valueMuted={m.mtdPence === null}
            note={
              m.mtdPence === null
                ? 'No cash-up feed this month'
                : m.avgPerDayPence !== null
                  ? `${formatNumber(m.workingDaysElapsed)} days traded · ${formatPence(m.avgPerDayPence)}/day`
                  : 'No days traded yet'
            }
            info="Cash taken from the 1st of the month to now. 'Days traded' counts days a practice actually sent a cash-up, not calendar weekdays."
          />
          <Kpi
            label={`Projected ${monthLabelShort(m.periodMonth)}`}
            value={m.projectedPence === null ? '—' : formatPence(m.projectedPence)}
            valueMuted={m.projectedPence === null}
            note={m.projectedPence === null ? 'Nothing traded yet' : 'at current run-rate'}
            info="Each practice is projected on its own run-rate (month-to-date ÷ days traded × its working days per month) and the results are summed, so the group figure is always the sum of its parts."
          />
          <DailyTargetCard key={practiceId ?? 'all'} month={m} practiceId={practiceId} />
        </div>

        <div style={{ marginTop: 12 }}>
          <Kpi
            label="Cash taken (Emergent) in the selected period"
            value={formatPence(data.revenue.collectedPence)}
            note="Click to see the day-by-day breakdown."
            onClick={onToggle}
            active={active}
          />
        </div>

        {rows.length > 0 ? (
          <div className={s.scrollX} style={{ marginTop: 16 }}>
            <table className={s.table} style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>Practice</th>
                  <th className={s.r}>Cash taken £</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.practiceId ?? r.name ?? 'unmapped'}>
                    <td>{r.name ?? 'Unmapped practice'}</td>
                    <td className={cx(s.r, s.money)}>{formatPence(r.collectedPence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      <RevenueTrendChart dailySeries={data.revenue.dailySeries} />

      {active && (
        <DetailPanel title="Cash taken by day" sub="Every day with Emergent cash-up in this window, most recent first.">
          {data.revenue.dailySeries.length === 0 ? (
            <p className={s.subtle} style={{ fontSize: 13 }}>No daily cash-up rows in this window.</p>
          ) : (
            <div className={s.scrollX}>
              <table className={s.table} style={{ minWidth: 360 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className={s.r}>Cash taken £</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.revenue.dailySeries]
                    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                    .map((d) => (
                      <tr key={d.date}>
                        <td>{fmtDay(d.date)}</td>
                        <td className={cx(s.r, s.money)}>{formatPence(d.cashPence)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailPanel>
      )}
    </>
  );
}

// "close rate 8/15 = 53%" — accepted as a share of the plans presented. Returns
// null when no plans were keyed in: a close rate out of zero plans is undefined.
function closeRate(acceptedCount: number, txPlansGiven: number): string | null {
  if (txPlansGiven <= 0) return null;
  const rounded = Math.round((acceptedCount / txPlansGiven) * 100);
  return `close rate ${acceptedCount}/${txPlansGiven} = ${rounded}%`;
}

// Day-by-day breakdown behind a manager-keyed Emergent metric. This is as deep
// as these numbers go: the cash-up sends a COUNT PER DAY, no per-plan records.
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
  const days = (data?.lines ?? []).filter((l) => l[metric] > 0).sort((a, b) => (a.cashupDate < b.cashupDate ? 1 : -1));

  return (
    <DetailPanel title={title} sub={sub}>
      {byPractice.length > 1 && (
        <div className={s.scrollX} style={{ marginBottom: 12 }}>
          <table className={s.table} style={{ minWidth: 360 }}>
            <thead>
              <tr>
                <th>Practice</th>
                <th className={s.r}>Total</th>
              </tr>
            </thead>
            <tbody>
              {byPractice.map((p) => (
                <tr key={p.practiceId ?? p.name ?? 'unmapped'}>
                  <td>{p.name ?? 'Unmapped practice'}</td>
                  <td className={cx(s.r, s.money)}>{formatNumber(p[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isLoading && <p className={s.subtle} style={{ fontSize: 13 }}>Loading days…</p>}
      {isError && <p className={cx(s.danger)} style={{ fontSize: 13 }}>Couldn&rsquo;t load the daily breakdown.</p>}
      {!isLoading && !isError && days.length === 0 && (
        <p className={s.subtle} style={{ fontSize: 13 }}>No day in this window has a figure keyed in for this metric.</p>
      )}

      {days.length > 0 && (
        <div className={s.scrollX} style={{ maxHeight: 420 }}>
          <table className={s.table} style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Practice</th>
                <th className={s.r}>{title}</th>
                {showValue && <th className={s.r}>Value £</th>}
              </tr>
            </thead>
            <tbody>
              {days.map((l, i) => (
                <tr key={`${l.cashupDate}-${l.practiceName ?? i}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(l.cashupDate)}</td>
                  <td>{l.practiceName ?? '—'}</td>
                  <td className={cx(s.r, s.money)}>{formatNumber(l[metric])}</td>
                  {showValue && (
                    <td className={cx(s.r, s.money)}>
                      {l.txPlanValuePence > 0 ? formatPence(l.txPlanValuePence) : <span className={s.subtle}>not sent</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer}
    </DetailPanel>
  );
}

// "New leads" is a count the manager types into the cash-up — no records of its
// own. But the people usually exist in the GoHighLevel pipelines over the same
// window, so we look them up and tag each with the pipeline it came in on. The
// two counts measure different things, so they are reconciled, not forced equal.
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

  const rows = dedupeByPerson(data?.lines ?? [], false);
  const byChannel = new Map<LeadChannel, number>();
  for (const r of rows) byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + 1);
  const untracked = Math.max(0, keyedIn - rows.length);
  const unkeyed = Math.max(0, rows.length - keyedIn);

  return (
    <DetailPanel
      title="The same leads, found in GoHighLevel"
      sub="Every person who came in through a GoHighLevel pipeline over this window, tagged with the pipeline they arrived on. This is where the leads behind the keyed-in number actually live."
    >
      {isLoading && <p className={s.subtle} style={{ fontSize: 13 }}>Looking these leads up in GoHighLevel…</p>}
      {isError && <p className={s.danger} style={{ fontSize: 13 }}>Couldn&rsquo;t load the pipeline leads.</p>}

      {!isLoading && !isError && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px 24px',
              border: '1px solid var(--line)',
              background: 'var(--tint2)',
              borderRadius: 8,
              padding: 12,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            <span>
              <span className={s.subtle}>Keyed into Emergent: </span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(keyedIn)}</strong>
            </span>
            <span>
              <span className={s.subtle}>Found in GoHighLevel pipelines: </span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(rows.length)}</strong>
            </span>
            {untracked > 0 ? (
              <span className={s.subtle}>
                {formatNumber(untracked)} of the keyed-in leads have no pipeline record — phone calls, walk-ins and
                referrals never reach GoHighLevel.
              </span>
            ) : null}
            {unkeyed > 0 ? (
              <span className={s.subtle}>
                GoHighLevel has {formatNumber(unkeyed)} more than were keyed in — the daily tally is under-recording
                what the pipelines actually brought in.
              </span>
            ) : null}
          </div>

          {rows.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {CHANNEL_ORDER.filter((ch) => byChannel.has(ch)).map((ch) => (
                <span key={ch} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <PipelineTag channel={ch} />
                  <span className={s.subtle} style={{ fontSize: 12 }}>{formatNumber(byChannel.get(ch)!)}</span>
                </span>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <p className={s.subtle} style={{ fontSize: 13 }}>
              No GoHighLevel pipeline leads at all in this window for this practice — so every one of the{' '}
              {formatNumber(keyedIn)} keyed-in leads came in some other way, or the practice&rsquo;s GoHighLevel
              subaccount isn&rsquo;t linked under System &gt; Integrations.
            </p>
          ) : (
            <LeadsTable rows={rows} />
          )}
        </>
      )}
    </DetailPanel>
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

  // Emergent sends a plan COUNT every day but only sometimes a plan value.
  // Rendering that as "£0.00" reads as "42 plans worth nothing"; it means
  // "Emergent didn't tell us".
  const txValueMissing = t.txPlansGiven > 0 && t.txPlanValuePence === 0;

  return (
    <>
      <SectionCard>
        <SecHead
          n={2}
          title="Treatment & close"
          desc="What the practice proposed and what patients accepted. Keyed into Emergent by the practice each day, except Accepted, which comes from Emergent's treatment feed."
          src={{ label: 'Emergent daily push' }}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Accepted"
            value={formatNumber(t.acceptedCount)}
            note={formatPence(t.acceptedValuePence)}
            info="Treatments a patient said yes to, from Emergent's treatment feed — one record per treatment, so this is the one number here that can be opened patient by patient. Click to see them, including which ad pipeline each patient first came in on."
            onClick={() => onToggle('treatment')}
            active={active}
          />
          <Kpi
            label="Tx plans given"
            value={formatNumber(t.txPlansGiven)}
            note={txValueMissing ? 'Value not sent by Emergent' : formatPence(t.txPlanValuePence)}
            info="Treatment plans presented to patients — the number the practice manager keys into the Emergent cash-up. Emergent sends a count per day and no per-plan records, so the deepest this can go is day by day. Some practices never key the plan value, which is why the value can be blank while the count is not."
            onClick={() => onToggle('txPlans')}
            active={drill === 'txPlans'}
          />
          <Kpi
            label="New leads"
            value={formatNumber(t.newLeads)}
            note="Keyed in — click to see who they are"
            info="The practice manager's own daily tally of new enquiries, typed into the Emergent cash-up. The number has no records behind it, but the people usually do — click through and we look them up in the GoHighLevel pipelines for the same window. Emergent's tally also counts phone calls, walk-ins and referrals, which never reach GoHighLevel, so the two counts are reconciled rather than forced to match."
            onClick={() => onToggle('newLeads')}
            active={drill === 'newLeads'}
          />
          <Kpi
            label="Attended"
            value={formatNumber(t.attended)}
            note={t.attended === 0 ? 'Not being keyed in' : (closeRate(t.acceptedCount, t.txPlansGiven) ?? undefined)}
            info="Patients who attended their appointment, keyed into the Emergent cash-up each day. It reads zero because no practice is filling this field in — a data-entry gap in Emergent, not a day with no patients."
            onClick={() => onToggle('attended')}
            active={drill === 'attended'}
          />
        </div>
        {t.byPractice.length > 0 ? (
          <div className={s.scrollX} style={{ marginTop: 16 }}>
            <table className={s.table} style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Practice</th>
                  <th className={s.r}>Accepted</th>
                  <th className={s.r}>Accepted value £</th>
                  <th className={s.r}>Tx plans given</th>
                  <th className={s.r}>Tx plan value £</th>
                  <th className={s.r}>New leads</th>
                  <th className={s.r}>Attended</th>
                </tr>
              </thead>
              <tbody>
                {t.byPractice.map((p) => (
                  <tr key={p.practiceId ?? p.name ?? 'unmapped'}>
                    <td>{p.name ?? 'Unmapped practice'}</td>
                    <td className={cx(s.r, s.money)}>{formatNumber(p.acceptedCount)}</td>
                    <td className={cx(s.r, s.money)}>{formatPence(p.acceptedValuePence)}</td>
                    <td className={cx(s.r, s.money)}>{formatNumber(p.txPlansGiven)}</td>
                    <td className={cx(s.r, s.money)}>{formatPence(p.txPlanValuePence)}</td>
                    <td className={cx(s.r, s.money)}>{formatNumber(p.newLeads)}</td>
                    <td className={cx(s.r, s.money)}>{formatNumber(p.attended)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      {active && (
        <DetailPanel
          title="Accepted treatments"
          sub="Every treatment accepted in this window. 'Came in on' is the GoHighLevel pipeline the patient first arrived through — the link between an ad and the treatment it paid for."
        >
          {isLoading && <p className={s.subtle} style={{ fontSize: 13 }}>Loading accepted treatments…</p>}
          {isError && <p className={s.danger} style={{ fontSize: 13 }}>Couldn&rsquo;t load accepted treatments.</p>}
          {!isLoading && !isError && (detail?.lines.length ?? 0) === 0 && (
            <p className={s.subtle} style={{ fontSize: 13 }}>No accepted treatments in this window.</p>
          )}
          {(detail?.lines.length ?? 0) > 0 && (
            <div className={s.scrollX} style={{ maxHeight: 480 }}>
              <table className={s.table} style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    {['Date', 'Patient', 'Treatment', 'Practice', 'Came in on', 'Value'].map((h, i) => (
                      <th key={h} className={i === 5 ? s.r : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail!.lines.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(l.acceptedDate)}</td>
                      <td>{l.patientName ?? '—'}</td>
                      <td>{l.treatmentName ?? '—'}</td>
                      <td>{l.practiceName ?? '—'}</td>
                      <td>
                        {l.leadChannel ? (
                          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                            <PipelineTag channel={l.leadChannel} pipelineName={l.leadPipelineName} />
                            <span className={s.subtle} style={{ fontSize: 12 }}>{l.leadPipelineName ?? '—'}</span>
                          </span>
                        ) : (
                          <span className={s.subtle} title="No GoHighLevel lead matched this patient by phone, email or name — a walk-in, a referral, or a lead we can't tie back.">
                            Not from a tracked pipeline
                          </span>
                        )}
                      </td>
                      <td className={cx(s.r, s.money)}>{formatPence(l.valuePence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(detail?.lines.length ?? 0) === (detail?.limit ?? 0) && (
            <p className={s.footNote}>Showing the first {detail?.limit} — narrow the period or practice to see fewer at once.</p>
          )}
        </DetailPanel>
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
              <p className={s.footNote}>
                Plan value shows as &ldquo;not sent&rdquo; because Emergent isn&rsquo;t sending a value with these plans —
                the count is real, the £0 was not. Ask the practice to key the plan value into the cash-up and it will
                appear here.
              </p>
            ) : undefined
          }
        />
      )}

      {drill === 'newLeads' && <PipelineLeadsForWindow keyedIn={t.newLeads} practiceId={practiceId} win={win} />}

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
              <p className={s.footNote}>
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
  const flaggedGroup = Math.abs(c.variancePence) > 5000;
  const { data: detail, isLoading, isError } = useCockpitCashupDays(active, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 200,
  });

  return (
    <>
      <SectionCard>
        <SecHead
          n={4}
          title="Cash up — till reconciliation"
          desc="System revenue vs the till/terminal total — flags same-day gaps."
          src={{ label: 'Emergent daily push' }}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Cash taken £" value={formatPence(c.collectedPence)} />
          <Kpi label="Till detail £" value={formatPence(c.detailPence)} />
          <Kpi
            label="Variance £"
            value={formatPence(c.variancePence)}
            tag={flaggedGroup ? { text: 'Over £50 — check today', tone: 'neg' } : { text: 'Within tolerance', tone: 'pos' }}
            onClick={onToggle}
            active={active}
          />
        </div>
        {c.byPractice.length > 0 ? (
          <div className={s.scrollX} style={{ marginTop: 16 }}>
            <table className={s.table} style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Practice</th>
                  <th className={s.r}>Cash taken £</th>
                  <th className={s.r}>Till detail £</th>
                  <th className={s.r}>Variance £</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {c.byPractice.map((p) => {
                  const flagged = Math.abs(p.variancePence) > 5000;
                  return (
                    <tr key={p.practiceId ?? p.name ?? 'unmapped'}>
                      <td>{p.name ?? 'Unmapped practice'}</td>
                      <td className={cx(s.r, s.money)}>{formatPence(p.collectedPence)}</td>
                      <td className={cx(s.r, s.money)}>{formatPence(p.detailPence)}</td>
                      <td className={cx(s.r, s.money)}>{formatPence(p.variancePence)}</td>
                      <td>
                        <span className={cx(s.st, flagged ? s.stBelow : s.stAbove)}>{flagged ? 'Check' : 'OK'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      {active && (
        <DetailPanel title="Cash-up days" sub="Every day's till reconciliation in this window, most recent first — flags where the variance is over £50.">
          {isLoading && <p className={s.subtle} style={{ fontSize: 13 }}>Loading cash-up days…</p>}
          {isError && <p className={s.danger} style={{ fontSize: 13 }}>Couldn&rsquo;t load cash-up days.</p>}
          {!isLoading && !isError && (detail?.lines.length ?? 0) === 0 && (
            <p className={s.subtle} style={{ fontSize: 13 }}>No cash-up rows in this window.</p>
          )}
          {(detail?.lines.length ?? 0) > 0 && (
            <div className={s.scrollX} style={{ maxHeight: 480 }}>
              <table className={s.table} style={{ minWidth: 680 }}>
                <thead>
                  <tr>
                    {['Date', 'Practice', 'Cash taken £', 'Till detail £', 'Variance £', 'Refunds'].map((h, i) => (
                      <th key={h} className={i >= 2 ? s.r : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...detail!.lines]
                    .sort((a, b) => (a.cashupDate < b.cashupDate ? 1 : a.cashupDate > b.cashupDate ? -1 : 0))
                    .map((l, i) => {
                      const flagged = Math.abs(l.variancePence) > 5000;
                      return (
                        <tr key={`${l.cashupDate}-${l.practiceName ?? i}`}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(l.cashupDate)}</td>
                          <td>{l.practiceName ?? '—'}</td>
                          <td className={cx(s.r, s.money)}>{formatPence(l.cashTakenPence)}</td>
                          <td className={cx(s.r, s.money)}>{formatPence(l.detailPence)}</td>
                          <td className={cx(s.r, s.money, flagged && s.danger)}>{formatPence(l.variancePence)}</td>
                          <td className={cx(s.r, s.money)}>{l.refunds?.length ?? 0}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </DetailPanel>
      )}
    </>
  );
}

function groupTotal(lines: PLLine[]): number {
  return lines.reduce((sum, l) => sum + l.amountPence, 0);
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
    return <p className={s.footNote}>No itemised P&amp;L lines from Emergent for this month.</p>;
  }

  return (
    <div className={s.scrollX} style={{ marginTop: 8 }}>
      <table className={s.table} style={{ minWidth: 420 }}>
        <tbody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <Fragment key={g.key}>
                <tr className={s.rowClickable} onClick={() => toggleRow(g.key)}>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 12, marginRight: 4, fontSize: 10, color: 'var(--muted)' }} aria-hidden>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {g.label}
                    <span className={s.subtle} style={{ marginLeft: 4, fontSize: 11 }}>({g.lines.length})</span>
                  </td>
                  <td className={cx(s.r, s.money)}>{formatPence(groupTotal(g.lines))}</td>
                </tr>
                {isOpen &&
                  g.lines.map((l) => (
                    <tr key={`${g.key}:${l.name}`} style={{ background: 'var(--tint2)' }}>
                      <td className={s.subtle} style={{ paddingLeft: 28 }} title={noteByName.get(l.name)}>
                        {l.name}
                        {noteByName.has(l.name) ? <span className={s.subtle} style={{ marginLeft: 4, fontSize: 10 }}>note</span> : null}
                      </td>
                      <td className={cx(s.r, s.money, s.subtle)}>{formatPence(l.amountPence)}</td>
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
    <SectionCard>
      <SecHead
        n={5}
        title={`Monthly revenue & P&L — ${periodMonthLabel(m.periodMonth)}`}
        desc="The latest month Emergent has sent a P&L for."
        src={{ label: 'Emergent P&L push + Xero' }}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Revenue" value={formatPence(m.revenuePence)} />
        <Kpi
          label="Net profit"
          value={formatPence(m.netProfitPence)}
          tag={m.marginPct === null ? undefined : { text: `${m.marginPct.toFixed(1)}% margin`, tone: m.netProfitPence >= 0 ? 'pos' : 'neg' }}
        />
        <Kpi
          label="Clinician fees"
          value={formatPence(m.clinicianFeesPence)}
          note={m.revenuePence > 0 ? `${((m.clinicianFeesPence / m.revenuePence) * 100).toFixed(1)}% of revenue` : undefined}
        />
        <Kpi label="Lab & overhead" value={formatPence(m.labOverheadPence)} note="Lab, materials, rent, staff, marketing" />
      </div>
      {/* Gated on revenuePence > 0 deliberately: a zero-revenue month means
          Emergent hasn't sent a P&L feed for this org/period at all (nothing to
          reconcile), not a reconciliation failure. */}
      {m.residualPence !== 0 && m.revenuePence > 0 ? (
        <p className={s.footNote}>
          Emergent&rsquo;s P&amp;L lines don&rsquo;t reconcile to the net profit it sent &mdash;{' '}
          {formatPence(Math.abs(m.residualPence))} is {m.residualPence > 0 ? 'unaccounted for' : 'double-counted'}. The
          cards above show what Emergent actually sent, not a balanced figure.
        </p>
      ) : null}
      {m.byBusiness.length > 0 ? (
        <div className={s.scrollX} style={{ marginTop: 16 }}>
          <table className={s.table} style={{ minWidth: 420 }}>
            <thead>
              <tr>
                <th>Business</th>
                <th className={s.r}>Revenue £</th>
                <th className={s.r}>Net profit £</th>
              </tr>
            </thead>
            <tbody>
              {m.byBusiness.map((b) => (
                <tr key={b.practiceId ?? b.name ?? 'unmapped'}>
                  <td>{b.name ?? 'Unmapped practice'}</td>
                  <td className={cx(s.r, s.money)}>{formatPence(b.revenuePence)}</td>
                  <td className={cx(s.r, s.money)}>{formatPence(b.netProfitPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={s.footNote}>No monthly P&amp;L data from Emergent yet for this org.</p>
      )}

      <div style={{ marginTop: 20 }}>
        <h3 className={s.lbl} style={{ display: 'block' }}>Line items</h3>
        <MonthlyLineItemsPanel data={data} />
      </div>
    </SectionCard>
  );
}

export default function CockpitScreen() {
  const { scope, win } = useScopePeriod();
  const practiceId = scope !== 'all' ? scope : undefined;
  const { data, isLoading, isError } = useCockpit({ since: win.since, until: win.until, scope });
  const [drill, setDrill] = useState<Drill>(null);
  const toggle = (m: Exclude<Drill, null>) => setDrill((cur) => (cur === m ? null : m));

  // The scope bar carries only the practice id; the payload names it. Either
  // feed can name it — a practice may have Emergent cash-up but no GoHighLevel
  // subaccount, or the other way round.
  const practiceName = practiceId
    ? data?.treatment.byPractice.find((p) => p.practiceId === practiceId)?.name ??
      data?.leadRoi.channels.find((c) => c.practiceId === practiceId)?.practiceName ??
      null
    : null;

  return (
    <div className={s.shell}>
      <div className={s.wrap}>
        <div className={s.topbar}>
          <div className={s.h1}>
            Daily Command Cockpit
          </div>
          <div className={s.sub}>
            One-page daily snapshot: cash taken, treatment closed, lead performance, till reconciliation, profit vs
            breakeven and revenue by line.
          </div>
          <div style={{ marginTop: 14 }}>
            <ScopePeriodBar />
          </div>
          <div className={s.legend}>
            <span><span className={s.swatch} style={{ background: 'var(--pos)' }} />above breakeven</span>
            <span><span className={s.swatch} style={{ background: 'var(--neg)' }} />below breakeven</span>
            <span>Money in £ pence, integer throughout.</span>
          </div>
        </div>

        {isLoading ? (
          <div className={s.stateBox}>Loading…</div>
        ) : isError ? (
          <div className={cx(s.stateBox, s.errorBox)}>Could not load the cockpit data. Retry shortly.</div>
        ) : !data ? (
          <div className={s.stateBox}>No data for this window.</div>
        ) : (
          <>
            <RevenueSection data={data} practiceId={practiceId} drill={drill} onToggle={() => toggle('revenue')} />
            <TreatmentSection data={data} practiceId={practiceId} win={win} drill={drill} onToggle={toggle} />
            <LeadPerformanceChart channels={data.leadRoi.channels} />
            <LeadComparison data={data.leadRoi} practiceId={practiceId} practiceName={practiceName} win={win} />
            <CashUpSection data={data} practiceId={practiceId} win={win} drill={drill} onToggle={() => toggle('cashup')} />
            <BreakevenSection data={data.breakeven} />
            <MonthlySection data={data} />
            <RevenueByLine lines={data.revenueByLine} />
            <p className={s.lastUpdated}>Last updated {formatDate(data.updatedAt)}</p>
          </>
        )}
      </div>
    </div>
  );
}

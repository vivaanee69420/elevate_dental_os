'use client';

// Board Report Generator (GM Intelligence OS / DentaCFO gap module, Phase 2).
// An AI-written board pack from the group's LIVE numbers — executive summary +
// RAG-coded priorities, computed from the same rollups as Business Hub +
// Revenue Leakage. Export to PDF (browser print), email it now, or schedule
// recurring delivery (daily / weekly / monthly).
//
// WIRED: POST /api/analytics/board-report (generate, token cost — button only),
// POST .../email (SES send, falls back to a mailto draft when SES is off),
// GET/POST/PATCH/DELETE .../schedules. Money is integer PENCE.

import { useState } from 'react';
import { PageHeader, KpiTile, EmptyState, SkeletonKpiRow } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill } from './os-ui';
import { useMe } from '@/hooks/useMe';
import {
  useGenerateBoardReport,
  useEmailBoardReport,
  useBoardSchedules,
  useCreateBoardSchedule,
  useUpdateBoardSchedule,
  useDeleteBoardSchedule,
  useTurnoverSource,
  useSaveTurnoverSource,
} from '../board-report-hooks';
import type { BoardReport, Rag, ScheduleFrequency, TurnoverSource } from '../board-report-api';

const gbp = (p: number) => formatPence(p);

const RAG_DOT: Record<Rag, string> = {
  red: 'bg-danger',
  amber: 'bg-[#c6a253]',
  green: 'bg-success',
};

const FREQ_LABEL: Record<ScheduleFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

const TURNOVER_OPTIONS: { value: TurnoverSource; label: string }[] = [
  { value: 'dentally', label: 'Dentally' },
  { value: 'quickbooks', label: 'QuickBooks' },
  { value: 'both', label: 'Both' },
];

// Owner-editable group-turnover source. Dentally = clinical production
// (invoice_items); QuickBooks = QBO P&L revenue (group-level only); Both sums
// them (double-counts when an org runs both over the same revenue).
function TurnoverSourceControl({ onChanged }: { onChanged: () => void }) {
  const me = useMe();
  const { data } = useTurnoverSource();
  const save = useSaveTurnoverSource();
  const isOwner = me.data?.role === 'owner';
  const current = data?.turnoverSource ?? 'dentally';
  if (!isOwner) return null;

  const pick = (value: TurnoverSource) => {
    if (value === current || save.isPending) return;
    save.mutate(value, { onSuccess: onChanged });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 print:hidden">
      <span className="text-[12.5px] text-ink-muted">Group turnover source</span>
      <div className="inline-flex rounded-md border border-line overflow-hidden">
        {TURNOVER_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => pick(o.value)}
            disabled={save.isPending}
            className={`text-[12.5px] px-3 py-1 disabled:opacity-50 ${
              current === o.value ? 'bg-accent text-white' : 'hover:bg-surface-2'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-[11.5px] text-ink-muted">
        Dentally = clinical production · QuickBooks = QBO P&amp;L (group-level) · Both sums them
      </span>
    </div>
  );
}

export default function BoardReportScreen() {
  const gen = useGenerateBoardReport();
  const report = gen.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Board Report Generator"
        subtitle="An AI-written board pack from your live numbers — executive summary, RAG priorities, PDF export and recurring delivery."
      />
      <ScopePeriodBar dentallyOnly />

      <Panel>
        <PanelHead
          title="Generate the board pack"
          sub="Built live from group turnover, margin, conversion, banked cash and recoverable leakage for the selected scope and period."
          right={
            <div className="flex items-center gap-2 print:hidden">
              {report && (
                <button onClick={() => window.print()} className="text-[13px] px-3 py-1.5 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50">
                  Export PDF
                </button>
              )}
              <button onClick={() => gen.mutate()} disabled={gen.isPending} className="btn-primary text-[13px] py-1.5 disabled:opacity-50">
                {gen.isPending ? 'Generating…' : report ? 'Regenerate' : 'Generate report'}
              </button>
            </div>
          }
        />
        <TurnoverSourceControl onChanged={() => { if (report) gen.mutate(); }} />
        {gen.isError && (
          <EmptyState message={`Couldn't generate: ${gen.error?.message ?? 'unknown error'}`} />
        )}
        {gen.isPending && <SkeletonKpiRow count={4} />}
        {!gen.isPending && !report && !gen.isError && (
          <EmptyState message="Pick a scope and period, then Generate report. The pack is written from your live data on demand (it is not produced on page load)." />
        )}
        {report && report.empty && (
          <EmptyState message="No turnover, appointments or leads for this scope/period — nothing to report on. Pick a window with activity or sync Dentally." />
        )}
        {report && !report.empty && <BoardPack report={report} />}
      </Panel>

      {report && !report.empty && <DeliveryPanel report={report} />}
    </div>
  );
}

// Per-card data lineage — which integration feeds populate each headline metric.
function SourceCaption({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="text-[11px] text-ink-muted leading-tight px-1">Source: {text}</p>;
}

function BoardPack({ report }: { report: BoardReport }) {
  const m = report.metrics;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1">
          <KpiTile
            label="Group turnover"
            value={gbp(m.revenuePence)}
            delta={`~${gbp(m.revenueAnnualisedPence)}/yr`}
          />
          <SourceCaption text={m.sources?.turnover} />
        </div>
        <div className="flex flex-col gap-1">
          <KpiTile
            label="Net margin"
            value={m.marginPct > 0 ? `${m.marginPct}%` : '—'}
            delta={m.marginPct > 0 ? `EBITDA ${gbp(m.ebitdaWindowPence)}` : 'Connect Xero/QuickBooks'}
            deltaTone={m.marginPct > 0 ? 'up' : 'muted'}
          />
          <SourceCaption text={m.sources?.margin} />
        </div>
        <div className="flex flex-col gap-1">
          <KpiTile
            label="Recoverable leakage"
            value={`${gbp(m.leakageAnnualPence)}/yr`}
            delta={m.leakagePctOfRevenue ? `${m.leakagePctOfRevenue}% of turnover` : `${gbp(m.leakageMonthlyPence)}/mo`}
            deltaTone="down"
          />
          <SourceCaption text={m.sources?.leakage} />
        </div>
        <div className="flex flex-col gap-1">
          <KpiTile
            label="Conversion"
            value={`${m.conversionRate}%`}
            delta={`${m.leads.toLocaleString('en-GB')} leads · ${gbp(m.cashCollectedPence)} banked`}
          />
          <SourceCaption text={m.sources?.conversion} />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">Executive summary</h4>
          <Pill tone={report.basis === 'ai' ? 'good' : 'info'}>
            {report.basis === 'ai' ? 'AI-written' : 'Data-driven'}
          </Pill>
        </div>
        <ul className="list-disc pl-5 flex flex-col gap-2 text-[13px] leading-relaxed">
          {report.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold mb-2">Priorities</h4>
        <div className="flex flex-col">
          {report.priorities.map((p, i) => (
            <div key={i} className="flex items-start gap-3 py-2 border-b border-line last:border-0">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-none ${RAG_DOT[p.rag]}`} />
              <span className="text-[12.5px] leading-relaxed">{p.text}</span>
            </div>
          ))}
        </div>
      </div>

      <NoteFoot>
        Generated {report.generatedAt.slice(0, 10)} for {report.period.label}. Figures are computed live from
        your Dentally / Xero / GoHighLevel data — recall and lapsed-patient pools are modelled shares until
        patient-level cohorts are wired. Export PDF uses your browser print dialog.
      </NoteFoot>
    </div>
  );
}

function DeliveryPanel({ report }: { report: BoardReport }) {
  const email = useEmailBoardReport();
  const schedules = useBoardSchedules();
  const createSched = useCreateBoardSchedule();
  const updateSched = useUpdateBoardSchedule();
  const deleteSched = useDeleteBoardSchedule();

  const [recipient, setRecipient] = useState('');
  const [freq, setFreq] = useState<ScheduleFrequency>('weekly');
  const [touched, setTouched] = useState(false);

  const recipientValid = validEmail(recipient);

  const sendNow = () => {
    setTouched(true);
    if (!recipientValid) return;
    email.mutate(recipient);
  };

  const schedule = () => {
    setTouched(true);
    if (!recipientValid) return;
    createSched.mutate({ frequency: freq, recipient_email: recipient });
  };

  // Fallback when SES is unconfigured — open a pre-filled mail draft.
  const mailtoDraft = () => {
    const subject = `Board Report — ${report.period.label}`;
    const lines = [
      `BOARD REPORT — ${report.period.label}`,
      '',
      'EXECUTIVE SUMMARY',
      ...report.summary.map((s) => `• ${s}`),
      '',
      'PRIORITIES',
      ...report.priorities.map((p) => `• ${p.text}`),
      '',
      `Recoverable leakage identified: ${gbp(report.metrics.leakageAnnualPence)}/yr.`,
      '',
      '— Generated by Elevate Dental OS',
    ];
    window.location.href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
  };

  const sent = email.data?.delivery;

  return (
    <Panel className="print:hidden">
      <PanelHead title="Delivery & schedule" sub="Email the pack now, or schedule recurring delivery to a board member." />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={freq} onChange={(e) => setFreq(e.target.value as ScheduleFrequency)} className="input text-[13px]">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="board@practice.com"
          className={`input text-[13px] flex-1 min-w-[180px] ${touched && !recipientValid ? 'border-danger' : ''}`}
        />
        <button onClick={schedule} disabled={createSched.isPending} className="text-[13px] px-3 py-1.5 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50">
          {createSched.isPending ? 'Scheduling…' : '+ Schedule'}
        </button>
        <button onClick={sendNow} disabled={email.isPending} className="btn-primary text-[13px] py-1.5 disabled:opacity-50">
          {email.isPending ? 'Sending…' : 'Send now'}
        </button>
      </div>

      {touched && !recipientValid && (
        <div className="text-xs text-danger mb-2">Enter a valid email address.</div>
      )}
      {sent && sent.sent && (
        <div className="text-xs text-success mb-2">Sent to {sent.to}.</div>
      )}
      {sent && !sent.sent && (
        <div className="text-xs text-ink-muted mb-2">
          Email service not configured in this environment.{' '}
          <button onClick={mailtoDraft} className="underline text-accent">Open a draft instead</button>.
        </div>
      )}

      <div className="mt-2">
        {schedules.isLoading ? (
          <div className="text-[12.5px] text-ink-muted py-1.5">Loading schedules…</div>
        ) : schedules.data && schedules.data.length > 0 ? (
          <div className="flex flex-col">
            {schedules.data.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0 text-[12.5px]">
                <span>
                  <b>{FREQ_LABEL[s.frequency]}</b> → <span className="text-accent">{s.recipient_email}</span>
                  {!s.active && <span className="text-ink-muted"> · paused</span>}
                  {s.last_sent_at && <span className="text-ink-muted"> · last sent {s.last_sent_at.slice(0, 10)}</span>}
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => updateSched.mutate({ id: s.id, fields: { active: !s.active } })}
                    className="text-[12px] px-2.5 py-1 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50"
                  >
                    {s.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => deleteSched.mutate(s.id)} className="text-[12px] px-2.5 py-1 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50 text-danger">
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-ink-muted py-1.5">
            No scheduled reports yet — pick a cadence and recipient above, then + Schedule.
          </div>
        )}
      </div>

      <NoteFoot>
        Scheduled packs are generated fresh from your live data at send time and emailed automatically
        (daily 06:30, weekly &gt; 7 days, monthly &gt; 28 days). Send now and scheduled delivery use the same
        SES sender; where email is unavailable, a draft opens in your mail client.
      </NoteFoot>
    </Panel>
  );
}

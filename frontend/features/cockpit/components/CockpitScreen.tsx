'use client';
// Daily Command Cockpit — one page pulling together yesterday's numbers:
// cash taken, treatment accepted/closed, Google vs Facebook lead performance,
// till reconciliation, and the latest monthly P&L Emergent has sent. Mirrors
// the GM_Dental_Daily_Cockpit reference layout but renders light (rule 1).
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { formatPence, formatNumber, formatDate } from '@/lib/format';
import { useCockpit } from '../hooks';
import { LeadComparison } from './LeadComparison';
import type { CockpitResponse } from '../api';

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

function RevenueSection({ data }: { data: CockpitResponse }) {
  const rows = data.revenue.byPractice;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <SectionHeading n={1} title="Revenue — cash taken (Emergent)" />
      <Card label="Cash taken (Emergent) in period" value={formatPence(data.revenue.collectedPence)} />
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
  );
}

function TreatmentSection({ data }: { data: CockpitResponse }) {
  const t = data.treatment;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <SectionHeading n={2} title="Treatment &amp; close" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Accepted" value={formatNumber(t.acceptedCount)} sub={formatPence(t.acceptedValuePence)} />
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
  );
}

function CashUpSection({ data }: { data: CockpitResponse }) {
  const c = data.cashUp;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <SectionHeading n={4} title="Cash up — till reconciliation" note="Flags where the till/terminal total differs from system revenue." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Cash taken £" value={formatPence(c.collectedPence)} />
        <Card label="Till detail £" value={formatPence(c.detailPence)} />
        <Card
          label="Variance £"
          value={formatPence(c.variancePence)}
          sub={Math.abs(c.variancePence) > 5000 ? 'Over £50 — check today' : 'Within tolerance'}
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
    </section>
  );
}

export default function CockpitScreen() {
  const { win } = useScopePeriod();
  const { data, isLoading, isError } = useCockpit({ since: win.since, until: win.until });

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Daily Command Cockpit</h1>
        <p className="text-[13px] text-slate-500">
          One-page daily snapshot: cash taken, treatment closed, lead performance, and till reconciliation.
        </p>
      </div>

      <ScopePeriodBar hideScope />

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
          <RevenueSection data={data} />
          <TreatmentSection data={data} />
          <LeadComparison data={data.leadRoi} />
          <CashUpSection data={data} />
          <MonthlySection data={data} />
          <p className="text-right text-[11px] text-slate-400">Last updated {formatDate(data.updatedAt)}</p>
        </div>
      )}
    </div>
  );
}

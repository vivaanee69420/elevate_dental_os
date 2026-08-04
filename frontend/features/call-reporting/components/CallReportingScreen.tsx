'use client';

import { useState } from 'react';
import Link from 'next/link';
import PracticeTabs from '@/features/practices/PracticeTabs';
import { useCallReportingDashboard } from '../hooks';

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function CallReportingScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const { data, isLoading, isError } = useCallReportingDashboard(date, practiceId ?? undefined);

  const fieldCls =
    'text-[13px] border border-slate-200 bg-white text-slate-900 px-3 py-2 rounded-xl shadow-sm cursor-pointer';

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Call Reporting</h1>
        <p className="text-[13px] text-slate-500">
          Lead response speed by practice, synced from your Google Sheet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PracticeTabs value={practiceId} onChange={setPracticeId} />
        <input
          type="date"
          className={fieldCls}
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value || todayISO())}
        />
        {date !== todayISO() && (
          <button
            className="text-[13px] text-slate-500 underline-offset-2 hover:underline"
            onClick={() => setDate(todayISO())}
          >
            Today
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700">
          Could not load Call Reporting. Try refreshing the page.
        </div>
      ) : !data?.configured ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          <div className="font-medium text-slate-900">Not set up yet</div>
          <p className="mt-1 text-[13px]">
            Connect Google Sheets and map your lead sheet columns to power this dashboard.
          </p>
          <Link
            href="/integrations"
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-medium text-white"
          >
            Go to Integrations
          </Link>
        </div>
      ) : (
        <>
          {data.sourceStatus === 'failed' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
              The last sheet sync failed — figures below are from the last successful sync.
              Check the Google Sheets panel on the Integrations page.
            </div>
          )}
          {data.unmapped > 0 && !practiceId && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
              {data.unmapped} lead{data.unmapped === 1 ? '' : 's'} today {data.unmapped === 1 ? 'is' : 'are'} not
              mapped to a practice.{' '}
              <Link href="/integrations" className="font-medium underline underline-offset-2">
                Map sheet practices
              </Link>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Total Leads" value={String(data.totalLeads)} sub={data.date} />
            <Card label="Called Within 3 Min" value={String(data.calledWithin3m)} />
            <Card label="Called Within 10 Min" value={String(data.calledWithin10m)} />
            <Card label="Efficiency % (Called < 3m)" value={`${data.efficiencyPct}%`} />
            <Card label="Leads in Pipeline" value={String(data.leadsInPipeline)} />
            <Card label="Not Called" value={String(data.notCalled)} />
            <Card label="Facebook Ads Leads" value={String(data.facebookLeads)} />
            <Card label="Google Ads Leads" value={String(data.googleLeads)} />
          </div>

          <p className="text-[12px] text-slate-400">
            {data.lastSyncedAt
              ? `Last synced ${new Date(data.lastSyncedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}`
              : 'Not synced yet'}
            {!data.topUpOk ? ' · live refresh unavailable, showing cached data' : ''}
          </p>
        </>
      )}
    </div>
  );
}

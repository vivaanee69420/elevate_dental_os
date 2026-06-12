'use client';
import { useState } from 'react';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useGhlDashboard } from '../hooks';
import { GhlKpiCards } from './GhlKpiCards';
import { PipelineByStage } from './PipelineByStage';
import { ConversationActivity } from './ConversationActivity';
import { AppointmentsPanel } from './AppointmentsPanel';
import { SyncHealthTable } from './SyncHealthTable';
import { SubaccountFilterBar } from './SubaccountFilterBar';

export default function GhlDashboardScreen() {
  const { win } = useScopePeriod();
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data, isLoading, isError } = useGhlDashboard({
    accountId,
    since: win.since,
    until: win.until,
  });

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">GoHighLevel Dashboard</h1>
        <p className="text-[13px] text-slate-500">Consolidated across all connected subaccounts.</p>
      </div>

      {data && data.perAccount.length > 0 ? (
        <SubaccountFilterBar
          accounts={data.perAccount}
          selected={accountId}
          onSelect={setAccountId}
        />
      ) : null}
      <ScopePeriodBar hideScope />

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading...</div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700">Could not load GHL data. Retry shortly.</div>
      ) : !data || data.totals.sync.accounts === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          No GoHighLevel subaccounts connected. Connect one under System &gt; Integrations.
        </div>
      ) : (
        <>
          <GhlKpiCards totals={data.totals} />
          <PipelineByStage stages={data.totals.leads.byStage} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ConversationActivity conversations={data.totals.conversations} />
            <AppointmentsPanel appointments={data.totals.appointments} />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Subaccount breakdown</h2>
            <SyncHealthTable accounts={data.perAccount} />
          </div>
        </>
      )}
    </div>
  );
}

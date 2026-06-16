'use client';

// Revenue Leakage (GM Intelligence OS). "Money left on the table" this window,
// annualised — five recoverable pools with a tunable recoverable-rate each, and
// a one-click "＋ Task" that pushes a recovery job into the live Task Manager.
//
// WIRED: GET /api/analytics/leakage (scope/period + rate reactive). Real settled
// turnover, FTA no-shows, treatment-plan value and banked receipts. recall +
// lapsed are modelled shares of revenue until patient-level Dentally cohorts
// land. Money is integer PENCE. "＋ Task" is Owner-only (POST /api/tasks 403s
// otherwise) — the button surfaces the error rather than hiding.

import { useState } from 'react';
import { PageHeader, KpiTile, EmptyState, SkeletonKpiRow, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill } from './os-ui';
import { useLeakage } from '../leakage-hooks';
import type { Leakage, LeakageLine, LeakageRates } from '../leakage-api';
import { createTask } from '@/features/overview/tasks-api';

const gbp = (p: number) => formatPence(p);

const RATE_LABELS: Record<keyof LeakageRates, string> = {
  plans: 'Plan recovery',
  fta: 'FTA recoverable',
  recall: 'Recall recoverable',
  lapsed: 'Reactivation',
  collect: 'Collections recoverable',
};

export default function RevenueLeakageScreen() {
  // Local rate overrides (0-100). Empty until the user tunes — the API then
  // returns pools scaled to their reality. Defaults live server-side.
  const [rates, setRates] = useState<Partial<LeakageRates>>({});
  const { data, isLoading, isError, error } = useLeakage(
    Object.keys(rates).length ? rates : undefined,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Revenue Leakage"
        subtitle="The money left on the table this period — what it is, who owns the fix, and the recoverable value. Tune the recoverable rates to your reality."
      />
      <ScopePeriodBar dentallyOnly />

      {isError ? (
        <Panel><EmptyState message={`Couldn't load leakage: ${(error as Error)?.message ?? 'unknown error'}`} /></Panel>
      ) : isLoading ? (
        <>
          <SkeletonKpiRow count={3} />
          <SkeletonTable rows={5} cols={3} />
        </>
      ) : !data || data.inputs.revenuePence === 0 ? (
        <Panel>
          <PanelHead title="Revenue Leakage" sub="Real turnover, FTA, plans and receipts." />
          <EmptyState message="No settled turnover for this scope/period, so there is nothing to model leakage against. Pick a window with activity or sync Dentally." />
        </Panel>
      ) : (
        <LeakageBody data={data} rates={rates} setRates={setRates} />
      )}
    </div>
  );
}

function LeakageBody({
  data,
  rates,
  setRates,
}: {
  data: Leakage;
  rates: Partial<LeakageRates>;
  setRates: (r: Partial<LeakageRates>) => void;
}) {
  const biggest = data.lines[0];
  return (
    <>
      {/* KPI strip */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <KpiTile
          label="Recoverable / year"
          value={gbp(data.annualTotalPence)}
          delta={`${gbp(data.monthlyTotalPence)}/mo across all sites`}
          deltaTone="down"
        />
        <KpiTile
          label="As % of turnover"
          value={`${data.asPctOfRevenue}%`}
          delta="of window turnover"
        />
        <KpiTile
          label="Biggest single leak"
          value={biggest ? biggest.label : '—'}
          delta={biggest ? `${gbp(biggest.annualPence)}/yr` : ''}
        />
      </div>

      <Panel>
        <PanelHead
          title="Tune the recoverable rates"
          sub="Each rate is the share of that leak you realistically claw back. Pools are modelled from acceptance, FTA, recall and collection gaps in your data."
          right={<Pill tone="info">{data.windowDays}-day window</Pill>}
        />
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 mt-2">
          {(Object.keys(RATE_LABELS) as (keyof LeakageRates)[]).map((k) => {
            const val = rates[k] ?? data.rates[k];
            return (
              <label key={k} className="flex items-center gap-3 text-[13px]">
                <span className="w-40 text-ink-muted">{RATE_LABELS[k]}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={val}
                  onChange={(e) => setRates({ ...rates, [k]: Number(e.target.value) })}
                  className="flex-1 accent-brand"
                />
                <span className="w-10 text-right tabular-nums font-semibold">{val}%</span>
              </label>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Where the money leaks" sub="Annualised from the selected window. ＋ Task pushes a recovery job into the Task Manager (Owner only)." />
        <div className="flex flex-col divide-y divide-line">
          {data.lines.map((l) => (
            <LeakRow key={l.key} line={l} />
          ))}
        </div>
        <NoteFoot>
          Recall and reactivation pools are modelled shares of revenue — wire Dentally for patient-level
          exact figures. FTA rate this window: {data.ftaRatePct}%.
        </NoteFoot>
      </Panel>
    </>
  );
}

function LeakRow({ line }: { line: LeakageLine }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function addTask() {
    setState('saving');
    setMsg('');
    try {
      await createTask({
        title: `Recover: ${line.label}`,
        description: `${line.sub}. Recoverable value ~${gbp(line.annualPence)}/yr. Owner: ${line.owner}.`,
        priority: 'high',
      });
      setState('done');
    } catch (e) {
      setState('error');
      setMsg((e as Error)?.message ?? 'Failed');
    }
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1">
        <div className="text-[13.5px] font-semibold text-ink">{line.label}</div>
        <div className="text-[12px] text-ink-muted">{line.sub} · owner: {line.owner}</div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-semibold tabular-nums text-danger">{gbp(line.annualPence)}</div>
        <div className="text-[11px] text-ink-muted">{gbp(line.monthlyPence)}/mo</div>
      </div>
      <button
        onClick={addTask}
        disabled={state === 'saving' || state === 'done'}
        className="text-[12px] px-2.5 py-1 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50"
        title={state === 'error' ? msg : 'Create a recovery task'}
      >
        {state === 'done' ? '✓ Added' : state === 'saving' ? 'Adding…' : state === 'error' ? 'Retry' : '＋ Task'}
      </button>
    </div>
  );
}

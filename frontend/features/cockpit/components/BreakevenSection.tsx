'use client';
// §6 Profit vs Breakeven — per practice, is today's cash above the cost of
// opening the doors?
//
// The margin is fixed/breakeven (37.1% on GM's numbers), NOT 1 - fixed/breakeven
// (62.9%). The latter is the variable-cost ratio; using it as the margin — as
// the source mockup did — reports a group in profit on a day it lost money. See
// docs/FORMULAS.md §15.
//
// Practices with no cost model ("Not set") and no cash-up feed ("Not reporting")
// show their state rather than £0, and are excluded from the Group row.
import { useState } from 'react';
import { Panel, PanelHead, th, td } from '@/features/intelligence/components/os-ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useCostModel, useSaveCostModel } from '../hooks';
import type { BreakevenRow, BreakevenStatus, CockpitResponse } from '../api';

const STATUS_LABEL: Record<BreakevenStatus, string> = {
  above: 'Above',
  below: 'Below',
  not_set: 'Not set',
  not_reporting: 'Not reporting',
};

function StatusPill({ status }: { status: BreakevenStatus }) {
  const tone =
    status === 'above'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'below'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-slate-100 text-slate-500';
  return <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{STATUS_LABEL[status]}</span>;
}

// "—" for anything we can't state. Never £0: a practice with no feed has not
// earned nothing, we simply cannot say.
const money = (v: number | null) => (v === null ? <span className="text-ink-muted">&mdash;</span> : formatPence(v));

function CostModelEditor({ row, onDone }: { row: BreakevenRow; onDone: () => void }) {
  const { data } = useCostModel();
  const save = useSaveCostModel();
  const current = data?.rows.find((r) => r.practiceId === row.practiceId);

  // Edit in whole pounds; convert to integer pence at the boundary.
  const [fixed, setFixed] = useState(() => (current?.fixedCostPenceMonth ?? 0) / 100 || '');
  const [low, setLow] = useState(() => (current?.breakevenLowPence ?? 0) / 100 || '');
  const [high, setHigh] = useState(() => (current?.breakevenHighPence ?? 0) / 100 || '');
  const [days, setDays] = useState(() => current?.workingDaysPerMonth ?? 20);

  const toPence = (v: string | number) => Math.round(Number(v) * 100);
  const invalid = low !== '' && high !== '' && Number(low) > Number(high);

  const submit = () => {
    if (invalid) return;
    save.mutate(
      {
        practiceId: row.practiceId,
        input: {
          fixedCostPenceMonth: fixed === '' ? null : toPence(fixed),
          breakevenLowPence: low === '' ? null : toPence(low),
          breakevenHighPence: high === '' ? null : toPence(high),
          workingDaysPerMonth: Number(days),
        },
      },
      { onSuccess: onDone },
    );
  };

  const field = 'w-32 rounded border border-slate-200 px-2 py-1 text-[13px] tabular-nums';

  return (
    <tr className="bg-slate-50">
      <td className={td} colSpan={7}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-slate-600">
            Fixed cost / month £<br />
            <input className={field} type="number" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-600">
            Breakeven revenue low £<br />
            <input className={field} type="number" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-600">
            Breakeven revenue high £<br />
            <input className={field} type="number" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
          <label className="text-[12px] text-slate-600">
            Working days / month<br />
            <input className={field} type="number" min={1} max={31} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={save.isPending || invalid}
            className="rounded bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onDone} className="text-[13px] text-slate-500 underline">
            Cancel
          </button>
        </div>
        {invalid ? (
          <p className="mt-2 text-xs text-danger">Breakeven low can&rsquo;t be higher than breakeven high.</p>
        ) : null}
        {save.isError ? (
          <p className="mt-2 text-xs text-danger">
            Couldn&rsquo;t save your changes.
            {save.error instanceof Error && save.error.message ? ` ${save.error.message}` : ''}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-ink-muted">
          Saved against today, so past months keep the costs that were actually in force then.
        </p>
      </td>
    </tr>
  );
}

export function BreakevenSection({ data }: { data: CockpitResponse['breakeven'] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const g = data.group;

  return (
    <Panel>
      <PanelHead
        title="Profit vs breakeven"
        sub="Per practice: is the cash taken covering the cost of opening the doors? Contribution is revenue x the practice's contribution margin (fixed cost / breakeven revenue); fixed is charged for the days it actually traded."
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 760 }}>
          <thead>
            <tr className="border-b border-border">
              <th className={`${th} text-left`}>Practice</th>
              <th className={`${th} text-right`}>Revenue</th>
              <th className={`${th} text-right`}>Breakeven/day</th>
              <th className={`${th} text-right`}>Contribution</th>
              <th className={`${th} text-right`}>Fixed</th>
              <th className={`${th} text-right`}>Profit</th>
              <th className={`${th} text-left`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.practiceId} className="border-b border-border">
                <td className={td}>
                  <button type="button" className="text-left underline decoration-dotted" onClick={() => setEditing(editing === r.practiceId ? null : r.practiceId)}>
                    {r.name}
                  </button>
                  {r.status === 'not_reporting' ? (
                    <div className="text-[11px] text-ink-muted">Emergent isn&rsquo;t sending a business for this practice</div>
                  ) : null}
                  {r.status === 'not_set' ? (
                    <div className="text-[11px] text-ink-muted">No cost model &mdash; click to set one</div>
                  ) : null}
                </td>
                <td className={`${td} text-right tabular-nums`}>{money(r.revenuePence)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.breakevenDayPence)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.contributionPence)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.fixedPence)}</td>
                <td className={`${td} text-right tabular-nums ${r.profitPence !== null && r.profitPence < 0 ? 'text-danger' : ''}`}>
                  {money(r.profitPence)}
                </td>
                <td className={td}><StatusPill status={r.status} /></td>
              </tr>
            ))}
            {data.rows.map((r) => (editing === r.practiceId ? <CostModelEditor key={`${r.practiceId}-edit`} row={r} onDone={() => setEditing(null)} /> : null))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td className={td}>Group</td>
              <td className={`${td} text-right tabular-nums`}>{money(g.revenuePence)}</td>
              <td className={`${td} text-right tabular-nums`}>{money(g.breakevenPence)}</td>
              <td className={`${td} text-right tabular-nums`}>{money(g.contributionPence)}</td>
              <td className={`${td} text-right tabular-nums`}>{money(g.fixedPence)}</td>
              <td className={`${td} text-right tabular-nums ${g.profitPence !== null && g.profitPence < 0 ? 'text-danger' : ''}`}>
                {money(g.profitPence)}
              </td>
              <td className={td}><StatusPill status={g.status} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {g.excludedCount > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          {formatNumber(g.excludedCount)} {g.excludedCount === 1 ? 'practice is' : 'practices are'} left out of the group
          row &mdash; no cost model set, or no cash-up feed. Counting them as £0 fixed cost would make the group look more
          profitable than it is.
        </p>
      ) : null}
    </Panel>
  );
}

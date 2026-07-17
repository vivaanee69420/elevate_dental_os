'use client';
// §6 Profit vs Breakeven — per practice, is today's cash above the cost of
// opening the doors?
//
// The margin is fixed/breakeven (37.1% on GM's numbers), NOT 1 - fixed/breakeven
// (62.9%). The latter is the variable-cost ratio; using it as the margin — as
// the source mockup did — reports a group in profit on a day it lost money. See
// docs/FORMULAS.md §17.
//
// Practices with no cost model ("Not set") and no cash-up feed ("Not reporting")
// show their state rather than £0, and are excluded from the Group row.
import { Fragment, useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useCostModel, useSaveCostModel } from '../hooks';
import { SectionCard, SecHead, cx, cockpitStyles as s } from './cockpit-ui';
import type { BreakevenRow, BreakevenStatus, CockpitResponse } from '../api';
import type { CostModelRow } from '../cost-model-api';

const STATUS_LABEL: Record<BreakevenStatus, string> = {
  above: 'Above',
  below: 'Below',
  not_set: 'Not set',
  not_reporting: 'Not reporting',
};

function StatusPill({ status }: { status: BreakevenStatus }) {
  const tone = status === 'above' ? s.stAbove : status === 'below' ? s.stBelow : s.stMuted;
  return <span className={cx(s.st, tone)}>{STATUS_LABEL[status]}</span>;
}

// "—" for anything we can't state. Never £0: a practice with no feed has not
// earned nothing, we simply cannot say.
const money = (v: number | null) => (v === null ? <span className={s.subtle}>&mdash;</span> : formatPence(v));

// A stored 0 must seed as "0", not "" — "" round-trips back to null on save.
const poundsFromPence = (p: number | null | undefined) => (p == null ? '' : String(p / 100));

function CostModelEditor({ row, onDone }: { row: BreakevenRow; onDone: () => void }) {
  const { data, isPending, isError } = useCostModel();

  if (isPending) {
    return (
      <tr style={{ background: 'var(--tint2)' }}>
        <td colSpan={7}>Loading the cost model&hellip;</td>
      </tr>
    );
  }

  // Never mount the form on a failed fetch. `isPending` is false once the query
  // errors, but `data` is still undefined — the form would seed every field blank
  // and Save would write those blanks back as nulls, wiping a real cost model.
  if (isError || !data) {
    return (
      <tr style={{ background: 'var(--tint2)' }}>
        <td colSpan={7}>
          <span className={s.danger}>Couldn&rsquo;t load the cost model.</span>{' '}
          <button type="button" className={s.btnLink} onClick={onDone}>
            Close
          </button>
        </td>
      </tr>
    );
  }

  return <CostModelForm row={row} current={data.rows.find((r) => r.practiceId === row.practiceId)} onDone={onDone} />;
}

function CostModelForm({
  row,
  current,
  onDone,
}: {
  row: BreakevenRow;
  current: CostModelRow | undefined;
  onDone: () => void;
}) {
  const save = useSaveCostModel();

  // Edit in whole pounds; convert to integer pence at the boundary.
  const [fixed, setFixed] = useState(() => poundsFromPence(current?.fixedCostPenceMonth));
  const [low, setLow] = useState(() => poundsFromPence(current?.breakevenLowPence));
  const [high, setHigh] = useState(() => poundsFromPence(current?.breakevenHighPence));
  const [days, setDays] = useState(() => String(current?.workingDaysPerMonth ?? 20));

  const toPence = (v: string | number) => Math.round(Number(v) * 100);
  const invalid = low !== '' && high !== '' && Number(low) > Number(high);
  const daysInvalid = days === '' || Number(days) < 1;

  const submit = () => {
    if (invalid || daysInvalid) return;
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

  const label = { fontSize: 12, color: 'var(--muted)' } as const;

  return (
    <tr style={{ background: 'var(--tint2)' }}>
      <td colSpan={7}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <label style={label}>
            Fixed cost / month £<br />
            <input className={s.field} style={{ width: '8rem' }} type="number" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </label>
          <label style={label}>
            Breakeven revenue low £<br />
            <input className={s.field} style={{ width: '8rem' }} type="number" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <label style={label}>
            Breakeven revenue high £<br />
            <input className={s.field} style={{ width: '8rem' }} type="number" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
          <label style={label}>
            Working days / month<br />
            <input className={s.field} style={{ width: '8rem' }} type="number" min={1} max={31} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <button type="button" className={s.btn} onClick={submit} disabled={save.isPending || invalid || daysInvalid}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={s.btnLink} onClick={onDone}>
            Cancel
          </button>
        </div>
        {invalid ? <p className={cx(s.footNote, s.danger)}>Breakeven low can&rsquo;t be higher than breakeven high.</p> : null}
        {daysInvalid ? <p className={cx(s.footNote, s.danger)}>Working days must be at least 1.</p> : null}
        {save.isError ? (
          <p className={cx(s.footNote, s.danger)}>
            Couldn&rsquo;t save your changes.
            {save.error instanceof Error && save.error.message ? ` ${save.error.message}` : ''}
          </p>
        ) : null}
        <p className={s.footNote}>
          These fields show today&rsquo;s cost model, which may differ from the figures in the table above if you are
          viewing an earlier period. Saved against today, so past months keep the costs that were actually in force
          then.
        </p>
      </td>
    </tr>
  );
}

export function BreakevenSection({ data }: { data: CockpitResponse['breakeven'] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const g = data.group;

  return (
    <SectionCard>
      <SecHead
        n={6}
        title="Profit vs breakeven"
        desc="Per practice: is the cash taken covering the cost of opening the doors? Contribution is revenue × the practice's contribution margin (fixed cost ÷ breakeven revenue); fixed is charged for the days it actually traded."
      />
      <div className={s.scrollX}>
        <table className={s.table} style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Practice</th>
              <th className={s.r}>Revenue</th>
              <th className={s.r}>Breakeven/day</th>
              <th className={s.r}>Contribution</th>
              <th className={s.r}>Fixed</th>
              <th className={s.r}>Profit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <Fragment key={r.practiceId}>
                <tr>
                  <td>
                    <button type="button" className={s.btnLink} style={{ textDecorationStyle: 'dotted' }} onClick={() => setEditing(editing === r.practiceId ? null : r.practiceId)}>
                      {r.name}
                    </button>
                    {r.status === 'not_reporting' ? (
                      <div className={s.subtle} style={{ fontSize: 11 }}>Emergent isn&rsquo;t sending a business for this practice</div>
                    ) : null}
                    {r.status === 'not_set' ? (
                      <div className={s.subtle} style={{ fontSize: 11 }}>No cost model &mdash; click to set one</div>
                    ) : null}
                  </td>
                  <td className={cx(s.r, s.money)}>{money(r.revenuePence)}</td>
                  <td className={cx(s.r, s.money)}>{money(r.breakevenDayPence)}</td>
                  <td className={cx(s.r, s.money)}>{money(r.contributionPence)}</td>
                  <td className={cx(s.r, s.money)}>{money(r.fixedPence)}</td>
                  <td className={cx(s.r, s.money, r.profitPence !== null && r.profitPence < 0 && s.danger)}>{money(r.profitPence)}</td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
                {editing === r.practiceId ? <CostModelEditor row={r} onDone={() => setEditing(null)} /> : null}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className={s.totalRow}>
              <td>Group</td>
              <td className={cx(s.r, s.money)}>{money(g.revenuePence)}</td>
              <td className={cx(s.r, s.money)}>{money(g.breakevenPence)}</td>
              <td className={cx(s.r, s.money)}>{money(g.contributionPence)}</td>
              <td className={cx(s.r, s.money)}>{money(g.fixedPence)}</td>
              <td className={cx(s.r, s.money, g.profitPence !== null && g.profitPence < 0 && s.danger)}>{money(g.profitPence)}</td>
              <td><StatusPill status={g.status} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {g.excludedCount > 0 ? (
        <p className={s.footNote}>
          {formatNumber(g.excludedCount)} {g.excludedCount === 1 ? 'practice is' : 'practices are'} left out of the group
          row &mdash; no cost model set, or no cash-up feed. Counting them as £0 fixed cost would make the group look more
          profitable than it is.
        </p>
      ) : null}
    </SectionCard>
  );
}

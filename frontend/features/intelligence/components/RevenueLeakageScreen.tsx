'use client';

// Revenue Leakage (GM Intelligence OS). "Money left on the table" this window,
// annualised — five recoverable pools with a tunable recoverable-rate each, and
// Each figure opens its own working; every pool says whether it is measured or
// modelled.
//
// WIRED: GET /api/analytics/leakage (scope/period + rate reactive). Real settled
// turnover, FTA no-shows, treatment-plan value and banked receipts. recall +
// lapsed are modelled shares of revenue until patient-level Dentally cohorts
// land. Money is integer PENCE.
//
// A one-click "+ Task" used to sit on every row, posting a recovery job into
// the Task Manager. Removed: it created a task from a figure the page itself
// could not stand behind — three of the five pools are planning models, and the
// biggest was an open-plans upper bound with no acceptance signal underneath
// it. Turning that into an assigned job made an assumption look like work.

import { useState } from 'react';
import { PageHeader, KpiTile, EmptyState, SkeletonKpiRow, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill } from './os-ui';
import { useLeakage } from '../leakage-hooks';
import { DetailModal } from '@/features/marketing/_shared/DetailModal';
import { buildLeakageProof, buildTotalProof, type Proof } from '../leakage-proof';
import type { Leakage, LeakageLine, LeakageRates } from '../leakage-api';

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
  // Which figure's working is open. Every number on this page is either an
  // observation or a model, and a reader cannot tell which without being shown.
  const [proof, setProof] = useState<Proof | null>(null);

  // The biggest MEASURED leak. Leading with the biggest line overall meant
  // leading with the modelled open-plans figure, which was 93% of the old
  // headline and is not money anyone has lost.
  const biggestMeasured = data.lines.find((l) => l.basis === 'measured');
  const measuredPct = data.inputs.revenuePence > 0
    ? Math.round((data.measuredAnnualPence / (data.inputs.revenuePence * (365 / Math.max(1, data.windowDays)))) * 1000) / 10
    : 0;
  return (
    <>
      {/* KPI strip. MEASURED leads; the modelled pools are shown beside it and
          never folded into it — the page used to sum the two and call the
          result recoverable, which read as 77% of turnover. */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <KpiTile
          onClick={() => setProof(buildTotalProof('measured', data))}
          label="Recoverable / year — measured"
          value={gbp(data.measuredAnnualPence)}
          delta={`${gbp(Math.round(data.measuredAnnualPence / 12))}/mo · from real no-shows and unpaid invoices`}
          deltaTone="down"
        />
        <KpiTile
          onClick={() => setProof(buildTotalProof('modelled', data))}
          label="Modelled opportunity"
          value={gbp(data.modelledAnnualPence)}
          delta="planning estimate — open plans, recall and lapsed shares"
        />
        <KpiTile
          onClick={biggestMeasured ? () => setProof(buildLeakageProof(biggestMeasured, data)) : undefined}
          label="Biggest measured leak"
          value={biggestMeasured ? biggestMeasured.label : '—'}
          delta={biggestMeasured ? `${gbp(biggestMeasured.annualPence)}/yr · ${measuredPct}% of turnover` : 'nothing measurable in this window'}
        />
      </div>

      {data.planCompletionPct !== null && data.planCompletionPct < 15 && (
        <div className="text-sm rounded-lg p-3" style={{ background: '#FEF3C7', color: '#78350F' }}>
          <b>Open plans are an upper bound, not lost money.</b> Only {data.planCompletionPct}% of
          presented plan value is marked completed in your feed, and Dentally sends no acceptance
          state at all — so &ldquo;still open&rdquo; counts work in progress and work booked ahead
          alongside anything genuinely lost. Treat it as the size of the follow-up list, not a
          shortfall.
        </div>
      )}

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
        <PanelHead title="Where the money leaks" sub="Annualised from the selected window. Tap any figure to see how it was worked out." />
        <div className="flex flex-col divide-y divide-line">
          {data.lines.map((l) => (
            <LeakRow key={l.key} line={l} onProof={() => setProof(buildLeakageProof(l, data))} />
          ))}
        </div>
        <NoteFoot>
          Tap any figure to see how it was worked out. Recall and reactivation are modelled shares of
          revenue — wire Dentally for patient-level exact figures. FTA rate this window: {data.ftaRatePct}%.
        </NoteFoot>
      </Panel>

      <DetailModal
        open={proof !== null}
        title={proof?.title ?? ''}
        subtitle={proof?.means}
        onClose={() => setProof(null)}
      >
        {proof && (
          <div style={{ fontSize: 13 }}>
            <p className="text-ink-muted mb-4">{proof.basis}</p>
            <table className="w-full">
              <tbody>
                {proof.rows.map((r) => (
                  <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className={r.muted ? 'text-ink-muted' : ''} style={{ padding: '8px 4px' }}>{r.name}</td>
                    <td
                      className={'text-right tabular-nums ' + (r.muted ? 'text-ink-muted' : '')}
                      style={{ padding: '8px 4px' }}
                    >
                      {r.value}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="font-semibold" style={{ padding: '10px 4px' }}>{proof.total.name}</td>
                  <td className="text-right font-semibold tabular-nums" style={{ padding: '10px 4px' }}>
                    {proof.total.value}
                  </td>
                </tr>
              </tfoot>
            </table>
            {proof.caveat && (
              <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 16, lineHeight: 1.55 }}>
                {proof.caveat}
              </p>
            )}
          </div>
        )}
      </DetailModal>
    </>
  );
}

function LeakRow({ line, onProof }: { line: LeakageLine; onProof: () => void }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1">
        <div className="text-[13.5px] font-semibold text-ink">
          {line.label}
          {/* Measured or modelled, on the row itself. Four of these five lines
              were assumptions and only the footnote said so. */}
          <span
            className="ml-2 text-[10px] font-semibold rounded px-1.5 py-0.5 align-middle"
            style={line.basis === 'measured'
              ? { background: 'var(--success-50, #DCFCE7)', color: 'var(--success)' }
              : { background: 'var(--bg)', color: 'var(--ink-muted)' }}
          >
            {line.basis === 'measured' ? 'measured' : 'modelled'}
          </span>
        </div>
        <div className="text-[12px] text-ink-muted">{line.sub}</div>
      </div>
      <div className="text-right">
        <button
          type="button"
          onClick={onProof}
          className="text-[14px] font-semibold tabular-nums text-danger underline decoration-dotted underline-offset-4"
        >
          {gbp(line.annualPence)}
        </button>
        <div className="text-[11px] text-ink-muted">{gbp(line.monthlyPence)}/mo</div>
      </div>
    </div>
  );
}

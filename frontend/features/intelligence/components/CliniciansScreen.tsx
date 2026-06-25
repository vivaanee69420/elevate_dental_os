'use client';

// Clinicians (GM Intelligence OS). Production by clinician, pay-split ledger and
// NHS/UDA obligation. Practice-only (Academy/Lab show a scope note).
//
// WIRED: reads GET /api/analytics/clinicians (scope/period reactive). REAL
// associate roster + treatment_plans production + appointment stats + owner-
// entered NHS contract. HONEST data walls: production £ / appointment counts /
// UDA-completed each flag when their Dentally feed isn't populated, instead of
// fabricating. Money is integer PENCE.

import { useEffect, useState } from 'react';
import { PageHeader, KpiTile, BarRow, EmptyState } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill, ScopeNote, th, td } from './os-ui';
import { DecisionLens } from '@/features/_shared/DecisionLens';
import { useClinicians, useTreatmentsCompletedLines } from '../clinicians-hooks';
import type { Clinicians } from '../clinicians-api';

const gbp = (p: number) => formatPence(p);
const pct = (n: number) => `${n.toFixed(1)}%`;

export default function CliniciansScreen() {
  const { data, isLoading, isError, error } = useClinicians();

  const header = (
    <>
      <PageHeader title="Clinicians" subtitle="Production, pay splits and profit by associate and hygienist, plus NHS/UDA obligation tracking." />
      <ScopePeriodBar dentallyOnly />
    </>
  );

  if (isError) return <div className="flex flex-col gap-4">{header}<Panel><EmptyState message={`Couldn't load clinicians: ${(error as Error)?.message ?? 'unknown error'}`} /></Panel></div>;
  if (isLoading) return <div className="flex flex-col gap-4">{header}<Panel><EmptyState message="Loading clinician roster…" /></Panel></div>;
  if (data && data.applicable === false) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ScopeNote title="Clinicians applies to the dental practices" body={data.message || 'Switch scope to the whole group or a single practice to see production, pay splits and NHS/UDA tracking.'} />
      </div>
    );
  }
  if (!data) return <div className="flex flex-col gap-4">{header}</div>;

  return (
    <div className="flex flex-col gap-4">
      {header}
      {/* Treatments Completed drill-down — which treatments, for whom, by whom,
          and the revenue each generated (reconciles to the Business Hub card).
          Pinned to the top of the page. */}
      <CompletedTreatmentsPanel />
      {data.clinicians.length === 0 ? (
        <Panel><EmptyState message="No associates on the roster for this scope. Add associates (Team) or map Dentally practitioners to populate the clinician list." /></Panel>
      ) : (
        <CliniciansBody data={data} />
      )}
    </div>
  );
}

// Completed-treatment detail behind the "Treatments Completed" card: one row per
// completed Dentally treatment with patient, clinician, treatment and revenue.
// Loads on open (nothing fetched until then); the first 100 land fast and the
// rest stream in the background (paginated 100 at a time).
function CompletedTreatmentsPanel() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useTreatmentsCompletedLines(open);
  // Back-fill the remaining pages once the first 100 are in (fetchNextPage is stable).
  useEffect(() => {
    if (open && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [open, hasNextPage, isFetchingNextPage, data, fetchNextPage]);

  const lines = data?.pages.flatMap((p) => p.lines) ?? [];
  const totals = data?.pages[0]?.totals ?? null;
  const note = data?.pages[0]?.note;
  const loadingMore = totals != null && lines.length < totals.count;
  const fmtDate = (d: string) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <Panel>
      <PanelHead
        title="Completed treatments"
        sub="Every completed treatment in the window — patient, clinician, treatment and the revenue it generated."
        right={totals ? <Pill tone="info">{totals.count.toLocaleString('en-GB')} · {gbp(totals.valuePence)}</Pill> : undefined}
      />
      {!open ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-ink-muted">See every completed treatment with its patient, clinician and the revenue it generated.</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-white bg-brand rounded-xl px-4 py-2 hover:opacity-90 whitespace-nowrap"
          >
            View completed treatments →
          </button>
        </div>
      ) : (
        <>
          {isLoading && <EmptyState message="Loading completed treatments…" />}
          {isError && <EmptyState message="Couldn't load completed treatments." />}
          {!isLoading && !isError && lines.length === 0 && <EmptyState message="No completed treatments in this window." />}
          {lines.length > 0 && (
            <>
              <div className="overflow-auto" style={{ maxHeight: 480 }}>
                <table className="w-full border-collapse" style={{ minWidth: 760 }}>
                  <thead>
                    <tr className="border-b border-border">
                      {['Date', 'Patient', 'Clinician', 'Treatment', 'Practice', 'Revenue'].map((h, i) => (
                        <th key={h} className={`${th} ${i === 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-border last:border-0">
                        <td className={`${td} whitespace-nowrap`}>{fmtDate(l.completedAt)}</td>
                        <td className={td}>{l.patientName ?? '—'}</td>
                        <td className={td}>{l.clinicianName ?? '—'}</td>
                        <td className={td}>{l.treatmentName ?? '—'}</td>
                        <td className={td}>{l.practiceName ?? '—'}</td>
                        <td className={`${td} text-right tabular-nums`}>{gbp(l.valuePence)}</td>
                      </tr>
                    ))}
                    {totals && (
                      <tr className="border-t-2 border-border font-semibold">
                        <td className={td} colSpan={5}>Total ({totals.count.toLocaleString('en-GB')})</td>
                        <td className={`${td} text-right tabular-nums`}>{gbp(totals.valuePence)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-ink-muted mt-2">
                {loadingMore
                  ? `Loaded ${lines.length.toLocaleString('en-GB')} of ${totals!.count.toLocaleString('en-GB')} — loading the rest…`
                  : `Showing all ${lines.length.toLocaleString('en-GB')} completed treatments`}
              </div>
            </>
          )}
          {note && <NoteFoot>{note}</NoteFoot>}
        </>
      )}
    </Panel>
  );
}

// Which headline metric a clinician row contributes to — drives the drill-down.
type DrillMetric = 'production' | 'fees' | 'net';

function CliniciansBody({ data }: { data: Clinicians }) {
  const roster = data.clinicians;
  const feeRatio = data.totalProductionPence ? (data.totalFeesPence / data.totalProductionPence) * 100 : 0;
  // Bar metric: production when available, else appointment volume (honest fallback).
  const useProd = data.productionAvailable;
  const maxBar = Math.max(...roster.map((c) => (useProd ? c.productionPence : c.appointments)), 1);
  // Which headline card is expanded into a per-clinician breakdown (null = none).
  // Only meaningful once production is available — the tiles read "—" otherwise.
  const [drill, setDrill] = useState<DrillMetric | null>(null);
  const toggle = (m: DrillMetric) => setDrill((cur) => (cur === m ? null : m));
  const canDrill = data.productionAvailable && roster.length > 0;

  return (
    <>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <KpiTile label={`Production · ${data.window?.label ?? ''}`} value={data.productionAvailable ? gbp(data.totalProductionPence) : '—'} delta={`${roster.length} clinicians in scope`} onClick={canDrill ? () => toggle('production') : undefined} active={drill === 'production'} />
        <KpiTile label="Associate / clinician fees" value={data.productionAvailable ? gbp(data.totalFeesPence) : '—'} delta={data.productionAvailable ? (data.payTermsEstimated ? `est. at ${pct(feeRatio)} default split — set real terms in Team` : `${pct(feeRatio)} of production`) : 'awaiting production feed'} onClick={canDrill ? () => toggle('fees') : undefined} active={drill === 'fees'} />
        <KpiTile label="Net to practice" value={data.productionAvailable ? gbp(data.totalNetPence) : '—'} delta={data.payTermsEstimated ? 'estimated — pay terms not yet set' : 'after associate pay (pre lab/opex)'} deltaTone={data.totalNetPence >= 0 ? 'up' : 'down'} onClick={canDrill ? () => toggle('net') : undefined} active={drill === 'net'} />
      </div>

      {drill && <MetricBreakdown data={data} metric={drill} onClose={() => setDrill(null)} />}

      <Panel>
        <PanelHead title="Decision Lens" sub="What to act on across the clinical team." />
        <DecisionLens surface="clinicians" fallback={data.insights} />
      </Panel>

      {/* Production / activity by clinician */}
      <Panel>
        <PanelHead
          title={useProd ? 'Production by clinician' : 'Appointment activity by clinician'}
          sub={useProd ? 'Completed private production, ranked.' : 'Production £ not yet synced — ranking by appointment volume instead.'}
        />
        {roster.map((c) => (
          <BarRow
            key={c.id}
            name={c.name}
            sub={`${c.practiceName} · ${c.role}`}
            pct={((useProd ? c.productionPence : c.appointments) / maxBar) * 100}
            value={useProd ? gbp(c.productionPence) : `${c.appointments} appts`}
            valueSub={useProd ? `${c.payPct}% split` : `${c.completed} completed`}
          />
        ))}
      </Panel>

      {/* Ledger */}
      <Panel>
        <PanelHead title="Associate & hygienist ledger" sub="Pay splits, production, fees and net to the practice per clinician." right={<Pill tone="info">{data.window?.label}</Pill>} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 820 }}>
            <thead>
              <tr className="border-b border-border">
                {['Clinician', 'Role', 'Practice', 'Split', 'Lab Split', 'Production', 'Fees', 'Net to Practice', 'Appts'].map((h, i) => (
                  <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className={td}>{c.name}{!c.active && <span className="ml-1"><Pill tone="warn">inactive</Pill></span>}</td>
                  <td className={td}>{c.role}</td>
                  <td className={td}>{c.practiceName}</td>
                  <td className={`${td} text-right`}>{c.payPct}%{c.payDefault && <span className="ml-1 text-ink-muted text-xs">(default)</span>}</td>
                  <td className={`${td} text-right`}>{c.labSplitPct}%</td>
                  <td className={`${td} text-right tabular-nums`}>{data.productionAvailable ? gbp(c.productionPence) : '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{data.productionAvailable ? gbp(c.feesPence) : '—'}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{data.productionAvailable ? gbp(c.netToPracticePence) : '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{data.appointmentsAvailable ? c.appointments : '—'}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border font-semibold">
                <td className={td} colSpan={5}>Total</td>
                <td className={`${td} text-right tabular-nums`}>{data.productionAvailable ? gbp(data.totalProductionPence) : '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{data.productionAvailable ? gbp(data.totalFeesPence) : '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{data.productionAvailable ? gbp(data.totalNetPence) : '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{data.appointmentsAvailable ? roster.reduce((s, c) => s + c.appointments, 0) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <NoteFoot>{data.note}</NoteFoot>
      </Panel>

      {/* (Metric breakdown panel is rendered above, right under the KPI grid.) */}

      {/* NHS / UDA */}
      {data.nhs.available ? (
        <Panel>
          <PanelHead title="NHS / UDA Obligation" sub="Units of Dental Activity contracted, for the sites carrying an NHS contract (owner-entered)." />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 560 }}>
              <thead>
                <tr className="border-b border-border">
                  {['Practice', 'UDA Rate', 'UDA Contract', 'Completed (YTD)', 'Contract Value'].map((h, i) => (
                    <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.nhs.practices.map((n) => (
                  <tr key={n.id} className="border-b border-border last:border-0">
                    <td className={td}>{n.name}</td>
                    <td className={`${td} text-right tabular-nums`}>{gbp(n.udaRatePence)}</td>
                    <td className={`${td} text-right tabular-nums`}>{n.contractUda.toLocaleString('en-GB')}</td>
                    <td className={`${td} text-right tabular-nums`}>{data.nhs.completedAvailable ? '—' : <Pill tone="info">awaiting feed</Pill>}</td>
                    <td className={`${td} text-right tabular-nums`}>{gbp(n.contractUda * n.udaRatePence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NoteFoot>
            UDA contract and rate are live (owner-entered). UDA <b>completed</b> needs the Dentally treatment-plan feed (UDA values), which isn&apos;t populated yet — so delivery pace and clawback risk can&apos;t be tracked until that syncs.
          </NoteFoot>
        </Panel>
      ) : (
        <ScopeNote title="NHS / UDA Obligation" body="No NHS contract in the current scope — these sites are fully private, so there's no UDA obligation or clawback risk to track." />
      )}
    </>
  );
}

// Per-clinician breakdown behind a headline card. Reconciles exactly to the card
// total (same roster, same pence). Sorted by the chosen metric, largest-first,
// with each clinician's share of the total. Pure client-side — every figure is
// already on the page (the ledger), this just re-centres it on one metric.
const METRIC_META: Record<DrillMetric, { title: string; sub: string; col: string; pick: (c: Clinicians['clinicians'][number]) => number; total: (d: Clinicians) => number }> = {
  production: { title: 'Production by clinician', sub: 'Completed private production each clinician generated.', col: 'Production', pick: (c) => c.productionPence, total: (d) => d.totalProductionPence },
  fees: { title: 'Associate / clinician fees by clinician', sub: 'Fee owed to each clinician — production × their pay split.', col: 'Fees', pick: (c) => c.feesPence, total: (d) => d.totalFeesPence },
  net: { title: 'Net to practice by clinician', sub: "What the practice keeps per clinician after their fee (pre lab/opex).", col: 'Net to practice', pick: (c) => c.netToPracticePence, total: (d) => d.totalNetPence },
};

function MetricBreakdown({ data, metric, onClose }: { data: Clinicians; metric: DrillMetric; onClose: () => void }) {
  const meta = METRIC_META[metric];
  const total = meta.total(data);
  const rows = [...data.clinicians]
    .map((c) => ({ c, val: meta.pick(c) }))
    .sort((a, b) => b.val - a.val);
  const share = (v: number) => (total ? (v / total) * 100 : 0);

  return (
    <Panel>
      <PanelHead
        title={meta.title}
        sub={meta.sub}
        right={
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink underline-offset-2 hover:underline">
            Close ×
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 720 }}>
          <thead>
            <tr className="border-b border-border">
              {['Clinician', 'Practice', 'Split', 'Production', meta.col, 'Share'].map((h, i) => (
                <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, val }) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className={td}>{c.name}{!c.active && <span className="ml-1"><Pill tone="warn">inactive</Pill></span>}</td>
                <td className={td}>{c.practiceName}</td>
                <td className={`${td} text-right tabular-nums`}>{c.payPct}%{c.payDefault && <span className="ml-1 text-ink-muted text-xs">(default)</span>}</td>
                <td className={`${td} text-right tabular-nums`}>{gbp(c.productionPence)}</td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{gbp(val)}</td>
                <td className={`${td} text-right tabular-nums`}>{pct(share(val))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold">
              <td className={td} colSpan={3}>Total ({rows.length})</td>
              <td className={`${td} text-right tabular-nums`}>{gbp(data.totalProductionPence)}</td>
              <td className={`${td} text-right tabular-nums`}>{gbp(total)}</td>
              <td className={`${td} text-right tabular-nums`}>{total ? '100.0%' : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {data.payTermsEstimated && (metric === 'fees' || metric === 'net') && (
        <NoteFoot>
          Pay terms aren&apos;t set yet, so fees (and the resulting net) use the default split. Set each clinician&apos;s real terms in Team for exact figures.
        </NoteFoot>
      )}
    </Panel>
  );
}

'use client';

// Clinicians (GM Intelligence OS). Production by clinician, pay-split ledger and
// NHS/UDA obligation. Practice-only (Academy/Lab show a scope note).
//
// WIRED: reads GET /api/analytics/clinicians (scope/period reactive). REAL
// associate roster + treatment_plans production + appointment stats + owner-
// entered NHS contract. HONEST data walls: production £ / appointment counts /
// UDA-completed each flag when their Dentally feed isn't populated, instead of
// fabricating. Money is integer PENCE.

import { PageHeader, KpiTile, BarRow, AlertRow, EmptyState } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill, ScopeNote, th, td } from './os-ui';
import { useClinicians } from '../clinicians-hooks';
import type { Clinicians } from '../clinicians-api';

const gbp = (p: number) => formatPence(p);
const pct = (n: number) => `${n.toFixed(1)}%`;

export default function CliniciansScreen() {
  const { data, isLoading, isError, error } = useClinicians();

  const header = (
    <>
      <PageHeader title="Clinicians" subtitle="Production, pay splits and profit by associate and hygienist, plus NHS/UDA obligation tracking." />
      <ScopePeriodBar />
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
      {data.clinicians.length === 0 ? (
        <Panel><EmptyState message="No associates on the roster for this scope. Add associates (Team) or map Dentally practitioners to populate the clinician list." /></Panel>
      ) : (
        <CliniciansBody data={data} />
      )}
    </div>
  );
}

function CliniciansBody({ data }: { data: Clinicians }) {
  const roster = data.clinicians;
  const feeRatio = data.totalProductionPence ? (data.totalFeesPence / data.totalProductionPence) * 100 : 0;
  // Bar metric: production when available, else appointment volume (honest fallback).
  const useProd = data.productionAvailable;
  const maxBar = Math.max(...roster.map((c) => (useProd ? c.productionPence : c.appointments)), 1);

  return (
    <>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <KpiTile label={`Production · ${data.window?.label ?? ''}`} value={data.productionAvailable ? gbp(data.totalProductionPence) : '—'} delta={`${roster.length} clinicians in scope`} />
        <KpiTile label="Associate / clinician fees" value={data.productionAvailable ? gbp(data.totalFeesPence) : '—'} delta={data.productionAvailable ? `${pct(feeRatio)} of production` : 'awaiting production feed'} />
        <KpiTile label="Net to practice" value={data.productionAvailable ? gbp(data.totalNetPence) : '—'} delta="after associate pay (pre lab/opex)" deltaTone={data.totalNetPence >= 0 ? 'up' : 'down'} />
      </div>

      {data.insights.length > 0 && (
        <Panel>
          <PanelHead title="Decision Lens" sub="What to act on across the clinical team." />
          {data.insights.map((a, i) => (
            <AlertRow key={i} tone={a.tone} title={a.title} body={a.body} tag={a.value ? <Pill tone={a.tone}>{a.value}</Pill> : undefined} />
          ))}
        </Panel>
      )}

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
                  <td className={`${td} text-right`}>{c.payPct}%</td>
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

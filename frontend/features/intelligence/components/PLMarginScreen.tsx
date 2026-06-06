'use client';

// P&L & Margin (GM Intelligence OS) — group P&L statement + per-entity breakdown
// from REAL monthly_financials actuals (Xero/QuickBooks override manual).
//
// WIRED: reads GET /api/analytics/pl-margin (scope/period reactive). Money is
// integer PENCE. Honest CoA granularity — staff includes associate/clinician pay
// (Xero books them together), so there is no separate clinician line (it would
// read false-green). The fully-editable spreadsheet engine + account-level CoA
// mapping are the Phase 3 persistence slice.

import { PageHeader, KpiTile, EmptyState, AlertRow } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { Panel, PanelHead, NoteFoot, Pill, th, td } from './os-ui';
import { usePLMargin } from '../pl-margin-hooks';
import type { PLLine } from '../pl-margin-api';

const pct = (n: number) => `${n.toFixed(1)}%`;
const marginTone = (m: number): 'good' | 'warn' | 'bad' => (m >= 18 ? 'good' : m >= 10 ? 'warn' : 'bad');
const BASIS_LABEL: Record<string, string> = {
  'actuals-month': 'Selected month · actuals',
  'actuals-annual': 'Trailing 12mo · actuals',
  'actuals-mixed': 'Mixed month/annual · actuals',
  none: 'No actuals',
};

// Group statement lines, in order. `field` keys into PLLine; neg = a cost row.
const STATEMENT: { field: keyof PLLine; label: string; kind: 'rev' | 'direct' | 'sub' | 'op' | 'total' }[] = [
  { field: 'revPence', label: 'Revenue', kind: 'rev' },
  { field: 'labMaterialsPence', label: 'Lab & materials', kind: 'direct' },
  { field: 'grossPence', label: 'Gross profit', kind: 'sub' },
  { field: 'staffPence', label: 'Staff & clinician pay', kind: 'op' },
  { field: 'otherOpexPence', label: 'Other operating costs', kind: 'op' },
  { field: 'netPence', label: 'Net operating profit', kind: 'total' },
];

export default function PLMarginScreen() {
  const { data, isLoading, isError, error } = usePLMargin();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="P&L & Margin"
        subtitle="Group and per-entity profit from your accounting actuals: revenue, lab, staff and the net operating profit that lands."
      />
      <ScopePeriodBar />

      {isError ? (
        <Panel><EmptyState message={`Couldn't load P&L: ${(error as Error)?.message ?? 'unknown error'}`} /></Panel>
      ) : isLoading ? (
        <Panel><EmptyState message="Loading accounting actuals…" /></Panel>
      ) : !data?.hasData ? (
        <Panel>
          <PanelHead title="Profit & Loss" sub="Real actuals only — no projection on a finance screen." />
          <EmptyState message="No P&L actuals for this scope/period. Connect Xero or QuickBooks (Integrations), or enter monthly actuals, to populate the statement." />
        </Panel>
      ) : (
        <PLBody data={data} />
      )}
    </div>
  );
}

function PLBody({ data }: { data: NonNullable<ReturnType<typeof usePLMargin>['data']> }) {
  const t = data.statement;
  const staffRatio = t.revPence ? (t.staffPence / t.revPence) * 100 : 0;
  const basisPill = BASIS_LABEL[data.basis] ?? data.basis;

  return (
    <>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <KpiTile label="Revenue" value={formatPence(t.revPence)} delta={basisPill} />
        <KpiTile label="Net operating profit" value={formatPence(t.netPence)} delta={`${pct(t.marginPct)} of turnover`} deltaTone={t.marginPct >= 18 ? 'up' : t.marginPct >= 10 ? 'muted' : 'down'} />
        <KpiTile label="Staff & clinician ratio" value={pct(staffRatio)} delta={`${formatPence(t.staffPence)} incl. associate pay`} />
      </div>

      {!data.dentistStaffSeparable && (
        <AlertRow
          tone="info"
          title="Staff includes associate/clinician pay"
          body="Your accounting feed books associate pay inside the staff bucket, so this P&L can't split a separate clinician line without double-counting. Use the Treatment Workbench for per-clinician economics."
        />
      )}

      {/* Group statement */}
      <Panel>
        <PanelHead title="Profit & Loss — group statement" sub="Revenue down to net operating profit for the current scope and period." right={<Pill tone="info">{basisPill}</Pill>} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 420 }}>
            <tbody>
              {STATEMENT.map((line) => {
                const isSub = line.kind === 'sub' || line.kind === 'total';
                const neg = line.kind === 'direct' || line.kind === 'op';
                return (
                  <tr key={line.field} className={`border-b border-border last:border-0 ${line.kind === 'sub' ? 'border-t border-border' : ''} ${line.kind === 'total' ? 'border-t-2' : ''}`}>
                    <td className={`${td} ${line.kind === 'rev' || isSub ? 'font-semibold' : ''}`}>{line.label}</td>
                    <td className={`${td} text-right tabular-nums ${isSub ? 'font-bold' : ''} ${neg ? 'text-danger' : ''}`}>
                      {`${neg ? '−' : ''}${formatPence(t[line.field])}`}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-b border-border last:border-0">
                <td className={`${td} font-semibold`}>Net margin</td>
                <td className={`${td} text-right`}><Pill tone={marginTone(t.marginPct)}>{pct(t.marginPct)}</Pill></td>
              </tr>
            </tbody>
          </table>
        </div>
        <NoteFoot>Direct costs (lab &amp; materials) sit above gross profit; operating costs below. {data.note}</NoteFoot>
      </Panel>

      {/* Per-entity */}
      <Panel>
        <PanelHead title="P&L by Entity" sub={data.perEntityAvailable ? 'Each business in scope with its own tagged actuals.' : 'Per-entity split needs practice-tagged actuals.'} right={<Pill tone="info">{basisPill}</Pill>} />
        {data.perEntityAvailable ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 600 }}>
              <thead>
                <tr className="border-b border-border">
                  {['Entity', 'Revenue', 'Lab & mat', 'Staff', 'Other opex', 'Net Profit', 'Margin'].map((h, i) => (
                    <th key={h} className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entities.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className={td}>{e.name}<span className="block text-[11px] text-ink-soft">{e.region || (e.kind === 'practice' ? 'Practice' : e.kind)}</span></td>
                    <td className={`${td} text-right tabular-nums`}>{formatPence(e.revPence)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatPence(e.labMaterialsPence)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatPence(e.staffPence)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatPence(e.otherOpexPence)}</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{formatPence(e.netPence)}</td>
                    <td className={`${td} text-right`}><Pill tone={marginTone(e.marginPct)}>{pct(e.marginPct)}</Pill></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className={td}>Total</td>
                  <td className={`${td} text-right tabular-nums`}>{formatPence(t.revPence)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatPence(t.labMaterialsPence)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatPence(t.staffPence)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatPence(t.otherOpexPence)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatPence(t.netPence)}</td>
                  <td className={`${td} text-right`}>{pct(t.marginPct)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="Your accounting feed posts at group level (no practice tag), so the P&L can't be split per entity yet. Tag actuals by practice in Xero/QuickBooks to unlock this." />
        )}
      </Panel>
    </>
  );
}

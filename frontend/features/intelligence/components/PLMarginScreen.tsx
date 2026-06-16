'use client';

// P&L & Margin (GM Intelligence OS) — group P&L statement + per-entity breakdown
// from REAL monthly_financials actuals (Xero/QuickBooks override manual).
//
// WIRED: reads GET /api/analytics/pl-margin (scope/period reactive). Money is
// integer PENCE. Honest CoA granularity — staff includes associate/clinician pay
// (Xero books them together), so there is no separate clinician line (it would
// read false-green). The fully-editable spreadsheet engine + account-level CoA
// mapping are the Phase 3 persistence slice.

import { useState } from 'react';
import { PageHeader, KpiTile, EmptyState, AlertRow, SkeletonKpiRow, SkeletonTable, Explainer } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useQboAccounts } from '@/features/finance/hooks';
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
  // QuickBooks is the live accounting feed: it posts a full P&L per company.
  // When any QB company is connected the tab goes QuickBooks-first — company +
  // accrual/cash filters replace the practice (Dentally) scope, which QB data
  // can't honour (QB is not practice-mapped). With no QB connected we fall back
  // to the all-feeds view + the practice scope, so Xero/manual orgs are unchanged.
  const { data: qbo } = useQboAccounts();
  const companies = (qbo?.accounts ?? []).filter((a) => a.status === 'active');
  const hasQbo = companies.length > 0;

  const [accountId, setAccountId] = useState<string | null>(null);
  const [method, setMethod] = useState<'accrual' | 'cash'>('accrual');

  // A stale company selection (company disconnected) silently falls back to All.
  const selected = hasQbo && accountId && companies.some((c) => c.id === accountId) ? accountId : null;

  const { data, isLoading, isError, error } = usePLMargin(
    hasQbo
      ? { source: 'quickbooks', accountId: selected, accountingMethod: method }
      : { source: 'combined', accountingMethod: 'accrual' },
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="P&L & Margin"
        subtitle="Group and per-entity profit from your accounting actuals: revenue, lab, staff and the net operating profit that lands."
      />
      {/* Period pills always; practice scope only when there is no QB feed. */}
      <ScopePeriodBar hideScope={hasQbo} dentallyOnly />
      {hasQbo && (
        <QboFilterBar
          companies={companies}
          accountId={selected}
          onAccount={setAccountId}
          method={method}
          onMethod={setMethod}
        />
      )}

      {isError ? (
        <Panel><EmptyState message={`Couldn't load P&L: ${(error as Error)?.message ?? 'unknown error'}`} /></Panel>
      ) : isLoading ? (
        <>
          <SkeletonKpiRow count={4} />
          <SkeletonTable rows={6} cols={4} />
        </>
      ) : !data?.hasData ? (
        <Panel>
          <PanelHead title="Profit & Loss" sub="Real actuals only — no projection on a finance screen." />
          <EmptyState message={hasQbo
            ? 'No QuickBooks P&L for this company/period. Pick another month or company, or check the QuickBooks sync in Integrations.'
            : 'No P&L actuals for this scope/period. Connect QuickBooks or Xero (Integrations), or enter monthly actuals, to populate the statement.'} />
        </Panel>
      ) : (
        <PLBody data={data} />
      )}
    </div>
  );
}

// QuickBooks filter row: company picker (a QB company = one legal entity, not a
// dental practice) + accrual/cash accounting basis. Mirrors the /profit source
// bar's controls so the two QuickBooks surfaces feel identical.
function QboFilterBar({
  companies,
  accountId,
  onAccount,
  method,
  onMethod,
}: {
  companies: { id: string; company_name: string | null; label: string | null; realm_id: string | null }[];
  accountId: string | null;
  onAccount: (id: string | null) => void;
  method: 'accrual' | 'cash';
  onMethod: (m: 'accrual' | 'cash') => void;
}) {
  const fieldCls = 'text-[13px] border border-border bg-card text-ink px-3 py-2 rounded-xl shadow-panel-sm cursor-pointer';
  return (
    <div className="flex flex-wrap items-end gap-4 mb-1">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-ink-soft mb-1.5">QuickBooks company</div>
        <select className={fieldCls} value={accountId ?? ''} onChange={(e) => onAccount(e.target.value || null)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.company_name || c.label || c.realm_id || 'Company'}</option>
          ))}
        </select>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-ink-soft mb-1.5">Accounting basis</div>
        <div className="inline-flex rounded-xl overflow-hidden border border-border">
          {(['accrual', 'cash'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMethod(m)}
              className={
                'text-[13px] px-4 py-2 font-medium capitalize ' +
                (method === m ? 'bg-brand text-white' : 'bg-card text-ink hover:bg-surface-2')
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PLBody({ data }: { data: NonNullable<ReturnType<typeof usePLMargin>['data']> }) {
  const [linesInfo, setLinesInfo] = useState(false);
  const t = data.statement;
  const staffRatio = t.revPence ? (t.staffPence / t.revPence) * 100 : 0;
  const isQbo = data.source === 'quickbooks';
  const isCompany = data.perEntityKind === 'company';
  // Plain-English name for where these numbers come from, used in the card
  // explainers so a non-technical reader knows exactly what feed they're reading.
  const srcLabel = isQbo ? 'QuickBooks' : 'your accounting feed (QuickBooks, Xero, or figures entered by hand)';
  const basisWord = isQbo ? (data.accountingMethod === 'cash' ? 'cash' : 'accrual') : 'accrual';
  // Append the accounting basis to the period pill for QuickBooks (cash vs accrual
  // change the numbers materially; non-QB feeds are accrual-only so no need).
  const basisPill = `${BASIS_LABEL[data.basis] ?? data.basis}${isQbo ? ` · ${basisWord}` : ''}`;

  return (
    <>
      <div className="text-[12px] text-ink-muted">
        These figures come straight from <b>{isQbo ? 'QuickBooks' : 'your accounting records'}</b>
        {isQbo && <> — your accountant&apos;s books, on a <b>{basisWord}</b> basis</>}. Nothing here is estimated or forecast. Tap the <b>?</b> on any card to see what it means.
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <KpiTile
          label="Revenue"
          value={formatPence(t.revPence)}
          delta={basisPill}
          info={
            <Explainer
              what="The total money the business billed for dental work over this period — the top line before any costs are taken off."
              how={<>We take the revenue (sales/income) posted in {srcLabel} for the company and months you&apos;ve selected, and add it up. No VAT, no estimates.</>}
              now={<>For this selection you billed <b>{formatPence(t.revPence)}</b>.</>}
            />
          }
        />
        <KpiTile
          label="Net operating profit"
          value={formatPence(t.netPence)}
          delta={`${pct(t.marginPct)} of turnover`}
          deltaTone={t.marginPct >= 18 ? 'up' : t.marginPct >= 10 ? 'muted' : 'down'}
          info={
            <Explainer
              what="What's actually left after every running cost is paid: lab &amp; materials, all staff and clinician pay, and the other day-to-day overheads."
              how={<>Revenue minus lab &amp; materials gives gross profit; then we take off all staff/clinician pay and the other operating costs. The margin % is this profit divided by revenue.</>}
              now={<>You kept <b>{formatPence(t.netPence)}</b> of every <b>{formatPence(t.revPence)}</b> billed — a margin of <b>{pct(t.marginPct)}</b>.</>}
            />
          }
        />
        <KpiTile
          label="Staff & clinician ratio"
          value={pct(staffRatio)}
          delta={`${formatPence(t.staffPence)} incl. associate pay`}
          info={
            <Explainer
              what="How much of every pound you bill goes on paying people — both employed team and self-employed associate clinicians."
              how={<>We add up all the wages, salaries and associate/clinician pay posted in {srcLabel}, then divide that by revenue. A lower number means more of each pound is left over.</>}
              now={<><b>{formatPence(t.staffPence)}</b> of pay against <b>{formatPence(t.revPence)}</b> of revenue = <b>{pct(staffRatio)}</b> spent on people.</>}
            />
          }
        />
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
        <PanelHead
          title="Profit & Loss — group statement"
          sub="Revenue down to net operating profit for the current scope and period."
          right={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLinesInfo((o) => !o)}
                aria-label={linesInfo ? 'Hide what each line means' : 'What does each line mean?'}
                aria-expanded={linesInfo}
                className="shrink-0 w-5 h-5 rounded-full border border-border text-[11px] font-semibold text-ink-muted leading-none flex items-center justify-center hover:bg-surface-muted"
              >
                {linesInfo ? '×' : '?'}
              </button>
              <Pill tone="info">{basisPill}</Pill>
            </div>
          }
        />
        {linesInfo && (
          <div className="card-padded mb-2 text-[12px] text-ink-muted leading-relaxed">
            <div className="font-semibold text-ink mb-1">What each line means — all pulled from {isQbo ? 'QuickBooks' : 'your accounting records'}</div>
            <ul className="list-disc pl-4 flex flex-col gap-1">
              <li><b>Revenue</b> — total money billed for dental work, before any costs.</li>
              <li><b>Lab &amp; materials</b> — what you paid labs and for the materials used on patients.</li>
              <li><b>Gross profit</b> — revenue minus lab &amp; materials: what&apos;s left to run the practice.</li>
              <li><b>Staff &amp; clinician pay</b> — all wages, salaries and self-employed associate/clinician pay.</li>
              <li><b>Other operating costs</b> — every other running cost: rent, rates, marketing, insurance, software, and so on.</li>
              <li><b>Net operating profit</b> — what&apos;s left after all of the above: the profit the business actually makes.</li>
              <li><b>Net margin</b> — that profit as a share of revenue (profit ÷ revenue).</li>
            </ul>
          </div>
        )}
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
        <PanelHead
          title={isCompany ? 'P&L by Company' : 'P&L by Entity'}
          sub={data.perEntityAvailable
            ? (isCompany ? 'Each connected QuickBooks company with its own P&L.' : 'Each business in scope with its own tagged actuals.')
            : (isQbo ? 'Connect a QuickBooks company per entity to split this.' : 'Per-entity split needs practice-tagged actuals.')}
          right={<Pill tone="info">{basisPill}</Pill>}
        />
        {data.perEntityAvailable ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 600 }}>
              <thead>
                <tr className="border-b border-border">
                  {[isCompany ? 'Company' : 'Entity', 'Revenue', 'Lab & mat', 'Staff', 'Other opex', 'Net Profit', 'Margin'].map((h, i) => (
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
          <EmptyState message={isQbo
            ? "These QuickBooks rows aren't tagged to a company, so they can't be split per entity. Map each company to its QuickBooks realm in Integrations to unlock this."
            : "Your accounting feed posts at group level (no practice tag), so the P&L can't be split per entity yet. Tag actuals by practice in Xero/QuickBooks to unlock this."} />
        )}
      </Panel>
    </>
  );
}

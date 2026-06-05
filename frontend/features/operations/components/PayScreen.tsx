'use client';
// Associate Pay Run — live draft from /api/pay-runs/draft. Production per
// associate is summed from completed treatment_plans for the period and run
// through calculateAssociatePay on the backend.
//
// Caveats (reflected in the UI): lab cost has no feed yet (no lab-invoice
// import), so lab deduction is 0 and net == gross; NHS UDA production is
// excluded. Money arrives as integer pence -> converted to whole pounds here.

import { useMemo } from 'react';
import { formatPounds } from '@/features/_mock';
import { useDraftPayRun, lastCompleteMonth, type PayDraftRow } from '../pay-api';

const NEG = 'var(--danger)';
const BRAND = 'var(--brand)';

// pence -> whole pounds (formatPounds expects pounds); basis points -> percent.
const gbp = (pence: number) => Math.round(pence / 100);
const pct = (bps: number) => bps / 100;

/** Associate Pay Run screen — sourced from /api/pay-runs/draft. */
export default function PayScreen() {
  const period = useMemo(() => lastCompleteMonth(), []);
  const { data, isLoading, isError, error } = useDraftPayRun(period);
  const rows: PayDraftRow[] = data?.rows ?? [];
  const totals = data?.totals ?? { production: 0, gross: 0, lab: 0, net: 0 };

  const th: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--ink-muted)',
    fontWeight: 600,
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Associate Pay Run
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              {period.label} · Draft · {rows.length} associate{rows.length === 1 ? '' : 's'} · live from Dentally
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" style={{ fontSize: 13 }}>
              Upload lab invoices
            </button>
            <button className="btn-primary" style={{ fontSize: 13 }}>
              Approve &amp; export
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="card-padded text-ink-muted" style={{ fontSize: 13 }}>
          Loading pay run…
        </div>
      )}

      {isError && (
        <div className="card-padded" style={{ fontSize: 13, color: NEG }}>
          Could not load pay run: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* 4 KPIs */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Gross pay
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {formatPounds(gbp(totals.gross))}
              </div>
            </div>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Lab deductions
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {formatPounds(gbp(totals.lab))}
              </div>
              <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: 'var(--ink-muted)' }}>
                No lab-invoice feed yet
              </div>
            </div>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                Net to associates
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {formatPounds(gbp(totals.net))}
              </div>
            </div>
            <div className="card-padded">
              <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
                % of production
              </div>
              <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
                {(data?.pct_of_production ?? 0).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Pay-run table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div
              className="flex justify-between items-center"
              style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}
            >
              <h2 className="display font-bold" style={{ fontSize: 17 }}>
                {period.label} pay run
              </h2>
              <span className="chip chip-amber">Draft</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-ink-muted" style={{ fontSize: 13, padding: '16px 20px' }}>
                No completed production found for {period.label}. Run a Dentally sync to populate
                treatment plans.
              </p>
            ) : (
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead className="bg-bg" style={{ borderBottom: '1px solid var(--border)' }}>
                  <tr>
                    <th className="text-left" style={th}>
                      Associate
                    </th>
                    <th className="text-left" style={th}>
                      Practice
                    </th>
                    {['Production', 'Pay %', 'Gross', 'Lab cost', 'Lab deduct', 'Prev', 'Net pay'].map(
                      (h) => (
                        <th key={h} className="text-right" style={th}>
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.associate_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <strong>{a.full_name}</strong>
                      </td>
                      <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                        {a.practice ?? '—'}
                      </td>
                      <td className="text-right" style={{ padding: '12px 16px' }}>
                        {formatPounds(gbp(a.production_pence))}
                      </td>
                      <td className="text-right" style={{ padding: '12px 16px' }}>
                        {pct(a.pay_pct)}%
                      </td>
                      <td className="text-right" style={{ padding: '12px 16px' }}>
                        {formatPounds(gbp(a.gross_pence))}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '12px 16px' }}>
                        {formatPounds(gbp(a.lab_cost_pence))}
                      </td>
                      <td className="text-right" style={{ padding: '12px 16px', color: NEG }}>
                        {a.lab_deduction_pence ? `−${formatPounds(gbp(a.lab_deduction_pence))}` : '—'}
                      </td>
                      <td
                        className="text-right"
                        style={{ padding: '12px 16px', color: a.prev_balance_pence < 0 ? NEG : 'var(--ink-muted)' }}
                      >
                        {a.prev_balance_pence === 0 ? '—' : formatPounds(gbp(a.prev_balance_pence))}
                      </td>
                      <td
                        className="text-right"
                        style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, color: BRAND }}
                      >
                        {formatPounds(gbp(a.net_pence))}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-bg" style={{ fontWeight: 700 }}>
                    <td colSpan={4} style={{ padding: '12px 16px' }}>
                      TOTAL
                    </td>
                    <td className="text-right" style={{ padding: '12px 16px' }}>
                      {formatPounds(gbp(totals.gross))}
                    </td>
                    <td className="text-right" colSpan={2} style={{ padding: '12px 16px', color: NEG }}>
                      {totals.lab ? `−${formatPounds(gbp(totals.lab))}` : '—'}
                    </td>
                    <td />
                    <td
                      className="text-right"
                      style={{ padding: '12px 16px', fontSize: 15, color: BRAND }}
                    >
                      {formatPounds(gbp(totals.net))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

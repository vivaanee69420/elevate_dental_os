'use client';
// Tax (Making Tax Digital) — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.tax). VAT / Corporation tax /
// Self-assessment. Static mock data (no backend); annual revenue/profit come
// from ../data.ts at the prototype's scale.
//
// Data-flow (mirrors the prototype's arithmetic):
//
//   ANNUAL_REVENUE ──┬─► vatQuarterly = revenue * 0.12 / 4 * 0.20
//                     └─► VAT breakdown table (exempt 88% / standard 12%)
//   ANNUAL_PROFIT ───┬─► corpTax = profit>250k ? (profit-250k)*0.25 + 250k*0.19
//                     │                          : profit*0.19
//                     └─► Corp tax calc table (small-profits / main-rate split)
//                     └─► KPI tiles + HMRC deadlines table

import { Card } from '@/components/ui';
import { formatPounds } from '@/features/_mock';
import { ANNUAL_REVENUE, ANNUAL_PROFIT, formatPoundsCompact } from '../data';

// VAT chargeable on the ~12% standard-rated slice of quarterly revenue at 20%.
const VAT_QUARTERLY = Math.round((ANNUAL_REVENUE * 0.12) / 4 * 0.2);

// UK corporation tax: 19% on profit up to £250k, 25% on the excess.
const CORP_TAX =
  ANNUAL_PROFIT > 250000
    ? (ANNUAL_PROFIT - 250000) * 0.25 + 250000 * 0.19
    : ANNUAL_PROFIT * 0.19;

/** One KPI tile with a label, big value and a red "due" sub-line. */
function TaxKpi({ label, value, due }: { label: string; value: string; due: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      <div className="kpi-delta down">{due}</div>
    </div>
  );
}

/** Tax (MTD) page. */
export default function TaxScreen() {
  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Tax (Making Tax Digital)</h1>
        <p className="text-sm text-ink-muted mt-1">
          VAT &middot; Corporation tax &middot; Self-assessment
        </p>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}
      >
        <TaxKpi
          label="VAT due (current quarter)"
          value={formatPoundsCompact(VAT_QUARTERLY)}
          due="Due 7 Aug 2026"
        />
        <TaxKpi
          label="Corp tax accrual"
          value={formatPoundsCompact(CORP_TAX)}
          due="Due 9 months post-YE"
        />
        <TaxKpi
          label="Director SA estimate"
          value={formatPoundsCompact(35000)}
          due="Due 31 Jan 2027"
        />
      </div>

      <Card className="mb-4">
        <div className="flex justify-between" style={{ marginBottom: 16 }}>
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Upcoming HMRC deadlines
          </h2>
          <span className="chip chip-brand">MTD compliant</span>
        </div>
        <table className="table" style={{ margin: -16 }}>
          <thead>
            <tr>
              <th>Filing</th>
              <th>Period</th>
              <th className="right">Due</th>
              <th>Deadline</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>VAT return</strong>
              </td>
              <td>Apr-Jun 2026</td>
              <td className="right">{formatPounds(VAT_QUARTERLY)}</td>
              <td>7 Aug 2026</td>
              <td>
                <span className="chip chip-amber">Due 82d</span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>VAT return</strong>
              </td>
              <td>Jul-Sep 2026</td>
              <td className="right">{formatPounds(VAT_QUARTERLY)}</td>
              <td>7 Nov 2026</td>
              <td>
                <span className="chip chip-blue">Scheduled</span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Corporation Tax</strong>
              </td>
              <td>FY26</td>
              <td className="right">{formatPoundsCompact(CORP_TAX)}</td>
              <td>1 Feb 2027</td>
              <td>
                <span className="chip chip-blue">Scheduled</span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Self Assessment</strong>
              </td>
              <td>FY25-26</td>
              <td className="right">£35,000</td>
              <td>31 Jan 2027</td>
              <td>
                <span className="chip chip-blue">Scheduled</span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>P60 / P11D</strong>
              </td>
              <td>FY25-26</td>
              <td className="right">&mdash;</td>
              <td>6 Jul 2026</td>
              <td>
                <span className="chip chip-emerald">Filed</span>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <h2
            className="display font-semibold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            VAT breakdown
          </h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Total quarterly revenue
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPoundsCompact(ANNUAL_REVENUE / 4)}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Exempt (dental services)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPoundsCompact((ANNUAL_REVENUE / 4) * 0.88)}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Standard rated (cosmetic, retail)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPoundsCompact((ANNUAL_REVENUE / 4) * 0.12)}
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0' }}>
                  <strong>VAT due (20%)</strong>
                </td>
                <td
                  style={{ textAlign: 'right', fontWeight: 700, color: 'var(--brand)' }}
                >
                  {formatPounds(VAT_QUARTERLY)}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <h2
            className="display font-semibold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            Corp tax calc
          </h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Annual profit
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPoundsCompact(ANNUAL_PROFIT)}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Small profits band (£250k @ 19%)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPounds(Math.min(ANNUAL_PROFIT, 250000) * 0.19)}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Main rate (over £250k @ 25%)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPounds(Math.max(0, ANNUAL_PROFIT - 250000) * 0.25)}
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0' }}>
                  <strong>Total corporation tax</strong>
                </td>
                <td
                  style={{ textAlign: 'right', fontWeight: 700, color: 'var(--brand)' }}
                >
                  {formatPoundsCompact(CORP_TAX)}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

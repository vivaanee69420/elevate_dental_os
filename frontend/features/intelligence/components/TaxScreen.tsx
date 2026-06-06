'use client';
// Tax (Making Tax Digital) — VAT / PAYE / Self-assessment for a UK dental group.
// Static mock data (no backend); annual revenue comes from ../data.ts at the
// prototype's scale.
//
// UK tax model (corporation tax lives on its own; not shown here):
//
//   ANNUAL_REVENUE ──┬─► vatQuarterly = standard-rated slice * 20%
//                     └─► VAT breakdown table (exempt dental care vs standard-rated)
//
// Dental specifics: clinical dental treatment by a registered professional is a
// VAT-EXEMPT supply of medical care; only cosmetic-only work, teeth whitening and
// retail (toothbrushes, whitening kits) are standard-rated at 20%. VAT
// registration threshold is £90,000 taxable turnover. MTD for VAT is mandatory;
// MTD for Income Tax Self Assessment (ITSA) phases in from Apr 2026 for the
// director's >£50k self-employment/property income.

import { Card } from '@/components/ui';
import { formatPounds } from '@/features/_mock';
import { ANNUAL_REVENUE, formatPoundsCompact } from '../data';

// Standard-rated share of revenue (cosmetic-only, whitening, retail) — the rest
// is exempt clinical dental care. VAT chargeable on that slice at 20%.
const STANDARD_RATED_SHARE = 0.12;
const VAT_QUARTERLY = Math.round((ANNUAL_REVENUE * STANDARD_RATED_SHARE) / 4 * 0.2);

// Director Self Assessment estimate (income tax + Class 4 NIC on profit share).
const SA_ESTIMATE = 35000;
// Self Assessment is paid in two payments on account at 50% each.
const SA_PAYMENT_ON_ACCOUNT = Math.round(SA_ESTIMATE / 2);

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
          VAT &middot; PAYE &amp; payroll &middot; Self-assessment
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
          label="PAYE / NIC (this month)"
          value={formatPoundsCompact(0)}
          due="Due 22nd (RTI)"
        />
        <TaxKpi
          label="Director SA estimate"
          value={formatPoundsCompact(SA_ESTIMATE)}
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
                <strong>PAYE / NIC (RTI)</strong>
              </td>
              <td>Monthly</td>
              <td className="right">&mdash;</td>
              <td>22nd each month</td>
              <td>
                <span className="chip chip-blue">Scheduled</span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Self Assessment</strong>
              </td>
              <td>FY25-26</td>
              <td className="right">{formatPounds(SA_ESTIMATE)}</td>
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
                  Exempt (clinical dental care)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPoundsCompact((ANNUAL_REVENUE / 4) * (1 - STANDARD_RATED_SHARE))}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Standard rated (cosmetic, whitening, retail)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPoundsCompact((ANNUAL_REVENUE / 4) * STANDARD_RATED_SHARE)}
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
            Self-assessment (director)
          </h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Estimated tax + Class 4 NIC
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPounds(SA_ESTIMATE)}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Balancing payment (31 Jan 2027)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPounds(SA_PAYMENT_ON_ACCOUNT)}
                </td>
              </tr>
              <tr>
                <td className="text-ink-muted" style={{ padding: '6px 0' }}>
                  Payment on account (31 Jul 2027)
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatPounds(SA_PAYMENT_ON_ACCOUNT)}
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0' }}>
                  <strong>MTD for ITSA</strong>
                </td>
                <td
                  style={{ textAlign: 'right', fontWeight: 700, color: 'var(--brand)' }}
                >
                  From Apr 2026
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

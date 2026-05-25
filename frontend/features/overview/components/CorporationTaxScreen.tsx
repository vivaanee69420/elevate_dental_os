'use client';
// Corporation Tax Planning — faithful port of elevate-dental-os.html
// (PAGES['corp-tax']). Static mock data at the prototype's scale: annual
// tax liability across the small-profits band and main rate, quarterly VAT,
// and tax-planning levers. Whole-pounds display via _mock formatPounds.

import { Card } from '@/components/ui';
import { formatPounds } from '@/features/_mock';

const ANNUAL_PROFIT = 374000;
const AIA = 18200;
const TAXABLE = ANNUAL_PROFIT - AIA;
const SMALL_BAND = Math.min(TAXABLE, 250000) * 0.19;
const MAIN_RATE = Math.max(0, TAXABLE - 250000) * 0.25;
const CORP_TAX = SMALL_BAND + MAIN_RATE;
const EFFECTIVE = (CORP_TAX / ANNUAL_PROFIT) * 100;
const SAVING = 87100;
const EFFECTIVE_AFTER = ((CORP_TAX - SAVING) / ANNUAL_PROFIT) * 100;

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div
        className="display text-2xl font-bold mt-1"
        style={tone === 'warn' ? { color: 'var(--warning, #F59E0B)' } : undefined}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

const LEVERS = [
  { lever: 'AIA on CBCT scanner', saving: 42500, impl: 'Capex before 31 Mar 2027', deadline: '31 Mar 2027', status: 'Consider', chip: 'chip-amber' },
  { lever: 'Pension contribution (Director SSAS)', saving: 14800, impl: '£40k contribution', deadline: '31 Mar 2027', status: 'Recommended', chip: 'chip-emerald' },
  { lever: 'R&D tax credit (clinical innovation)', saving: 18200, impl: 'Submit with accounts', deadline: '2 yrs post-FY', status: 'Pending', chip: 'chip-amber' },
  { lever: 'Staff bonus (deductible)', saving: 8400, impl: '£35k bonus pool', deadline: 'FY end', status: 'Annual', chip: 'chip-blue' },
  { lever: 'Director loan repayment timing', saving: 3200, impl: 'Repay within 9mo of period end', deadline: '9mo post FY', status: 'Scheduled', chip: 'chip-emerald' },
];

export default function CorporationTaxScreen() {
  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Corporation Tax Planning</h1>
        <p className="text-sm text-ink-muted mt-1">
          Annual tax liability &middot; small profits band, main rate, quarterly VAT. Plan reliefs and timing.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
        <Kpi label="Annual profit" value={formatPounds(ANNUAL_PROFIT)} sub="FY26" />
        <Kpi label="Estimated corp tax" value={formatPounds(CORP_TAX)} sub="Due 1 Feb 2027" tone="warn" />
        <Kpi label="Effective tax rate" value={`${EFFECTIVE.toFixed(1)}%`} />
        <Kpi label="Quarterly VAT due" value="£42,180" sub="7 Jul 2026" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>
            Corporation tax calc &middot; FY26
          </h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Annual profit (per management accounts)</td><td style={{ textAlign: 'right' }}>{formatPounds(ANNUAL_PROFIT)}</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Add back: non-deductible</td><td style={{ textAlign: 'right' }}>£0</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Less: capital allowances (AIA)</td><td style={{ textAlign: 'right', color: 'var(--danger, #EF4444)' }}>-{formatPounds(AIA)}</td></tr>
              <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}><td style={{ padding: '8px 0' }}>Taxable profit</td><td style={{ textAlign: 'right' }}>{formatPounds(TAXABLE)}</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Small profits band (£0-£250k @ 19%)</td><td style={{ textAlign: 'right' }}>{formatPounds(SMALL_BAND)}</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Main rate (over £250k @ 25%)</td><td style={{ textAlign: 'right' }}>{formatPounds(MAIN_RATE)}</td></tr>
              <tr style={{ borderTop: '2px solid var(--ink, #1F2937)', fontWeight: 600 }}><td style={{ padding: '8px 0' }}>Total corporation tax</td><td style={{ textAlign: 'right', color: 'var(--brand)', fontWeight: 700 }}>{formatPounds(CORP_TAX)}</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Due date</td><td style={{ textAlign: 'right' }}>1 Feb 2027</td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>
            VAT breakdown &middot; Q1 FY26
          </h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Total quarterly revenue</td><td style={{ textAlign: 'right' }}>£920,000</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Exempt (dental services)</td><td style={{ textAlign: 'right' }}>£809,600</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Standard rated (cosmetic, retail)</td><td style={{ textAlign: 'right' }}>£110,400</td></tr>
              <tr><td className="text-ink-muted" style={{ padding: '6px 0' }}>Input VAT reclaim</td><td style={{ textAlign: 'right', color: 'var(--danger, #EF4444)' }}>-£6,420</td></tr>
              <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}><td style={{ padding: '8px 0' }}>VAT due (20%)</td><td style={{ textAlign: 'right', color: 'var(--brand)', fontWeight: 700 }}>£15,660</td></tr>
            </tbody>
          </table>
          <div className="text-xs text-ink-muted mt-3" style={{ background: 'var(--brand-50, #E6F2F2)', padding: 10, borderRadius: 8 }}>
            Dental services are VAT-exempt (Group 7, Sched 9 VATA 1994). Standard-rated: whitening, mouthguards, dental products, cosmetic.
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>
          Tax planning levers &middot; FY26
        </h2>
        <table className="table">
          <thead>
            <tr><th>Lever</th><th className="right">Saving</th><th>Implementation</th><th>Deadline</th><th>Status</th></tr>
          </thead>
          <tbody>
            {LEVERS.map((l) => (
              <tr key={l.lever}>
                <td>{l.lever}</td>
                <td className="right" style={{ color: 'var(--success, #10B981)' }}>{formatPounds(l.saving)}</td>
                <td>{l.impl}</td>
                <td>{l.deadline}</td>
                <td><span className={`chip ${l.chip}`}>{l.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-sm mt-3" style={{ background: 'var(--brand-50, #E6F2F2)', padding: 12, borderRadius: 8 }}>
          <b>Total saving potential: {formatPounds(SAVING)}</b> — reduces effective rate from {EFFECTIVE.toFixed(1)}% to {EFFECTIVE_AFTER.toFixed(1)}%.
        </div>
      </Card>
    </div>
  );
}

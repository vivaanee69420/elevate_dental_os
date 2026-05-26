// Intelligence section — local mock-data layer.
//
// The Intelligence screens (Scenario Planner, Tax/MTD, Debt Recovery, Alerts)
// are fed entirely by the figures hard-coded in the prototype
// (preview/elevate-dental-os-v2.html, PAGES.scenarios/tax/debt/alerts). The
// shared @/features/_mock module does not expose the group P&L totals the Tax
// screen needs, so the annual revenue/profit baseline is reproduced here at the
// prototype's scale (~£10.3m turnover, ~23.5% margin). When real
// /api/analytics endpoints land, swap these constants for fetched data; the
// component contracts stay stable.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic and
// @/features/_mock's formatPounds). Pence conversion happens at the future
// backend swap point, not here.

/**
 * Group trailing-12-month revenue, reproduced from the prototype dataset
 * (12 synthesised months at the prototype's scale). Whole pounds.
 */
export const ANNUAL_REVENUE = (() => {
  // Same month synthesis the prototype dataset uses, summed to a yearly total.
  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += Math.round(815000 + i * 9000 + (i % 3) * 12000);
  }
  return total;
})();

/** Group annual EBITDA at the prototype's blended 23.5% margin. Whole pounds. */
export const ANNUAL_PROFIT = Math.round(ANNUAL_REVENUE * 0.235);

/** A single modelled what-if scenario shown on the Scenario Planner. */
export interface Scenario {
  title: string;
  revenue: number;
  profit: number;
  cash: number;
  valuation: number;
  summary: string;
  status: 'positive' | 'negative' | 'neutral';
}

/** The six what-if scenarios, verbatim from PAGES.scenarios. */
export const SCENARIOS: Scenario[] = [
  {
    title: 'Hire new associate (Bexleyheath)',
    revenue: 280000,
    profit: 140000,
    cash: -12000,
    valuation: 840000,
    summary: 'Recruitment £8k + lost productivity months 1-2. Break-even month 4.',
    status: 'positive',
  },
  {
    title: 'Buy practice in Maidstone (£950k)',
    revenue: 580000,
    profit: 160000,
    cash: -380000,
    valuation: 960000,
    summary: '60% loan / 40% equity. Adds 25% to group EBITDA.',
    status: 'positive',
  },
  {
    title: 'Raise private fees 8%',
    revenue: 95000,
    profit: 95000,
    cash: 95000,
    valuation: 570000,
    summary: 'Some patient churn (4-6%). Net positive even at 10% churn.',
    status: 'positive',
  },
  {
    title: 'Lose top associate (Dr Mitchell)',
    revenue: -412000,
    profit: -206000,
    cash: -50000,
    valuation: -1236000,
    summary:
      'Worst case. Recruitment + 3-month productivity gap. Mitigation: bonus structure.',
    status: 'negative',
  },
  {
    title: 'Drop NHS contract (Rochester)',
    revenue: -380000,
    profit: -200000,
    cash: 28000,
    valuation: -1200000,
    summary:
      'Net negative short-term but releases chair capacity for private. Revisit at 6 months.',
    status: 'negative',
  },
  {
    title: 'Open 6th site (organic, 2027)',
    revenue: 480000,
    profit: 80000,
    cash: -180000,
    valuation: 480000,
    summary:
      'Greenfield startup. Year 1 slow, breakeven month 14. Lower risk than acquisition.',
    status: 'neutral',
  },
];

/** A configurable alert-threshold definition shown on the Alerts screen. */
export interface AlertThreshold {
  id: string;
  label: string;
  defaultValue: number;
  unit: string;
}

/** Alert thresholds, verbatim from PAGES.alerts. */
export const ALERT_THRESHOLDS: AlertThreshold[] = [
  { id: 'cash_low', label: 'Bank balance drops below', defaultValue: 50000, unit: '£' },
  { id: 'response_sla', label: 'Lead response time exceeds (min)', defaultValue: 60, unit: 'min' },
  { id: 'fta_rate', label: 'FTA rate exceeds (%)', defaultValue: 8, unit: '%' },
  { id: 'conversion_low', label: 'Conversion drops below (%)', defaultValue: 12, unit: '%' },
  { id: 'revenue_drop', label: 'Monthly revenue drops more than (%)', defaultValue: 10, unit: '%' },
  { id: 'lab_pending', label: 'Lab invoices pending approval', defaultValue: 5, unit: '' },
];

/** Notification channels, verbatim from PAGES.alerts. */
export const ALERT_CHANNELS: { key: string; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS (urgent)' },
  { key: 'slack', label: 'Slack' },
  { key: 'in_app', label: 'In-app notification' },
];

/** Digest frequency options, verbatim from PAGES.alerts. */
export const DIGEST_OPTIONS = ['hourly', 'daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_OPTIONS)[number];

/**
 * Compact money formatter mirroring the prototype's formatPoundsCompact:
 * >=1M -> "£1.2M", >=1k -> "£124k", else "£840". Keeps sign for negatives.
 */
export function formatPoundsCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '£' + Math.round(n / 1_000) + 'k';
  return '£' + Math.round(n);
}

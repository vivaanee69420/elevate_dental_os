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
// Zero until the group P&L feed is wired (no real /api/analytics endpoint yet).
// 0 is shown rather than a synthesised prototype baseline.
export const ANNUAL_REVENUE = 0;

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

// Scenario shells kept as structure; all modelled outputs are 0 until the
// scenario engine is wired to real group data. 0 is shown rather than the
// prototype's synthesised what-if figures.
export const SCENARIOS: Scenario[] = [
  {
    title: 'Hire new associate (Bexleyheath)',
    revenue: 0,
    profit: 0,
    cash: 0,
    valuation: 0,
    summary: 'Recruitment £8k + lost productivity months 1-2. Break-even month 4.',
    status: 'neutral',
  },
  {
    title: 'Buy practice in Maidstone (£950k)',
    revenue: 0,
    profit: 0,
    cash: 0,
    valuation: 0,
    summary: '60% loan / 40% equity. Adds 25% to group EBITDA.',
    status: 'neutral',
  },
  {
    title: 'Raise private fees 8%',
    revenue: 0,
    profit: 0,
    cash: 0,
    valuation: 0,
    summary: 'Some patient churn (4-6%). Net positive even at 10% churn.',
    status: 'neutral',
  },
  {
    title: 'Lose top associate (Dr Mitchell)',
    revenue: 0,
    profit: 0,
    cash: 0,
    valuation: 0,
    summary:
      'Worst case. Recruitment + 3-month productivity gap. Mitigation: bonus structure.',
    status: 'neutral',
  },
  {
    title: 'Drop NHS contract (Rochester)',
    revenue: 0,
    profit: 0,
    cash: 0,
    valuation: 0,
    summary:
      'Net negative short-term but releases chair capacity for private. Revisit at 6 months.',
    status: 'neutral',
  },
  {
    title: 'Open 6th site (organic, 2027)',
    revenue: 0,
    profit: 0,
    cash: 0,
    valuation: 0,
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

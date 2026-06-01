// ============================================================================
// Business-health metric catalog — single source of truth for backend
// resolution AND frontend scorecard/progress rendering.
//   sourceType 'auto'   => `current` computed live from analytics actuals.
//   sourceType 'manual' => `current` read from business_health.manual[key].
// `target` is a sensible default goal used until an owner sets a per-metric
// target; `better` drives the traffic-light direction.
// ============================================================================
export const METRIC_CATALOG = [
  // Financial
  { key: 'annual_revenue',   label: 'Annual revenue',          cat: 'Financial',    unit: '£',   better: 'higher', sourceType: 'auto',   target: null },
  { key: 'net_profit',       label: 'Net profit',              cat: 'Financial',    unit: '£',   better: 'higher', sourceType: 'auto',   target: null },
  { key: 'net_profit_margin',label: 'Net profit margin',       cat: 'Financial',    unit: '%',   better: 'higher', sourceType: 'auto',   target: 18 },
  { key: 'cash_at_bank',     label: 'Cash at bank',            cat: 'Financial',    unit: '£',   better: 'higher', sourceType: 'auto',   target: null },
  { key: 'lab_cost_pct',     label: 'Lab cost % revenue',      cat: 'Financial',    unit: '%',   better: 'lower',  sourceType: 'manual', target: 15 },
  { key: 'staff_cost_pct',   label: 'Staff cost % revenue',    cat: 'Financial',    unit: '%',   better: 'lower',  sourceType: 'manual', target: 16 },
  { key: 'aged_debtors_90',  label: 'Aged debtors >90 days',   cat: 'Financial',    unit: '%',   better: 'lower',  sourceType: 'manual', target: 0.5 },
  // Patient
  { key: 'new_patients_month', label: 'New patients per month', cat: 'Patient',     unit: '',    better: 'higher', sourceType: 'manual', target: 220 },
  { key: 'active_patients',  label: 'Active patient base',     cat: 'Patient',      unit: '',    better: 'higher', sourceType: 'manual', target: 16000 },
  { key: 'retention_12mo',   label: 'Patient retention (12mo)',cat: 'Patient',      unit: '%',   better: 'higher', sourceType: 'manual', target: 92 },
  { key: 'recall_compliance',label: 'Recall compliance',       cat: 'Patient',      unit: '%',   better: 'higher', sourceType: 'manual', target: 90 },
  { key: 'nps',              label: 'Net Promoter Score',      cat: 'Patient',      unit: '',    better: 'higher', sourceType: 'manual', target: 60 },
  // Conversion
  { key: 'lead_to_treatment',label: 'Overall lead-to-treatment',cat: 'Conversion',  unit: '%',   better: 'higher', sourceType: 'auto',   target: 18 },
  { key: 'avg_case_value',   label: 'Average case value',      cat: 'Conversion',   unit: '£',   better: 'higher', sourceType: 'manual', target: 3200 },
  // Operational
  { key: 'chair_utilisation',label: 'Chair utilisation',       cat: 'Operational',  unit: '%',   better: 'higher', sourceType: 'manual', target: 88 },
  { key: 'fta_no_show_rate', label: 'FTA / no-show rate',      cat: 'Operational',  unit: '%',   better: 'lower',  sourceType: 'auto',   target: 5 },
  { key: 'lead_response_time',label: 'Lead response time (min)',cat: 'Operational',  unit: 'min', better: 'lower',  sourceType: 'manual', target: 5 },
  { key: 'same_day_fill',    label: 'Same-day appointment fill',cat: 'Operational', unit: '%',   better: 'higher', sourceType: 'manual', target: 80 },
  { key: 'production_per_associate', label: 'Production per associate / mo', cat: 'Operational', unit: '£', better: 'higher', sourceType: 'manual', target: 42000 },
];

export const METRIC_BY_KEY = Object.fromEntries(METRIC_CATALOG.map((m) => [m.key, m]));

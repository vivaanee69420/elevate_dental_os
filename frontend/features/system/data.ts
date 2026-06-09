// System feature mock-data layer — pixel-faithful port of the
// Integrations and Team Permissions fixtures in
// preview/elevate-dental-os-v2.html (PAGES.integrations integration list,
// PAGE_META, DEFAULT_PM_PAGES, DEFAULT_RECEPTION_PAGES).
//
// No API, no persistence — these are static snapshots so both System
// screens render exactly as the prototype's default state. When real
// endpoints land, screens swap to a data hook; shapes stay stable.

/** A third-party integration tile. */
export interface Integration {
  name: string;
  category: string;
  status: 'connected' | 'disconnected';
  desc: string;
}

/**
 * Connectable integrations, in prototype order. The prototype rendered an
 * emoji per tile; per project rule 7 we drop the glyph and keep the name +
 * description (the chip already communicates connection state).
 */
export const INTEGRATIONS: Integration[] = [
  { name: 'Xero', category: 'Accounting', status: 'connected', desc: 'Auto-sync revenue, expenses, lab invoices' },
  { name: 'QuickBooks', category: 'Accounting', status: 'disconnected', desc: 'Alternative to Xero' },
  { name: 'Dentally', category: 'Clinical PMS', status: 'connected', desc: 'Patient records, appointments, treatment plans' },
  { name: 'SOE Exact', category: 'Clinical PMS', status: 'disconnected', desc: 'Alternative PMS' },
  { name: 'Stripe', category: 'Payments', status: 'connected', desc: 'Patient payments, deposits, plans' },
  { name: 'GoCardless', category: 'Payments', status: 'connected', desc: 'Direct debit for membership plans' },
  { name: 'Twilio', category: 'Messaging', status: 'connected', desc: 'SMS reminders, workflow messages' },
  { name: 'Postmark', category: 'Email', status: 'connected', desc: 'Transactional email delivery' },
  { name: 'TrueLayer', category: 'Banking', status: 'connected', desc: 'Open banking · cash flow sync' },
  { name: 'Meta Ads', category: 'Marketing', status: 'connected', desc: 'Auto-sync spend and leads via UTM' },
  { name: 'Google Ads', category: 'Marketing', status: 'connected', desc: 'Spend tracking, ROAS reporting' },
  { name: 'Google Business Profile', category: 'Reputation', status: 'connected', desc: 'Reviews sync to dashboard' },
  { name: 'Trustpilot', category: 'Reputation', status: 'disconnected', desc: 'Review management' },
  { name: 'Slack', category: 'Internal', status: 'connected', desc: 'Alerts and daily digest' },
  { name: 'Zapier', category: 'Automation', status: 'disconnected', desc: 'Connect to 5000+ apps' },
];

/** Metadata for one product page (used by Team Permissions). */
export interface PageMeta {
  id: string;
  label: string;
  section: string;
  importance: 'major' | 'minor';
  ownerOnly?: boolean;
}

/**
 * Page catalogue grouped by sidebar section — a faithful copy of the
 * prototype's PAGE_META, in declaration order. Wealth pages are
 * owner-only forever (project rule 5 sibling: personal wealth never
 * delegated).
 */
export const PAGE_META: PageMeta[] = [
  // Overview
  { id: 'dashboard', label: 'Command Centre', section: 'Overview', importance: 'major' },
  { id: 'ai-insights', label: 'AI Insights', section: 'Overview', importance: 'major' },
  { id: 'p4g-ai', label: 'Plan4Growth AI chat', section: 'Overview', importance: 'minor' },
  { id: 'mobile', label: 'Mobile App', section: 'Overview', importance: 'minor' },
  // Finance
  { id: 'cashflow', label: 'Cash Flow', section: 'Finance', importance: 'major' },
  { id: 'profit', label: 'Profit & Loss', section: 'Finance', importance: 'major' },
  { id: 'financial', label: 'Financial Statements', section: 'Finance', importance: 'minor' },
  { id: 'payments', label: 'Patient Payments', section: 'Finance', importance: 'major' },
  { id: 'valuation', label: 'Valuation', section: 'Finance', importance: 'major' },
  // Business Health
  { id: 'healthsetup', label: 'Setup & Targets', section: 'Business Health', importance: 'major' },
  { id: 'progress', label: 'Progress Tracker', section: 'Business Health', importance: 'major' },
  { id: 'kpiscorecard', label: 'KPI Scorecard', section: 'Business Health', importance: 'major' },
  // Operations
  { id: 'associates', label: 'Associates', section: 'Operations', importance: 'major' },
  { id: 'staff', label: 'Staff Scheduling', section: 'Operations', importance: 'major' },
  { id: 'pay', label: 'Associate Pay', section: 'Operations', importance: 'major' },
  { id: 'chair', label: 'Chair Utilisation', section: 'Operations', importance: 'minor' },
  { id: 'treatments', label: 'Treatments', section: 'Operations', importance: 'minor' },
  { id: 'uda', label: 'UDA Tracker', section: 'Operations', importance: 'minor' },
  // Intelligence
  { id: 'tax', label: 'Tax (MTD)', section: 'Intelligence', importance: 'major' },
  { id: 'debt', label: 'Debt Recovery', section: 'Intelligence', importance: 'major' },
  { id: 'alerts', label: 'Alerts', section: 'Intelligence', importance: 'minor' },
  // Growth
  { id: 'patients', label: 'Patients', section: 'Growth', importance: 'major' },
  { id: 'marketing', label: 'Marketing', section: 'Growth', importance: 'major' },
  { id: 'loyalty', label: 'Loyalty & Members', section: 'Growth', importance: 'major' },
  { id: 'reviews', label: 'Reviews', section: 'Growth', importance: 'major' },
  { id: 'booking', label: 'Online Booking', section: 'Growth', importance: 'major' },
  { id: 'benchmark', label: 'Benchmark', section: 'Growth', importance: 'minor' },
  // Elevate CRM
  { id: 'inbox', label: 'Inbox', section: 'Elevate CRM', importance: 'major' },
  { id: 'pipeline', label: 'Pipeline', section: 'Elevate CRM', importance: 'major' },
  { id: 'contacts', label: 'Contacts', section: 'Elevate CRM', importance: 'major' },
  { id: 'workflows', label: 'Automations', section: 'Elevate CRM', importance: 'minor' },
  { id: 'pages', label: 'Landing Pages', section: 'Elevate CRM', importance: 'minor' },
  { id: 'crm-today', label: 'Today (Tasks)', section: 'Elevate CRM', importance: 'major' },
  { id: 'crm-leads', label: 'Leads Table', section: 'Elevate CRM', importance: 'major' },
  { id: 'crm-enquiries', label: 'Enquiries', section: 'Elevate CRM', importance: 'major' },
  { id: 'crm-sequences', label: 'Nurturing Sequences', section: 'Elevate CRM', importance: 'major' },
  { id: 'crm-templates', label: 'Message Templates', section: 'Elevate CRM', importance: 'minor' },
  { id: 'crm-reports', label: 'CRM Reports', section: 'Elevate CRM', importance: 'major' },
  { id: 'crm-settings', label: 'CRM Settings', section: 'Elevate CRM', importance: 'minor' },
  { id: 'crm-lead-detail', label: 'Lead Detail', section: 'Elevate CRM', importance: 'minor' },
  // Wealth — owner only forever
  { id: 'wealth-net', label: 'Net Worth', section: 'Wealth', importance: 'major', ownerOnly: true },
  { id: 'wealth-prop', label: 'Property Portfolio', section: 'Wealth', importance: 'major', ownerOnly: true },
  { id: 'wealth-pen', label: 'Pensions', section: 'Wealth', importance: 'major', ownerOnly: true },
  { id: 'exit-plan', label: 'Exit Plan', section: 'Overview', importance: 'major', ownerOnly: true },
  // Training
  { id: 'training-library', label: 'Module Library', section: 'Training', importance: 'major' },
  { id: 'training-my', label: 'My Modules', section: 'Training', importance: 'major' },
  { id: 'training-mentorship', label: 'Mentorship Calls', section: 'Training', importance: 'major' },
  { id: 'training-onetoone', label: '1-to-1 Coaching', section: 'Training', importance: 'major' },
  { id: 'training-module', label: 'Module Player', section: 'Training', importance: 'minor' },
  // System
  { id: 'integrations', label: 'Integrations', section: 'System', importance: 'minor' },
  { id: 'team-permissions', label: 'Team Permissions', section: 'System', importance: 'minor', ownerOnly: true },
  { id: 'settings', label: 'Settings', section: 'System', importance: 'minor' },
];

/** Default Practice Manager page grants (prototype DEFAULT_PM_PAGES). */
export const DEFAULT_PM_PAGES: string[] = [
  'dashboard', 'ai-insights', 'p4g-ai', 'mobile',
  'progress', 'kpiscorecard',
  'associates', 'staff', 'chair', 'treatments', 'uda',
  'alerts',
  'patients', 'marketing', 'loyalty', 'reviews', 'booking',
  'inbox', 'pipeline', 'contacts', 'workflows', 'pages',
  'crm-today', 'crm-leads', 'crm-enquiries', 'crm-sequences', 'crm-templates', 'crm-reports', 'crm-lead-detail',
  'training-library', 'training-my', 'training-module',
];

/** Default Reception page grants (prototype DEFAULT_RECEPTION_PAGES). */
export const DEFAULT_RECEPTION_PAGES: string[] = [
  'crm-today', 'inbox', 'pipeline', 'crm-leads', 'crm-enquiries', 'contacts', 'crm-lead-detail',
];

/** Section colour + section order, matching the prototype's sidebar. */
export const SECTION_COLOURS: Record<
  string,
  { colour: string; bg: string }
> = {
  Overview: { colour: '#0E7C7B', bg: '#E6F2F2' },
  Finance: { colour: '#059669', bg: '#D1FAE5' },
  'Business Health': { colour: '#7C3AED', bg: '#EDE9FE' },
  Operations: { colour: '#0284C7', bg: '#DBEAFE' },
  Intelligence: { colour: '#DB2777', bg: '#FCE7F3' },
  Growth: { colour: '#EA580C', bg: '#FED7AA' },
  'Elevate CRM': { colour: '#0891B2', bg: '#CFFAFE' },
  Wealth: { colour: '#CA8A04', bg: '#FEF3C7' },
  Training: { colour: '#9333EA', bg: '#F3E8FF' },
  System: { colour: '#6B7280', bg: '#F3F4F6' },
};

/** Sidebar section order (prototype sectionOrder). */
export const SECTION_ORDER: string[] = [
  'Overview',
  'Finance',
  'Business Health',
  'Operations',
  'Intelligence',
  'Growth',
  'Elevate CRM',
  'Wealth',
  'Training',
  'System',
];

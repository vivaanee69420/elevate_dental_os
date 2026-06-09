// Shared navigation config — single source of truth for both the Sidebar
// and the SectionTabs bar. Mirrors the prototype (elevate-dental-os.html)
// section grouping. Section agents add screens behind these routes; RBAC
// visibility is resolved per item via lib/permissions canAccessRoute.
//
// Overview is the prototype's 10-screen group (Command Centre … Alerts).
// `isNew` renders a small NEW badge, matching the prototype's NEW_FEATURES.

export type NavItem = {
  id: string;
  label: string;
  isNew?: boolean;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV: NavSection[] = [
  { label: 'Overview', items: [
    { id: 'dashboard', label: 'Command Centre' },
    { id: 'business-hub', label: 'Business Hub', isNew: true },
    { id: 'deep-dive', label: 'Practice Deep Dive', isNew: true },
    { id: 'task-manager', label: 'Task Manager' },
    { id: 'ai-insights', label: 'AI Analyst', isNew: true },
    { id: 'day', label: 'Day · Cash Collected', isNew: true },
    { id: 'p4g-ai', label: 'Mastermind AI' },
    { id: 'tax', label: 'Tax (MTD)' },
    { id: 'debt', label: 'Debt Recovery' },
    { id: 'alerts', label: 'Alerts' },
  ]},
  { label: 'Finance', items: [
    { id: 'cashflow', label: 'Cash Flow' },
    { id: 'workbench', label: 'Treatment Economics', isNew: true },
    { id: 'profit', label: 'Profit & Loss' },
    { id: 'financial', label: 'P&L & Margin' },
    { id: 'payments', label: 'Patient Payments' },
    { id: 'leakage', label: 'Revenue Leakage', isNew: true },
    { id: 'valuation', label: 'Value & Growth' },
  ]},
  { label: 'Business Health', items: [
    { id: 'health-setup', label: 'Setup & Targets' },
    { id: 'progress', label: 'Progress Tracker' },
    { id: 'kpiscorecard', label: 'KPI Scorecard' },
  ]},
  { label: 'Operations', items: [
    { id: 'appointments', label: 'Appointments', isNew: true },
    { id: 'associates', label: 'Associates' },
    { id: 'clinicians', label: 'Clinicians', isNew: true },
    { id: 'staff', label: 'Staff Scheduling' },
    { id: 'pay', label: 'Associate Pay' },
    { id: 'chair', label: 'Chair Utilisation' },
    { id: 'treatments', label: 'Treatments' },
    { id: 'uda', label: 'UDA Tracker' },
  ]},
  { label: 'Growth', items: [
    { id: 'patients', label: 'Patients' },
    { id: 'marketing', label: 'Marketing & ROI' },
    { id: 'loyalty', label: 'Loyalty & Members' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'booking', label: 'Online Booking' },
    { id: 'benchmark', label: 'Benchmark' },
  ]},
  { label: 'Elevate CRM', items: [
    { id: 'crm-today', label: 'Today' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'leads', label: 'Leads' },
    { id: 'crm-enquiries', label: 'Enquiries' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'crm-reports', label: 'CRM Reports' },
    { id: 'workflows', label: 'Automations' },
  ]},
  { label: 'Wealth', items: [
    { id: 'wealth-net', label: 'Net Worth' },
    { id: 'wealth-prop', label: 'Property' },
    { id: 'wealth-pen', label: 'Pensions' },
    { id: 'wealth-fire', label: 'FIRE Plan' },
  ]},
  { label: 'Training', items: [
    { id: 'training-library', label: 'Module Library' },
    { id: 'training-my', label: 'My Modules' },
    { id: 'training-mentorship', label: 'Mentorship Calls' },
    { id: 'training-onetoone', label: '1-to-1 Coaching' },
  ]},
  { label: 'System', items: [
    { id: 'integrations', label: 'Integrations' },
    { id: 'data-hub', label: 'Data Hub', isNew: true },
    { id: 'team-permissions', label: 'Team Permissions' },
    { id: 'settings', label: 'Settings' },
  ]},
];

// Resolve which section a route id belongs to (for SectionTabs).
export function sectionForRoute(routeId: string): NavSection | undefined {
  return NAV.find((s) => s.items.some((i) => i.id === routeId));
}

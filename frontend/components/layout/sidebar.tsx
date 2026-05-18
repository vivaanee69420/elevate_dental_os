'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

const NAV_SECTIONS = [
  { label: 'Overview', items: [
    { id: 'dashboard', label: 'Command Centre' },
    { id: 'ai-insights', label: 'AI Insights' },
    { id: 'p4g-ai', label: 'Plan4Growth AI' },
  ]},
  { label: 'Finance', requiresFinance: true, items: [
    { id: 'cashflow', label: 'Cash Flow' },
    { id: 'profit', label: 'Profit & Loss' },
    { id: 'payments', label: 'Patient Payments' },
    { id: 'valuation', label: 'Valuation' },
  ]},
  { label: 'Business Health', items: [
    { id: 'health-setup', label: 'Setup & Targets', requiresOwner: true },
    { id: 'progress', label: 'Progress Tracker' },
    { id: 'kpiscorecard', label: 'KPI Scorecard' },
  ]},
  { label: 'Operations', items: [
    { id: 'associates', label: 'Associates' },
    { id: 'staff', label: 'Staff' },
    { id: 'chair', label: 'Chair Utilisation' },
    { id: 'treatments', label: 'Treatments' },
  ]},
  { label: 'Growth', items: [
    { id: 'patients', label: 'Patients' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'loyalty', label: 'Loyalty' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'booking', label: 'Online Booking' },
  ]},
  { label: 'Elevate CRM', items: [
    { id: 'inbox', label: 'Inbox' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'workflows', label: 'Workflows', requiresManager: true },
  ]},
  { label: 'Wealth', requiresOwner: true, items: [
    { id: 'wealth-net', label: 'Net Worth' },
    { id: 'wealth-prop', label: 'Property' },
    { id: 'wealth-pen', label: 'Pensions' },
    { id: 'wealth-fire', label: 'FIRE Plan' },
  ]},
  { label: 'System', requiresOwner: true, items: [
    { id: 'integrations', label: 'Integrations' },
    { id: 'team-permissions', label: 'Team Permissions' },
    { id: 'settings', label: 'Settings' },
  ]},
];

export function Sidebar() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ role: string; full_name: string } | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'Overview': true,
    'Elevate CRM': true,
  });

  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => {});
  }, []);

  const role = me?.role || 'reception';
  const isOwner = role === 'owner';
  const isManager = role === 'practice_manager' || isOwner;

  function canSeeSection(section: any) {
    if (section.requiresOwner && !isOwner) return false;
    if (section.requiresFinance && role === 'reception') return false;
    return true;
  }

  function canSeeItem(item: any) {
    if (item.requiresOwner && !isOwner) return false;
    if (item.requiresManager && !isManager) return false;
    return true;
  }

  return (
    <aside className="w-64 bg-card border-r border-border h-screen sticky top-0 overflow-y-auto">
      <div className="p-4 border-b border-border">
        <Link href="/dashboard" className="display text-xl font-bold text-brand">Elevate</Link>
      </div>

      {me && (
        <div className="px-3 py-2 mx-3 mt-3 bg-bg rounded-lg text-xs">
          <div className="font-bold">{me.full_name}</div>
          <div className="text-ink-muted capitalize">{role.replace('_', ' ')}</div>
        </div>
      )}

      <nav className="p-3 space-y-1">
        {NAV_SECTIONS.filter(canSeeSection).map((section) => {
          const items = section.items.filter(canSeeItem);
          if (items.length === 0) return null;
          const isOpen = openSections[section.label] ?? items.some((i) => pathname.includes(`/${i.id}`));
          return (
            <div key={section.label}>
              <button
                onClick={() => setOpenSections((s) => ({ ...s, [section.label]: !isOpen }))}
                className="w-full text-left text-xs uppercase tracking-wide font-semibold text-ink-muted px-3 py-2 flex justify-between items-center hover:text-ink"
              >
                <span>{section.label}</span>
                <span style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
              </button>
              {isOpen && items.map((item) => (
                <Link
                  key={item.id}
                  href={`/${item.id}`}
                  className={`block px-6 py-2 text-sm rounded-lg mx-2 ${
                    pathname.includes(`/${item.id}`) ? 'bg-brand text-white' : 'text-ink hover:bg-bg'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

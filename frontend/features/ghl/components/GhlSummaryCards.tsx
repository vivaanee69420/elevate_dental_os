'use client';
import { useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useGhlDashboard } from '../hooks';
import { SyncHealthTable } from './SyncHealthTable';

export function GhlSummaryCards({ since, until }: { since?: string; until?: string }) {
  const { data } = useGhlDashboard({ since, until });
  const [open, setOpen] = useState(false);

  if (!data || data.totals.sync.accounts === 0) return null;
  const t = data.totals;

  const cards = [
    { label: 'GHL Contacts', value: formatNumber(t.contacts.total) },
    { label: 'GHL Leads', value: formatNumber(t.leads.total) },
    { label: 'GHL Pipeline', value: formatPence(t.leads.pipelineValuePence) },
    { label: 'GHL Conversion', value: `${t.leads.conversionPct}%` },
  ];

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => setOpen((v) => !v)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{c.value}</div>
            <div className="mt-0.5 text-[12px] text-slate-400">Click for breakdown</div>
          </button>
        ))}
      </div>
      {open ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">GHL by subaccount</h3>
          <SyncHealthTable accounts={data.perAccount} />
        </div>
      ) : null}
    </section>
  );
}

'use client';
// Practices & Patients — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.patients). One card per GM
// Dental location with a 4-up 30-day metric strip (leads / consults /
// conversion / revenue). Fed by the growth mock-data layer; swap to a
// per-practice analytics endpoint when one exists server-side.
//
// Data flow:
//   PRACTICE_SUMMARY ──> one card per practice ──> 4-up metric grid

import { Card, Chip } from '@/components/ui';
import { formatPoundsCompact } from '@/features/_mock';
import { PRACTICE_SUMMARY } from '../data';

/** One labelled metric inside a practice card's 4-up grid. */
function Metric({ label, value, brand }: { label: string; value: string; brand?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div
        className="display font-semibold mt-1"
        style={{ fontSize: 22, color: brand ? 'var(--brand)' : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

/** Practices & Patients screen: a stack of per-practice performance cards. */
export default function PatientsScreen() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Practices &amp; Patients</h1>
        <p className="text-sm text-ink-muted mt-1">
          Performance across all 5 GM Dental locations
        </p>
      </div>

      {PRACTICE_SUMMARY.map((p) => (
        <Card key={p.name} className="mb-4">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="display font-semibold" style={{ fontSize: 18 }}>
                {p.name}
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">Last 30 days</p>
            </div>
            <Chip colour="brand">Active</Chip>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Metric label="Leads" value={String(p.leads_30d)} />
            <Metric label="Consults" value={String(p.consults_30d)} />
            <Metric label="Conversion" value={`${p.conversion_rate}%`} />
            <Metric label="Revenue" value={formatPoundsCompact(p.revenue_30d)} brand />
          </div>
        </Card>
      ))}
    </div>
  );
}

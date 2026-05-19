'use client';
// Automations (Workflows) — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.workflows at ~line 4099). Three
// summary KPIs over a table of automation workflows.
//
// Data flow: WORKFLOWS -> KPI aggregates + table rows.

import { useMemo } from 'react';
import { Card, DataTable, KpiTile, Chip, type Column } from '@/components/ui';
import { WORKFLOWS, type Workflow } from '../data';

/** Automations screen. */
export default function WorkflowsScreen() {
  // Header aggregates over the workflow set.
  const { active, totalSent, avgConv } = useMemo(() => {
    const a = WORKFLOWS.filter((w) => w.status === 'active').length;
    const sent = WORKFLOWS.reduce((s, w) => s + w.sent, 0);
    const conv =
      WORKFLOWS.reduce((s, w) => s + w.conversion, 0) / WORKFLOWS.length;
    return { active: a, totalSent: sent, avgConv: conv };
  }, []);

  const columns: Column<Workflow>[] = [
    {
      header: 'Workflow',
      render: (w) => <strong>{w.name}</strong>,
    },
    {
      header: 'Trigger',
      render: (w) => (
        <span className="text-ink-muted" style={{ fontSize: 12 }}>
          {w.trigger}
        </span>
      ),
    },
    { header: 'Steps', align: 'right', render: (w) => w.steps },
    {
      header: 'Sent',
      align: 'right',
      render: (w) => w.sent.toLocaleString('en-GB'),
    },
    {
      header: 'Conversion',
      align: 'right',
      render: (w) => (
        <span style={{ fontWeight: 600 }}>{w.conversion}%</span>
      ),
    },
    {
      header: 'Status',
      render: (w) => (
        <Chip colour={w.status === 'active' ? 'emerald' : 'amber'}>
          {w.status}
        </Chip>
      ),
    },
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Workflows
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {active} active · {totalSent.toLocaleString('en-GB')} messages TTM
        </p>
      </div>

      {/* 3 KPIs */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
      >
        <KpiTile label="Active workflows" value={String(active)} />
        <KpiTile
          label="Messages sent"
          value={totalSent.toLocaleString('en-GB')}
        />
        <KpiTile label="Avg conversion" value={`${avgConv.toFixed(1)}%`} />
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={WORKFLOWS}
          rowKey={(w) => w.name}
        />
      </Card>
    </div>
  );
}
